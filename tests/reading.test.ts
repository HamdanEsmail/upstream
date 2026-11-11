import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { firstSeen, savedCopy } from "../src/archive";
import { TinyFishError } from "../src/tinyfish/client";
import { readPages } from "../src/tinyfish/fetch";
import { readResearch, startResearch } from "../src/tinyfish/research";
import { fetchMock } from "./helpers/fetch-mock";

const FETCH_API = "https://api.fetch.tinyfish.ai/";
const START = "https://agent.tinyfish.ai/v1/automation/run-research-async";
const RUN = "https://agent.tinyfish.ai/v1/research-run/run-1";

beforeEach(() => fetchMock.activate());
afterEach(() => fetchMock.reset());

describe("readPages", () => {
  it("reads up to ten pages in one call and returns them in the order asked", async () => {
    let key: string | null = null;
    fetchMock.intercept({
      method: "POST",
      url: FETCH_API,
      reply: (req) => {
        key = req.headers.get("X-API-Key");
        return Response.json({
          results: [
            { url: "https://b.example/y", final_url: "https://b.example/y/", title: "B", author: null, published_date: null, text: "Second page.", links: [] },
            { url: "https://a.example/x", final_url: "https://a.example/x", title: "A", author: "A Writer", published_date: "2025-12-15T22:20:00", text: "First page.", links: ["https://c.example/z"] },
          ],
          errors: [{ url: "https://gone.example/", error: "page_not_found", status: 404 }],
        });
      },
    });

    const pages = await readPages(env, ["https://a.example/x", "https://gone.example/", "https://b.example/y"]);

    expect(key).toBe("test-tinyfish-key");
    expect(fetchMock.calls).toHaveLength(1);
    expect(fetchMock.calls[0]?.body).toMatchObject({ urls: ["https://a.example/x", "https://gone.example/", "https://b.example/y"], format: "markdown", links: true });
    expect(pages).toEqual([
      { url: "https://a.example/x", ok: true, finalUrl: "https://a.example/x", title: "A", author: "A Writer", date: "2025-12-15", text: "First page.", links: ["https://c.example/z"] },
      { url: "https://gone.example/", ok: false, error: "page_not_found" },
      { url: "https://b.example/y", ok: true, finalUrl: "https://b.example/y/", title: "B", author: null, date: null, text: "Second page.", links: [] },
    ]);
  });

  it("marks every page unread when the call itself fails", async () => {
    fetchMock.intercept({ method: "POST", url: FETCH_API, reply: { status: 500, body: "down" } });
    expect(await readPages(env, ["https://a.example/x", "https://b.example/y"])).toEqual([
      { url: "https://a.example/x", ok: false, error: "http_500" },
      { url: "https://b.example/y", ok: false, error: "http_500" },
    ]);
  });

  it("marks a page unread when it came back without text or not at all", async () => {
    fetchMock.intercept({ method: "POST", url: FETCH_API, reply: { json: { results: [{ url: "https://a.example/x", text: null }], errors: [] } } });
    expect(await readPages(env, ["https://a.example/x", "https://b.example/y"])).toEqual([
      { url: "https://a.example/x", ok: false, error: "no_text" },
      { url: "https://b.example/y", ok: false, error: "no_result" },
    ]);
  });

  it("refuses more than ten addresses and makes no call for none", async () => {
    await expect(readPages(env, Array.from({ length: 11 }, (_, i) => `https://a.example/${i}`))).rejects.toThrow("at most 10");
    expect(await readPages(env, [])).toEqual([]);
    expect(fetchMock.calls).toHaveLength(0);
  });
});

