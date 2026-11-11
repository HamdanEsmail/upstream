import { describe, expect, it } from "vitest";
import { readTrail } from "../src/core/report";

const block = (body: unknown) => "# A report\n\nSome prose first.\n\n```json\n" + JSON.stringify(body) + "\n```\n";

const TRAIL = {
  steps: [
    { url: "https://news.example/story", publisher: "Example News", date: "2026-06-29", wording: "Nine in ten harbours are busier.", names_source: "the Port Board", linked: true },
    { url: "https://ports.example/report.pdf", publisher: "Port Board", date: "2011-05", wording: "About 87 percent of harbours were busier.", names_source: "none", linked: false },
  ],
  origin: { found: true, url: "https://ports.example/report.pdf", kind: "report", note: "Annual survey." },
  changes: ["87 percent became nine in ten."],
  verdict: "changed_on_the_way",
  summary: "It comes from a 2011 survey. The figure was rounded.",
};

describe("readTrail", () => {
  it("reads the closing json block of a report", () => {
    expect(readTrail(block(TRAIL))).toEqual({
      steps: [
        { url: "https://news.example/story", publisher: "Example News", date: "2026-06-29", wording: "Nine in ten harbours are busier.", namesSource: "the Port Board", saidLinked: true },
        { url: "https://ports.example/report.pdf", publisher: "Port Board", date: "2011-05", wording: "About 87 percent of harbours were busier.", namesSource: null, saidLinked: false },
      ],
      origin: { found: true, url: "https://ports.example/report.pdf", kind: "report", note: "Annual survey." },
      changes: ["87 percent became nine in ten."],
      verdict: "changed_on_the_way",
      summary: "It comes from a 2011 survey. The figure was rounded.",
    });
  });

  it("uses the last block when the report holds several", () => {
    const report = "```json\n{\"steps\":[]}\n```\n" + block(TRAIL);
    expect(readTrail(report)?.steps).toHaveLength(2);
  });

  it("cuts an address at the first space and drops one that is not a web address", () => {
    const steps = [
      { url: "https://courier.example/ [Daily Courier, 11 October 1981, front page]", publisher: "Daily Courier", date: "1981-10-11", wording: "A line.", names_source: "none", linked: false },
      { url: "print only", publisher: "A 1960 book", date: "1960", wording: "Another line.", names_source: "none", linked: false },
    ];
    expect(readTrail(block({ ...TRAIL, steps }))?.steps.map((s) => s.url)).toEqual(["https://courier.example/", null]);
  });

  it("rejects wording that is a note in brackets or is empty", () => {
    const steps = [
      { url: "https://a.example/x", publisher: "A", date: "1989", wording: "[Body text not accessible from the retrieved page]", names_source: "none", linked: false },
      { url: "https://b.example/y", publisher: "B", date: "1989", wording: "   ", names_source: "none", linked: false },
    ];
    expect(readTrail(block({ ...TRAIL, steps }))?.steps.map((s) => s.wording)).toEqual([null, null]);
  });

  it("keeps a date only as a year, a year and month, or a full day", () => {
    const dated = (date: unknown) => readTrail(block({ ...TRAIL, steps: [{ ...TRAIL.steps[0], date }] }))?.steps[0]?.date;
    expect(dated("1960")).toBe("1960");
    expect(dated("2011-05")).toBe("2011-05");
    expect(dated("2013-05-22")).toBe("2013-05-22");
    expect(dated("unknown")).toBeNull();
    expect(dated("May 2011")).toBeNull();
    expect(dated(2011)).toBeNull();
  });

  it("drops a verdict it does not know", () => {
    expect(readTrail(block({ ...TRAIL, verdict: "probably fine" }))?.verdict).toBeNull();
  });

  it("returns null when the block is missing, broken or has no steps", () => {
    expect(readTrail("A report with no block at all.")).toBeNull();
    expect(readTrail("```json\n{ not json }\n```")).toBeNull();
    expect(readTrail(block({ ...TRAIL, steps: [] }))).toBeNull();
    expect(readTrail(block({ ...TRAIL, steps: "none" }))).toBeNull();
  });

  it("survives a block with missing parts", () => {
    expect(readTrail(block({ steps: [{ url: "https://a.example/x" }] }))).toEqual({
      steps: [{ url: "https://a.example/x", publisher: "", date: null, wording: null, namesSource: null, saidLinked: false }],
      origin: { found: false, url: null, kind: "other", note: "" },
      changes: [],
      verdict: null,
      summary: "",
    });
  });
});
