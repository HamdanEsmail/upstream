// The question Upstream puts to the research run for one highlighted sentence.
import { TEXT_MAX } from "../core/limits";

/** The closing block the report must end with. `readTrail` in core/report.ts reads it. */
const SHAPE =
  '{"steps":[{"url":"","publisher":"","date":"YYYY-MM-DD, YYYY-MM, YYYY or unknown","wording":"exact sentence copied from that page","names_source":"what that page names as its source, or none","linked":true}],' +
  '"origin":{"found":true,"url":"","kind":"study, report, dataset, book, speech, interview or other","note":""},' +
  '"changes":["one plain sentence per change"],' +
  '"verdict":"matches_original, changed_on_the_way, said_by_someone_else, outdated or no_original_source",' +
  '"summary":"two plain sentences"}';

/** Double quotes inside the highlight would end the quotation early, so they become single ones. */
const quotable = (s: string): string => s.replace(/["“”„«»]/g, "'").replace(/\s+/g, " ").trim().slice(0, TEXT_MAX);

export function buildQuery(pageUrl: string, text: string, known: { url: string; wording: string | null }[]): string {
  const lines = [
    "A reader highlighted a sentence on a web page and wants to know where it really comes from.",
    "",
    `Page: ${pageUrl}`,
    `Highlighted text: "${quotable(text)}"`,
    "",
    "Trace the claim in the highlighted text upstream to its original source, one step at a time: the page above, then the source that page gives for it, then the source that one gives, and so on until the earliest source you can find (the study, report, dataset, book, speech or interview where it first appeared). Open and read each page yourself; do not rely on someone else's summary when the page itself can be read.",
    "",
    "For every step report: the page address, the publisher, the publication date, the exact sentence on that page that states the claim (copied word for word), and which source that page names for it. Say whether the page links to that source or only names it.",
    "",
    "Say plainly whether the wording, the number, the year, the place or the group of people changed between steps. For a quotation, find the earliest known appearance and who actually said or wrote it.",
    "",
    "If no original source can be found, say so plainly and name the page where the trail goes cold. Do not present the most popular copy as the origin.",
  ];
  if (known.length > 0) {
    lines.push("", "Steps already found by following the page's links (check them, then go further back):");
    for (const k of known) lines.push(`- ${k.url}${k.wording ? `: "${quotable(k.wording)}"` : ""}`);
  }
  lines.push(
    "",
    "End the report with one fenced code block labelled json, with nothing after it, in exactly this shape:",
    SHAPE,
    "Order the steps from the highlighted page (first) to the earliest source (last).",
  );
  return lines.join("\n");
}
