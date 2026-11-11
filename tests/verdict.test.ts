import { describe, expect, it } from "vitest";
import { decide, type VerdictInput } from "../src/core/verdict";

const base: VerdictInput = {
  readings: ["exact", "exact", "exact"],
  research: { verdict: "matches_original", originFound: true },
  changes: [],
  originYear: 2024,
  thisYear: 2026,
};

describe("decide", () => {
  it("matches the original when one was reached and nothing changed", () => {
    expect(decide(base)).toEqual({ verdict: "matches_original", reached: "original" });
  });

  it("is changed on the way when code names a changed figure or a dropped careful word, whatever the research run said", () => {
    expect(decide({ ...base, changes: [{ kind: "rounded", detail: "87% became 90 percent" }] }).verdict).toBe("changed_on_the_way");
    expect(decide({ ...base, changes: [{ kind: "careful_word_dropped", detail: 'dropped "about"' }] }).verdict).toBe("changed_on_the_way");
  });

  it("is changed on the way when the research run says so", () => {
    expect(decide({ ...base, research: { verdict: "changed_on_the_way", originFound: true } }).verdict).toBe("changed_on_the_way");
  });

  it("is out of date when the year was dropped and the original is five or more years old", () => {
    const changes = [{ kind: "year_dropped" as const, detail: "the year 2013 is gone" }];
    expect(decide({ ...base, changes, originYear: 2013 }).verdict).toBe("out_of_date");
    expect(decide({ ...base, changes, originYear: 2024 }).verdict).toBe("matches_original");
    expect(decide({ ...base, research: { verdict: "outdated", originFound: true } }).verdict).toBe("out_of_date");
  });

  it("puts a changed figure ahead of out of date", () => {
    const changes = [
      { kind: "year_dropped" as const, detail: "the year 2013 is gone" },
      { kind: "number_changed" as const, detail: "12 became 8" },
    ];
    expect(decide({ ...base, changes, originYear: 2013 }).verdict).toBe("changed_on_the_way");
  });

  it("is no original source when the research run found none, and says only an earliest copy was reached", () => {
    expect(decide({ ...base, research: { verdict: "no_original_source", originFound: false }, changes: [{ kind: "rounded", detail: "x" }] })).toEqual({
      verdict: "no_original_source",
      reached: "earliest_copy",
    });
  });

  it("is said by someone else for a quotation, ahead of everything else", () => {
    expect(decide({ ...base, research: { verdict: "said_by_someone_else", originFound: false } })).toEqual({ verdict: "said_by_someone_else", reached: "earliest_copy" });
  });

  it("reaches only an earliest copy when the research run confirmed no original", () => {
    expect(decide({ ...base, research: { verdict: "changed_on_the_way", originFound: false } })).toEqual({ verdict: "changed_on_the_way", reached: "earliest_copy" });
  });

  it("counts a source that is only in print as reached", () => {
    expect(decide({ ...base, readings: ["exact", "offline"] }).verdict).toBe("matches_original");
  });

  it("is not settled when no step after the first could be confirmed", () => {
    expect(decide({ ...base, readings: ["exact", "not_found", "unreadable"] })).toEqual({ verdict: "not_settled", reached: "nothing" });
    expect(decide({ ...base, readings: ["exact"] })).toEqual({ verdict: "not_settled", reached: "nothing" });
  });

  it("is not settled without a research verdict, and says how far the links went", () => {
    expect(decide({ ...base, research: null })).toEqual({ verdict: "not_settled", reached: "earliest_copy" });
    expect(decide({ ...base, research: { verdict: null, originFound: false } })).toEqual({ verdict: "not_settled", reached: "earliest_copy" });
  });
});
