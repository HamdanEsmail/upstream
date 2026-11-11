// A trail as the pages and the API show it: the stored trace with its links, plain dates,
// marked words, change notes and citation worked out.
import { citation } from "../core/cite";
import { plainDate } from "../core/dates";
import { wordDiff, type DiffRun } from "../core/diff";
import { sentenceLink } from "../core/fragment";
import { siteName } from "../core/links";
import { restates } from "../core/match";
import type { Reached, Verdict } from "../core/verdict";
import type { Env } from "../env";
import { changeWords, verdictWords } from "../site/words";
import { getChanges, getEvents, getSteps, getTrace, type StoredStep, type TraceStatus } from "./store";

export type DocumentStep = {
  position: number;
  url: string | null;
  /** Where "open" leads: the sentence on the page, the saved copy, or the plain address. */
  openUrl: string | null;
  publisher: string;
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
  /** This step's sentence with the words it changed marked `added`; null when there is nothing to mark. */
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

/** The words a step changed, compared with the next older confirmed step when that one restates it. */
function marks(steps: StoredStep[], i: number): DiffRun[] | null {
  const mine = steps[i]?.wording ?? null;
  const older = steps.slice(i + 1).find(confirmed)?.wording ?? null;
  if (mine === null || older === null || !restates(older, mine)) return null;
  const runs = wordDiff(older, mine).filter((r) => r.op !== "removed");
  return runs.some((r) => r.op === "added") ? runs : null;
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
          origin: origin ? { publisher: origin.publisher || siteName(origin.url), title: origin.title, date: origin.date, url: origin.url, wording: origin.wording } : null,
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
      title: s.title,
      date: s.date,
      datePlain: plainDate(s.date),
      dateSource: s.dateSource,
      wording: s.wording,
      reading: s.reading,
      readFrom: s.readFrom,
      archiveUrl: s.archiveUrl,
      reachedBy: s.reachedBy,
      namesSource: s.namesSource,
      quotedBy: s.quotedBy,
      marks: marks(steps, i),
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
