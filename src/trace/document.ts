// A trail as the pages and the API show it: the stored trace with its links, plain dates,
// marked words, change notes and citation worked out.
import { citation } from "../core/cite";
import { plainDate } from "../core/dates";
import type { DiffRun } from "../core/diff";
import { sentenceLink } from "../core/fragment";
import { siteName } from "../core/links";
import type { Reached, Verdict } from "../core/verdict";
import type { Env } from "../env";
import { changeWords, verdictWords } from "../site/words";
import { getChanges, getEvents, getSteps, getTrace, type StoredChange, type StoredStep, type TraceStatus } from "./store";

export type DocumentStep = {
  position: number;
  url: string | null;
  /** Where "open" leads: the sentence on the page, the saved copy, or the plain address. */
  openUrl: string | null;
  publisher: string;
  /** What to call the source: a short publisher name, else the site. */
  name: string;
  title: string | null;
  date: string | null;
  datePlain: string;
  dateSource: string | null;
  wording: string | null;
  reading: string;
  readFrom: string | null;
  archiveUrl: string | null;
  reachedBy: string;
  namesSource: string | null;
  quotedBy: string | null;
  /** This step's sentence with the words a named change points at marked `added`; null when there are none. */
  marks: DiffRun[] | null;
  /** What changed on the way to this step, in plain words. */
  notes: string[];
};

export type TrailDocument = {
  id: string;
  url: string;
  pageUrl: string;
  pageSite: string;
  text: string;
  status: TraceStatus;
  running: boolean;
  verdict: string | null;
  verdictWords: string;
  reached: string | null;
  summary: string | null;
  error: string | null;
  progress: { pagesRead: number; latestHosts: string[]; startedAt: string; deepStartedAt: string | null };
  /** Seconds from start to finish; null while running. */
  seconds: number | null;
  steps: DocumentStep[];
  /** Changes the deep search described that code cannot check. */
  noted: string[];
  events: { at: string; message: string }[];
  cite: { plain: string; markdown: string } | null;
  spendUsd: number;
  createdAt: string;
  finishedAt: string | null;
};

const confirmed = (s: StoredStep): boolean => s.wording !== null && (s.reading === "exact" || s.reading === "close" || s.reading === "offline");

function openUrl(s: StoredStep): string | null {
  if (s.url === null) return null;
  if (s.readFrom === "archive" && s.archiveUrl !== null) return sentenceLink(s.archiveUrl, s.wording ?? "");
  if (s.wording !== null && (s.reading === "exact" || s.reading === "close")) return sentenceLink(s.url, s.wording);
  return s.url;
}

const NAME_MAX = 44;
const TITLE_MAX = 120;
const SOURCE_MAX = 180;

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max) + "…" : s);

/** A short publisher name when there is one, else the site; a print-only source keeps its name. */
function nameOf(s: StoredStep): string {
  if (s.url === null) return clip(s.publisher, 80);
  return s.publisher !== "" && s.publisher.length <= NAME_MAX ? s.publisher : siteName(s.url);
}

const NAMED: Record<string, string> = { amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

/** Page titles sometimes arrive with character codes left in ("world&apos;s"). The page shows the characters. */
function decoded(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    const c = String(code).toLowerCase();
    if (c.startsWith("#x")) return String.fromCodePoint(parseInt(c.slice(2), 16) || 0xfffd);
    if (c.startsWith("#")) return String.fromCodePoint(parseInt(c.slice(1), 10) || 0xfffd);
    return NAMED[c] ?? whole;
  });
}

/** A page title worth showing: long enough to say something, clipped when very long. */
function titleOf(s: StoredStep): string | null {
  const title = s.title === null ? "" : decoded(s.title).trim();
  return title.length >= 8 ? clip(title, TITLE_MAX) : null;
}

/** What a change note points at in the newer sentence: the new figure, or the word a year became. */
function target(change: StoredChange): string | null {
  if (change.kind === "rounded" || change.kind === "number_changed") return change.detail.split(" became ")[1] ?? null;
  if (change.kind === "year_dropped") return /became "([^"]+)"/.exec(change.detail)?.[1] ?? null;
  return null;
}

