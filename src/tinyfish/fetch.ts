// TinyFish Fetch: reads pages as text, with their links, dates and authors. Free, and one
// call carries up to ten addresses, which matters on a plan that counts outside requests.
import { READS_PER_DAY } from "../core/limits";
import type { Env } from "../env";
import { takeMany } from "../trace/store";
import { TinyFishError, readJson, tinyfishFetch } from "./client";

const FETCH_API = "https://api.fetch.tinyfish.ai";
const MOST = 10;
const PER_PAGE_TIMEOUT_MS = 30_000;
/** A copy read within the last hour is fresh enough for checking wording. */
const FRESH_FOR_SECONDS = 3600;

export type PageRead =
  | { url: string; ok: true; finalUrl: string; title: string | null; author: string | null; date: string | null; text: string; links: string[] }
  | { url: string; ok: false; error: string };

type Result = { url?: unknown; final_url?: unknown; title?: unknown; author?: unknown; published_date?: unknown; text?: unknown; links?: unknown };
type Failure = { url?: unknown; error?: unknown };

const stringOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** The day a page says it was published, when it says so in a form that starts with a full date. */
function day(v: unknown): string | null {
  return typeof v === "string" ? (/^\d{4}-\d{2}-\d{2}/.exec(v)?.[0] ?? null) : null;
}

/** Reads the pages in one call. The answer has one entry per address, in the order asked. */
export async function readPages(env: Env, urls: string[]): Promise<PageRead[]> {
  if (urls.length > MOST) throw new RangeError(`readPages takes at most ${MOST} addresses`);
  if (urls.length === 0) return [];
  // The day's reading budget is taken before the call; a page not read for this reason says so.
  const today = new Date().toISOString().slice(0, 10);
  if (!(await takeMany(env.DB, today, "fetch", urls.length, READS_PER_DAY))) return urls.map((url) => ({ url, ok: false, error: "reading_budget_used" }));

  let body: { results?: Result[]; errors?: Failure[] };
  try {
    const res = await tinyfishFetch(env, "main", FETCH_API, {
      method: "POST",
      body: JSON.stringify({ urls, format: "markdown", links: true, ttl: FRESH_FOR_SECONDS, per_url_timeout_ms: PER_PAGE_TIMEOUT_MS }),
    });
    body = await readJson(res);
  } catch (err) {
    if (!(err instanceof TinyFishError)) throw err;
    return urls.map((url) => ({ url, ok: false, error: err.code }));
  }

  return urls.map((url): PageRead => {
    const failed = (body.errors ?? []).find((e) => e.url === url);
    if (failed) return { url, ok: false, error: typeof failed.error === "string" && failed.error !== "" ? failed.error : "fetch_error" };
    const r = (body.results ?? []).find((x) => x.url === url);
    if (!r) return { url, ok: false, error: "no_result" };
    if (typeof r.text !== "string" || r.text === "") return { url, ok: false, error: "no_text" };
    return {
      url,
      ok: true,
      finalUrl: stringOrNull(r.final_url) ?? url,
      title: stringOrNull(r.title),
      author: stringOrNull(r.author),
      date: day(r.published_date),
      text: r.text,
      links: Array.isArray(r.links) ? r.links.filter((l): l is string => typeof l === "string") : [],
    };
  });
}
