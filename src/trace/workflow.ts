// The Cloudflare Workflow that carries a trace, one leg to a run. It only adapts the
// platform's step to the small interface runLeg needs, and starts the run for the next leg;
// all the work is in run.ts.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "../env";
import { runLeg, type Leg } from "./run";

/** `leg` is absent on the run that begins a trace. */
export type TraceParams = { traceId: string; leg?: Leg };

// A step that fails is tried twice more, a few seconds apart, then the trace is marked failed.
const STEP = { retries: { limit: 2, delay: "5 seconds", backoff: "constant" }, timeout: "2 minutes" } as const;

/**
 * The id of the run that carries a leg: the trace's own id for the first, and one built from
 * it for each later leg. A hand-over that is tried twice therefore cannot start two runs.
 */
export function legId(traceId: string, leg: Leg): string {
  if (leg.part === "start") return traceId;
  if (leg.part === "wait") return `${traceId}-wait-${leg.turn}`;
  if (leg.part === "check") return `${traceId}-check-${leg.from}`;
  return `${traceId}-book`;
}

/** Starts the run that carries `leg`. A run that exists already is left alone. */
export async function handOver(env: Env, traceId: string, leg: Leg): Promise<void> {
  const id = legId(traceId, leg);
  try {
    await env.TRACE_WORKFLOW.create({ id, params: { traceId, leg } });
  } catch (err) {
    // An earlier try may have started the run before it failed. If the run is there, all is well.
    try {
      await (await env.TRACE_WORKFLOW.get(id)).status();
    } catch {
      throw err;
    }
  }
}

export class TraceWorkflow extends WorkflowEntrypoint<Env, TraceParams> {
  async run(event: WorkflowEvent<TraceParams>, step: WorkflowStep): Promise<void> {
    const { traceId, leg } = event.payload;
    await runLeg(this.env, traceId, leg ?? { part: "start" }, {
      do: <T>(name: string, fn: () => Promise<T>) => step.do(name, STEP, fn as () => Promise<never>) as Promise<T>,
      sleep: (name, ms) => step.sleep(name, ms),
      handOver: (next) => step.do(`hand over to ${legId(traceId, next)}`, STEP, () => handOver(this.env, traceId, next)),
    });
  }
}