/** The sentence cut into runs, with the words the change notes point at marked. */
function marks(wording: string | null, notes: StoredChange[]): DiffRun[] | null {
  if (wording === null) return null;
  const spans: { from: number; to: number }[] = [];
  for (const note of notes) {
    const word = target(note);
    if (!word) continue;
    // The word is taken literally: every character with a meaning in a pattern is escaped.
    const literal = word.replace(/[.*+?^${}()|[\]\\]/g, (ch) => "\\" + ch);
    const at = new RegExp(`(?<![a-z0-9])${literal}(?![a-z0-9])`, "i").exec(wording);
    if (at && !spans.some((s) => at.index < s.to && at.index + word.length > s.from)) spans.push({ from: at.index, to: at.index + word.length });
  }
  if (spans.length === 0) return null;
  spans.sort((a, b) => a.from - b.from);
  const runs: DiffRun[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.from > cursor) runs.push({ op: "same", text: wording.slice(cursor, span.from) });
    runs.push({ op: "added", text: wording.slice(span.from, span.to) });
    cursor = span.to;
  }
  if (cursor < wording.length) runs.push({ op: "same", text: wording.slice(cursor) });
  return runs;
}

export async function buildDocument(env: Env, id: string): Promise<TrailDocument | null> {
  const trace = await getTrace(env.DB, id);
  if (!trace) return null;
  const [steps, changes, events] = await Promise.all([getSteps(env.DB, id), getChanges(env.DB, id), getEvents(env.DB, id, 8)]);
  const url = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/t/${trace.id}`;
  const running = trace.status !== "done" && trace.status !== "failed";

  const origin = [...steps].reverse().find((s, k) => k < steps.length - 1 && confirmed(s)) ?? (steps.length > 1 ? steps[steps.length - 1] : undefined);
  const cite =
    trace.status === "done"
      ? citation({
          verdict: (trace.verdict ?? "not_settled") as Verdict,
          reached: (trace.reached ?? "nothing") as Reached,
          origin: origin ? { publisher: nameOf(origin), title: titleOf(origin), date: origin.date, url: origin.url, wording: origin.wording } : null,
          trailUrl: url,
        })
      : null;

  return {
    id: trace.id,
    url,
    pageUrl: trace.pageUrl,
    pageSite: siteName(trace.pageUrl),
    text: trace.text,
    status: trace.status,
    running,
    verdict: trace.status === "done" ? trace.verdict : null,
    verdictWords: verdictWords(trace.verdict),
    reached: trace.reached,
    summary: trace.summary,
    error: trace.error,
    progress: { pagesRead: trace.pagesRead, latestHosts: trace.latestHosts, startedAt: trace.createdAt, deepStartedAt: trace.researchStartedAt },
    seconds: trace.finishedAt === null ? null : Math.round((Date.parse(trace.finishedAt) - Date.parse(trace.createdAt)) / 1000),
    steps: steps.map((s, i) => ({
      position: i,
      url: s.url,
      openUrl: openUrl(s),
      publisher: s.publisher || siteName(s.url),
      name: nameOf(s),
      title: titleOf(s),
      date: s.date,
      datePlain: plainDate(s.date),
      dateSource: s.dateSource,
      wording: s.wording,
      reading: s.reading,
      readFrom: s.readFrom,
      archiveUrl: s.archiveUrl,
      reachedBy: s.reachedBy,
      namesSource: s.namesSource === null ? null : clip(s.namesSource, SOURCE_MAX),
      quotedBy: s.quotedBy,
      marks: marks(s.wording, changes.filter((c) => c.basis === "code" && c.toPosition === i)),
      notes: changes.filter((c) => c.basis === "code" && c.toPosition === i).map((c) => changeWords(c.kind, c.detail)),
    })),
    noted: changes.filter((c) => c.basis === "research").map((c) => c.detail),
    events,
    cite,
    spendUsd: trace.spendUsd,
    createdAt: trace.createdAt,
    finishedAt: trace.finishedAt,
  };
}
