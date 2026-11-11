// A trace from start to finish, as a list of small named steps. Each step does one small
// thing, because a free Cloudflare Worker allows little processing and few outside calls
// per step. The Workflow runs these steps; tests run them with a stand-in.
import { FOLLOW_DEPTH, FOLLOW_PAGES_PER_TRY, POLL_MS, POLL_TURNS } from "../core/limits";
import type { Env } from "../env";
import { checkProposed, loadProposed, skipProposed } from "./check";
import { giveUpDeep, pollDeep, startDeep } from "./deep";
import { finishTrace } from "./finish";
import { followOnce, readStart } from "./follow";
import { updateTrace } from "./store";

/** The part of a Workflow step this file needs. */
export type TraceStep = {
  do<T>(name: string, fn: () => Promise<T>): Promise<T>;
  sleep(name: string, ms: number): Promise<void>;
};

/** A hop tries at most this many of a page's links, five at a time. */
const LINKS_PER_HOP = FOLLOW_PAGES_PER_TRY * 2;

export async function runTrace(env: Env, traceId: string, step: TraceStep, clock: () => Date = () => new Date()): Promise<void> {
  const stamp = () => clock().toISOString();
  try {
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

    // 2. The deep engine: start it, wait for it, then check every step it proposes.
    const deep = await step.do("start the deep search", () => startDeep(env, traceId, clock()));
    if (deep.started) {
      let state: "running" | "completed" | "failed" = "running";
      for (let turn = 0; turn < POLL_TURNS && state === "running"; turn++) {
        await step.sleep(`wait ${turn}`, POLL_MS);
        state = await step.do(`poll ${turn}`, () => pollDeep(env, traceId, stamp()));
      }
      if (state === "running") await step.do("give up the deep search", () => giveUpDeep(env, traceId, stamp()));
      if (state === "completed") {
        const count = await step.do("read the report", () => loadProposed(env, traceId, stamp()));
        for (let i = 0; i < count; i++) {
          // One page that cannot be processed costs one step, not the whole trail.
          try {
            await step.do(`check ${i + 1}`, () => checkProposed(env, traceId, i, stamp()));
          } catch {
            await step.do(`skip ${i + 1}`, () => skipProposed(env, traceId, i, stamp()));
          }
        }
      }
    }

    // 3. Join, order, compare, decide.
    await step.do("finish", () => finishTrace(env, traceId, clock()));
  } catch (err) {
    await updateTrace(env.DB, traceId, { status: "failed", error: err instanceof Error ? err.message.slice(0, 200) : "unknown", finishedAt: stamp() });
    throw err;
  }
}
