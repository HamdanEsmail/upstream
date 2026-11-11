// Plain text helpers. Everything Upstream compares goes through these first.

/** One quantity found in a sentence. `raw` is the text as written. */
export type Quantity = { value: number; unit: "percent" | null; raw: string };

/** Same characters for the same meaning: straight quotes, plain dashes, single spaces, lower case. */
export function normalise(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[­​-‍﻿]/g, "")
    .replace(/[“”„«»]/g, '"')
    .replace(/[‘’‚]/g, "'")
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Footnote marks as encyclopaedias print them, attached to the word or full stop before them:
// [36], [a], [note 2], [citation needed]. They are not part of what the page says.
const FOOTNOTE = /(?<=\S)\\?\[(?:\d{1,3}|[a-z]|note \d{1,3}|citation needed)\\?\]/gi;

/** The text without its footnote marks. */
export function withoutFootnotes(s: string): string {
  return s.replace(FOOTNOTE, "");
}

// A full stop after one of these does not end a sentence.
const ABBREVIATIONS = new Set([
  "dr", "mr", "mrs", "ms", "prof", "st", "vs", "etc", "inc", "ltd", "jr", "sr", "fig", "no", "vol", "approx", "est", "e.g", "i.e", "ph.d",
]);

function endsWithAbbreviation(before: string): boolean {
  const word = /([A-Za-z][A-Za-z.]*)$/.exec(before)?.[1] ?? "";
  if (word === "") return false;
  if (/^[A-Z]$/.test(word) || /^(?:[A-Za-z]\.)+[A-Za-z]$/.test(word)) return true; // an initial, or U.S / e.g
  return ABBREVIATIONS.has(word.toLowerCase());
}

function splitLine(line: string): string[] {
  const out: string[] = [];
  const end = /[.?!]+["'”’)\]]*\s+(?=["'“‘(\[]?[A-Z0-9])/g;
  let start = 0;
  for (let m = end.exec(line); m !== null; m = end.exec(line)) {
    const stop = m.index + m[0].trimEnd().length;
    const body = line.slice(start, m.index);
    if (m[0].startsWith(".") && endsWithAbbreviation(body)) continue;
    out.push(line.slice(start, stop));
    start = m.index + m[0].length;
  }
  if (start < line.length) out.push(line.slice(start));
  return out;
}

/** Splits page text (plain or markdown) into sentences, keeping the page's own characters. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  for (const rawLine of text.split(/\n+/)) {
    const line = withoutFootnotes(rawLine)
      .replace(/^\s*(?:#{1,6}|[-*+>]|\d+\.)\s+/, "")
      .replace(/\*\*|__/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (line === "") continue;
    for (const s of splitLine(line)) {
      const t = s.trim();
      if (t !== "") out.push(t);
    }
  }
  return out;
}

const ONES: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };

const DIGITS = "\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?";
const WORDS = `(?:${Object.keys(TENS).join("|")})(?:[-\\s](?:one|${Object.keys(ONES).slice(0, 8).join("|")}))?|${Object.keys(ONES).join("|")}`;
const QUANTITY = new RegExp(
  `(?<![\\w.,])(?:(?<digits>${DIGITS})|(?<words>${WORDS}))(?![\\w])(?:\\s*(?<scale>${Object.keys(SCALES).join("|")})\\b)?(?<percent>\\s*%|\\s+per\\s?cent\\b)?`,
  "gi",
);

function wordValue(words: string): number {
  const parts = words.toLowerCase().split(/[-\s]/);
  const first = parts[0] ?? "";
  if (first in TENS) return (TENS[first] ?? 0) + (parts[1] === "one" ? 1 : (ONES[parts[1] ?? ""] ?? 0));
  return ONES[first] ?? 0;
}

/** Every quantity in a sentence, in order. A bare year (1500 to 2099) is not a quantity. */
export function numbers(s: string): Quantity[] {
  const out: Quantity[] = [];
  for (const m of s.matchAll(QUANTITY)) {
    const g = m.groups ?? {};
    const scale = g.scale ? (SCALES[g.scale.toLowerCase()] ?? 1) : 1;
    let value: number;
    if (g.digits !== undefined) {
      const plain = /^\d{4}$/.test(g.digits) && !g.scale && !g.percent;
      value = Number(g.digits.replace(/,/g, ""));
      if (plain && value >= 1500 && value <= 2099) continue;
    } else {
      value = wordValue(g.words ?? "");
    }
    out.push({ value: Number((value * scale).toPrecision(12)), unit: g.percent ? "percent" : null, raw: m[0].trim() });
  }
  return out;
}

/** Four-digit years, 1500 to 2099. A decade such as "the 2000s" is not a year. */
export function years(s: string): number[] {
  return [...s.matchAll(/(?<![\w.,])(1[5-9]\d\d|20\d\d)(?![\w]|[.,]\d)/g)].map((m) => Number(m[1]));
}

const STOP = new Set(
  "a an the is are was were be been being of in on at to for and or that this these those it its as by with from has have had than their our your we you they he she his her but if so do does did will would can".split(" "),
);

/** The words that carry meaning, lower case, in order. */
export function contentWords(s: string): string[] {
  return normalise(s)
    .split(/[^a-z0-9%]+/)
    .filter((w) => w !== "" && !STOP.has(w));
}
