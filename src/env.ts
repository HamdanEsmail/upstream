// The Worker's bindings and secrets.
import type { TraceParams } from "./trace/workflow";

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  /** My main TinyFish account. */
  TINYFISH_API_KEY: string;
  /** My second TinyFish account; its free research runs are used after the first account's. */
  TINYFISH_API_KEY_2?: string;
  ADMIN_TOKEN: string;
  /** The most that may be spent in total on paid deep searches, in dollars. Unset means nothing. */
  PAID_DEEP_BUDGET_USD?: string;
  TRACE_WORKFLOW: Workflow<TraceParams>;
  PUBLIC_BASE_URL: string;
};
