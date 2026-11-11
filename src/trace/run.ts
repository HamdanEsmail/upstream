// A trace from start to finish, as a list of small named steps. Each step does one small
// thing, because a free Cloudflare Worker allows little processing per step. The steps are
// grouped into legs, because the free plan also allows one Workflow run only 50 requests to
// other hosts: each leg is carried by a run of its own and hands the rest on to the next.
// The Workflow runs the legs; tests run them with a stand-in.
import { BOOK_AFTER_MS, CHECKS_PER_LEG, FOLLOW_DEPTH, FOLLOW_PAGES_PER_TRY, POLLS_PER_LEG, POLL_MS, POLL_TURNS } from "../core/limits";
import type { Env } from "../env";
import { checkProposed, loadProposed, skipProposed } from "./check";
import { bookDeep, giveUpDeep, pollDeep, startDeep } from "./deep";
import { finishTrace } from "./finish";
import { followOnce, readStart } from "./follow";
import { updateTrace } from "./store";

/**
 * One part of a trace, small enough for one Workflow run.
 * - `start`: read the page, follow its links, start the deep search.
 * - `wait`: read the deep search again and again, from turn `turn`.
 * - `check`: check the proposed steps from index `from`. `count` is how many there are;
 *   null when the report has still to be read, 0 when the search gave nothing.
 * - `book`: after the trail is done, see what the deep search really cost.
 */
export type Leg = { part: "start" } | { part: "wait"; turn: number } | { part: "check"; from: number; count: number | null } | { part: "book" };

/** The part of a Workflow step this file needs. */
export type TraceStep = {
  do<T>(name: string, fn: () => Promise<T>): Promise<T>;
  sleep(name: string, ms: number): Promise<void>;
};

/** A step that can also pass the rest of the trace on to a fresh run. */
export type LegStep = TraceStep & { handOver(next: Leg): Promise<void> };

/** A hop tries at most this many of a page's links, five at a time. */
const LINKS_PER_HOP = FOLLOW_PAGES_PER_TRY * 2;

/**
 * Runs one leg. A Workflow may run this again from the top after a sleep, with the results
 * of finished steps remembered: so where a leg begins comes from `leg`, and every turn it
 * takes comes from the result of a step.
 */
export async function runLeg(env: Env, traceId: string, leg: Leg, step: LegStep, clock: () => Date = () => new Date()): Promise<void> {
  const stamp = () => clock().toISOString();

  // The books. The trail is done and on screen; only now is the wallet read again, to see
  // whether a run started as a free one was charged after all. A failure here is passed on,
  // so it shows in the Workflow's own record, but it does not touch the trail.
  if (leg.part === "book") {
    await step.sleep("let the charge land", BOOK_AFTER_MS);
    await step.do("book the deep search", () => bookDeep(env, traceId, stamp()));
    return;
  }

  // True once this trace has a deep search, which must be booked whatever becomes of the trace.
  let deep = leg.part !== "start";
  try {
    if (leg.part === "start") {
      // 1. The fast engine: the page, then its links, as deep as they go.
      let { candidates } = await step.do("read the page", () => readStart(env, traceId, stamp()));
      for (let depth = 1; depth <= FOLLOW_DEPTH && candidates.length > 0; depth++) {
        let next: string[] | null = null;
        for (let from = 0; from < Math.min(candidates.length, LINKS_PER_HOP) && next === null; from += FOLLOW_PAGES_PER_TRY) {
          const batch = candidates.slice(from, from + FOLLOW_PAGES_PER_TRY);
          // A try that fails outright (a page too heavy to process) ends the following, not the trace.
          let hop: { found: boolean; candidates: string[] };
          try {
            hop = await step.do(`follow ${depth}.${from / FOLLOW_PAGES_PER_TRY + 1}`, () => followOnce(env, traceId, batch, stamp()));
          } catch {
            hop = { found: false, candidates: [] };
            from = LINKS_PER_HOP;
          }
          if (hop.found) next = hop.candidates;
        }
        if (next === null) break;
        candidates = next;
      }

      // 2. The deep engine: start it here; the waiting and the checking are other legs.
      deep = (await step.do("start the deep search", () => startDeep(env, traceId, clock()))).started;
      if (deep) return await step.handOver({ part: "wait", turn: 0 });
    } else if (leg.part === "wait") {
      let state: "running" | "completed" | "failed" = "running";
      let turn = leg.turn;
      for (const end = Math.min(POLL_TURNS, leg.turn + POLLS_PER_LEG); turn < end && state === "running"; turn++) {
        await step.sleep(`wait ${turn}`, POLL_MS);
        state = await step.do(`poll ${turn}`, () => pollDeep(env, traceId, stamp()));
      }
      if (state === "running" && turn < POLL_TURNS) return await step.handOver({ part: "wait", turn });
      if (state === "running") await step.do("give up the deep search", () => giveUpDeep(env, traceId, stamp()));
      return await step.handOver({ part: "check", from: 0, count: state === "completed" ? null : 0 });
    } else {
      // Check every step the deep search proposes.
      const count = leg.count ?? (await step.do("read the report", () => loadProposed(env, traceId, stamp())));
      const end = Math.min(count, leg.from + CHECKS_PER_LEG);
      for (let i = leg.from; i < end; i++) {
        // One page that cannot be processed costs one step, not the whole trail.
        try {
          await step.do(`check ${i + 1}`, () => checkProposed(env, traceId, i, stamp()));
        } catch {
          await step.do(`skip ${i + 1}`, () => skipProposed(env, traceId, i, stamp()));
        }
      }
      if (end < count) return await step.handOver({ part: "check", from: end, count });
    }

    // 3. Join, order, compare, decide.
    await step.do("finish", () => finishTrace(env, traceId, clock()));
  } catch (err) {
    await updateTrace(env.DB, traceId, { status: "failed", error: err instanceof Error ? err.message.slice(0, 200) : "unknown", finishedAt: stamp() });
    // A deep search that was started may be charged, so it is booked even now.
    if (deep) await step.handOver({ part: "book" }).catch(() => console.error("a broken trace's deep search could not be handed on for booking"));
    throw err;
  }

  // The trail is done. Handing the booking on is outside the block above: a failure here must
  // not mark a finished trail as broken.
  if (deep) await step.handOver({ part: "book" });
}

/** Runs every leg in turn, in one go. The Workflow does not use this: it gives each leg a run of its own. */
export async function runTrace(env: Env, traceId: string, step: TraceStep, clock: () => Date = () => new Date()): Promise<void> {
  const waiting: Leg[] = [{ part: "start" }];
  const relay: LegStep = { do: (name, fn) => step.do(name, fn), sleep: (name, ms) => step.sleep(name, ms), handOver: async (next) => void waiting.push(next) };
  let failure: { err: unknown } | null = null;
  for (let leg = waiting.shift(); leg; leg = waiting.shift()) {
    try {
      await runLeg(env, traceId, leg, relay, clock);
    } catch (err) {
      failure ??= { err };
    }
  }
  if (failure) throw failure.err;
}
