// The deep engine: a TinyResearch run. TinyFish charges $2 for each one. A run is paid for
// from a fixed reserve, and when that is gone the trace carries on without one and says so.
//
// Until 11 November 2026 TinyFish gave two runs a day free on each account, and this file
// was written to use those first. That part is kept, because it is what found the change: a
// run is called free only as long as the wallet agrees. The account's wallet is read before
// a free run starts and again after the trail is done. The first time a run that should have
// been free turns out to have been charged (it happened on 12 November 2026), Upstream stops
// calling runs free: from then on every deep search is paid from the reserve, and when the
// reserve is used there are none.
import { FREE_RESEARCH_RUNS_PER_DAY, RESEARCH_RUN_USD } from "../core/limits";
import type { Env } from "../env";
import { TinyFishError, type Account } from "../tinyfish/client";
import { readResearch, runsToday, startResearch } from "../tinyfish/research";
import { readBalance } from "../tinyfish/wallet";
import { buildQuery } from "./query";
import { addEvent, bookRun, countOf, countUp, getSteps, getTrace, giveBack, recordSpend, takeSlot, updateTrace } from "./store";

/** `walletBefore` is the account's wallet just before a free run; a paid run has none. */
type Slot = { account: Account; day: string; name: string; costUsd: number; walletBefore: number | null };

/** The day's counter that says a trace found no deep search left. Its limit is 1: it is a mark, not a count. */
const OUT = "research:out";
/** Set for good, under the day "all", when a free run turned out to have been charged. Also a mark. */
const CHARGED = "research:charged";
const PAID = "research:paid";
/** A fall this much short of a run's price still counts as the price: wallets are kept to fractions of a cent. */
const CENT = 0.01;

/** True when a run that should have been free was charged, so that no run is called free any more. */
export async function freeRunsOff(env: Env): Promise<boolean> {
  return (await countOf(env.DB, "all", CHARGED)) > 0;
}

/** How many more deep searches the reserve pays for. A charged run that was started as a free one has taken its place in it. */
export async function paidRunsLeft(env: Env): Promise<number> {
  return Math.max(0, reserveRuns(env) - (await countOf(env.DB, "all", PAID)));
}

/**
 * What the first page should warn of. Once a run has been charged, only the reserve counts:
 * "off" when it pays for no more, and that is known before anyone starts a trace. While runs
 * are still thought free: "today" when a trace today found the day's deep searches used up.
 */
export async function deepSearchesOut(env: Env, day: string): Promise<"today" | "off" | null> {
  if (await freeRunsOff(env)) return (await paidRunsLeft(env)) === 0 ? "off" : null;
  return (await countOf(env.DB, day, OUT)) === 0 ? null : "today";
}

/**
 * Takes a free run on `account` if one is left today, counting runs made outside Upstream
 * too. `counted` is false when TinyFish would not say how many runs were made today, or
 * what the wallet holds: a run whose cost could not be checked afterwards is not started.
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
  if (mine >= limit) return { slot: null, counted: true };
  let walletBefore: number;
  try {
    walletBefore = await readBalance(env, account);
  } catch (err) {
    if (err instanceof TinyFishError) return { slot: null, counted: false };
    throw err;
  }
  return { slot: (await takeSlot(env.DB, day, name, limit)) ? { account, day, name, costUsd: 0, walletBefore } : null, counted: true };
}

/** How many runs the reserve pays for in all. */
function reserveRuns(env: Env): number {
  const budget = Number(env.PAID_DEEP_BUDGET_USD ?? "0");
  return Number.isFinite(budget) ? Math.floor(budget / RESEARCH_RUN_USD) : 0;
}

/** Takes one paid run from the reserve, if the reserve still has room for it. */
async function paidSlot(env: Env): Promise<Slot | null> {
  return (await takeSlot(env.DB, "all", PAID, reserveRuns(env))) ? { account: "main", day: "all", name: PAID, costUsd: RESEARCH_RUN_USD, walletBefore: null } : null;
}

