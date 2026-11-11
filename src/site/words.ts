// The plain words the pages use for the states a trail can be in. One place, so the trail
// page, the side panel and the API say the same thing.

const VERDICTS: Record<string, string> = {
  said_by_someone_else: "Said by someone else",
  no_original_source: "No original source",
  changed_on_the_way: "Changed on the way",
  out_of_date: "Out of date",
  matches_original: "Matches the original",
  not_settled: "Not settled",
};

/** A sentence in quotation marks; one that already opens with a mark is left as it is. */
export function quoted(text: string): string {
  const t = text.trim();
  return /^["“‘'«]/.test(t) ? t : `“${t}”`;
}

export function verdictWords(verdict: string | null): string {
  return VERDICTS[verdict ?? "not_settled"] ?? "Not settled";
}

/** What the verdict rests on. */
export function reachedLine(reached: string | null): string {
  if (reached === "original") return "This rests on the original source, which was read.";
  if (reached === "earliest_copy") return "This rests on the earliest copy found, not on an original source.";
  return "No earlier source could be confirmed.";
}

export function readingWords(reading: string, readFrom: string | null, quotedBy: string | null): string {
  const where = readFrom === "archive" ? ", in a saved copy" : "";
  if (reading === "exact") return `Found word for word${where}.`;
  if (reading === "close") return `Found in slightly different words${where}.`;
  if (reading === "not_found") return "The wording was not found on this page.";
  if (reading === "offline") return quotedBy ? `Not readable online. Quoted by ${quotedBy}.` : "Not readable online.";
  return "This page could not be read.";
}

export function reachedWords(reachedBy: string): string {
  if (reachedBy === "start") return "The page you read.";
  if (reachedBy === "link") return "Linked from a page above.";
  if (reachedBy === "named") return "Named by the page above, without a link.";
  return "Found by search, not by a link.";
}

export function changeWords(kind: string, detail: string): string {
  if (kind === "rounded") return `rounded: ${detail}`;
  if (kind === "number_changed") return `the figure changed: ${detail}`;
  if (kind === "careful_word_dropped") return detail.replace(/^dropped /, "careful words dropped: ");
  return detail;
}

/** Where a date came from, when it is not the page's own. */
export function dateSourceWords(dateSource: string | null): string | null {
  if (dateSource === "archive") return "first saved by the Internet Archive";
  if (dateSource === "research") return "date given by the deep search";
  return null;
}

/** What a running trace is doing, for the waiting display. */
export function stageWords(status: string, pagesRead: number, latestHosts: string[]): string {
  if (status === "following") return "Reading the page and following its links.";
  if (status === "searching") {
    if (pagesRead === 0) return "The deep search has started.";
    // "a", "a and b", "a, b and c"
    const listed = latestHosts.length > 1 ? `${latestHosts.slice(0, -1).join(", ")} and ${latestHosts[latestHosts.length - 1]}` : (latestHosts[0] ?? "");
    const latest = listed !== "" ? `, most recently ${listed}` : "";
    return `The deep search has read ${pagesRead} ${pagesRead === 1 ? "page" : "pages"} so far${latest}.`;
  }
  if (status === "checking") return "Re-reading each step the deep search proposed.";
  return "";
}

/** "5 min 13 s", "48 s". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}
