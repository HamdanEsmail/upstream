// TinyResearch: the wider search. A run takes minutes, so it is started here and read
// again later; while it runs, the pages it has read so far can already be counted.
import type { Env } from "../env";
import { TinyFishError, readJson, tinyfishFetch, type Account } from "./client";

const AGENT_API = "https://agent.tinyfish.ai";

export type ResearchState = {
  status: "queued" | "running" | "completed" | "failed";
  pagesRead: number;
  /** The sites of the pages read most recently, for the progress line. */
  latestHosts: string[];
  report: string | null;
};

/** Starts a deep run and returns its id. */
export async function startResearch(env: Env, account: Account, query: string): Promise<string> {
  const res = await tinyfishFetch(env, account, `${AGENT_API}/v1/automation/run-research-async`, {
    method: "POST",
    body: JSON.stringify({ query, mode: "deep" }),
  });
  const body = await readJson<{ research_run_id?: unknown; run_id?: unknown; id?: unknown }>(res);
  const id = [body.research_run_id, body.run_id, body.id].find((v): v is string => typeof v === "string" && v !== "");
  if (!id) throw new TinyFishError(res.status, "no_run_id");
  return id;
}

/**
 * How many research runs the account has made since the start of `day` (UTC) that count
 * towards the two free ones: every run that did not fail or get cancelled.
 */
export async function runsToday(env: Env, account: Account, day: string): Promise<number> {
  const res = await tinyfishFetch(env, account, `${AGENT_API}/v1/research-run?created_after=${day}T00:00:00Z&limit=50`, { method: "GET" });
  const body = await readJson<{ data?: unknown }>(res);
  const rows = Array.isArray(body.data) ? (body.data as { status?: unknown }[]) : [];
  return rows.filter((r) => !/^(FAILED|CANCELLED)$/i.test(String(r?.status ?? ""))).length;
}

function host(url: unknown): string | null {
  try {
    return typeof url === "string" ? new URL(url).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

export async function readResearch(env: Env, account: Account, id: string): Promise<ResearchState> {
  const res = await tinyfishFetch(env, account, `${AGENT_API}/v1/research-run/${encodeURIComponent(id)}`, { method: "GET" });
  const body = await readJson<{ status?: unknown; evidence?: unknown; deep_result?: { result?: unknown } | null }>(res);
  const evidence = Array.isArray(body.evidence) ? (body.evidence as { url?: unknown }[]) : [];
  const latestHosts = [...new Set(evidence.slice(-3).map((e) => host(e?.url)).filter((h): h is string => h !== null))];
  const said = String(body.status ?? "").toUpperCase();
  const report = typeof body.deep_result?.result === "string" && body.deep_result.result !== "" ? body.deep_result.result : null;

  let status: ResearchState["status"];
  if (said === "COMPLETED") status = report === null ? "failed" : "completed";
  else if (said === "FAILED" || said === "CANCELLED" || said === "TIMED_OUT") status = "failed";
  else status = said === "QUEUED" ? "queued" : "running";
  return { status, pagesRead: evidence.length, latestHosts, report: status === "completed" ? report : null };
}
