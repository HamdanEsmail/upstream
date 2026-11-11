// Names what changed between an older sentence and a newer one. Worked out from the two
// sentences alone, so every change it reports can be checked by reading them.
import { normalise, numbers, years, type Quantity } from "./text";

export type ChangeKind = "rounded" | "number_changed" | "careful_word_dropped" | "year_dropped";

export type Change = { kind: ChangeKind; detail: string };

/** Two numbers this close are the same figure rounded. */
const ROUNDING = 0.05;

// Words that make a statement careful, by kind. Losing every word of a kind makes the
// statement sound firmer than its source; swapping "about" for "nearly" does not.
const CAREFUL_KINDS = [
  ["about", "approximately", "around", "roughly", "nearly", "almost"],
  ["at least", "a minimum of", "more than"],
  ["up to", "at most", "a maximum of", "as many as", "as much as", "less than"],
  ["an average of", "on average"],
  ["estimated"],
  ["usually", "typically", "generally"],
  ["may", "might", "could"],
];

function significantDigits(value: number): number {
  const digits = String(Math.abs(value)).replace(/e.*$/, "").replace(".", "").replace(/^0+/, "").replace(/0+$/, "");
  return Math.max(1, digits.length);
}

function numberChanges(older: string, newer: string): Change[] {
  const sameClass = (a: Quantity, b: Quantity) => (a.unit === "percent") === (b.unit === "percent");
  let was = numbers(older);
  let now = numbers(newer);
  // A figure both sentences carry has not changed.
  for (const n of [...now]) {
    const twin = was.find((o) => o.value === n.value && sameClass(o, n));
    if (!twin) continue;
    was = was.filter((o) => o !== twin);
    now = now.filter((x) => x !== n);
  }

  const out: Change[] = [];
  for (const n of [...now]) {
    const near = was.find((o) => sameClass(o, n) && Math.abs(o.value - n.value) / Math.max(Math.abs(o.value), Math.abs(n.value)) <= ROUNDING);
    if (!near || significantDigits(n.value) > significantDigits(near.value)) continue;
    out.push({ kind: "rounded", detail: `${near.raw} became ${n.raw}` });
    was = was.filter((o) => o !== near);
    now = now.filter((x) => x !== n);
  }
  // Only when exactly one figure is left on each side is it clear which became which.
  const [o, n] = [was[0], now[0]];
  if (was.length === 1 && now.length === 1 && o && n && sameClass(o, n)) out.push({ kind: "number_changed", detail: `${o.raw} became ${n.raw}` });
  return out;
}

function carefulAt(text: string, phrase: string): number {
  // "may" is also a month: "14 May 2015" is not a careful word.
  const re = phrase === "may" ? /(?<![a-z])(?<!\d )may(?! \d)(?![a-z])/ : new RegExp(`(?<![a-z])${phrase}(?![a-z])`);
  return text.search(re);
}

function carefulChanges(older: string, newer: string): Change[] {
  const was = normalise(older);
  const now = normalise(newer);
  const dropped = CAREFUL_KINDS.filter((kind) => kind.every((phrase) => carefulAt(now, phrase) === -1))
    .flat()
    .map((phrase) => ({ phrase, at: carefulAt(was, phrase) }))
    .filter((p) => p.at !== -1)
    .sort((a, b) => a.at - b.at);
  if (dropped.length === 0) return [];
  return [{ kind: "careful_word_dropped", detail: "dropped " + dropped.map((p) => `"${p.phrase}"`).join(", ") }];
}

function yearChanges(older: string, newer: string): Change[] {
  const was = years(older);
  if (was.length === 0 || years(newer).length > 0) return [];
  const current = /(?<![a-z])(now|today|currently|nowadays)(?![a-z])/;
  const word = current.exec(normalise(newer))?.[1];
  if (word && !current.test(normalise(older))) return [{ kind: "year_dropped", detail: `${was[0]} became "${word}"` }];
  const list = [...new Set(was)];
  return [{ kind: "year_dropped", detail: list.length === 1 ? `the year ${list[0]} is gone` : `the years ${list.join(" and ")} are gone` }];
}

/** Every change code can name, in a fixed order: figures, careful words, years. */
export function namedChanges(older: string, newer: string): Change[] {
  return [...numberChanges(older, newer), ...carefulChanges(older, newer), ...yearChanges(older, newer)];
}
