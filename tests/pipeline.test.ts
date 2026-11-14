import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bookDeep, paidRunsLeft } from "../src/trace/deep";
import { runLeg, runTrace, type Leg, type LegStep, type TraceStep } from "../src/trace/run";
import { askSearch, readListed } from "../src/trace/search";
import { countOf, getChanges, getEvents, getSteps, getTrace, insertTrace, totals, wasSearched } from "../src/trace/store";
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
  /** What the count of today's runs and the read of the run answer with; 200 unless a test breaks them. */
  listStatus: number;
  runStatus: number;
  /** What each account's wallet holds on successive reads, by key. The last value repeats; null is a read that fails. */
  wallet: Record<string, (number | null)[]>;
  archive: Record<string, { copy: string; timestamp: string } | undefined>;
  /** The day the Internet Archive first saved a page, by address. */
  firstSeen: Record<string, string | undefined>;
  /** What TinyFish Search lists for the sentence. `date` is the index's own date for the page, in whatever form it gives. */
  search: { url: string; date?: string }[];
  /** 200 unless a test makes Search impossible to ask. */
  searchStatus: number;
  /** Every question put to Search. */
  searched: URL[];
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
    listStatus: 200,
    runStatus: 200,
    wallet: { "test-tinyfish-key": [27], "test-tinyfish-key-2": [35.97] },
    archive: {},
    firstSeen: {},
    search: [],
    searchStatus: 200,
    searched: [],
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
      if (w.listStatus !== 200) return Response.json({ error: { code: "INVALID_INPUT" } }, { status: w.listStatus });
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
    reply: () => (w.runStatus === 200 ? Response.json(w.runStates[Math.min(reads++, w.runStates.length - 1)]) : Response.json({ error: { code: "FORBIDDEN" } }, { status: w.runStatus })),
  });
  const walletReads: Record<string, number> = {};
  fetchMock.intercept({
    method: "GET",
    url: "https://agent.tinyfish.ai/v1/wallet",
    times: Infinity,
    reply: (req) => {
      const key = req.headers.get("X-API-Key") ?? "";
      const values = w.wallet[key] ?? [50];
      const read = walletReads[key] ?? 0;
      walletReads[key] = read + 1;
      const value = values[Math.min(read, values.length - 1)];
      return typeof value === "number" ? Response.json({ available_balance: String(value), currency: "USD" }) : Response.json({ error: { code: "SERVICE_BUSY" } }, { status: 503 });
    },
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
  fetchMock.intercept({
    method: "GET",
    url: /web\.archive\.org\/cdx/,
    times: Infinity,
    reply: (req) => {
      const seen = w.firstSeen[new URL(req.url).searchParams.get("url") ?? ""];
      return Response.json(seen ? [["timestamp", "statuscode"], [`${seen.replace(/-/g, "")}120000`, "200"]] : []);
    },
  });
  fetchMock.intercept({
    method: "GET",
    url: /^https:\/\/api\.search\.tinyfish\.ai\/\?/,
    times: Infinity,
    reply: (req) => {
      w.searched.push(new URL(req.url));
      if (w.searchStatus !== 200) return Response.json({ error: { code: "SERVICE_BUSY" } }, { status: w.searchStatus });
      return Response.json({ query: "", results: w.search.map((r, i) => ({ position: i + 1, site_name: "", title: "", snippet: "", ...r })), total_results: w.search.length, page: 0 });
    },
  });
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
    expect(trace?.summary).toBe(
      "The deep search did not run, so this trail shows only what following the page's links and searching the web for the sentence found. The day's deep searches return at midnight UTC: trace the sentence again after that for the full trail.",
    );
    expect((await getSteps(env.DB, "t1")).map((s) => s.url)).toEqual([START, AGENCY]);
    expect((await getEvents(env.DB, "t1", 50)).map((e) => e.message)).toContain("Today's deep searches are used up. This trail comes from following links and searching the web for the sentence; the deep search is back at midnight UTC.");
    // The first page reads this mark to warn the next visitor before they start.
    expect(await countOf(env.DB, "2026-11-11", "research:out")).toBe(1);
  });

  it("takes the used-up mark away as soon as a trace gets a deep search again", async () => {
    world({ runsToday: { "test-tinyfish-key": 2, "test-tinyfish-key-2": 2 } });
    await env.DB.prepare("INSERT INTO limits (day, name, count) VALUES ('2026-11-11', 'research:out', 1)").run();
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ researchAccount: "main", spendUsd: 2 });
    expect(await countOf(env.DB, "2026-11-11", "research:out")).toBe(0);
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

describe("never spending by accident", () => {
  it("starts no deep search, and pays for none, when today's runs could not be counted", async () => {
    const w = world({ listStatus: 500 });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    expect(w.startedWith).toEqual([]);
    expect(await countOf(env.DB, "all", "research:paid")).toBe(0);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done", verdict: "not_settled", spendUsd: 0, researchRunId: null });
    expect((await getEvents(env.DB, "t1", 50)).map((e) => e.message)).toContain(
      "Today's deep-search allowance could not be checked, so none was started. This trail comes from following links and searching the web for the sentence.",
    );
  });

  it("keeps the run it started even when the bookkeeping after it fails, so a retry cannot start a second one", async () => {
    const w = world();
    await newTrace();
    await env.DB.prepare("ALTER TABLE spend RENAME TO spend_away").run();
    try {
      await runTrace(env, "t1", fakeStep(), clock);
    } finally {
      await env.DB.prepare("ALTER TABLE spend_away RENAME TO spend").run();
    }
    expect(w.startedWith).toHaveLength(1);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done", researchRunId: "run-1", verdict: "changed_on_the_way" });
  });

  it("stops waiting at once when the run cannot be read at all", async () => {
    world({ runStatus: 403 });
    await newTrace();
    const step = fakeStep();
    await runTrace(env, "t1", step, clock);
    expect(step.names.filter((n) => n.startsWith("wait"))).toHaveLength(1);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done", verdict: "not_settled" });
  });

  it("starts no free run on an account whose wallet cannot be read, and pays for none", async () => {
    const w = world({ wallet: { "test-tinyfish-key": [null], "test-tinyfish-key-2": [null] } });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    expect(w.startedWith).toEqual([]);
    expect(await countOf(env.DB, "2026-11-11", "research:main")).toBe(0);
    expect(await countOf(env.DB, "all", "research:paid")).toBe(0);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done", verdict: "not_settled", spendUsd: 0, researchRunId: null });
    expect((await getEvents(env.DB, "t1", 50)).map((e) => e.message)).toContain(
      "Today's deep-search allowance could not be checked, so none was started. This trail comes from following links and searching the web for the sentence.",
    );
  });

  it("uses the second account when only the main account's wallet cannot be read", async () => {
    const w = world({ wallet: { "test-tinyfish-key": [null], "test-tinyfish-key-2": [35.97] } });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    expect(w.startedWith).toEqual(["test-tinyfish-key-2"]);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ researchAccount: "second", walletBefore: 35.97, spendUsd: 0 });
  });
});

