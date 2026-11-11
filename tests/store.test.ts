import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addEvent,
  appendStep,
  clearStaged,
  countOf,
  findTraceByKey,
  getChanges,
  getEvents,
  getStaged,
  getSteps,
  getTrace,
  giveBack,
  insertTrace,
  recordSpend,
  saveChanges,
  saveSteps,
  stageStep,
  takeSlot,
  totals,
  updateTrace,
  type StoredStep,
} from "../src/trace/store";

const NOW = "2026-11-11T06:00:00.000Z";

const step = (over: Partial<StoredStep>): StoredStep => ({
  url: "https://a.example/x",
  publisher: "a.example",
  title: null,
  date: null,
  dateSource: null,
  wording: "A sentence.",
  reading: "exact",
  readFrom: "live",
  archiveUrl: null,
  reachedBy: "search",
  namesSource: null,
  quotedBy: null,
  links: [],
  readAt: NOW,
  ...over,
});

async function wipe() {
  for (const table of ["traces", "steps", "staged_steps", "changes", "events", "spend", "limits"]) await env.DB.prepare(`DELETE FROM ${table}`).run();
}

beforeEach(wipe);

describe("traces", () => {
  it("stores a trace and finds it by id and by its claim key", async () => {
    await insertTrace(env.DB, { id: "t1", pageUrl: "https://a.example/x", text: "Nine in ten harbours.", textKey: "k1", near: ["https://b.example/y"], now: NOW });
    const row = await getTrace(env.DB, "t1");
    expect(row).toMatchObject({ id: "t1", pageUrl: "https://a.example/x", text: "Nine in ten harbours.", status: "following", near: ["https://b.example/y"], pagesRead: 0, latestHosts: [], verdict: null, createdAt: NOW });
    expect((await findTraceByKey(env.DB, "k1"))?.id).toBe("t1");
    expect(await findTraceByKey(env.DB, "other")).toBeNull();
    expect(await getTrace(env.DB, "missing")).toBeNull();
  });

  it("updates only the fields it is given", async () => {
    await insertTrace(env.DB, { id: "t1", pageUrl: "https://a.example/x", text: "Nine in ten.", textKey: "k1", near: [], now: NOW });
    await updateTrace(env.DB, "t1", { status: "searching", researchRunId: "run-1", researchAccount: "main", pagesRead: 7, latestHosts: ["b.example"] });
    await updateTrace(env.DB, "t1", { verdict: "matches_original" });
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "searching", researchRunId: "run-1", researchAccount: "main", pagesRead: 7, latestHosts: ["b.example"], verdict: "matches_original" });
  });
});

describe("steps", () => {
  it("appends steps in order and reads them back", async () => {
    expect(await appendStep(env.DB, "t1", step({ reachedBy: "start", links: ["https://b.example/y"] }))).toBe(0);
    expect(await appendStep(env.DB, "t1", step({ url: "https://b.example/y", reachedBy: "link", date: "2015-05-14", dateSource: "page" }))).toBe(1);
    const steps = await getSteps(env.DB, "t1");
    expect(steps.map((s) => [s.url, s.reachedBy, s.date])).toEqual([
      ["https://a.example/x", "start", null],
      ["https://b.example/y", "link", "2015-05-14"],
    ]);
    expect(steps[0]?.links).toEqual(["https://b.example/y"]);
  });

  it("replaces a trail's steps in one go", async () => {
    await appendStep(env.DB, "t1", step({}));
    await saveSteps(env.DB, "t1", [step({ url: "https://c.example/z" }), step({ url: null, reading: "offline", quotedBy: "c.example" })]);
    const steps = await getSteps(env.DB, "t1");
    expect(steps.map((s) => s.url)).toEqual(["https://c.example/z", null]);
    expect(steps[1]).toMatchObject({ reading: "offline", quotedBy: "c.example" });
  });

  it("keeps staged steps apart until they are merged", async () => {
    await stageStep(env.DB, "t1", 1, step({ url: "https://b.example/y" }));
    await stageStep(env.DB, "t1", 0, step({ url: "https://a.example/x" }));
    await stageStep(env.DB, "t1", 0, step({ url: "https://a.example/again" }));
    expect((await getStaged(env.DB, "t1")).map((s) => s.url)).toEqual(["https://a.example/again", "https://b.example/y"]);
    expect(await getSteps(env.DB, "t1")).toEqual([]);
    await clearStaged(env.DB, "t1");
    expect(await getStaged(env.DB, "t1")).toEqual([]);
  });
});

describe("changes and events", () => {
  it("replaces a trail's changes", async () => {
    await saveChanges(env.DB, "t1", [{ fromPosition: 3, toPosition: 0, kind: "rounded", detail: "87% became 90 percent", basis: "code" }]);
    await saveChanges(env.DB, "t1", [{ fromPosition: null, toPosition: null, kind: "noted", detail: "The group changed.", basis: "research" }]);
    expect(await getChanges(env.DB, "t1")).toEqual([{ fromPosition: null, toPosition: null, kind: "noted", detail: "The group changed.", basis: "research" }]);
  });

  it("logs events and returns the latest ones oldest first", async () => {
    await addEvent(env.DB, "t1", "Read the page.", "2026-11-11T06:00:01.000Z");
    await addEvent(env.DB, "t1", "Followed a link.", "2026-11-11T06:00:02.000Z");
    await addEvent(env.DB, "t1", "Started the deep search.", "2026-11-11T06:00:03.000Z");
    expect((await getEvents(env.DB, "t1", 2)).map((e) => e.message)).toEqual(["Followed a link.", "Started the deep search."]);
  });
});

describe("limits and spend", () => {
  it("hands out slots up to the limit and no further", async () => {
    expect(await takeSlot(env.DB, "2026-11-11", "research:main", 2)).toBe(true);
    expect(await takeSlot(env.DB, "2026-11-11", "research:main", 2)).toBe(true);
    expect(await takeSlot(env.DB, "2026-11-11", "research:main", 2)).toBe(false);
    expect(await countOf(env.DB, "2026-11-11", "research:main")).toBe(2);
    expect(await takeSlot(env.DB, "2026-11-12", "research:main", 2)).toBe(true);
  });

  it("never hands out a slot when the limit is zero", async () => {
    expect(await takeSlot(env.DB, "2026-11-11", "research:paid", 0)).toBe(false);
    expect(await countOf(env.DB, "2026-11-11", "research:paid")).toBe(0);
  });

  it("gives a slot back", async () => {
    await takeSlot(env.DB, "2026-11-11", "research:main", 2);
    await giveBack(env.DB, "2026-11-11", "research:main");
    expect(await countOf(env.DB, "2026-11-11", "research:main")).toBe(0);
  });

  it("adds up traces, steps and spend", async () => {
    await insertTrace(env.DB, { id: "t1", pageUrl: "https://a.example/x", text: "Nine in ten.", textKey: "k1", near: [], now: NOW });
    await saveSteps(env.DB, "t1", [step({}), step({ url: "https://b.example/y" })]);
    await recordSpend(env.DB, "research", 0, "run-1", NOW);
    await recordSpend(env.DB, "research", 2, "run-2", NOW);
    // Money is added up from what was spent; a deep search is counted per trail that had one.
    expect(await totals(env.DB)).toEqual({ traces: 1, steps: 2, deepSearches: 0, spendUsd: 2 });
    await updateTrace(env.DB, "t1", { researchRunId: "run-2" });
    expect(await totals(env.DB)).toEqual({ traces: 1, steps: 2, deepSearches: 1, spendUsd: 2 });
  });
});
