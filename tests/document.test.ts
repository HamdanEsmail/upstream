import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { changeWords, quoted, reachedWords, readingWords, verdictWords } from "../src/site/words";
import { buildDocument } from "../src/trace/document";
import { addEvent, insertTrace, saveChanges, saveSteps, updateTrace, type StoredStep } from "../src/trace/store";

const NOW = "2026-11-11T06:30:00.000Z";
const START = "https://news.example/science/indoor-air";
const STUDY = "https://journal.example/study-2001";

const step = (over: Partial<StoredStep>): StoredStep => ({
  url: START,
  publisher: "news.example",
  title: null,
  date: null,
  dateSource: null,
  wording: null,
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

beforeEach(async () => {
  for (const table of ["traces", "steps", "changes", "events"]) await env.DB.prepare(`DELETE FROM ${table}`).run();
  await insertTrace(env.DB, { id: "t1", pageUrl: START, text: "People spend 90 percent of their time indoors", textKey: "k1", near: [], now: NOW });
});

describe("words", () => {
  it("names each verdict plainly", () => {
    expect(verdictWords("no_original_source")).toBe("No original source");
    expect(verdictWords("said_by_someone_else")).toBe("Said by someone else");
    expect(verdictWords("changed_on_the_way")).toBe("Changed on the way");
    expect(verdictWords("out_of_date")).toBe("Out of date");
    expect(verdictWords("matches_original")).toBe("Matches the original");
    expect(verdictWords("not_settled")).toBe("Not settled");
    expect(verdictWords(null)).toBe("Not settled");
  });

  it("says how a step was read and reached", () => {
    expect(readingWords("exact", "live", null)).toBe("Found word for word.");
    expect(readingWords("close", "archive", null)).toBe("Found in slightly different words, in a saved copy.");
    expect(readingWords("not_found", "live", null)).toBe("The wording was not found on this page.");
    expect(readingWords("unreadable", null, null)).toBe("This page could not be read.");
    expect(readingWords("offline", null, "agency.example")).toBe("Not readable online. Quoted by agency.example.");
    expect(readingWords("offline", null, null)).toBe("Not readable online.");
    expect(reachedWords("link")).toBe("Linked from a page above.");
    expect(reachedWords("named")).toBe("Named by the page above, without a link.");
    expect(reachedWords("search")).toBe("Found by search, not by a link.");
    expect(reachedWords("start")).toBe("The page you read.");
  });

  it("puts quotation marks round a sentence unless it already opens with one", () => {
    expect(quoted("People spend 90 percent of their time indoors.")).toBe("“People spend 90 percent of their time indoors.”");
    expect(quoted("“Insanity is doing the same thing.” — A physicist")).toBe("“Insanity is doing the same thing.” — A physicist");
    expect(quoted('  "Already quoted" ')).toBe('"Already quoted"');
  });

  it("puts a change in a few plain words", () => {
    expect(changeWords("rounded", "87% became 90 percent")).toBe("rounded: 87% became 90 percent");
    expect(changeWords("number_changed", "12 became 8")).toBe("the figure changed: 12 became 8");
    expect(changeWords("careful_word_dropped", 'dropped "about"')).toBe('careful words dropped: "about"');
    expect(changeWords("year_dropped", "the year 2013 is gone")).toBe("the year 2013 is gone");
    expect(changeWords("noted", "The group changed.")).toBe("The group changed.");
  });
});

describe("buildDocument", () => {
  it("is null for a trace that does not exist", async () => {
    expect(await buildDocument(env, "missing")).toBeNull();
  });

  it("shows a running trace with its progress and no verdict yet", async () => {
    await saveSteps(env.DB, "t1", [step({ reachedBy: "start", wording: "People spend 90 percent of their time indoors." })]);
    await updateTrace(env.DB, "t1", { status: "searching", pagesRead: 12, latestHosts: ["agency.example"], researchStartedAt: NOW });
    await addEvent(env.DB, "t1", "Started the deep search. It usually takes 4 to 6 minutes.", NOW);
    const doc = await buildDocument(env, "t1");
    expect(doc).toMatchObject({
      id: "t1",
      url: "https://upstream.test/t/t1",
      status: "searching",
      running: true,
      verdict: null,
      cite: null,
      progress: { pagesRead: 12, latestHosts: ["agency.example"], startedAt: NOW, deepStartedAt: NOW },
    });
    expect(doc?.events.map((e) => e.message)).toEqual(["Started the deep search. It usually takes 4 to 6 minutes."]);
  });

  it("gives a finished trail its links, marks, notes and citation", async () => {
    await saveSteps(env.DB, "t1", [
      step({ reachedBy: "start", date: "2025-12-15", dateSource: "page", wording: "People spend 90 percent of their time indoors." }),
      step({
        url: STUDY,
        publisher: "Journal of Examples",
        title: "A survey of daily activity",
        date: "2001-07-26",
        dateSource: "page",
        wording: "People spend an average of 87 percent of their time indoors.",
        reachedBy: "link",
      }),
    ]);
    await saveChanges(env.DB, "t1", [
      { fromPosition: 1, toPosition: 0, kind: "rounded", detail: "87 percent became 90 percent", basis: "code" },
      { fromPosition: null, toPosition: null, kind: "noted", detail: "The group changed.", basis: "research" },
    ]);
    await updateTrace(env.DB, "t1", { status: "done", verdict: "changed_on_the_way", reached: "original", summary: "It comes from a 2001 survey.", finishedAt: NOW });

    const doc = await buildDocument(env, "t1");
    expect(doc).toMatchObject({ status: "done", running: false, verdict: "changed_on_the_way", verdictWords: "Changed on the way", reached: "original", summary: "It comes from a 2001 survey." });
    expect(doc?.steps).toHaveLength(2);
    expect(doc?.steps[0]).toMatchObject({
      position: 0,
      datePlain: "15 December 2025",
      openUrl: `${START}#:~:text=People%20spend%2090%20percent%20of%20their%20time%20indoors`,
      notes: ["rounded: 87 percent became 90 percent"],
    });
    // Only the words a named change points at are marked.
    expect(doc?.steps[0]?.marks).toEqual([
      { op: "same", text: "People spend " },
      { op: "added", text: "90 percent" },
      { op: "same", text: " of their time indoors." },
    ]);
    expect(doc?.steps[1]).toMatchObject({ position: 1, datePlain: "26 July 2001", marks: null, notes: [] });
    expect(doc?.noted).toEqual(["The group changed."]);
    expect(doc?.cite?.plain).toBe(
      'Journal of Examples, "A survey of daily activity" (26 July 2001). https://journal.example/study-2001\nOriginal wording: "People spend an average of 87 percent of their time indoors."\nTrail: https://upstream.test/t/t1',
    );
  });

  it("marks the word a dropped year turned into, and nothing when no change is named", async () => {
    await saveSteps(env.DB, "t1", [
      step({ reachedBy: "start", wording: "People now lose focus after 8 seconds, a study says." }),
      step({ url: STUDY, wording: "In 2013 the span was 8 seconds.", date: "2015" }),
    ]);
    await saveChanges(env.DB, "t1", [{ fromPosition: 1, toPosition: 0, kind: "year_dropped", detail: '2013 became "now"', basis: "code" }]);
    const doc = await buildDocument(env, "t1");
    expect(doc?.steps[0]?.marks).toEqual([
      { op: "same", text: "People " },
      { op: "added", text: "now" },
      { op: "same", text: " lose focus after 8 seconds, a study says." },
    ]);
    expect(doc?.steps[1]?.marks).toBeNull();
  });

  it("names a step by a short publisher, else by its site, and trims long titles and source notes", async () => {
    const long = "Journal of Exposure Science and Environmental Epidemiology (a national laboratory, agency-sponsored)";
    await saveSteps(env.DB, "t1", [
      step({ reachedBy: "start", wording: "A sentence here." }),
      step({ url: STUDY, publisher: long, title: "T".repeat(200), namesSource: "N".repeat(400) }),
      step({ url: "https://agency.example/x", publisher: "The Agency", title: "Read" }),
      step({ url: null, publisher: "A 1960 handbook", reading: "offline" }),
    ]);
    const doc = await buildDocument(env, "t1");
    expect(doc?.steps.map((s) => s.name)).toEqual(["news.example", "journal.example", "The Agency", "A 1960 handbook"]);
    expect(doc?.steps[1]?.title).toHaveLength(121);
    expect(doc?.steps[1]?.title?.endsWith("…")).toBe(true);
    expect(doc?.steps[1]?.namesSource).toHaveLength(181);
    expect(doc?.steps[2]?.title).toBeNull();
  });

  it("shows a title's characters, not their codes", async () => {
    await saveSteps(env.DB, "t1", [step({ reachedBy: "start", wording: "A sentence here.", title: "Big data: 90% of world&apos;s data &amp; more &#8211; a &quot;report&quot;" })]);
    expect((await buildDocument(env, "t1"))?.steps[0]?.title).toBe("Big data: 90% of world's data & more – a \"report\"");
  });

  it("opens a saved copy when that is where the step was read, and a PDF without a sentence link", async () => {
    await saveSteps(env.DB, "t1", [
      step({ reachedBy: "start", wording: "People spend 90 percent of their time indoors." }),
      step({ url: "https://gone.example/story", wording: "A sentence there.", readFrom: "archive", archiveUrl: "https://web.archive.org/web/2015/https://gone.example/story" }),
      step({ url: "https://agency.example/report.pdf", wording: "A sentence in a report." }),
      step({ url: "https://b.example/y", wording: null, reading: "not_found" }),
      step({ url: null, wording: "As quoted.", reading: "offline", readFrom: null, quotedBy: "b.example" }),
    ]);
    const doc = await buildDocument(env, "t1");
    expect(doc?.steps.map((s) => s.openUrl)).toEqual([
      `${START}#:~:text=People%20spend%2090%20percent%20of%20their%20time%20indoors`,
      "https://web.archive.org/web/2015/https://gone.example/story#:~:text=A%20sentence%20there",
      "https://agency.example/report.pdf",
      "https://b.example/y",
      // A source that is only in print opens where it is quoted.
      "https://b.example/y#:~:text=As%20quoted",
    ]);
  });
});

describe("buildDocument on awkward sources", () => {
  it("drops a title that is only a file name", async () => {
    await saveSteps(env.DB, "t1", [
      step({ reachedBy: "start", wording: "A sentence here." }),
      step({ url: "https://a.example/1.pdf", title: "Print scan0008 1.tif (1 page)" }),
      step({ url: "https://a.example/2.pdf", title: "103700_03_BRA_11_24W" }),
      step({ url: "https://a.example/3.pdf", title: "Big Data Book3.indd" }),
      step({ url: "https://a.example/4.pdf", title: "Microsoft Word - report_final.doc" }),
      step({ url: "https://a.example/5", title: "Big Data – for better or worse - SINTEF" }),
    ]);
    const doc = await buildDocument(env, "t1");
    expect(doc?.steps.map((s) => s.title)).toEqual([null, null, null, null, null, "Big Data – for better or worse - SINTEF"]);
  });

  it("cuts a long title at a word, not inside one", async () => {
    // The 120th character falls inside "extraordinarily".
    const title = "word ".repeat(23) + "extraordinarily long ending here";
    await saveSteps(env.DB, "t1", [step({ reachedBy: "start", wording: "A sentence here.", title })]);
    expect((await buildDocument(env, "t1"))?.steps[0]?.title).toBe("word ".repeat(23).trimEnd() + "…");
  });

  it("opens a source that is only in print at the sentence where a later page quotes it, and shows no title for it", async () => {
    await saveSteps(env.DB, "t1", [
      step({ reachedBy: "start", wording: "A sentence here." }),
      step({ url: "https://quotes.example/history", publisher: "Quote History", wording: "The paper wrote this in 1981." }),
      step({
        url: "https://paper.example/",
        publisher: "The Daily Example",
        title: "News, Sports, Business | The Daily Example",
        wording: "As printed in 1981.",
        reading: "offline",
        readFrom: null,
        quotedBy: "quotes.example",
      }),
    ]);
    await updateTrace(env.DB, "t1", { status: "done", verdict: "said_by_someone_else", reached: "earliest_copy", finishedAt: NOW });
    const doc = await buildDocument(env, "t1");
    expect(doc?.steps[2]).toMatchObject({ title: null, openUrl: "https://quotes.example/history#:~:text=As%20printed%20in%201981" });
    // The citation does not send a reader to the newspaper's front page either.
    expect(doc?.cite?.plain).toContain("The Daily Example (no date). Not readable online.");
    expect(doc?.cite?.plain).not.toContain("https://paper.example/");
  });
});
