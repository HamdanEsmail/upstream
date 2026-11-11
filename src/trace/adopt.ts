// Builds a trail from a research run that has already finished, so a run made while
// testing is not paid for or waited for twice. Only I can call it.
import type { Env } from "../env";
import type { Account } from "../tinyfish/client";
import { createTrace, type CreateResult } from "./create";
import { setFeatured, updateTrace } from "./store";

export type AdoptInput = { pageUrl: unknown; text: unknown; researchRunId: unknown; account: unknown };

export type AdoptResult = CreateResult | { ok: false; status: 400 | 409; code: string; message: string; id?: string };

export async function adoptTrace(env: Env, input: AdoptInput, now: Date, start: (id: string) => Promise<void>): Promise<AdoptResult> {
  const runId = typeof input.researchRunId === "string" ? input.researchRunId.trim() : "";
  const account: Account | null = input.account === "main" || input.account === "second" ? input.account : null;
  if (runId === "" || account === null) return { ok: false, status: 400, code: "bad_request", message: "Give research_run_id and account (main or second)." };

  const made = await createTrace(
    env,
    { pageUrl: input.pageUrl, text: input.text },
    "admin",
    now,
    async (id) => {
      // With the run already named, the trace skips starting one and goes straight to reading it.
      await updateTrace(env.DB, id, { researchRunId: runId, researchAccount: account, researchStartedAt: now.toISOString() });
      await setFeatured(env.DB, id, true);
      await start(id);
    },
    { limits: false },
  );
  if (made.ok && made.reused) return { ok: false, status: 409, code: "exists", message: "This claim already has a trail.", id: made.id };
  return made;
}