describe("what a free deep search really cost", () => {
  const CHARGED = "This deep search was started as a free one, and the wallet shows it was charged $2. It is paid from the reserve.";

  it("leaves it at $0 when the wallet did not fall by the price of a run", async () => {
    // Twelve cents went on something else while the run was going.
    world({ wallet: { "test-tinyfish-key": [27, 26.88] } });
    await newTrace();
    const step = fakeStep();
    await runTrace(env, "t1", step, clock);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done", spendUsd: 0, walletBefore: 27, walletAfter: 26.88, bookedAt: NOW.toISOString() });
    expect(await totals(env.DB)).toMatchObject({ spendUsd: 0 });
    expect(await countOf(env.DB, "all", "research:charged")).toBe(0);
    expect(await countOf(env.DB, "all", "research:paid")).toBe(0);
    // The wallet is read again only after the trail is done, so no visitor waits for it.
    expect(step.names.slice(-3)).toEqual(["finish", "let the charge land", "book the deep search"]);
  });

  it("books it at the price when the wallet shows it was charged after all, and takes it from the reserve", async () => {
    world({ wallet: { "test-tinyfish-key": [27, 25] } });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done", verdict: "changed_on_the_way", spendUsd: 2, walletBefore: 27, walletAfter: 25 });
    expect(await totals(env.DB)).toMatchObject({ deepSearches: 1, spendUsd: 2 });
    expect(await countOf(env.DB, "all", "research:charged")).toBe(1);
    expect(await countOf(env.DB, "all", "research:paid")).toBe(1);
    expect((await getEvents(env.DB, "t1", 50)).map((e) => e.message)).toContain(CHARGED);
  });

  it("books the price and never more when the wallet fell further: my other projects spend from it too", async () => {
    world({ wallet: { "test-tinyfish-key": [27, 22.4] } });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ spendUsd: 2, walletAfter: 22.4 });
    expect(await totals(env.DB)).toMatchObject({ spendUsd: 2 });
  });

  it("books the price when the wallet cannot be read afterwards, without calling the free runs off", async () => {
    world({ wallet: { "test-tinyfish-key": [27, null] } });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done", spendUsd: 2, walletBefore: 27, walletAfter: null, bookedAt: NOW.toISOString() });
    expect(await totals(env.DB)).toMatchObject({ spendUsd: 2 });
    expect(await countOf(env.DB, "all", "research:paid")).toBe(1);
    expect(await countOf(env.DB, "all", "research:charged")).toBe(0);
  });

  it("books the price when the wallet went up: a wallet that was topped up can no longer say", async () => {
    world({ wallet: { "test-tinyfish-key": [27, 45] } });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ spendUsd: 2, walletAfter: 45 });
    expect(await countOf(env.DB, "all", "research:charged")).toBe(0);
  });

  it("books a run once, however often the step is tried", async () => {
    world({ wallet: { "test-tinyfish-key": [27, 25] } });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    await bookDeep(env, "t1", NOW.toISOString());
    await bookDeep(env, "t1", NOW.toISOString());
    expect(await totals(env.DB)).toMatchObject({ spendUsd: 2 });
    expect(await countOf(env.DB, "all", "research:paid")).toBe(1);
    expect((await getEvents(env.DB, "t1", 50)).filter((e) => e.message === CHARGED)).toHaveLength(1);
  });

  it("counts a charge against the reserve even when the reserve had no room for it", async () => {
    world({ wallet: { "test-tinyfish-key": [27, 25] } });
    await newTrace();
    await runTrace({ ...env, PAID_DEEP_BUDGET_USD: "0" }, "t1", fakeStep(), clock);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ spendUsd: 2 });
    expect(await countOf(env.DB, "all", "research:paid")).toBe(1);

    // A reserve of $6 set afterwards pays for two more runs, not three: $6 in all.
    const six = { ...env, PAID_DEEP_BUDGET_USD: "6" };
    for (const id of ["t2", "t3", "t4"]) {
      await newTrace(id);
      await runTrace(six, id, fakeStep(), clock);
    }
    expect(await getTrace(env.DB, "t2")).toMatchObject({ researchRunId: "run-1", spendUsd: 2 });
    expect(await getTrace(env.DB, "t3")).toMatchObject({ researchRunId: "run-1", spendUsd: 2 });
    expect(await getTrace(env.DB, "t4")).toMatchObject({ researchRunId: null, spendUsd: 0 });
    expect(await totals(env.DB)).toMatchObject({ spendUsd: 6 });
  });

  it("leaves a run paid from the reserve as it was booked when it started", async () => {
    world({ runsToday: { "test-tinyfish-key": 2, "test-tinyfish-key-2": 2 }, wallet: { "test-tinyfish-key": [27, 25] } });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ spendUsd: 2, walletBefore: null, bookedAt: null });
    expect(await totals(env.DB)).toMatchObject({ spendUsd: 2 });
    expect(await countOf(env.DB, "all", "research:paid")).toBe(1);
  });

  it("does not sink a finished trail when the booking breaks", async () => {
    world();
    await newTrace();
    const step = fakeStep();
    const broken: TraceStep = { do: (name, fn) => (name === "book the deep search" ? Promise.reject(new Error("no books")) : step.do(name, fn)), sleep: step.sleep };
    await expect(runTrace(env, "t1", broken, clock)).rejects.toThrow("no books");
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done", verdict: "changed_on_the_way", error: null });
  });
});

