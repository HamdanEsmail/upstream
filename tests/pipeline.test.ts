import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTrace, type TraceStep } from "../src/trace/run";
import { countOf, getChanges, getEvents, getSteps, getTrace, insertTrace, totals } from "../src/trace/store";
import { fetchMock } from "./helpers/fetch-mock";

const NOW = new Date("2026-11-11T06:30:00.000Z");
const clock = () => NOW;

const START = "https://news.example/science/indoor-air";
const AGENCY = "https://agency.example/indoor-report";
const STUDY = "https://journal.example/study-2001";
const HIGHLIGHT = "People spend nearly 90 percent of their time indoors";

type Page = { text: string; links?: string[]; published_date?: string; title?: string };

const PAGES: Record<string, Page> = {
  [START]: {
    title: "How safe is the air indoors?",
    published_date: "2025-12-15T10:00:00",
    text: "A new study looks at dust. People spend nearly 90 percent of their time indoors, yet indoor air is studied less. The ferry leaves at noon.",
    links: ["https://www.facebook.com/newsexample", AGENCY],
  },
  [AGENCY]: {
    title: "Indoor air quality",
    published_date: "2017-11-02",
    text: "On average, people spend approximately 90 percent of their time indoors, the agency says.",
    links: [STUDY],
  },
  [STUDY]: {
    title: "A survey of daily activity",
    published_date: "2001-07-26",
    text: "Methods follow. Respondents reported spending an average of 87 percent of their time in enclosed buildings. Vehicles took about 6 percent.",
    links: [],
  },
};

const trail = (over: Record<string, unknown> = {}) => ({
  steps: [
    { url: START, publisher: "Example News", date: "2025-12-15", wording: "People spend nearly 90 percent of their time indoors, yet indoor air is studied less.", names_source: "none", linked: false },
    { url: AGENCY, publisher: "The Agency", date: "unknown", wording: "On average, people spend approximately 90 percent of their time indoors, the agency says.", names_source: "a 2001 survey", linked: true },
    { url: STUDY, publisher: "Journal of Examples", date: "2001", wording: "Respondents reported spending an average of 87 percent of their time in enclosed buildings.", names_source: "none", linked: true },
  ],
  origin: { found: true, url: STUDY, kind: "study", note: "A national survey." },
  changes: ["Respondents in one country became people in general."],
  verdict: "changed_on_the_way",
  summary: "The figure comes from a 2001 survey that measured 87 percent. It was rounded up on the way.",
  ...over,
});

const report = (body: unknown) => "# Report\n\nProse.\n\n```json\n" + JSON.stringify(body) + "\n```\n";

/** What the fake TinyFish and Internet Archive answer in a test. */
type World = {
  pages: Record<string, Page | null>;
  /** Runs each account already made today, by key. */
  runsToday: Record<string, number>;
  /** Answers to successive reads of the research run. */
  runStates: unknown[];
  startStatus: number;
  archive: Record<string, { copy: string; timestamp: string } | undefined>;
  fetched: string[][];
  startedWith: string[];
};

