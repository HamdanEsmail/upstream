import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createTrace } from "../src/trace/create";
import { buildQuery } from "../src/trace/query";
import { countOf, getTrace } from "../src/trace/store";

const NOW = new Date("2026-11-11T06:30:00.000Z");
const PAGE = "https://news.example/science/indoor-air";
const TEXT = "People spend nearly 90 percent of their time indoors.";

let started: string[] = [];
const start = async (id: string) => {
  started.push(id);
};

beforeEach(async () => {
  started = [];
  for (const table of ["traces", "limits"]) await env.DB.prepare(`DELETE FROM ${table}`).run();
});

describe("createTrace", () => {
  it("stores the claim, keeps the nearby links that are web addresses, and starts the work", async () => {
    const made = await createTrace(env, { pageUrl: PAGE, text: `  ${TEXT}  `, near: ["https://agency.example/report", "mailto:x@y.example", 7] }, "203.0.113.9", NOW, start);
    expect(made).toMatchObject({ ok: true, reused: false });
    if (!made.ok) return;
    expect(made.id).toMatch(/^[a-z2-9]{10}$/);
    expect(started).toEqual([made.id]);
    expect(await getTrace(env.DB, made.id)).toMatchObject({ pageUrl: PAGE, text: TEXT, status: "following", near: ["https://agency.example/report"], createdAt: NOW.toISOString() });
  });

  it("returns the existing trail for the same claim on the same page, however it is typed", async () => {
    const first = await createTrace(env, { pageUrl: PAGE, text: TEXT }, "203.0.113.9", NOW, start);
    const again = await createTrace(env, { pageUrl: "http://www.news.example/science/indoor-air/?utm_source=mail#top", text: "“People spend  nearly 90 percent of their time indoors.”" }, "198.51.100.4", NOW, start);
    expect(again).toMatchObject({ ok: true, reused: true });
    expect(again.ok && first.ok && again.id === first.id).toBe(true);
    expect(started).toHaveLength(1);
    expect(await countOf(env.DB, "2026-11-11", "traces")).toBe(1);
  });

  it("refuses text that is too short or too long", async () => {
    expect(await createTrace(env, { pageUrl: PAGE, text: "Too short" }, "v", NOW, start)).toMatchObject({ ok: false, status: 400, code: "text_too_short" });
    expect(await createTrace(env, { pageUrl: PAGE, text: "word ".repeat(200) }, "v", NOW, start)).toMatchObject({ ok: false, status: 400, code: "text_too_long" });
    expect(await createTrace(env, { pageUrl: PAGE, text: 42 }, "v", NOW, start)).toMatchObject({ ok: false, status: 400, code: "text_too_short" });
  });

  it("refuses an address that is not a public web page", async () => {
    for (const pageUrl of ["ftp://news.example/x", "http://localhost:8787/x", "http://192.168.1.4/x", "https://intranet/x", "https://printer.local/x", "not an address", null]) {
      expect(await createTrace(env, { pageUrl, text: TEXT }, "v", NOW, start)).toMatchObject({ ok: false, status: 400, code: "bad_address" });
    }
    expect(started).toEqual([]);
  });

  it("lets one visitor start six new traces an hour, and other visitors carry on", async () => {
    for (let i = 0; i < 6; i++) expect((await createTrace(env, { pageUrl: PAGE, text: `${TEXT} Number ${i}.` }, "203.0.113.9", NOW, start)).ok).toBe(true);
    expect(await createTrace(env, { pageUrl: PAGE, text: `${TEXT} One more.` }, "203.0.113.9", NOW, start)).toMatchObject({ ok: false, status: 429, code: "too_many_traces" });
    expect((await createTrace(env, { pageUrl: PAGE, text: `${TEXT} One more.` }, "198.51.100.4", NOW, start)).ok).toBe(true);
    const nextHour = new Date("2026-11-11T07:30:00.000Z");
    expect((await createTrace(env, { pageUrl: PAGE, text: `${TEXT} After the hour.` }, "203.0.113.9", nextHour, start)).ok).toBe(true);
  });

  it("stops new traces for everyone at the daily limit", async () => {
    await env.DB.prepare("INSERT INTO limits (day, name, count) VALUES ('2026-11-11', 'traces', 40)").run();
    expect(await createTrace(env, { pageUrl: PAGE, text: TEXT }, "v", NOW, start)).toMatchObject({ ok: false, status: 429, code: "daily_limit" });
  });

  it("starts no new trace when too little of the day's reading budget is left for one", async () => {
    await env.DB.prepare("INSERT INTO limits (day, name, count) VALUES ('2026-11-11', 'fetch', 470)").run();
    expect(await createTrace(env, { pageUrl: PAGE, text: TEXT }, "v", NOW, start)).toMatchObject({ ok: false, status: 429, code: "daily_limit" });
    expect(started).toEqual([]);
  });

  it("leaves nothing behind when the work could not be started", async () => {
    const made = await createTrace(env, { pageUrl: PAGE, text: TEXT }, "v", NOW, async () => {
      throw new Error("no workflow");
    });
    expect(made).toMatchObject({ ok: false, status: 503, code: "could_not_start" });
    expect((await createTrace(env, { pageUrl: PAGE, text: TEXT }, "v", NOW, start)).ok).toBe(true);
  });
});

describe("buildQuery", () => {
  it("names the page and the highlight, and asks for the closing block", () => {
    const q = buildQuery(PAGE, 'He said "nearly 90 percent" of time is indoors.', []);
    expect(q).toContain(`Page: ${PAGE}`);
    expect(q).toContain(`Highlighted text: "He said 'nearly 90 percent' of time is indoors."`);
    expect(q).toContain("fenced code block labelled json");
    expect(q).toContain('"verdict":');
    expect(q).not.toContain("already found");
  });

  it("lists the steps already found by following links", () => {
    const q = buildQuery(PAGE, TEXT, [{ url: "https://agency.example/report", wording: "Americans spend about 90 percent of their time indoors." }]);
    expect(q).toContain("Steps already found by following the page's links");
    expect(q).toContain('https://agency.example/report: "Americans spend about 90 percent of their time indoors."');
  });
});

describe("createTrace after a failure", () => {
  it("starts afresh when the earlier trace for the same claim failed", async () => {
    const first = await createTrace(env, { pageUrl: PAGE, text: TEXT }, "v", NOW, start);
    if (!first.ok) throw new Error("setup");
    await env.DB.prepare("UPDATE traces SET status = 'failed' WHERE id = ?").bind(first.id).run();
    const second = await createTrace(env, { pageUrl: PAGE, text: TEXT }, "v", NOW, start);
    expect(second).toMatchObject({ ok: true, reused: false });
    expect(second.ok && second.id !== first.id).toBe(true);
    expect(await getTrace(env.DB, first.id)).toBeNull();
  });

  it("skips the visitor and daily limits when told to", async () => {
    await env.DB.prepare("INSERT INTO limits (day, name, count) VALUES ('2026-11-11', 'traces', 40)").run();
    expect((await createTrace(env, { pageUrl: PAGE, text: TEXT }, "admin", NOW, start, { limits: false })).ok).toBe(true);
  });
});
