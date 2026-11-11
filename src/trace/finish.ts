// The last step of a trace: join what both engines found, put it in order, compare the
// sentences, and decide.
import { namedChanges, type Change } from "../core/changes";
import { restates } from "../core/match";
import { mergeSteps, orderSteps, sameAddress, type ReachedBy } from "../core/trail";
import { decide } from "../core/verdict";
import type { Env } from "../env";
import { proposedOf } from "./check";
import { addEvent, clearStaged, getStaged, getSteps, getTrace, saveChanges, saveSteps, updateTrace, type StoredChange, type StoredStep } from "./store";

const confirmed = (s: StoredStep): s is StoredStep & { wording: string } => s.wording !== null && (s.reading === "exact" || s.reading === "close" || s.reading === "offline");

export async function finishTrace(env: Env, traceId: string, now: Date): Promise<void> {
  const trace = await getTrace(env.DB, traceId);
  if (!trace) throw new Error("trace_missing");
  const trail = proposedOf(trace);
  const steps = orderSteps(mergeSteps(await getSteps(env.DB, traceId), await getStaged(env.DB, traceId)));

  // A step is linked only when a newer page in the trail, or the highlighted paragraph, links to it.
  for (const [i, s] of steps.entries()) {
    const url = s.url;
    const linked = url !== null && (trace.near.some((l) => sameAddress(l, url)) || steps.slice(0, i).some((newer) => newer.links.some((l) => sameAddress(l, url))));
    const reached: ReachedBy = i === 0 ? "start" : linked ? "link" : steps[i - 1]?.namesSource ? "named" : "search";
    s.reachedBy = reached;
  }

  // Compare the earliest confirmed sentence with the highlighted one: this is what the verdict
  // rests on. Then compare neighbours, but only where one sentence restates the other.
  const changes: StoredChange[] = [];
  const seen = new Set<string>();
  const add = (list: Change[], from: number, to: number) => {
    for (const c of list) {
      const key = `${c.kind}|${c.detail}`;
      if (seen.has(key)) continue;
      seen.add(key);
      changes.push({ fromPosition: from, toPosition: to, kind: c.kind, detail: c.detail, basis: "code" });
    }
  };
  const start = steps[0];
  const solid = steps.map((s, i) => ({ s, i })).filter(({ s, i }) => i > 0 && confirmed(s));
  const earliest = solid[solid.length - 1];
  const headline = start && start.wording !== null && earliest && earliest.s.wording !== null ? namedChanges(earliest.s.wording, start.wording) : [];
  if (earliest) add(headline, earliest.i, 0);
  const chain = start && start.wording !== null ? [{ s: start, i: 0 }, ...solid] : solid;
  for (let k = 1; k < chain.length; k++) {
    const newer = chain[k - 1];
    const older = chain[k];
    if (!newer || !older || newer.s.wording === null || older.s.wording === null) continue;
    if (restates(older.s.wording, newer.s.wording)) add(namedChanges(older.s.wording, newer.s.wording), older.i, newer.i);
  }
  for (const detail of trail?.changes ?? []) changes.push({ fromPosition: null, toPosition: null, kind: "noted", detail, basis: "research" });

  const last = steps[steps.length - 1];
  const dated = [...steps].reverse().find((s) => s.date !== null);
  const { verdict, reached } = decide({
    readings: steps.map((s) => s.reading),
    // The report's word that an original exists counts only when its last step was confirmed here.
    research: trail === null ? null : { verdict: trail.verdict, originFound: trail.origin.found && last !== undefined && confirmed(last) },
    changes: headline,
    originYear: dated?.date ? Number(dated.date.slice(0, 4)) : null,
    thisYear: now.getUTCFullYear(),
  });

  let summary = trail?.summary ?? "";
  if (trail === null) {
    summary =
      trace.researchRunId === null
        ? "The deep search did not run, so this trail shows only what following the page's links found."
        : "The deep search gave no trail, so this shows only what following the page's links found.";
  }

  const stamp = now.toISOString();
  await saveSteps(env.DB, traceId, steps);
  await saveChanges(env.DB, traceId, changes);
  await clearStaged(env.DB, traceId);
  await updateTrace(env.DB, traceId, { status: "done", verdict, reached, summary, finishedAt: stamp });
  await addEvent(env.DB, traceId, "Done.", stamp);
}
