// The last step of a trace: join what both engines found, put it in order, compare the
// sentences, and decide.
import { namedChanges, type Change } from "../core/changes";
import { restates } from "../core/match";
import { sentences } from "../core/text";
import { mergeSteps, orderSteps, sameAddress, type ReachedBy } from "../core/trail";
import { decide } from "../core/verdict";
import type { Env } from "../env";
import { proposedOf } from "./check";
import { freeRunsOff, paidRunsLeft } from "./deep";
import { addEvent, clearStaged, getStaged, getSteps, getTrace, saveChanges, saveSteps, updateTrace, wasSearched, type StoredChange, type StoredStep } from "./store";

const SUMMARY_MAX = 420;

/**
 * The verdict line must be read at a glance: at most two whole sentences that fit. A single
 * sentence that is too long is cut at a word, with an ellipsis to say so.
 */
function brief(summary: string): string {
  const list = sentences(summary).slice(0, 2);
  const first = list[0] ?? "";
  if (first.length > SUMMARY_MAX) return first.slice(0, SUMMARY_MAX).replace(/\s+\S*$/, "") + "…";
  const both = list.join(" ");
  return both.length <= SUMMARY_MAX ? both : first;
}

const confirmed = (s: StoredStep): s is StoredStep & { wording: string } => s.wording !== null && (s.reading === "exact" || s.reading === "close" || s.reading === "offline");

export async function finishTrace(env: Env, traceId: string, now: Date): Promise<void> {
  const trace = await getTrace(env.DB, traceId);
  if (!trace) throw new Error("trace_missing");
  const trail = proposedOf(trace);
  const stored = await getSteps(env.DB, traceId);

  // A page that the search for the sentence found, and that the deep search did not propose as
  // well. No page names it and no report vouches for it. So it is shown, but it is never
  // "named", it does not stand between a step and the source that step names, and when there
  // is a report the verdict does not rest on it.
  const proposedUrls = (trail?.steps ?? []).map((p) => p.url).filter((u): u is string => u !== null);
  const loose = stored.flatMap((s) => (s.reachedBy === "search" && s.url !== null && !proposedUrls.some((u) => sameAddress(u, s.url as string)) ? [s.url] : []));
  const onlySearched = (s: StoredStep): boolean => s.url !== null && loose.some((u) => sameAddress(u, s.url as string));

  const steps = orderSteps(mergeSteps(stored, await getStaged(env.DB, traceId)));

  // A step is linked only when a newer page in the trail, or the highlighted paragraph, links to it.
  // It is named when the nearest step above it, pages only the search found aside, names a source.
  let above: StoredStep | undefined;
  for (const [i, s] of steps.entries()) {
    const url = s.url;
    const linked = url !== null && (trace.near.some((l) => sameAddress(l, url)) || steps.slice(0, i).some((newer) => newer.links.some((l) => sameAddress(l, url))));
    const reached: ReachedBy = i === 0 ? "start" : linked ? "link" : !onlySearched(s) && above?.namesSource ? "named" : "search";
    s.reachedBy = reached;
    if (!onlySearched(s)) above = s;
  }

  // Compare the earliest confirmed sentence with the highlighted one: this is what the verdict
  // rests on. Then compare neighbours, but only where one sentence restates the other.
  const changes: StoredChange[] = [];
  const seen = new Set<string>();
  // A quotation's trail is about who said it. Pages along it discuss the quote rather than
  // restate a figure, so comparing their sentences for figures and years would only mislead.
  const quotation = trail?.verdict === "said_by_someone_else";
  const add = (list: Change[], from: number, to: number) => {
    if (quotation) return;
    for (const c of list) {
      const key = `${c.kind}|${c.detail}`;
      if (seen.has(key)) continue;
      seen.add(key);
      changes.push({ fromPosition: from, toPosition: to, kind: c.kind, detail: c.detail, basis: "code" });
    }
  };
  const start = steps[0];
  // With a report, only the steps of its own trail and the linked ones are compared and judged by.
  const solid = steps.map((s, i) => ({ s, i })).filter(({ s, i }) => i > 0 && confirmed(s) && (trail === null || !onlySearched(s)));
  // The earliest confirmed step that carries a date; an undated one cannot be called the oldest.
  const earliest = [...solid].reverse().find(({ s }) => s.date !== null) ?? solid[solid.length - 1];
  const headline = !quotation && start && start.wording !== null && earliest && earliest.s.wording !== null ? namedChanges(earliest.s.wording, start.wording) : [];
  if (earliest) add(headline, earliest.i, 0);
  const chain = start && start.wording !== null ? [{ s: start, i: 0 }, ...solid] : solid;
  for (let k = 1; k < chain.length; k++) {
    const newer = chain[k - 1];
    const older = chain[k];
    if (!newer || !older || newer.s.wording === null || older.s.wording === null) continue;
    if (restates(older.s.wording, newer.s.wording)) add(namedChanges(older.s.wording, newer.s.wording), older.i, newer.i);
  }
  for (const detail of trail?.changes ?? []) changes.push({ fromPosition: null, toPosition: null, kind: "noted", detail, basis: "research" });

  // The report's word that an original exists counts only when that page was confirmed here.
  const last = trail === null ? steps[steps.length - 1] : [...steps].reverse().find((s) => !onlySearched(s));
  const originUrl = trail?.origin.url ?? null;
  const originStep = originUrl === null ? last : steps.find((s) => s.url !== null && sameAddress(s.url, originUrl));
  const { verdict, reached } = decide({
    readings: steps.map((s) => s.reading),
    research: trail === null ? null : { verdict: trail.verdict, originFound: trail.origin.found && originStep !== undefined && confirmed(originStep) },
    changes: headline,
    originYear: earliest?.s.date ? Number(earliest.s.date.slice(0, 4)) : null,
    thisYear: now.getUTCFullYear(),
  });

  let summary = brief(trail?.summary ?? "");
  if (trail === null) {
    // A trail made before Upstream searched, or one whose search could not be asked, comes from links alone.
    const found = (await wasSearched(env.DB, traceId)) ? "following the page's links and searching the web for the sentence found." : "following the page's links found.";
    const links = `this trail shows only what ${found}`;
    if (trace.researchRunId !== null) summary = `The deep search gave no trail, so this shows only what ${found}`;
    else if (await freeRunsOff(env))
      summary =
        (await paidRunsLeft(env)) === 0
          ? `The deep search did not run, so ${links} The money set aside for deep searches is used up.`
          : `The deep search did not run, so ${links} Trace the sentence again on a later day for the full trail.`;
    else summary = `The deep search did not run, so ${links} The day's deep searches return at midnight UTC: trace the sentence again after that for the full trail.`;
  }

  const stamp = now.toISOString();
  await saveSteps(env.DB, traceId, steps);
  await saveChanges(env.DB, traceId, changes);
  await clearStaged(env.DB, traceId);
  await updateTrace(env.DB, traceId, { status: "done", verdict, reached, summary, finishedAt: stamp });
  await addEvent(env.DB, traceId, "Done.", stamp);
}
