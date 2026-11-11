import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { getTrace, insertTrace, saveSteps, updateTrace, type StoredStep } from "../src/trace/store";

const PAGE = "https://news.example/science/indoor-air";
const TEXT = "People spend nearly 90 percent of their time indoors.";
const NOW = "2026-11-11T06:30:00.000Z";

let started: string[] = [];
const app = createApp({
  start: async (_env, id) => {
    started.push(id);
  },
});

const call = (path: string, init?: RequestInit) => app.request(`https://upstream.test${path}`, init, env);
const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const form = (fields: Record<string, string>): RequestInit => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });

const step = (over: Partial<StoredStep>): StoredStep => ({
  url: PAGE,
  publisher: "news.example",
  title: null,
  date: null,
  dateSource: null,
  wording: TEXT,
  reading: "exact",
  readFrom: "live",
  archiveUrl: null,
  reachedBy: "start",
  namesSource: null,
  quotedBy: null,
  links: [],
  readAt: NOW,
  ...over,
});

async function finished(id: string, text = TEXT) {
  await insertTrace(env.DB, { id, pageUrl: PAGE, text, textKey: `key-${id}`, near: [], now: NOW });
  await saveSteps(env.DB, id, [
    step({}),
    step({ url: "https://journal.example/study", publisher: "Journal of Examples", date: "2001-07-26", dateSource: "page", wording: "People spend an average of 87 percent of their time indoors.", reachedBy: "search" }),
  ]);
  await updateTrace(env.DB, id, { status: "done", verdict: "changed_on_the_way", reached: "original", summary: "It comes from a 2001 survey.", finishedAt: NOW });
}

beforeEach(async () => {
  started = [];
  for (const table of ["traces", "steps", "staged_steps", "changes", "events", "spend", "limits"]) await env.DB.prepare(`DELETE FROM ${table}`).run();
});