function world(over: Partial<World> = {}): World {
  const w: World = {
    pages: { ...PAGES },
    runsToday: { "test-tinyfish-key": 0, "test-tinyfish-key-2": 0 },
    runStates: [
      { status: "RUNNING", evidence: [{ url: AGENCY }, { url: STUDY }] },
      { status: "COMPLETED", evidence: [{ url: AGENCY }, { url: STUDY }, { url: START }], deep_result: { result: report(trail()) } },
    ],
    startStatus: 200,
    archive: {},
    fetched: [],
    startedWith: [],
    ...over,
  };
  fetchMock.intercept({
    method: "POST",
    url: "https://api.fetch.tinyfish.ai/",
    times: Infinity,
    reply: (_req, body) => {
      const urls = (body as { urls: string[] }).urls;
      w.fetched.push(urls);
      const results = [];
      const errors = [];
      for (const url of urls) {
        const page = w.pages[url];
        if (page) results.push({ url, final_url: url, title: page.title ?? null, author: null, published_date: page.published_date ?? null, text: page.text, links: page.links ?? [] });
        else errors.push({ url, error: "page_not_found", status: 404 });
      }
      return Response.json({ results, errors });
    },
  });
  fetchMock.intercept({
    method: "GET",
    url: /agent\.tinyfish\.ai\/v1\/research-run\?/,
    times: Infinity,
    reply: (req) => {
      const used = w.runsToday[req.headers.get("X-API-Key") ?? ""] ?? 0;
      return Response.json({ data: Array.from({ length: used }, () => ({ status: "COMPLETED" })) });
    },
  });
  fetchMock.intercept({
    method: "POST",
    url: "https://agent.tinyfish.ai/v1/automation/run-research-async",
    times: Infinity,
    reply: (req) => {
      w.startedWith.push(req.headers.get("X-API-Key") ?? "");
      return w.startStatus === 200 ? Response.json({ research_run_id: "run-1" }) : Response.json({ error: { code: "SERVICE_BUSY" } }, { status: w.startStatus });
    },
  });
  let reads = 0;
  fetchMock.intercept({
    method: "GET",
    url: "https://agent.tinyfish.ai/v1/research-run/run-1",
    times: Infinity,
    reply: () => Response.json(w.runStates[Math.min(reads++, w.runStates.length - 1)]),
  });
  fetchMock.intercept({
    method: "GET",
    url: /archive\.org\/wayback\/available/,
    times: Infinity,
    reply: (req) => {
      const saved = w.archive[new URL(req.url).searchParams.get("url") ?? ""];
      return Response.json({ archived_snapshots: saved ? { closest: { available: true, status: "200", timestamp: saved.timestamp, url: saved.copy } } : {} });
    },
  });
  fetchMock.intercept({ method: "GET", url: /web\.archive\.org\/cdx/, times: Infinity, reply: { json: [] } });
  return w;
}

function fakeStep(): TraceStep & { names: string[] } {
  const names: string[] = [];
  return {
    names,
    async do(name, fn) {
      names.push(name);
      return fn();
    },
    async sleep(name) {
      names.push(name);
    },
  };
}

async function newTrace(id = "t1", text = HIGHLIGHT, near: string[] = []) {
  await insertTrace(env.DB, { id, pageUrl: START, text, textKey: `key-${id}`, near, now: NOW.toISOString() });
}

beforeEach(async () => {
  fetchMock.activate();
  for (const table of ["traces", "steps", "staged_steps", "changes", "events", "spend", "limits"]) await env.DB.prepare(`DELETE FROM ${table}`).run();
});
afterEach(() => fetchMock.reset());

describe("a full trace", () => {
  it("follows the links, runs the deep search, checks each step and decides", async () => {
    const w = world();
    await newTrace();
    const step = fakeStep();

    await runTrace(env, "t1", step, clock);

    const trace = await getTrace(env.DB, "t1");
    expect(trace).toMatchObject({
      status: "done",
      verdict: "changed_on_the_way",
      reached: "original",
      summary: "The figure comes from a 2001 survey that measured 87 percent. It was rounded up on the way.",
      researchRunId: "run-1",
      researchAccount: "main",
      pagesRead: 3,
      spendUsd: 0,
      finishedAt: NOW.toISOString(),
    });

    const steps = await getSteps(env.DB, "t1");
    expect(steps.map((s) => [s.url, s.reading, s.reachedBy, s.date, s.dateSource])).toEqual([
      [START, "exact", "start", "2025-12-15", "page"],
      [AGENCY, "close", "link", "2017-11-02", "page"],
      [STUDY, "exact", "link", "2001-07-26", "page"],
    ]);
    expect(steps[0]?.wording).toBe("People spend nearly 90 percent of their time indoors, yet indoor air is studied less.");
    expect(steps[1]?.namesSource).toBe("a 2001 survey");
    expect(steps[2]?.wording).toBe("Respondents reported spending an average of 87 percent of their time in enclosed buildings.");

    const changes = await getChanges(env.DB, "t1");
    expect(changes).toContainEqual({ fromPosition: 2, toPosition: 0, kind: "rounded", detail: "87 percent became 90 percent", basis: "code" });
    expect(changes).toContainEqual({ fromPosition: null, toPosition: null, kind: "noted", detail: "Respondents in one country became people in general.", basis: "research" });

    // One read of the start page, one try per link hop, one check of the page not yet read.
    expect(w.fetched).toEqual([[START], [AGENCY], [STUDY], [STUDY]]);
    expect(w.startedWith).toEqual(["test-tinyfish-key"]);
    expect(await countOf(env.DB, "2026-11-11", "research:main")).toBe(1);
    expect(await totals(env.DB)).toMatchObject({ deepSearches: 1, spendUsd: 0 });
    expect(step.names.filter((n) => n.startsWith("wait"))).toHaveLength(2);
    expect((await getEvents(env.DB, "t1", 50)).map((e) => e.message)).toEqual(
      expect.arrayContaining(["Read the page you highlighted.", "Followed a link to agency.example.", "Started the deep search. It usually takes 4 to 6 minutes.", "The deep search finished after reading 3 pages.", "Done."]),
    );
  });

  it("sends the steps found by following links along with the question", async () => {
    world();
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    const start = fetchMock.calls.find((c) => c.url.endsWith("/run-research-async"));
    expect((start?.body as { query: string }).query).toContain(`${AGENCY}: "On average, people spend approximately 90 percent of their time indoors, the agency says."`);
  });
});

