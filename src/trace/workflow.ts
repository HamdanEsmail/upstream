// The Cloudflare Workflow that carries a trace. It only adapts the platform's step to the
// small interface runTrace needs; all the work is in run.ts.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "../env";
import { runTrace } from "./run";

export type TraceParams = { traceId: string };

// A step that fails is tried twice more, a few seconds apart, then the trace is marked failed.
const STEP = { retries: { limit: 2, delay: "5 seconds", backoff: "constant" }, timeout: "2 minutes" } as const;

export class TraceWorkflow extends WorkflowEntrypoint<Env, TraceParams> {
  async run(event: WorkflowEvent<TraceParams>, step: WorkflowStep): Promise<void> {
    await runTrace(this.env, event.payload.traceId, {
      do: <T>(name: string, fn: () => Promise<T>) => step.do(name, STEP, fn as () => Promise<never>) as Promise<T>,
      sleep: (name, ms) => step.sleep(name, ms),
    });
  }
}
