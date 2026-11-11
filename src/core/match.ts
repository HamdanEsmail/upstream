// Finds where a page states a claim, and says how sure the reading is.
import { contentWords, normalise, numbers, sentences } from "./text";

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

/** Looks for `claim` in `pageText` and returns the page's own sentence that states it. */
export function findClaim(pageText: string, claim: string): Found {
  const wanted = core(claim);
  const list = sentences(pageText);
  if (wanted.length < 8 || list.length === 0) return { reading: "not_found", sentence: null, score: 0 };

  const claimStems = stems(claim);
  let best: { sentence: string; score: number } | null = null;
  for (const s of list) {
    if (normalise(s).includes(wanted)) return { reading: "exact", sentence: s, score: 1 };
    const sc = score(claim, claimStems, s);
    if (best === null || sc > best.score) best = { sentence: s, score: sc };
  }
  // A claim that runs across sentences is still word for word on the page: return all of them.
  const across = spanned(list, wanted);
  if (across !== null) return { reading: "exact", sentence: across, score: 1 };
  if (best !== null && best.score >= CLOSE_AT) return { reading: "close", sentence: best.sentence, score: best.score };
  return { reading: "not_found", sentence: null, score: best?.score ?? 0 };
}