describe("which deep search a trace gets", () => {
  it("uses the second account's free runs when the main account's are used", async () => {
    const w = world({ runsToday: { "test-tinyfish-key": 2, "test-tinyfish-key-2": 1 } });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    expect(w.startedWith).toEqual(["test-tinyfish-key-2"]);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ researchAccount: "second", spendUsd: 0 });
  });

  it("pays for one from the reserve when no free run is left, and says so", async () => {
    const w = world({ runsToday: { "test-tinyfish-key": 2, "test-tinyfish-key-2": 2 } });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    expect(w.startedWith).toEqual(["test-tinyfish-key"]);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ researchAccount: "main", spendUsd: 2, verdict: "changed_on_the_way" });
    expect(await totals(env.DB)).toMatchObject({ spendUsd: 2 });
    expect((await getEvents(env.DB, "t1", 50)).map((e) => e.message)).toContain("Started the deep search. This one is paid for from the reserve ($2).");
  });

  it("runs without a deep search when the free runs and the reserve are both used, and settles nothing", async () => {
    const w = world({ runsToday: { "test-tinyfish-key": 2, "test-tinyfish-key-2": 2 } });
    await env.DB.prepare("INSERT INTO limits (day, name, count) VALUES ('all', 'research:paid', 1)").run();
    await newTrace();
    const step = fakeStep();
    await runTrace(env, "t1", step, clock);
    expect(w.startedWith).toEqual([]);
    expect(step.names.some((n) => n.startsWith("wait"))).toBe(false);
    const trace = await getTrace(env.DB, "t1");
    expect(trace).toMatchObject({ status: "done", verdict: "not_settled", reached: "earliest_copy", researchRunId: null, spendUsd: 0 });
    expect(trace?.summary).toBe("The deep search did not run, so this trail shows only what following the page's links found.");
    expect((await getSteps(env.DB, "t1")).map((s) => s.url)).toEqual([START, AGENCY]);
    expect((await getEvents(env.DB, "t1", 50)).map((e) => e.message)).toContain("Today's deep searches are used up. This trail comes from following links only; the deep search is back at midnight UTC.");
  });

  it("gives the slot back when the run could not be started", async () => {
    world({ startStatus: 503 });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    expect(await countOf(env.DB, "2026-11-11", "research:main")).toBe(0);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done", verdict: "not_settled", researchRunId: null });
  });

  it("settles nothing when the deep search fails", async () => {
    world({ runStates: [{ status: "RUNNING", evidence: [] }, { status: "FAILED" }] });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done", verdict: "not_settled", reached: "earliest_copy" });
  });

  it("settles nothing when the report has no trail to read", async () => {
    world({ runStates: [{ status: "COMPLETED", evidence: [], deep_result: { result: "A report without the closing block." } }] });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done", verdict: "not_settled" });
  });
});