describe("research", () => {
  it("starts a deep run on the chosen account and returns its id", async () => {
    let key: string | null = null;
    fetchMock.intercept({ method: "POST", url: START, reply: (req) => ((key = req.headers.get("X-API-Key")), Response.json({ research_run_id: "run-1" })) });
    expect(await startResearch(env, "second", "Where does this come from?")).toBe("run-1");
    expect(key).toBe("test-tinyfish-key-2");
    expect(fetchMock.calls[0]?.body).toEqual({ query: "Where does this come from?", mode: "deep" });
  });

  it("turns a refusal into a typed error with the code TinyFish gave", async () => {
    fetchMock.intercept({ method: "POST", url: START, reply: { status: 402, json: { error: { code: "INSUFFICIENT_CREDITS", message: "no" } } } });
    const err = await startResearch(env, "main", "q").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TinyFishError);
    expect(err).toMatchObject({ status: 402, code: "INSUFFICIENT_CREDITS" });
  });

  it("reports progress while a run is going", async () => {
    fetchMock.intercept({
      method: "GET",
      url: RUN,
      reply: { json: { status: "RUNNING", evidence: [{ url: "https://www.a.example/x" }, { url: "https://b.example/y" }, { url: "https://b.example/z" }], deep_result: null } },
    });
    expect(await readResearch(env, "main", "run-1")).toEqual({ status: "running", pagesRead: 3, latestHosts: ["a.example", "b.example"], report: null });
  });

  it("returns the report of a finished run", async () => {
    fetchMock.intercept({ method: "GET", url: RUN, reply: { json: { status: "COMPLETED", evidence: [], deep_result: { result: "# Report" } } } });
    expect(await readResearch(env, "main", "run-1")).toEqual({ status: "completed", pagesRead: 0, latestHosts: [], report: "# Report" });
  });

  it("is failed when a run ended without a report, timed out or was cancelled", async () => {
    for (const body of [{ status: "COMPLETED", deep_result: { result: "" } }, { status: "TIMED_OUT" }, { status: "CANCELLED" }, { status: "FAILED" }]) {
      fetchMock.intercept({ method: "GET", url: RUN, reply: { json: body } });
      expect((await readResearch(env, "main", "run-1")).status).toBe("failed");
    }
  });

  it("is queued before a worker picks the run up", async () => {
    fetchMock.intercept({ method: "GET", url: RUN, reply: { json: { status: "QUEUED" } } });
    expect((await readResearch(env, "main", "run-1")).status).toBe("queued");
  });
});

describe("Internet Archive", () => {
  it("finds the saved copy nearest a date", async () => {
    fetchMock.intercept({
      method: "GET",
      url: "https://archive.org/wayback/available?url=https%3A%2F%2Fa.example%2Fstory&timestamp=20150514",
      reply: { json: { archived_snapshots: { closest: { available: true, status: "200", timestamp: "20150531191406", url: "http://web.archive.org/web/20150531191406/http://a.example:80/story" } } } },
    });
    expect(await savedCopy("https://a.example/story", "2015-05-14")).toEqual({ url: "https://web.archive.org/web/20150531191406/http://a.example:80/story", date: "2015-05-31" });
  });

  it("asks for the latest copy when no date is known", async () => {
    fetchMock.intercept({ method: "GET", url: "https://archive.org/wayback/available?url=https%3A%2F%2Fa.example%2Fstory", reply: { json: { archived_snapshots: {} } } });
    expect(await savedCopy("https://a.example/story", null)).toBeNull();
  });

  it("is null, never an error, when the archive is down", async () => {
    fetchMock.intercept({ method: "GET", url: /archive\.org\/wayback/, reply: { status: 503, body: "busy" } });
    fetchMock.intercept({ method: "GET", url: /web\.archive\.org\/cdx/, reply: { status: 503, body: "busy" } });
    expect(await savedCopy("https://a.example/story", "2015")).toBeNull();
    expect(await firstSeen("https://a.example/story")).toBeNull();
  });

  it("tells when a page was first saved", async () => {
    fetchMock.intercept({
      method: "GET",
      url: "https://web.archive.org/cdx/search/cdx?url=https%3A%2F%2Fa.example%2Fstory&output=json&limit=1&fl=timestamp%2Cstatuscode",
      reply: { json: [["timestamp", "statuscode"], ["20120208152927", "200"]] },
    });
    expect(await firstSeen("https://a.example/story")).toBe("2012-02-08");
  });

  it("is null for a page the archive never saved", async () => {
    fetchMock.intercept({ method: "GET", url: /web\.archive\.org\/cdx/, reply: { json: [] } });
    expect(await firstSeen("https://a.example/story")).toBeNull();
  });
});