describe("fitting the free plan, which allows a Workflow run 50 requests to other hosts", () => {
  /** Runs a trace leg by leg, as the Workflow does, and counts the outside requests each leg made. */
  async function legByLeg(id = "t1") {
    const step = fakeStep();
    const waiting: Leg[] = [{ part: "start" }];
    const legs: { part: string; calls: number }[] = [];
    const relay: LegStep = { do: step.do, sleep: step.sleep, handOver: async (leg) => void waiting.push(leg) };
    for (let leg = waiting.shift(); leg; leg = waiting.shift()) {
      const before = fetchMock.calls.length;
      const named = step.names.length;
      await runLeg(env, id, leg, relay, clock);
      legs.push({ part: leg.part, calls: fetchMock.calls.length - before });
      // A Workflow remembers a finished step by its name, so no two steps of a run may share one.
      const names = step.names.slice(named);
      expect(new Set(names).size).toBe(names.length);
    }
    return legs;
  }

  it("keeps the first leg to 45 too, at its worst: every link followed on its second try, ten undated pages from Search", async () => {
    // Each page on the way links to five pages that say nothing, then to the next page that holds the sentence.
    const hop = (n: number) => `https://hop${n}.example/page`;
    const duds = (n: number) => Array.from({ length: 5 }, (_, i) => `https://dud${n}-${i}.example/page`);
    const listed = Array.from({ length: 10 }, (_, i) => `https://listed${i}.example/page`);
    const pages: Record<string, Page> = { [START]: { ...PAGES[START]!, links: [...duds(0), hop(1)] } };
    for (let n = 1; n <= 5; n++) pages[hop(n)] = { published_date: `201${9 - n}-01-01`, text: `${HIGHLIGHT}.`, links: n < 5 ? [...duds(n), hop(n + 1)] : [] };
    // Ten pages that hold the sentence and give no date: each read asks the Internet Archive twice, and nothing can be kept.
    for (const url of listed) pages[url] = { text: `${HIGHLIGHT}.`, links: [] };
    world({ pages, search: listed.map((url) => ({ url })) });
    await newTrace();

    const [first] = await legByLeg();

    // 1 page, 10 tries at links, 1 question to Search, 2 reads of what it listed, 4 questions to the archive,
    // and 3 to start the deep search (today's runs, the wallet, the start).
    expect(first).toEqual({ part: "start", calls: 21 });
    expect((await getSteps(env.DB, "t1")).filter((s) => s.url?.startsWith("https://hop")).length).toBe(5);
  });

  it("keeps every leg to 45 outside requests, however slow the search and however hard its steps", async () => {
    // Twelve proposed steps on pages that cannot be read. Each one costs a read, a saved copy
    // looked up and read, a read of the two pages before it for a quote, and a date from the archive.
    const hard = Array.from({ length: 12 }, (_, i) => ({
      url: `https://gone.example/page-${i}`,
      publisher: `Gone ${i}`,
      date: "unknown",
      wording: `Page ${i} once said that people spend most of their time indoors.`,
      names_source: "none",
      linked: false,
    }));
    world({
      // The search is read 100 times before it is done: 25 minutes.
      runStates: [...Array.from({ length: 100 }, () => ({ status: "RUNNING", evidence: [] })), { status: "COMPLETED", evidence: [], deep_result: { result: report(trail({ steps: hard })) } }],
      archive: Object.fromEntries(hard.map((s) => [s.url, { copy: `http://web.archive.org/web/20100101000000/${s.url}`, timestamp: "20100101000000" }])),
    });
    await newTrace();

    const legs = await legByLeg();

    expect(legs.map((l) => l.part)).toEqual(["start", "wait", "wait", "wait", "check", "check", "book"]);
    expect(Math.max(...legs.map((l) => l.calls))).toBeLessThanOrEqual(45);
    // All the work was still done: 4 or 5 requests for each of the twelve steps.
    expect(legs.filter((l) => l.part === "check").reduce((n, l) => n + l.calls, 0)).toBe(59);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done", researchRunId: "run-1" });
    const gone = (await getSteps(env.DB, "t1")).filter((s) => s.url?.startsWith("https://gone.example/"));
    expect(gone).toHaveLength(12);
    expect(gone.every((s) => s.reading === "unreadable")).toBe(true);
  });

  it("takes a trail built from a finished run through the same legs", async () => {
    world({ runStates: [{ status: "COMPLETED", evidence: [], deep_result: { result: report(trail()) } }] });
    await newTrace();
    await env.DB.prepare("UPDATE traces SET research_run_id = 'run-1', research_account = 'main', research_started_at = created_at WHERE id = 't1'").run();
    const legs = await legByLeg();
    expect(legs.map((l) => l.part)).toEqual(["start", "wait", "check", "book"]);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done", verdict: "changed_on_the_way", spendUsd: 0, bookedAt: null });
  });

  it("ends in one leg when there is no deep search to wait for", async () => {
    world({ runsToday: { "test-tinyfish-key": 2, "test-tinyfish-key-2": 2 } });
    await env.DB.prepare("INSERT INTO limits (day, name, count) VALUES ('all', 'research:paid', 1)").run();
    await newTrace();
    expect((await legByLeg()).map((l) => l.part)).toEqual(["start"]);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done", verdict: "not_settled" });
  });

  it("marks the trace failed when the rest cannot be handed over, so it does not show as working for ever", async () => {
    world();
    await newTrace();
    const step = fakeStep();
    const relay: LegStep = { do: step.do, sleep: step.sleep, handOver: () => Promise.reject(new Error("no room")) };
    await expect(runLeg(env, "t1", { part: "start" }, relay, clock)).rejects.toThrow("no room");
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "failed", error: "no room" });
  });

  it("still books the deep search when the trace breaks after the search started", async () => {
    world({ wallet: { "test-tinyfish-key": [27, 25] } });
    await newTrace();
    const step = fakeStep();
    const broken: TraceStep = { do: (name, fn) => (name === "finish" ? Promise.reject(new Error("boom")) : step.do(name, fn)), sleep: step.sleep };
    await expect(runTrace(env, "t1", broken, clock)).rejects.toThrow("boom");
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "failed", spendUsd: 2, walletBefore: 27, walletAfter: 25 });
    expect(await countOf(env.DB, "all", "research:charged")).toBe(1);
  });
});

