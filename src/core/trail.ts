// A trail is a list of steps from the highlighted page back to the earliest source.
// These helpers join the steps the two engines find and put them in order.
import type { Reading } from "./match";

/** `unreadable`: the page could not be read. `offline`: named by another step, not readable online. */
export type StepReading = Reading | "unreadable" | "offline";

/** How a step was reached from the one before it. `start` is the highlighted page itself. */
export type ReachedBy = "start" | "link" | "named" | "search";

export type Step = {
  url: string | null;
  publisher: string;
  title: string | null;
  /** A year, a year and month, or a full day. */
  date: string | null;
  dateSource: "page" | "archive" | "research" | null;
  /** The sentence found on the page; for an offline source, the wording as another page quotes it. */
  wording: string | null;
  reading: StepReading;
  readFrom: "live" | "archive" | null;
  archiveUrl: string | null;
  reachedBy: ReachedBy;
  namesSource: string | null;
};

const TRACKING = /^(?:utm_\w+|fbclid|gclid|srsltid|ref)$/i;

/** One key per page, or null when the text is not a web address. */
function addressKey(address: string): string | null {
  const saved = /^https?:\/\/web\.archive\.org\/web\/\d+[a-z_]*\/(.+)$/i.exec(address.trim());
  let target = saved ? (saved[1] ?? "") : address.trim();
  if (saved && !/^https?:\/\//i.test(target)) target = "http://" + target;
  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const kept = [...u.searchParams].filter(([name]) => !TRACKING.test(name)).map(([name, value]) => `${name}=${value}`);
  return u.hostname.toLowerCase().replace(/^www\./, "") + u.pathname.replace(/\/+$/, "") + (kept.length > 0 ? "?" + kept.join("&") : "");
}

/** True when two addresses are the same page: scheme, www, trailing slash, fragment and tracking tags aside. */
export function sameAddress(a: string, b: string): boolean {
  const ka = addressKey(a);
  return ka !== null && ka === addressKey(b);
}

/** Joins two lists of steps. A page in both keeps its first entry, with gaps filled from the second. */
export function mergeSteps(first: Step[], second: Step[]): Step[] {
  const out = first.map((s) => ({ ...s }));
  for (const s of second) {
    const twin = s.url === null ? undefined : out.find((r) => r.url !== null && sameAddress(r.url, s.url as string));
    if (!twin) {
      out.push({ ...s });
      continue;
    }
    if (twin.date === null && s.date !== null) {
      twin.date = s.date;
      twin.dateSource = s.dateSource;
    }
    if (twin.wording === null) twin.wording = s.wording;
    if (twin.namesSource === null) twin.namesSource = s.namesSource;
    if (twin.publisher === "") twin.publisher = s.publisher;
    if (twin.title === null) twin.title = s.title;
  }
  return out;
}

/** "2011" and "2011-05" compare as the start of that year or month. */
const sortable = (date: string): string => (date + "-00-00").slice(0, 10);

/**
 * The highlighted page stays first; the rest run from newest to oldest. A step with no
 * date stays right after the step it followed.
 */
export function orderSteps(steps: Step[]): Step[] {
  const [start, ...rest] = steps;
  if (!start) return [];
  let carried = "9999-99-99";
  const keyed = rest.map((s, index) => {
    if (s.date !== null) carried = sortable(s.date);
    return { s, key: carried, index };
  });
  keyed.sort((a, b) => (a.key === b.key ? a.index - b.index : a.key < b.key ? 1 : -1));
  return [start, ...keyed.map((k) => k.s)];
}

/** `previousLinks` are the links on the step before; `previousNames` is the source that step names, if any. */
export function reachedBy(previousLinks: string[], url: string | null, previousNames: string | null): ReachedBy {
  if (url !== null && previousLinks.some((link) => sameAddress(link, url))) return "link";
  return previousNames !== null && previousNames !== "" ? "named" : "search";
}
