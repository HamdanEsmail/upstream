// TinyFish Search: the pages its index lists for a sentence. Free. Used once per trace,
// when the links run out, to find older pages that no link leads to.
import type { Env } from "../env";
import { TinyFishError, readJson, tinyfishFetch } from "./client";

const SEARCH_API = "https://api.search.tinyfish.ai";
/** A trace does not wait longer than this for the index. */
const TIMEOUT_MS = 15_000;

/** `day` is the index's own date for the page, when it gives one that can be read. It only orders the reading. */
export type Listed = { url: string; day: string | null };

/** `ok: false` means the search could not be asked. That is never "nothing was found". */
export type Searched = { ok: true; listed: Listed[] } | { ok: false; error: string };

/** The index writes a date as "2018-08-20T14:35:04Z", as "Aug 26, 2016", as "11 months ago", or not at all. */
function dayOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const iso = /^\d{4}-\d{2}-\d{2}/.exec(v)?.[0];
  if (iso) return iso;
  if (!/^[A-Za-z]{3,9}\.? \d{1,2}, \d{4}$/.test(v.trim())) return null;
  const at = Date.parse(`${v.trim()} UTC`);
  return Number.isNaN(at) ? null : new Date(at).toISOString().slice(0, 10);
}

/** Asks for pages that state `query`, published before `before` (a day) when one is given. */
export async function searchWeb(env: Env, query: string, before: string | null): Promise<Searched> {
  const params = new URLSearchParams({ query });
  if (before !== null) params.set("before_date", before);
  try {
    const res = await tinyfishFetch(env, "main", `${SEARCH_API}/?${params}`, { method: "GET", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await readJson<{ results?: unknown }>(res);
    if (!Array.isArray(body.results)) return { ok: false, error: "bad_answer" };
    const listed: Listed[] = [];
    for (const r of body.results) {
      if (typeof r !== "object" || r === null) continue;
      const { url, date } = r as { url?: unknown; date?: unknown };
      if (typeof url === "string" && /^https?:\/\//i.test(url)) listed.push({ url, day: dayOf(date) });
    }
    return { ok: true, listed };
  } catch (err) {
    // A refusal carries TinyFish's own code. Anything else (no answer in time, no connection) has none.
    return { ok: false, error: err instanceof TinyFishError ? err.code : "no_answer" };
  }
}
