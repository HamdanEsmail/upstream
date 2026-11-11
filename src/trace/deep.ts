// The deep engine: a TinyResearch run. Free runs are used first (two a day on each
// account); after that a run is paid for from a fixed reserve, and when that is gone the
// trace carries on without one and says so.
import { FREE_RESEARCH_RUNS_PER_DAY, RESEARCH_RUN_USD } from "../core/limits";
import type { Env } from "../env";
import { TinyFishError, type Account } from "../tinyfish/client";
import { readResearch, runsToday, startResearch } from "../tinyfish/research";
import { buildQuery } from "./query";
import { addEvent, countOf, getSteps, getTrace, giveBack, recordSpend, takeSlot, updateTrace } from "./store";

type Slot = { account: Account; day: string; name: string; costUsd: number };

/** The day's counter that says a trace found no deep search left. Its limit is 1: it is a mark, not a count. */
const OUT = "research:out";

/** True when a trace today has already found the deep searches used up. */
export async function deepSearchesUsedUp(env: Env, day: string): Promise<boolean> {
  return (await countOf(env.DB, day, OUT)) > 0;
}

/**
 * Takes a free run on `account` if one is left today, counting runs made outside Upstream
 * too. `counted` is false when TinyFish would not say how many runs were made today.
 */
async function freeSlot(env: Env, account: Account, day: string): Promise<{ slot: Slot | null; counted: boolean }> {
  if (account === "second" && !env.TINYFISH_API_KEY_2) return { slot: null, counted: true };
  let used: number;
  try {
    used = await runsToday(env, account, day);
  } catch (err) {
    if (err instanceof TinyFishError) return { slot: null, counted: false };
    throw err;
  }
  const name = `research:${account}`;
  const mine = await countOf(env.DB, day, name);
  // Runs this account made elsewhere today leave fewer free ones for Upstream.
  const limit = FREE_RESEARCH_RUNS_PER_DAY - Math.max(0, used - mine);
  return { slot: (await takeSlot(env.DB, day, name, limit)) ? { account, day, name, costUsd: 0 } : null, counted: true };
}

/** Takes one paid run from the reserve, if the reserve still has room for it. */
async function paidSlot(env: Env): Promise<Slot | null> {
  const budget = Number(env.PAID_DEEP_BUDGET_USD ?? "0");
  const runs = Number.isFinite(budget) ? Math.floor(budget / RESEARCH_RUN_USD) : 0;
  return (await takeSlot(env.DB, "all", "research:paid", runs)) ? { account: "main", day: "all", name: "research:paid", costUsd: RESEARCH_RUN_USD } : null;
}

/** Starts the deep search for a trace. `started` is false when there was no run to give it. */
export async function startDeep(env: Env, traceId: string, now: Date): Promise<{ started: boolean }> {
  const trace = await getTrace(env.DB, traceId);
  if (!trace) throw new Error("trace_missing");
  if (trace.researchRunId !== null) return { started: true };
  const stamp = now.toISOString();
  const day = stamp.slice(0, 10);

  const main = await freeSlot(env, "main", day);
  const second = main.slot === null ? await freeSlot(env, "second", day) : { slot: null, counted: true };
  const counted = main.counted && second.counted;
  // A paid run is taken only when both accounts said, in so many words, that their free runs are used.
  // Not knowing is never a reason to spend.
  const slot = main.slot ?? second.slot ?? (counted ? await paidSlot(env) : null);
  if (slot === null) {
    const why = counted
      ? "Today's deep searches are used up. This trail comes from following links only; the deep search is back at midnight UTC."
      : "Today's deep-search allowance could not be checked, so none was started. This trail comes from following links only.";
    await addEvent(env.DB, traceId, why, stamp);
    // The first page reads this mark and warns the next visitor before they start a trace.
    if (counted) await takeSlot(env.DB, day, OUT, 1);
    return { started: false };
  }

  const known = (await getSteps(env.DB, traceId)).slice(1).flatMap((s) => (s.url === null ? [] : [{ url: s.url, wording: s.wording }]));
  let runId: string;
  try {
    runId = await startResearch(env, slot.account, buildQuery(trace.pageUrl, trace.text, known));
  } catch (err) {
    if (!(err instanceof TinyFishError)) throw err;
    await giveBack(env.DB, slot.day, slot.name);
    await addEvent(env.DB, traceId, `The deep search could not be started (${err.code}). This trail comes from following links only.`, stamp);
    return { started: false };
  }

  // The run id is saved before anything else: if this step were tried again, it must find
  // the run and not start a second one. The bookkeeping after it may fail without harm.
  await updateTrace(env.DB, traceId, { status: "searching", researchRunId: runId, researchAccount: slot.account, researchStartedAt: stamp, spendUsd: slot.costUsd });
  try {
    await giveBack(env.DB, day, OUT);
    await recordSpend(env.DB, "research", slot.costUsd, runId, stamp);
    await addEvent(
      env.DB,
      traceId,
      slot.costUsd > 0 ? `Started the deep search. This one is paid for from the reserve ($${slot.costUsd}).` : "Started the deep search. It usually takes 4 to 6 minutes.",
      stamp,
    );
  } catch {
    console.error("deep search started; a note about it could not be written");
  }
  return { started: true };
}

/** Looks at the run once and records how far it has got. */
export async function pollDeep(env: Env, traceId: string, now: string): Promise<"running" | "completed" | "failed"> {
  const trace = await getTrace(env.DB, traceId);
  if (!trace) throw new Error("trace_missing");
  if (trace.researchRunId === null || trace.researchAccount === null) return "failed";

  let state;
  try {
    state = await readResearch(env, trace.researchAccount, trace.researchRunId);
  } catch (err) {
    if (!(err instanceof TinyFishError)) throw err;
    // A refusal (not found, not allowed) will not get better by waiting. Anything else may pass.
    if (err.status >= 400 && err.status < 500 && err.status !== 429) {
      await giveUpDeep(env, traceId, now);
      return "failed";
    }
    return "running";
  }
  if (state.status === "completed") {
    await updateTrace(env.DB, traceId, { status: "checking", report: state.report, pagesRead: state.pagesRead, latestHosts: state.latestHosts });
    await addEvent(env.DB, traceId, `The deep search finished after reading ${state.pagesRead} pages.`, now);
    return "completed";
  }
  if (state.status === "failed") {
    await giveUpDeep(env, traceId, now);
    return "failed";
  }
  await updateTrace(env.DB, traceId, { pagesRead: state.pagesRead, latestHosts: state.latestHosts });
  return "running";
}

/** Records that the deep search gave nothing, whether it failed or ran out of time. */
export async function giveUpDeep(env: Env, traceId: string, now: string): Promise<void> {
  await addEvent(env.DB, traceId, "The deep search did not finish. This trail comes from following links only.", now);
}