describe("once a free run has been charged", () => {
  const charged = () => env.DB.prepare("INSERT INTO limits (day, name, count) VALUES ('all', 'research:charged', 1)").run();

  it("calls no run free again: the next deep search is paid from the reserve", async () => {
    const w = world();
    await charged();
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    expect(w.startedWith).toEqual(["test-tinyfish-key"]);
    expect(await countOf(env.DB, "2026-11-11", "research:main")).toBe(0);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ spendUsd: 2, walletBefore: null });
    expect((await getEvents(env.DB, "t1", 50)).map((e) => e.message)).toContain("Started the deep search. This one is paid for from the reserve ($2).");
  });

  it("starts none when the reserve is used as well, says what a deep search costs, and promises none for midnight", async () => {
    const w = world();
    await charged();
    await env.DB.prepare("INSERT INTO limits (day, name, count) VALUES ('all', 'research:paid', 1)").run();
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    expect(w.startedWith).toEqual([]);
    const trace = await getTrace(env.DB, "t1");
    expect(trace).toMatchObject({ status: "done", verdict: "not_settled", researchRunId: null, spendUsd: 0 });
    expect(trace?.summary).toBe(
      "The deep search did not run, so this trail shows only what following the page's links and searching the web for the sentence found. The money set aside for deep searches is used up.",
    );
    const said = (await getEvents(env.DB, "t1", 50)).map((e) => e.message);
    expect(said).toContain(
      "No deep search was started: each one costs $2 at TinyFish, and the money set aside for them is used up. This trail comes from following links and searching the web for the sentence.",
    );
    expect(said.join(" ")).not.toMatch(/midnight|switched off|should have been free/);
  });

  it("does not say the money is used up when a paid run could not be started and the reserve still has room", async () => {
    world({ startStatus: 503 });
    await charged();
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    expect(await paidRunsLeft(env)).toBe(1);
    const trace = await getTrace(env.DB, "t1");
    expect(trace).toMatchObject({ status: "done", researchRunId: null, spendUsd: 0 });
    expect(trace?.summary).toBe(
      "The deep search did not run, so this trail shows only what following the page's links and searching the web for the sentence found. Trace the sentence again on a later day for the full trail.",
    );
  });

  it("with a reserve of eight dollars and the charged run counted in it, pays for three more and no fourth", async () => {
    const w = world();
    const eight = { ...env, PAID_DEEP_BUDGET_USD: "8" };
    await charged();
    await env.DB.prepare("INSERT INTO limits (day, name, count) VALUES ('all', 'research:paid', 1)").run();
    expect(await paidRunsLeft(eight)).toBe(3);

    await newTrace();
    await runTrace(eight, "t1", fakeStep(), clock);
    expect(w.startedWith).toEqual(["test-tinyfish-key"]);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ spendUsd: 2, walletBefore: null });
    expect((await getEvents(env.DB, "t1", 50)).map((e) => e.message)).toContain("Started the deep search. This one is paid for from the reserve ($2).");
    expect(await paidRunsLeft(eight)).toBe(2);

    await env.DB.prepare("UPDATE limits SET count = 4 WHERE day = 'all' AND name = 'research:paid'").run();
    expect(await paidRunsLeft(eight)).toBe(0);
    expect(await paidRunsLeft({ ...env, PAID_DEEP_BUDGET_USD: "0" })).toBe(0);
  });
});

