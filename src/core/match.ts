// Finds where a page states a claim, and says how sure the reading is.
import { contentWords, normalise, numbers, sentences, withoutFootnotes } from "./text";

/** `exact`: word for word. `close`: the same statement in slightly different words. */
export type Reading = "exact" | "close" | "not_found";

export type Found = { reading: Reading; sentence: string | null; score: number };

const CLOSE_AT = 0.6;

/** The claim without the quote marks, dots and spaces around it. */
function core(claim: string): string {
  return normalise(claim).replace(/^[\s"'.…]+|[\s"'.…]+$/g, "");
}

function stem(word: string): string {
  let w = word;
  if (w.length > 3 && !w.endsWith("ss")) w = w.replace(/(?:es|s)$/, "");
  if (w.length > 5) w = w.replace(/(?:ing|ed)$/, "");
  return w.length > 3 ? w.replace(/e$/, "") : w;
}

/** The meaning-carrying words of a sentence, without figures, reduced to their stems. */
function stems(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of contentWords(s)) {
    if (/\d|%/.test(w) || w === "percent" || w === "per" || w === "cent") continue;
    out.add(stem(w));
  }
  return out;
}

function score(claim: string, claimStems: Set<string>, sentence: string): number {
  if (claimStems.size === 0) return 0;
  const theirs = stems(sentence);
  let shared = 0;
  for (const w of claimStems) if (theirs.has(w)) shared++;
  const overlap = shared / claimStems.size;
  const mine = numbers(claim);
  if (mine.length === 0) return overlap;
  const found = numbers(sentence);
  const hit = mine.some((a) => found.some((b) => a.value === b.value));
  return overlap * 0.75 + (hit ? 0.25 : 0);
}

/** True when two sentences say the same thing in largely the same words, so comparing them is fair. */
export function restates(a: string, b: string): boolean {
  const sa = stems(a);
  const sb = stems(b);
  const smaller = Math.min(sa.size, sb.size);
  if (smaller === 0) return false;
  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared++;
  return shared / smaller >= 0.5;
}

/** The run of neighbouring sentences that together hold `wanted`, or null when the page does not. */
function spanned(list: string[], wanted: string): string | null {
  const parts = list.map(normalise);
  const at = parts.join(" ").indexOf(wanted);
  if (at === -1) return null;
  const end = at + wanted.length;
  let from = -1;
  let to = -1;
  let offset = 0;
  for (const [i, part] of parts.entries()) {
    const stop = offset + part.length;
    if (from === -1 && at < stop) from = i;
    if (end <= stop + 1) {
      to = i;
      break;
    }
    offset = stop + 1;
  }
  return from === -1 || to === -1 ? null : list.slice(from, to + 1).join(" ");
}

/**
 * Pages longer than this are read up to here. Matching a page must fit in the few
 * milliseconds of processing a free Cloudflare Worker step is allowed.
 */
const MOST_CHARS = 120_000;

/** Short prefixes of the claim's words: a cheap first test before a sentence is scored. */
function keys(claim: string): string[] {
  const out = new Set<string>();
  for (const w of contentWords(claim)) if (w.length >= 3 && !/\d|%/.test(w)) out.add(w.slice(0, 5));
  return [...out];
}

// A heading, a list item, a quotation or a table row: never the middle of a sentence.
const BLOCK = /^\s*(?:#{1,6}\s|[-*+>]\s|\d+\.\s|\|)/;
const ENDS = /[.?!:;]["'”’)\]]*\s*$/;
/** How many lines either side of a sentence are looked at when putting it back together. Some PDFs give one word to a line. */
const REACH = 12;

/** True when line `b` carries on a sentence that line `a` leaves unfinished. */
function carriesOn(a: string, b: string): boolean {
  if (a.trim() === "" || b.trim() === "" || BLOCK.test(a) || BLOCK.test(b)) return false;
  return /^\s*[a-z]/.test(b) || (!ENDS.test(a) && /^\s*\d/.test(b));
}

/**
 * Some pages, PDFs above all, break their lines in the middle of a sentence or even of a
 * word. This takes the lines around the best sentence found so far, joins them both ways
 * (with a space, and with nothing), and returns a better reading when one comes out of it.
 */
function mended(text: string, claim: string, claimStems: Set<string>, wanted: string, best: { sentence: string; score: number }): Found | null {
  // A line holding only a tab or spaces is a leftover of the page's layout, not a paragraph break.
  const lines = text.split("\n").filter((l) => l === "" || l.trim() !== "");
  const probe = best.sentence.slice(0, 24);
  const at = lines.findIndex((l) => l.includes(probe));
  if (at === -1) return null;
  let from = at;
  let to = at;
  while (from > 0 && at - from < REACH && carriesOn(lines[from - 1] as string, lines[from] as string)) from--;
  while (to < lines.length - 1 && to - at < REACH && carriesOn(lines[to] as string, lines[to + 1] as string)) to++;
  if (from === to) return null;

  let out: Found | null = null;
  for (const glue of [" ", ""]) {
    const joined = lines.slice(from, to + 1).join(glue);
    const list = sentences(joined);
    if (normalise(withoutFootnotes(joined)).includes(wanted)) {
      const whole = list.find((s) => normalise(s).includes(wanted)) ?? spanned(list, wanted);
      if (whole !== null) return { reading: "exact", sentence: whole, score: 1 };
    }
    for (const s of list) {
      const sc = score(claim, claimStems, s);
      if (sc > (out?.score ?? best.score)) out = { reading: "close", sentence: s, score: sc };
    }
  }
  return out !== null && out.score >= CLOSE_AT ? out : null;
}

/**
 * Looks for `claim` in `pageText` and returns the page's own sentence that states it.
 * Cheap tests come first so that a long page costs little: the whole page is checked once
 * for the exact words, and only sentences sharing words with the claim are scored.
 */
export function findClaim(pageText: string, rawClaim: string): Found {
  // A footnote mark copied along with the highlight is not part of the claim.
  const claim = withoutFootnotes(rawClaim);
  const wanted = core(claim);
  const text = pageText.length > MOST_CHARS ? pageText.slice(0, MOST_CHARS) : pageText;
  const list = sentences(text);
  if (wanted.length < 8 || list.length === 0) return { reading: "not_found", sentence: null, score: 0 };
  const lowered = list.map((s) => s.toLowerCase());

  if (normalise(withoutFootnotes(text)).includes(wanted)) {
    const anchor = (wanted.match(/[a-z]{5,}/g) ?? []).reduce((a, b) => (b.length > a.length ? b : a), "");
    for (const [i, s] of list.entries()) {
      if (anchor !== "" && !(lowered[i] as string).includes(anchor)) continue;
      if (normalise(s).includes(wanted)) return { reading: "exact", sentence: s, score: 1 };
    }
    // A claim that runs across sentences is still word for word on the page: return all of them.
    const across = spanned(list, wanted);
    if (across !== null) return { reading: "exact", sentence: across, score: 1 };
  }

  const claimStems = stems(claim);
  const prefixes = keys(claim);
  const need = prefixes.length >= 4 ? 2 : 1;
  let best: { sentence: string; score: number } | null = null;
  for (const [i, s] of list.entries()) {
    const low = lowered[i] as string;
    let hits = 0;
    for (const p of prefixes) if (low.includes(p) && ++hits >= need) break;
    if (prefixes.length > 0 && hits < need) continue;
    const sc = score(claim, claimStems, s);
    if (best === null || sc > best.score) best = { sentence: s, score: sc };
  }
  const better = best === null ? null : mended(text, claim, claimStems, wanted, best);
  if (better !== null) return better;
  if (best !== null && best.score >= CLOSE_AT) return { reading: "close", sentence: best.sentence, score: best.score };
  return { reading: "not_found", sentence: null, score: best?.score ?? 0 };
}