/** Starts the deep search for a trace. `started` is false when there was no run to give it. */
export async function startDeep(env: Env, traceId: string, now: Date): Promise<{ started: boolean }> {
  const trace = await getTrace(env.DB, traceId);
  if (!trace) throw new Error("trace_missing");
  if (trace.researchRunId !== null) return { started: true };
  const stamp = now.toISOString();
  const day = stamp.slice(0, 10);

  const off = await freeRunsOff(env);
  const none = { slot: null, counted: true };
  const main = off ? none : await freeSlot(env, "main", day);
  const second = off || main.slot !== null ? none : await freeSlot(env, "second", day);
  const counted = main.counted && second.counted;
  // A paid run is taken only when both accounts said, in so many words, that their free runs are used.
  // Not knowing is never a reason to spend.
  const slot = main.slot ?? second.slot ?? (counted ? await paidSlot(env) : null);
  if (slot === null) {
    const why = !counted
      ? "Today's deep-search allowance could not be checked, so none was started. This trail comes from following links and searching the web for the sentence."
      : off
        ? `No deep search was started: each one costs $${RESEARCH_RUN_USD} at TinyFish, and the money set aside for them is used up. This trail comes from following links and searching the web for the sentence.`
        : "Today's deep searches are used up. This trail comes from following links and searching the web for the sentence; the deep search is back at midnight UTC.";
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
    await addEvent(env.DB, traceId, `The deep search could not be started (${err.code}). This trail comes from following links and searching the web for the sentence.`, stamp);
    return { started: false };
  }

  // The run id is saved before anything else: if this step were tried again, it must find
  // the run and not start a second one. The bookkeeping after it may fail without harm.
  await updateTrace(env.DB, traceId, {
    status: "searching",
    researchRunId: runId,
    researchAccount: slot.account,
    researchStartedAt: stamp,
    spendUsd: slot.costUsd,
    walletBefore: slot.walletBefore,
  });
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

/**
 * Says what a deep search that was started as a free one really cost, once, after its trail
 * is done. The account's wallet was read before the run and is read again here.
 *
 * - A fall of a run's price or more: the run was charged. It is booked at the price and never
 *   more, because my other projects spend from the same wallet. It takes a place in the
 *   reserve, and no run is called free from then on.
 * - A smaller fall, or none: the run was free.
 * - A wallet that cannot be read, or that went up (it was topped up): it can no longer say.
 *   Not knowing is booked as the price, but does not call the free runs off.
 */
export async function bookDeep(env: Env, traceId: string, now: string): Promise<void> {
  const trace = await getTrace(env.DB, traceId);
  if (!trace || trace.researchRunId === null || trace.researchAccount === null) return;
  // A run paid from the reserve was booked when it started; a booked run is not booked again.
  if (trace.walletBefore === null || trace.bookedAt !== null) return;

  let after: number | null = null;
  for (let attempt = 0; attempt < 2 && after === null; attempt++) {
    try {
      after = await readBalance(env, trace.researchAccount);
    } catch (err) {
      if (!(err instanceof TinyFishError)) throw err;
    }
  }
  const fall = after === null ? null : trace.walletBefore - after;
  const charged = fall !== null && fall >= RESEARCH_RUN_USD - CENT;
  const free = fall !== null && fall > -CENT && !charged;
  const cost = free ? 0 : RESEARCH_RUN_USD;
  if (!(await bookRun(env.DB, traceId, trace.researchRunId, after, cost, now)) || cost === 0) return;

  // The charge has happened, so it is counted against the reserve whether or not the reserve
  // had room for it. A reserve raised later then pays for one run fewer.
  await countUp(env.DB, "all", PAID);
  if (charged) await takeSlot(env.DB, "all", CHARGED, 1);
  await addEvent(
    env.DB,
    traceId,
    charged
      ? `This deep search was started as a free one, and the wallet shows it was charged $${RESEARCH_RUN_USD}. It is paid from the reserve.`
      : `The wallet could not say what this deep search cost, so it is booked at its price, $${RESEARCH_RUN_USD}.`,
    now,
  );
}

/** Records that the deep search gave nothing, whether it failed or ran out of time. */
export async function giveUpDeep(env: Env, traceId: string, now: string): Promise<void> {
  await addEvent(env.DB, traceId, "The deep search did not finish. This trail comes from following links and searching the web for the sentence.", now);
}
