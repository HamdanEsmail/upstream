import { describe, expect, it } from "vitest";
import { mergeSteps, orderSteps, reachedBy, sameAddress, type Step } from "../src/core/trail";

const step = (over: Partial<Step>): Step => ({
  url: "https://a.example/x",
  publisher: "",
  title: null,
  date: null,
  dateSource: null,
  wording: null,
  reading: "exact",
  readFrom: "live",
  archiveUrl: null,
  reachedBy: "search",
  namesSource: null,
  ...over,
});

describe("sameAddress", () => {
  it("ignores the scheme, www, a trailing slash, the fragment and tracking tags", () => {
    expect(sameAddress("http://www.a.example/report/", "https://a.example/report#top")).toBe(true);
    expect(sameAddress("https://a.example/p?utm_source=x&id=7", "https://a.example/p?id=7")).toBe(true);
  });

  it("sees through an Internet Archive copy to the page it saved", () => {
    expect(sameAddress("https://web.archive.org/web/20150531191406/http://a.example:80/story/", "https://a.example/story")).toBe(true);
  });

  it("tells different pages apart", () => {
    expect(sameAddress("https://a.example/p?id=7", "https://a.example/p?id=8")).toBe(false);
    expect(sameAddress("https://a.example/p", "https://b.example/p")).toBe(false);
    expect(sameAddress("not an address", "https://a.example/p")).toBe(false);
  });
});

describe("mergeSteps", () => {
  it("keeps one entry per page and fills its gaps from the second list", () => {
    const followed = [step({ url: "https://a.example/x", wording: "Read on the page.", reachedBy: "link" })];
    const proposed = [
      step({ url: "https://www.a.example/x/", date: "2015-05-14", dateSource: "research", wording: "Told by the report.", namesSource: "a 2015 survey" }),
      step({ url: "https://b.example/y", date: "2013" }),
    ];
    expect(mergeSteps(followed, proposed)).toEqual([
      step({ url: "https://a.example/x", wording: "Read on the page.", reachedBy: "link", date: "2015-05-14", dateSource: "research", namesSource: "a 2015 survey" }),
      step({ url: "https://b.example/y", date: "2013" }),
    ]);
  });

  it("never merges sources that have no address", () => {
    const book = step({ url: null, publisher: "A 1960 book", reading: "offline" });
    expect(mergeSteps([book], [book])).toHaveLength(2);
  });
});

describe("orderSteps", () => {
  it("keeps the highlighted page first and runs the rest from newest to oldest", () => {
    const ordered = orderSteps([
      step({ url: "https://start.example/", date: null }),
      step({ url: "https://c.example/", date: "2011-04-14" }),
      step({ url: "https://a.example/", date: "2013-05-22" }),
      step({ url: "https://b.example/", date: "2011-05" }),
    ]);
    expect(ordered.map((s) => s.url)).toEqual(["https://start.example/", "https://a.example/", "https://b.example/", "https://c.example/"]);
  });

  it("puts an undated step with the dated step that follows it", () => {
    const ordered = orderSteps([
      step({ url: "https://start.example/", date: "2026-06-29" }),
      step({ url: "https://old.example/", date: "1989" }),
      step({ url: "https://undated.example/", date: null }),
      step({ url: "https://mid.example/", date: "2001" }),
    ]);
    expect(ordered.map((s) => s.url)).toEqual(["https://start.example/", "https://undated.example/", "https://mid.example/", "https://old.example/"]);
  });
});

describe("reachedBy", () => {
  it("is a link only when the page before really links to it", () => {
    expect(reachedBy(["https://www.b.example/y/", "https://c.example/z"], "https://b.example/y", null)).toBe("link");
  });

  it("is named when the page before names a source without linking to it", () => {
    expect(reachedBy(["https://c.example/z"], "https://b.example/y", "the Port Board survey")).toBe("named");
  });

  it("is search otherwise", () => {
    expect(reachedBy([], "https://b.example/y", null)).toBe("search");
    expect(reachedBy(["https://c.example/z"], null, null)).toBe("search");
  });
});

describe("orderSteps with undated steps", () => {
  it("puts an undated step just before the next dated step that followed it, not at the end", () => {
    const ordered = orderSteps([
      step({ url: "https://start.example/", date: "2025-12-15" }),
      step({ url: "https://release.example/", date: null }),
      step({ url: "https://agency.example/", date: "2017-11-02" }),
      step({ url: "https://report.example/", date: "1989" }),
      step({ url: "https://academy.example/", date: null }),
      step({ url: "https://study.example/", date: "2001-07-26" }),
    ]);
    expect(ordered.map((s) => s.url)).toEqual([
      "https://start.example/",
      "https://release.example/",
      "https://agency.example/",
      "https://academy.example/",
      "https://study.example/",
      "https://report.example/",
    ]);
  });
});
