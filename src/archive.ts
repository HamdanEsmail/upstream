// The Internet Archive: a saved copy of a page that is gone or cut short today, and the day
// a page was first saved. Free and keyless. A failure here is never an error for the trace:
// it only means there is no saved copy to offer.

const day = (timestamp: string): string => `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;

async function getJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { method: "GET" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** The saved copy closest to `near` (a year, a month or a day), or the latest one when `near` is null. */
export async function savedCopy(url: string, near: string | null): Promise<{ url: string; date: string } | null> {
  const query = new URLSearchParams({ url });
  if (near !== null) query.set("timestamp", near.replace(/-/g, ""));
  const body = (await getJson(`https://archive.org/wayback/available?${query}`)) as {
    archived_snapshots?: { closest?: { available?: unknown; status?: unknown; timestamp?: unknown; url?: unknown } };
  } | null;
  const copy = body?.archived_snapshots?.closest;
  if (!copy || copy.available !== true || copy.status !== "200") return null;
  if (typeof copy.url !== "string" || typeof copy.timestamp !== "string" || !/^\d{8}/.test(copy.timestamp)) return null;
  return { url: copy.url.replace(/^http:\/\//, "https://"), date: day(copy.timestamp) };
}

/** The day the Internet Archive first saved the page, or null when it never did. */
export async function firstSeen(url: string): Promise<string | null> {
  const query = new URLSearchParams({ url, output: "json", limit: "1", fl: "timestamp,statuscode" });
  const rows = await getJson(`https://web.archive.org/cdx/search/cdx?${query}`);
  const first = Array.isArray(rows) ? (rows[1] as unknown) : undefined;
  const timestamp = Array.isArray(first) ? (first[0] as unknown) : undefined;
  return typeof timestamp === "string" && /^\d{8}/.test(timestamp) ? day(timestamp) : null;
}
