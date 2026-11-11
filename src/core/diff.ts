// Word-by-word comparison of an older sentence with a newer one.
import { normalise } from "./text";

export type DiffRun = { op: "same" | "removed" | "added"; text: string };

function tokens(s: string): string[] {
  return s.split(/\s+/).filter((t) => t !== "");
}

/** What two tokens are compared by: lower case, no punctuation at either end. */
function key(token: string): string {
  return normalise(token).replace(/^[^a-z0-9%]+|[^a-z0-9%]+$/g, "");
}

/**
 * `removed` words are in the older sentence only, `added` words in the newer one only.
 * Words both share are shown in the newer sentence's spelling.
 */
export function wordDiff(older: string, newer: string): DiffRun[] {
  const a = tokens(older);
  const b = tokens(newer);
  const ka = a.map(key);
  const kb = b.map(key);

  // lcs[i][j] = length of the longest common run of words in a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = ka[i] === kb[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const runs: DiffRun[] = [];
  const push = (op: DiffRun["op"], word: string) => {
    const last = runs[runs.length - 1];
    if (last && last.op === op) last.text += " " + word;
    else runs.push({ op, text: word });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (ka[i] === kb[j]) {
      push("same", b[j]!);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      push("removed", a[i]!);
      i++;
    } else {
      push("added", b[j]!);
      j++;
    }
  }
  for (; i < a.length; i++) push("removed", a[i]!);
  for (; j < b.length; j++) push("added", b[j]!);
  return runs;
}