describe("one bad page", () => {
  it("does not sink the trail: the step is kept as unreadable and the rest carries on", async () => {
    world();
    await newTrace();
    const step = fakeStep();
    const flaky: TraceStep = { do: (name, fn) => (name === "check 3" ? Promise.reject(new Error("exceeded CPU")) : step.do(name, fn)), sleep: step.sleep };
    await runTrace(env, "t1", flaky, clock);
    const trace = await getTrace(env.DB, "t1");
    expect(trace).toMatchObject({ status: "done", verdict: "changed_on_the_way" });
    expect((await getSteps(env.DB, "t1"))[2]).toMatchObject({ url: STUDY, reading: "unreadable", wording: null });
    expect((await getEvents(env.DB, "t1", 50)).map((e) => e.message)).toContain("Checked journal.example: the page could not be processed.");
  });

  it("does not sink the trail when a link cannot be followed", async () => {
    world();
    await newTrace();
    const step = fakeStep();
    const flaky: TraceStep = { do: (name, fn) => (name.startsWith("follow") ? Promise.reject(new Error("exceeded CPU")) : step.do(name, fn)), sleep: step.sleep };
    await runTrace(env, "t1", flaky, clock);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done", verdict: "changed_on_the_way" });
    expect((await getSteps(env.DB, "t1")).map((s) => s.url)).toEqual([START, AGENCY, STUDY]);
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

describe("crediting a source to the page that quotes it", () => {
  const withLast = (last: Record<string, unknown>, extra: Partial<World> = {}) =>
    world({ runStates: [{ status: "COMPLETED", evidence: [], deep_result: { result: report(trail({ steps: [...trail().steps.slice(0, 2), last], origin: { found: false, url: "", kind: "other", note: "" } })) } }], ...extra });
  const AGENCY_LINE = "On average, people spend approximately 90 percent of their time indoors, the agency says.";

  it("does not do it for a page that was read and simply does not hold the wording", async () => {
    withLast({ url: STUDY, publisher: "Journal of Examples", date: "2001", wording: AGENCY_LINE, names_source: "none", linked: false });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    expect((await getSteps(env.DB, "t1"))[2]).toMatchObject({ url: STUDY, reading: "not_found", wording: null, quotedBy: null });
  });

  it("does it for a bare site address, looking two pages back", async () => {
    const paper = "https://courier.example/";
    withLast(
      { url: `${paper} [Daily Courier, 11 October 1981]`, publisher: "Daily Courier", date: "1981-10-11", wording: "People spend nearly 90 percent of their time indoors, yet indoor air is studied less.", names_source: "none", linked: false },
      { pages: { ...PAGES, [paper]: { text: "Today's front page.", links: [] } } },
    );
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    const last = (await getSteps(env.DB, "t1"))[2];
    expect(last).toMatchObject({ url: paper, reading: "offline", quotedBy: "news.example", date: "1981-10-11" });
  });

  it("keeps nothing of the front page that stood at the address", async () => {
    const paper = "https://courier.example/";
    withLast(
      { url: paper, publisher: "Daily Courier", date: "1981-10-11", wording: "People spend nearly 90 percent of their time indoors, yet indoor air is studied less.", names_source: "none", linked: false },
      { pages: { ...PAGES, [paper]: { title: "News, Sport, Business | Daily Courier", text: "Today's front page.", links: ["https://courier.example/sport"] } } },
    );
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    expect((await getSteps(env.DB, "t1"))[2]).toMatchObject({ reading: "offline", quotedBy: "news.example", title: null, links: [] });
  });

  it("says so when the page the deep search named is itself a saved copy", async () => {
    const copy = "https://web.archive.org/web/20120601120000/http://vendor.example/what-is-big-data.html";
    withLast(
      { url: copy, publisher: "The Vendor", date: "2011-05", wording: "People spend nearly 90 percent of their time indoors.", names_source: "none", linked: false },
      { pages: { ...PAGES, [copy]: { title: "What is big data?", text: "People spend nearly 90 percent of their time indoors. That is a lot.", links: [] } } },
    );
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    const last = (await getSteps(env.DB, "t1")).find((s) => s.url === copy);
    expect(last).toMatchObject({ reading: "exact", readFrom: "archive", archiveUrl: copy, date: "2011-05", dateSource: "research" });
    expect((await getEvents(env.DB, "t1", 50)).map((e) => e.message)).toContain("Checked web.archive.org: found word for word in a saved copy.");
  });

  it("does not do it on a loose match", async () => {
    withLast({ url: "print only", publisher: "A 1960 handbook", date: "1960", wording: "People spend approximately 90 percent of time indoors on average, says the agency.", names_source: "none", linked: false });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    expect((await getSteps(env.DB, "t1"))[2]).toMatchObject({ url: null, reading: "offline", wording: null, quotedBy: null });
  });
});

describe("the summary", () => {
  it("keeps the first two sentences of what the deep search wrote", async () => {
    const summary = "It comes from a 2001 survey. The figure was rounded up. A third sentence goes on at length. And a fourth.";
    world({ runStates: [{ status: "COMPLETED", evidence: [], deep_result: { result: report(trail({ summary })) } }] });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    expect((await getTrace(env.DB, "t1"))?.summary).toBe("It comes from a 2001 survey. The figure was rounded up.");
  });
});

describe("a long summary", () => {
  const run = async (summary: string) => {
    world({ runStates: [{ status: "COMPLETED", evidence: [], deep_result: { result: report(trail({ summary })) } }] });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    return (await getTrace(env.DB, "t1"))?.summary ?? "";
  };

  it("keeps only whole sentences that fit", async () => {
    const first = "The figure comes from a survey " + "of daily life ".repeat(20) + "published in 2001.";
    const second = "It was then rounded " + "again and again ".repeat(12) + "on the way.";
    expect(first.length + second.length).toBeGreaterThan(420);
    expect(await run(first + " " + second)).toBe(first);
  });

  it("cuts a single over-long sentence at a word and says so with an ellipsis", async () => {
    const summary = await run("The figure " + "comes from a survey of daily life and ".repeat(20) + "more.");
    expect(summary.length).toBeLessThanOrEqual(421);
    expect(summary.endsWith("…")).toBe(true);
    expect(summary).not.toMatch(/\s…$/);
  });
});

describe("a quotation", () => {
  it("gets no notes about figures or years: its trail is about who said it", async () => {
    world({ runStates: [{ status: "COMPLETED", evidence: [], deep_result: { result: report(trail({ verdict: "said_by_someone_else" })) } }] });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ verdict: "said_by_someone_else" });
    expect((await getChanges(env.DB, "t1")).filter((c) => c.basis === "code")).toEqual([]);
  });
});

describe("searching the web for the sentence, when the links run out", () => {
  const LEAFLET = "https://archive.example/1999-leaflet";
  const said = (date: string | undefined, line = `${HIGHLIGHT}, the leaflet said.`): Page => ({ title: "A leaflet", published_date: date, text: `Notes follow. ${line} More notes.`, links: [] });

  /** A day on which no deep search is to be had: the trail is what the links and Search find. */
  async function withoutDeep(over: Partial<World> = {}): Promise<World> {
    const w = world({ runsToday: { "test-tinyfish-key": 2, "test-tinyfish-key-2": 2 }, ...over });
    await env.DB.prepare("INSERT INTO limits (day, name, count) VALUES ('all', 'research:paid', 1)").run();
    await newTrace();
    return w;
  }
  const trailOf = async () => (await getSteps(env.DB, "t1")).map((s) => [s.url, s.reading, s.reachedBy, s.date, s.dateSource]);
  const log = async () => (await getEvents(env.DB, "t1", 50)).map((e) => e.message);

  it("asks Search for the sentence, for pages older than the earliest step so far", async () => {
    const w = await withoutDeep();
    await runTrace(env, "t1", fakeStep(), clock);
    expect(w.searched).toHaveLength(1);
    expect(w.searched[0]?.searchParams.get("query")).toBe(HIGHLIGHT);
    expect(w.searched[0]?.searchParams.get("before_date")).toBe("2017-11-02");
    expect(await log()).toContain("Searched the web for the sentence: nothing new was listed.");
  });

  it("sets no date limit when no step so far has a date", async () => {
    const w = await withoutDeep({ pages: { [START]: { ...PAGES[START]!, published_date: undefined }, [AGENCY]: { ...PAGES[AGENCY]!, published_date: undefined } } });
    await runTrace(env, "t1", fakeStep(), clock);
    expect(w.searched[0]?.searchParams.has("before_date")).toBe(false);
  });

  it("adds an older page that holds the sentence, as a step found by search", async () => {
    await withoutDeep({ search: [{ url: LEAFLET }], pages: { ...PAGES, [LEAFLET]: said("1999-03-01") } });
    await runTrace(env, "t1", fakeStep(), clock);
    expect(await trailOf()).toEqual([
      [START, "exact", "start", "2025-12-15", "page"],
      [AGENCY, "close", "link", "2017-11-02", "page"],
      [LEAFLET, "exact", "search", "1999-03-01", "page"],
    ]);
    expect((await getSteps(env.DB, "t1"))[2]?.wording).toBe(`${HIGHLIGHT}, the leaflet said.`);
    const events = await log();
    expect(events).toContain("Searched the web for the sentence: 1 page listed.");
    expect(events).toContain("The search led to archive.example: found word for word.");
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done", verdict: "not_settled", reached: "earliest_copy", spendUsd: 0 });
  });

  it("keeps nothing that is not older than the trail", async () => {
    await withoutDeep({ search: [{ url: LEAFLET }], pages: { ...PAGES, [LEAFLET]: said("2020-05-05") } });
    await runTrace(env, "t1", fakeStep(), clock);
    expect((await trailOf()).map((s) => s[0])).toEqual([START, AGENCY]);
    expect(await log()).toContain("None of the pages the search listed is an older page that holds the sentence.");
  });

  it("keeps nothing that says it with another figure", async () => {
    await withoutDeep({ search: [{ url: LEAFLET }], pages: { ...PAGES, [LEAFLET]: said("1999-03-01", "People spend nearly 80 percent of their time indoors.") } });
    await runTrace(env, "t1", fakeStep(), clock);
    expect((await trailOf()).map((s) => s[0])).toEqual([START, AGENCY]);
  });

  it("dates a page that gives no date by the Internet Archive's first saved copy", async () => {
    await withoutDeep({ search: [{ url: LEAFLET }], pages: { ...PAGES, [LEAFLET]: said(undefined) }, firstSeen: { [LEAFLET]: "2003-06-07" } });
    await runTrace(env, "t1", fakeStep(), clock);
    expect((await trailOf())[2]).toEqual([LEAFLET, "exact", "search", "2003-06-07", "archive"]);
  });

  it("keeps nothing that cannot be dated: such a page cannot be shown to be older", async () => {
    await withoutDeep({ search: [{ url: LEAFLET }], pages: { ...PAGES, [LEAFLET]: said(undefined) } });
    await runTrace(env, "t1", fakeStep(), clock);
    expect((await trailOf()).map((s) => s[0])).toEqual([START, AGENCY]);
  });

  describe("with seven pages listed", () => {
    const at = (n: number) => `https://old.example/page-${n}`;
    const years = [2010, 2001, 2005, 1995, 1990, 2012, 2014];
    // The index gives its dates in several forms; for the fifth and sixth pages it gives none that can be used.
    const search = [{ url: at(0), date: "2010-01-01T00:00:00Z" }, { url: at(1), date: "Mar 5, 2001" }, { url: at(2), date: "2005-02-02" }, { url: at(3), date: "1995-05-05T10:00:00Z" }, { url: at(4), date: "30 years ago" }, { url: at(5) }, { url: at(6), date: "2014-07-07" }];
    const pagesWhere = (holds: (n: number) => boolean) => ({
      ...PAGES,
      ...Object.fromEntries(years.map((y, n) => [at(n), holds(n) ? said(`${y}-06-01`) : said(`${y}-06-01`, "Nothing about it here.")])),
    });
    const reads = (w: World) => w.fetched.filter((batch) => batch.some((u) => u.startsWith("https://old.example/")));

    it("reads the pages the index dates oldest first, five to a read, then the rest", async () => {
      const w = await withoutDeep({ search, pages: pagesWhere((n) => [0, 1, 4, 5].includes(n)) });
      await runTrace(env, "t1", fakeStep(), clock);
      expect(reads(w)).toEqual([[at(3), at(1), at(2), at(0), at(6)], [at(4), at(5)]]);
      // Two were kept from the first read, so the second had room for one: the older of its two.
      expect((await trailOf()).slice(2).map((s) => s[0])).toEqual([at(0), at(1), at(4)]);
    });

    it("keeps three at most, the oldest, and reads no further once it has them", async () => {
      const w = await withoutDeep({ search, pages: pagesWhere(() => true) });
      await runTrace(env, "t1", fakeStep(), clock);
      expect(reads(w)).toEqual([[at(3), at(1), at(2), at(0), at(6)]]);
      expect((await trailOf()).slice(2).map((s) => s[0])).toEqual([at(2), at(1), at(3)]);
    });
  });

  it("reads no page that is already in the trail, no social page and not the highlighted page itself", async () => {
    const w = await withoutDeep({ search: [{ url: `${AGENCY}/` }, { url: START }, { url: "https://www.facebook.com/someone/posts/1" }, { url: LEAFLET }], pages: { ...PAGES, [LEAFLET]: said("1999-03-01") } });
    await runTrace(env, "t1", fakeStep(), clock);
    expect(w.fetched[w.fetched.length - 1]).toEqual([LEAFLET]);
  });

  it("goes on without it when Search cannot be asked, and says so", async () => {
    await withoutDeep({ searchStatus: 503, search: [{ url: LEAFLET }], pages: { ...PAGES, [LEAFLET]: said("1999-03-01") } });
    await runTrace(env, "t1", fakeStep(), clock);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done", verdict: "not_settled" });
    expect((await trailOf()).map((s) => s[0])).toEqual([START, AGENCY]);
    expect(await log()).toContain("The web search could not be asked (SERVICE_BUSY), so the trace goes on without it.");
    expect(await wasSearched(env.DB, "t1")).toBe(false);
  });

  it("goes on without it when a read of what Search listed breaks", async () => {
    await withoutDeep({ search: [{ url: LEAFLET }], pages: { ...PAGES, [LEAFLET]: said("1999-03-01") } });
    const step = fakeStep();
    const real = step.do;
    step.do = (name, fn) => (name.startsWith("read what the search listed") ? Promise.reject(new Error("too heavy")) : real(name, fn));
    await runTrace(env, "t1", step, clock);
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done" });
    expect((await trailOf()).map((s) => s[0])).toEqual([START, AGENCY]);
  });

  it("notes once in the ledger that Search was used, at no cost", async () => {
    await withoutDeep();
    await runTrace(env, "t1", fakeStep(), clock);
    await askSearch(env, "t1", NOW.toISOString());
    const rows = (await env.DB.prepare("SELECT kind, amount_usd, ref FROM spend").all<{ kind: string; amount_usd: number; ref: string }>()).results;
    expect(rows).toEqual([{ kind: "search", amount_usd: 0, ref: "t1" }]);
    expect(await wasSearched(env.DB, "t1")).toBe(true);
    expect((await totals(env.DB)).spendUsd).toBe(0);
  });

  it("adds no page twice when a read is tried again", async () => {
    await withoutDeep({ search: [{ url: LEAFLET }], pages: { ...PAGES, [LEAFLET]: said("1999-03-01") } });
    await runTrace(env, "t1", fakeStep(), clock);
    await readListed(env, "t1", [LEAFLET], NOW.toISOString());
    expect((await trailOf()).filter((s) => s[0] === LEAFLET)).toHaveLength(1);
  });

  it("says in the summary that the trail comes from links and a search", async () => {
    await withoutDeep();
    await runTrace(env, "t1", fakeStep(), clock);
    expect((await getTrace(env.DB, "t1"))?.summary).toBe(
      "The deep search did not run, so this trail shows only what following the page's links and searching the web for the sentence found. The day's deep searches return at midnight UTC: trace the sentence again after that for the full trail.",
    );
  });

  describe("carrying on from what Search found", () => {
    const on = (n: number) => `https://further${n}.example/report`;
    const duds = (n: number) => Array.from({ length: 5 }, (_, i) => `https://nothing${n}-${i}.example/page`);
    /** The leaflet links to a page that holds the sentence, which links to another, and so on: each a year older. */
    const chain = (length: number, between: (n: number) => string[] = () => []): Record<string, Page> => {
      const pages: Record<string, Page> = { ...PAGES, [LEAFLET]: { ...said("1999-03-01"), links: [...between(0), on(1)] } };
      for (let n = 1; n <= length; n++) pages[on(n)] = { published_date: `${1999 - n}-03-01`, text: `${HIGHLIGHT}, as report ${n} put it.`, links: n < length ? [...between(n), on(n + 1)] : [] };
      return pages;
    };

    it("follows the links of the oldest page Search found, as it follows any page's links", async () => {
      await withoutDeep({ search: [{ url: LEAFLET }], pages: chain(1) });
      await runTrace(env, "t1", fakeStep(), clock);
      expect(await trailOf()).toEqual([
        [START, "exact", "start", "2025-12-15", "page"],
        [AGENCY, "close", "link", "2017-11-02", "page"],
        [LEAFLET, "exact", "search", "1999-03-01", "page"],
        // The leaflet links to it, so this step is joined to the trail by a link, not by the search.
        [on(1), "exact", "link", "1998-03-01", "page"],
      ]);
      expect(await log()).toContain("Followed a link to further1.example.");
    });

    it("goes two links on from it and no further", async () => {
      await withoutDeep({ search: [{ url: LEAFLET }], pages: chain(4) });
      await runTrace(env, "t1", fakeStep(), clock);
      expect((await trailOf()).map((s) => s[0])).toEqual([START, AGENCY, LEAFLET, on(1), on(2)]);
    });

    it("starts from the oldest of the pages Search found", async () => {
      const newer = "https://newer.example/2005-article";
      const pages = { ...chain(1), [newer]: { ...said("2005-05-05"), links: ["https://elsewhere.example/page"] } };
      const w = await withoutDeep({ search: [{ url: newer, date: "2005-05-05" }, { url: LEAFLET, date: "1999-03-01" }], pages });
      await runTrace(env, "t1", fakeStep(), clock);
      expect(w.fetched[w.fetched.length - 1]).toEqual([on(1)]);
      expect(w.fetched.flat()).not.toContain("https://elsewhere.example/page");
    });

    it("does not follow on when Search found nothing to keep", async () => {
      await withoutDeep({ search: [{ url: LEAFLET }], pages: { ...PAGES, [LEAFLET]: { ...said("2020-05-05"), links: [on(1)] } } });
      const step = fakeStep();
      await runTrace(env, "t1", step, clock);
      expect(step.names.some((n) => n.startsWith("follow on") || n.startsWith("take up the trail"))).toBe(false);
    });

    it("leaves the trail as it is when the follow-on breaks", async () => {
      await withoutDeep({ search: [{ url: LEAFLET }], pages: chain(2) });
      const step = fakeStep();
      const real = step.do;
      step.do = (name, fn) => (name.startsWith("follow on") || name.startsWith("take up the trail") ? Promise.reject(new Error("too heavy")) : real(name, fn));
      await runTrace(env, "t1", step, clock);
      expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done" });
      expect((await trailOf()).map((s) => s[0])).toEqual([START, AGENCY, LEAFLET]);
    });

    it("fits the first leg's requests and gives every step its own name, with every follow-on link found on its second try", async () => {
      const w = world({ search: [{ url: LEAFLET }], pages: chain(2, duds) });
      await newTrace();
      const step = fakeStep();
      const waiting: Leg[] = [];
      const relay: LegStep = { do: step.do, sleep: step.sleep, handOver: async (leg) => void waiting.push(leg) };
      await runLeg(env, "t1", { part: "start" }, relay, clock);
      // The page, 2 tries at its links, 1 question to Search, 1 read, 4 tries at the leaflet's links, 3 to start the deep search.
      expect(fetchMock.calls.length).toBe(12);
      expect(new Set(step.names).size).toBe(step.names.length);
      expect(step.names.filter((n) => n.startsWith("follow on"))).toEqual(["follow on 1.1", "follow on 1.2", "follow on 2.1", "follow on 2.2"]);
      expect(w.startedWith).toHaveLength(1);
    });
  });

  it("hands what Search found to the deep search, to check and go further back", async () => {
    world({ search: [{ url: LEAFLET }], pages: { ...PAGES, [LEAFLET]: said("1999-03-01") } });
    await newTrace();
    await runTrace(env, "t1", fakeStep(), clock);
    const start = fetchMock.calls.find((c) => c.url.endsWith("/run-research-async"));
    expect((start?.body as { query: string }).query).toContain(`${LEAFLET}: "${HIGHLIGHT}, the leaflet said."`);
    // The deep search's own verdict stands, and the page Search found is part of the finished trail.
    expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done", verdict: "changed_on_the_way", reached: "original" });
    expect((await trailOf()).map((s) => [s[0], s[2]])).toEqual([[START, "start"], [AGENCY, "link"], [STUDY, "link"], [LEAFLET, "search"]]);
    // The leaflet is older than the study, but the verdict still rests on the study the report named: 87 percent became 90.
    expect(await getChanges(env.DB, "t1")).toContainEqual({ fromPosition: 2, toPosition: 0, kind: "rounded", detail: "87 percent became 90 percent", basis: "code" });
  });

  describe("beside a deep search", () => {
    it("is never marked as named by the step above it, and does not stand between a step and the source it names", async () => {
      // The agency names the 2001 survey without linking to it. Search finds a leaflet dated between the two.
      world({ search: [{ url: LEAFLET }], pages: { ...PAGES, [AGENCY]: { ...PAGES[AGENCY]!, links: [] }, [LEAFLET]: said("2010-03-01") } });
      await newTrace();
      await runTrace(env, "t1", fakeStep(), clock);
      expect((await trailOf()).map((s) => [s[0], s[2], s[3]])).toEqual([
        [START, "start", "2025-12-15"],
        [AGENCY, "link", "2017-11-02"],
        [LEAFLET, "search", "2010-03-01"],
        [STUDY, "named", "2001-07-26"],
      ]);
    });

    it("does not change the verdict: a report that found the original and says it matches is not overruled by an older page from Search", async () => {
      const SURVEY = "https://survey.example/2001-results";
      const HEDGED = "https://older.example/1995-notes";
      const line = "People spend nearly 90 percent of their time indoors, the survey found.";
      const matching = trail({
        steps: [
          { url: START, publisher: "Example News", date: "2025-12-15", wording: "People spend nearly 90 percent of their time indoors, yet indoor air is studied less.", names_source: "none", linked: false },
          { url: SURVEY, publisher: "The Survey", date: "2001-07-26", wording: line, names_source: "none", linked: true },
        ],
        origin: { found: true, url: SURVEY, kind: "study", note: "The survey itself." },
        changes: [],
        verdict: "matches_original",
        summary: "The survey says the same. Nothing changed on the way.",
      });
      world({
        pages: {
          [START]: { ...PAGES[START]!, links: [SURVEY] },
          [SURVEY]: { title: "Results", published_date: "2001-07-26", text: `Results follow. ${line} Tables below.`, links: [] },
          // Older, and hedged: "may" is a careful word the highlight does not have.
          [HEDGED]: { title: "Notes", published_date: "1995-04-04", text: "Some studies suggest people may spend nearly 90 percent of their time indoors. Other notes follow.", links: [] },
        },
        search: [{ url: HEDGED }],
        runStates: [{ status: "COMPLETED", evidence: [{ url: SURVEY }], deep_result: { result: report(matching) } }],
      });
      await newTrace();
      await runTrace(env, "t1", fakeStep(), clock);
      expect((await trailOf()).map((s) => [s[0], s[2]])).toEqual([[START, "start"], [SURVEY, "link"], [HEDGED, "search"]]);
      expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done", verdict: "matches_original", reached: "original" });
      // With a report, a page only Search found is shown and not compared: no note is hung on it or drawn from it.
      expect(await getChanges(env.DB, "t1")).toEqual([]);
    });

    it("still counts as the origin when the report gives no address for one and its own last step is confirmed", async () => {
      const SURVEY = "https://survey.example/2001-results";
      const line = "People spend nearly 90 percent of their time indoors, the survey found.";
      const noAddress = trail({
        steps: [
          { url: START, publisher: "Example News", date: "2025-12-15", wording: "People spend nearly 90 percent of their time indoors, yet indoor air is studied less.", names_source: "none", linked: false },
          { url: SURVEY, publisher: "The Survey", date: "2001-07-26", wording: "A sentence the page does not hold.", names_source: "none", linked: true },
        ],
        origin: { found: true, url: null, kind: "study", note: "" },
        changes: [],
        verdict: "matches_original",
        summary: "The survey says the same. Nothing changed on the way.",
      });
      world({
        pages: {
          [START]: { ...PAGES[START]!, links: [] },
          [SURVEY]: { title: "Results", published_date: "2001-07-26", text: "Results follow. Nothing about time indoors here. Tables below.", links: [] },
          [LEAFLET]: said("1999-03-01"),
        },
        search: [{ url: LEAFLET }],
        runStates: [{ status: "COMPLETED", evidence: [], deep_result: { result: report(noAddress) } }],
      });
      await newTrace();
      await runTrace(env, "t1", fakeStep(), clock);
      // The report's own last step was not confirmed, so the report's word that an original exists does not count:
      // the older leaflet, which Search found and which is confirmed, must not stand in for it.
      expect(await getTrace(env.DB, "t1")).toMatchObject({ status: "done", reached: "earliest_copy" });
    });
  });
});
