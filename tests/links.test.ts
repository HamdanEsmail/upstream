import { describe, expect, it } from "vitest";
import { candidateLinks } from "../src/core/links";

const PAGE = "https://www.news.example/science/indoor-air";

describe("candidateLinks", () => {
  it("keeps links to other sites and drops the page's own site", () => {
    expect(
      candidateLinks(PAGE, ["https://www.news.example/", "https://news.example/science", "https://agency.example/report", "https://journal.example/article/7"], []),
    ).toEqual(["https://agency.example/report", "https://journal.example/article/7"]);
  });

  it("drops social, sharing, sign-in and non-web links", () => {
    expect(
      candidateLinks(
        PAGE,
        [
          "https://www.facebook.com/newsexample",
          "https://x.com/intent/tweet?url=abc",
          "https://www.linkedin.com/in/someone/",
          "https://accounts.example/login?next=1",
          "https://shop.example/subscribe",
          "mailto:desk@news.example",
          "javascript:void(0)",
          "https://agency.example/report",
        ],
        [],
      ),
    ).toEqual(["https://agency.example/report"]);
  });

  it("puts the links near the highlight first, even when they stay on the same site", () => {
    expect(candidateLinks(PAGE, ["https://agency.example/report", "https://journal.example/a"], ["https://www.news.example/2015/the-study", "https://journal.example/a"])).toEqual([
      "https://www.news.example/2015/the-study",
      "https://journal.example/a",
      "https://agency.example/report",
    ]);
  });

  it("counts an address once, whatever its fragment or trailing slash", () => {
    expect(candidateLinks(PAGE, ["https://agency.example/report/", "https://agency.example/report#summary", "https://agency.example/report"], [])).toEqual([
      "https://agency.example/report/",
    ]);
  });

  it("never returns the page itself", () => {
    expect(candidateLinks(PAGE, [], [PAGE + "#main", "https://news.example/science/indoor-air/"])).toEqual([]);
  });

  it("keeps at most ten", () => {
    const many = Array.from({ length: 30 }, (_, i) => `https://site${i}.example/page`);
    expect(candidateLinks(PAGE, many, [])).toHaveLength(10);
  });
});