describe("checking what the deep search proposes", () => {
  it("reads a saved copy when the live page no longer holds the sentence", async () => {
    const copy = "https://web.archive.org/web/20010801000000/https://journal.example/study-2001";
    world({
      pages: { ...PAGES, [STUDY]: { text: "This article has moved.", links: [] }, [copy]: PAGES[STUDY] as Page },
      archive: { [STUDY]: { copy: copy.replace("https://web", "http://web"), timestamp: "20010801000000" } },
    });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    const study = (await getSteps(env.DB, "t1"))[2];
    expect(study).toMatchObject({ url: STUDY, reading: "exact", readFrom: "archive", archiveUrl: copy });
    expect((await getEvents(env.DB, "t1", 50)).map((e) => e.message)).toContain("Checked journal.example: found word for word in a saved copy.");
  });

  it("credits a source that is only in print to the page that quotes it", async () => {
    const book = { url: "print only", publisher: "A 1960 handbook", date: "1960", wording: "On average, people spend approximately 90 percent of their time indoors, the agency says.", names_source: "none", linked: false };
    const steps = [...trail().steps.slice(0, 2), book];
    world({ runStates: [{ status: "COMPLETED", evidence: [], deep_result: { result: report(trail({ steps, origin: { found: true, url: "", kind: "book", note: "" }, verdict: "matches_original" })) } }] });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    const last = (await getSteps(env.DB, "t1"))[2];
    expect(last).toMatchObject({ url: null, publisher: "A 1960 handbook", reading: "offline", quotedBy: "agency.example", date: "1960", dateSource: "research", reachedBy: "named" });
    expect(last?.wording).toBe("On average, people spend approximately 90 percent of their time indoors, the agency says.");
  });

  it("keeps a step whose page does not hold the wording, marked as not found", async () => {
    world({ pages: { ...PAGES, [STUDY]: { text: "A different article entirely.", links: [] } } });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    const steps = await getSteps(env.DB, "t1");
    expect(steps[2]).toMatchObject({ url: STUDY, reading: "not_found", wording: null });
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done", verdict: "changed_on_the_way" });
  });

  it("works from the highlight when the start page cannot be read", async () => {
    world({ pages: { ...PAGES, [START]: null } });
    await newTrace("t1", HIGHLIGHT, [AGENCY]);
    await runTrace(env, "t1", fakeStep(), clock);
    const steps = await getSteps(env.DB, "t1");
    expect(steps[0]).toMatchObject({ url: START, reading: "unreadable", wording: HIGHLIGHT });
    expect(steps[1]).toMatchObject({ url: AGENCY, reachedBy: "link" });
    expect((await getEvents(env.DB, "t1", 50)).map((e) => e.message)).toContain("Could not read the page you highlighted. The trace works from the highlight itself.");
  });
});

describe("when something breaks", () => {
  it("marks the trace failed and passes the error on", async () => {
    world();
    await newTrace();
    const step = fakeStep();
    const broken: TraceStep = { do: (name, fn) => (name === "finish" ? Promise.reject(new Error("boom")) : step.do(name, fn)), sleep: step.sleep };
    await expect(runTrace(env, "t1", broken, clock)).rejects.toThrow("boom");
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "failed", error: "boom" });
  });
});

describe("which sentence the verdict rests on", () => {
  it("compares the highlight with the earliest dated step that was confirmed, not with an undated one", async () => {
    const ACADEMY = "https://academy.example/chapter-2";
    const steps = [
      ...trail().steps,
      { url: ACADEMY, publisher: "The Academy", date: "unknown", wording: "Most people spend more than 90 percent of their time inside a building.", names_source: "none", linked: false },
    ];
    world({
      pages: { ...PAGES, [ACADEMY]: { text: "Most people spend more than 90 percent of their time inside a building.", links: [] } },
      runStates: [{ status: "COMPLETED", evidence: [], deep_result: { result: report(trail({ steps })) } }],
    });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    const stored = await getSteps(env.DB, "t1");
    expect(stored.map((s) => s.url)).toEqual([START, AGENCY, STUDY, ACADEMY]);
    const changes = await getChanges(env.DB, "t1");
    expect(changes).toContainEqual({ fromPosition: 2, toPosition: 0, kind: "rounded", detail: "87 percent became 90 percent", basis: "code" });
    expect(changes.some((c) => c.detail.includes("more than"))).toBe(false);
  });
});