describe("the API", () => {
  it("starts a trace and answers with where to watch it", async () => {
    const res = await call("/api/traces", json({ page_url: PAGE, text: TEXT, near: ["https://agency.example/report"] }));
    expect(res.status).toBe(202);
    const body = (await res.json()) as { id: string; url: string; api: string; reused: boolean };
    expect(body).toMatchObject({ url: `https://upstream.test/t/${body.id}`, api: `https://upstream.test/api/traces/${body.id}`, reused: false });
    expect(started).toEqual([body.id]);

    const again = await call("/api/traces", json({ page_url: PAGE, text: TEXT }));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ id: body.id, reused: true });
    expect(started).toHaveLength(1);
  });

  it("refuses a bad request in plain words", async () => {
    const short = await call("/api/traces", json({ page_url: PAGE, text: "Too short" }));
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({ error: "text_too_short", message: "Highlight at least 12 characters. A whole sentence works best." });
    const notJson = await call("/api/traces", { method: "POST", headers: { "content-type": "application/json" }, body: "{ nope" });
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toMatchObject({ error: "bad_request" });
  });

  it("returns a trail as JSON, and 404 for one that does not exist", async () => {
    await finished("t1");
    const res = await call("/api/traces/t1");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toMatchObject({ id: "t1", status: "done", verdict: "changed_on_the_way", verdictWords: "Changed on the way", steps: [{ position: 0 }, { position: 1, datePlain: "26 July 2001" }] });
    const missing = await call("/api/traces/nope");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found", message: "There is no trail with that id." });
  });

  it("serves the trail alone, for the side panel", async () => {
    await finished("t1");
    const res = await call("/api/traces/t1/fragment?panel=1");
    const html = await res.text();
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(html.startsWith("<main")).toBe(true);
    expect(html).toContain('class="trail panel"');
    expect(html).toContain("Changed on the way");
    expect(html).not.toContain("<html");
    expect((await call("/api/traces/nope/fragment")).status).toBe(404);
  });

  it("answers a preflight request", async () => {
    const res = await call("/api/traces", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("reports the totals", async () => {
    await finished("t1");
    const res = await call("/api/stats");
    expect(await res.json()).toEqual({ traces: 1, steps: 2, deepSearches: 0, spendUsd: 0 });
  });
});

describe("the pages", () => {
  it("shows a finished trail", async () => {
    await finished("t1");
    const res = await call("/t/t1");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Changed on the way");
    expect(html).toContain("It comes from a 2001 survey.");
    expect(html).toContain("26 July 2001");
    expect(html).toContain("Cite it right");
    expect(html).toContain("the earliest step confirmed");
    // On a narrow screen the trail comes before the facts and the citation.
    expect(html.indexOf('class="line"')).toBeGreaterThan(html.indexOf('class="verdict"'));
    expect(html.indexOf('class="line"')).toBeLessThan(html.indexOf('class="facts"'));
    expect(html).toContain('data-running="false"');
    expect(html).not.toContain("http-equiv");
  });

  it("shows a running trace as working, with a clock and a reload for browsers without scripts", async () => {
    await insertTrace(env.DB, { id: "t2", pageUrl: PAGE, text: TEXT, textKey: "k2", near: [], now: NOW });
    await saveSteps(env.DB, "t2", [step({})]);
    await updateTrace(env.DB, "t2", { status: "searching", pagesRead: 12, latestHosts: ["agency.example"] });
    const html = await (await call("/t/t2")).text();
    expect(html).toContain('data-running="true"');
    expect(html).toContain("Following the trail");
    expect(html).toContain(`data-since="${NOW}"`);
    expect(html).toContain("The deep search has read 12 pages so far, most recently agency.example.");
    expect(html).toContain("usually takes 4 to 6 minutes");
    expect(html).toContain('<noscript><meta http-equiv="refresh" content="5"></noscript>');
  });

  it("escapes text that came from a web page", async () => {
    await finished("t1", 'A claim with <script>alert("x")</script> inside it.');
    const html = await (await call("/t/t1")).text();
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert");
  });

  it("says so when there is no such trail", async () => {
    const res = await call("/t/nope");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("No trail here");
  });

  it("carries the credit on every page", async () => {
    await finished("t1");
    for (const path of ["/", "/how", "/get", "/t/t1", "/t/nope", "/somewhere-else"]) {
      const html = await (await call(path)).text();
      expect(html, path).toContain('<meta name="author" content="Hamdan Esmail"/>');
      expect(html, path).toMatch(/Built by\s*<a href="https:\/\/github\.com\/HamdanEsmail" rel="author">\s*Hamdan Esmail\s*<\/a>/);
    }
  });

  it("starts a trace from the form and sends the visitor to its page", async () => {
    const res = await call("/trace", form({ url: PAGE, text: TEXT }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/t/${started[0]}`);
  });

  it("sends a refused form back with the reason, chosen from a fixed list", async () => {
    const res = await call("/trace", form({ url: PAGE, text: "Too short" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/?note=text_too_short");
    expect(await (await call("/?note=text_too_short")).text()).toContain("Highlight at least 12 characters. A whole sentence works best.");
    expect(await (await call("/?note=%3Cb%3Ehello")).text()).not.toContain("hello");
  });

  it("lists only the trails chosen for the first page", async () => {
    await finished("t1");
    await finished("t2", "Another claim that nobody chose to show here.");
    await call("/api/admin/traces/t1/feature", { method: "POST", headers: { authorization: "Bearer test-admin" } });
    const html = await (await call("/")).text();
    expect(html).toContain('href="/t/t1"');
    expect(html).not.toContain('href="/t/t2"');
  });
});

describe("the admin routes", () => {
  it("need the token", async () => {
    expect((await call("/api/admin/adopt", json({ page_url: PAGE, text: TEXT, research_run_id: "run-9", account: "main" }))).status).toBe(403);
    expect((await call("/api/admin/traces/t1/feature", { method: "POST", headers: { authorization: "Bearer wrong" } })).status).toBe(403);
  });

  it("build a trail from a research run that already finished, and put it on the first page", async () => {
    const res = await call("/api/admin/adopt", json({ page_url: PAGE, text: TEXT, research_run_id: "run-9", account: "second" }, { authorization: "Bearer test-admin" }));
    expect(res.status).toBe(202);
    const { id } = (await res.json()) as { id: string };
    expect(started).toEqual([id]);
    expect(await getTrace(env.DB, id)).toMatchObject({ researchRunId: "run-9", researchAccount: "second", spendUsd: 0 });
    expect(await (await call("/")).text()).toContain(`href="/t/${id}"`);
  });

  it("refuse to adopt a run for a claim that already has a trail", async () => {
    await call("/api/traces", json({ page_url: PAGE, text: TEXT }));
    const res = await call("/api/admin/adopt", json({ page_url: PAGE, text: TEXT, research_run_id: "run-9", account: "main" }, { authorization: "Bearer test-admin" }));
    expect(res.status).toBe(409);
  });

  it("delete a trail and everything it holds", async () => {
    await finished("t1");
    const res = await call("/api/admin/traces/t1", { method: "DELETE", headers: { authorization: "Bearer test-admin" } });
    expect(res.status).toBe(200);
    expect((await call("/api/traces/t1")).status).toBe(404);
    expect(await (await call("/api/stats")).json()).toMatchObject({ traces: 0, steps: 0 });
  });
});

describe("what a trail page claims", () => {
  it("does not call the page's own date the earliest step when nothing was found beyond it", async () => {
    await insertTrace(env.DB, { id: "t5", pageUrl: PAGE, text: TEXT, textKey: "k5", near: [], now: NOW });
    await saveSteps(env.DB, "t5", [step({ date: "2002-01-15", dateSource: "page" })]);
    await updateTrace(env.DB, "t5", { status: "done", verdict: "not_settled", reached: "nothing", summary: "The deep search did not run.", finishedAt: NOW });
    const html = await (await call("/t/t5")).text();
    expect(html).toContain("No steps back");
    expect(html).not.toContain("the earliest step");
    expect(html).not.toContain("0 of 0");
  });

  it("counts a source known only through a quotation apart from the steps found on their own pages", async () => {
    await insertTrace(env.DB, { id: "t6", pageUrl: PAGE, text: TEXT, textKey: "k6", near: [], now: NOW });
    await saveSteps(env.DB, "t6", [
      step({}),
      step({ url: "https://quotes.example/history", publisher: "Quote History", date: "2017-03-23", dateSource: "page", wording: "The paper wrote this in 1981.", reachedBy: "search" }),
      step({ url: "https://paper.example/", publisher: "The Daily Example", date: "1981-10-11", dateSource: "research", wording: "As printed in 1981.", reading: "offline", readFrom: null, quotedBy: "quotes.example", reachedBy: "search" }),
    ]);
    await updateTrace(env.DB, "t6", { status: "done", verdict: "said_by_someone_else", reached: "earliest_copy", summary: "Someone else said it.", finishedAt: NOW });
    const html = await (await call("/t/t6")).text();
    expect(html).toContain("1 of 2");
    expect(html).toContain("steps back, found on the page itself; 1 more known only as quoted by another page");
    expect(html).toContain("the earliest step, known only as quoted");
    expect(html).toContain("Open where it is quoted");
    expect(html).not.toContain('href="https://paper.example/"');
  });

  it("names the research tool only on a trail that had a deep search", async () => {
    await finished("t1");
    expect(await (await call("/t/t1")).text()).not.toContain("Fetch and Research");
    await finished("t7");
    await updateTrace(env.DB, "t7", { researchRunId: "run-7", researchAccount: "main", researchStartedAt: "2026-11-11T06:30:04.000Z", pagesRead: 21, finishedAt: "2026-11-11T06:35:17.000Z" });
    const html = await (await call("/t/t7")).text();
    expect(html).toContain("TinyFish Fetch and Research");
    expect(html).toContain("<dt>5 min 17 s</dt>");
    expect(html).toContain("21 pages read by the deep search");
  });

  it("gives no time on a trail built from a deep search that had already finished", async () => {
    const res = await call("/api/admin/adopt", json({ page_url: PAGE, text: TEXT, research_run_id: "run-9", account: "second" }, { authorization: "Bearer test-admin" }));
    const { id } = (await res.json()) as { id: string };
    const made = await getTrace(env.DB, id);
    // Building the trail from the finished run took 39 seconds. That is not how long the search took.
    await saveSteps(env.DB, id, [step({})]);
    await updateTrace(env.DB, id, {
      status: "done",
      verdict: "not_settled",
      reached: "nothing",
      summary: "Nothing could be confirmed.",
      pagesRead: 26,
      finishedAt: new Date(Date.parse(made!.createdAt) + 39_000).toISOString(),
    });
    expect(((await (await call(`/api/traces/${id}`)).json()) as { seconds: number | null }).seconds).toBeNull();
    const html = await (await call(`/t/${id}`)).text();
    expect(html).toContain("<dt>26 pages</dt>");
    expect(html).toContain("<dd>read by the deep search</dd>");
    expect(html).not.toContain("39 s");
    expect(html).toContain("TinyFish Fetch and Research");
  });
});

describe("what the site says about itself", () => {
  it("counts a deep search for every trail that had one, however the run was started", async () => {
    await finished("t1");
    await finished("t8");
    await updateTrace(env.DB, "t8", { researchRunId: "run-8", researchAccount: "second", researchStartedAt: NOW });
    expect(await (await call("/api/stats")).json()).toEqual({ traces: 2, steps: 4, deepSearches: 1, spendUsd: 0 });
  });

  it("warns on the first page when the day's deep searches are used up", async () => {
    expect(await (await call("/")).text()).not.toContain("deep searches are used up");
    const today = new Date().toISOString().slice(0, 10);
    await env.DB.prepare("INSERT INTO limits (day, name, count) VALUES (?, 'research:out', 1)").bind(today).run();
    const html = await (await call("/")).text();
    expect(html).toContain("deep searches are used up. A trace started now follows links only");
    expect(html).toContain("back at midnight UTC");
    expect(html).not.toContain("usually takes 4 to 6 minutes, and you can watch it grow");
  });

  it("promises nothing for midnight on the first page once a free run has been charged", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await env.DB.prepare("INSERT INTO limits (day, name, count) VALUES (?, 'research:out', 1)").bind(today).run();
    await env.DB.prepare("INSERT INTO limits (day, name, count) VALUES ('all', 'research:charged', 1)").run();
    const html = await (await call("/")).text();
    expect(html).toContain("Deep searches are switched off for now. A trace started now follows links only");
    expect(html).not.toContain("back at midnight UTC");
  });

  it("describes the API on the page about how it works", async () => {
    const html = await (await call("/how")).text();
    for (const words of ["POST /api/traces", "GET /api/traces/:id", "GET /api/stats", "text_too_short", "reused"]) expect(html).toContain(words);
  });

  it("tells a stranger enough to install and use the extension", async () => {
    const html = await (await call("/get")).text();
    for (const words of ["Chrome 116", "Trace upstream", "Load unpacked", "Developer mode", "side panel", "manifest.json", "Reload"]) expect(html).toContain(words);
  });
});
