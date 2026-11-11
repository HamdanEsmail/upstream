import { describe, expect, it } from "vitest";
import { namedChanges } from "../src/core/changes";

const kinds = (older: string, newer: string) => namedChanges(older, newer).map((c) => c.kind);

describe("namedChanges", () => {
  it("names a rounded number", () => {
    expect(namedChanges("Respondents spent an average of 87% of their time in buildings.", "People spend 90 percent of their time indoors.")).toContainEqual({
      kind: "rounded",
      detail: "87% became 90 percent",
    });
  });

  it("sees rounding across million and billion", () => {
    expect(kinds("An estimated 2,325.5 million people were affected.", "An estimated 2.33 billion people were affected.")).toEqual(["rounded"]);
  });

  it("names a number that changed by more than rounding", () => {
    expect(namedChanges("The average span was 12 seconds.", "The average span is 8 seconds.")).toContainEqual({ kind: "number_changed", detail: "12 became 8" });
  });

  it("does not report a number both sentences share", () => {
    expect(kinds("It takes 21 days to settle.", "It takes 21 days to form a habit.")).toEqual([]);
  });

  it("names careful words the newer sentence dropped", () => {
    expect(namedChanges("It usually requires a minimum of about 21 days.", "It takes 21 days.")).toContainEqual({
      kind: "careful_word_dropped",
      detail: 'dropped "usually", "a minimum of", "about"',
    });
  });

  it("does not report a careful word that is still there", () => {
    expect(kinds("About 21 days are needed.", "It takes about 21 days.")).toEqual([]);
  });

  it("names a year that went missing", () => {
    expect(namedChanges("The average human attention span in 2013: 8 seconds.", "The attention span is 8 seconds.")).toContainEqual({
      kind: "year_dropped",
      detail: "the year 2013 is gone",
    });
  });

  it("names a year that became now", () => {
    expect(namedChanges("In 2013 the span was 8 seconds.", "People now lose focus after 8 seconds.")).toContainEqual({ kind: "year_dropped", detail: '2013 became "now"' });
  });

  it("reports nothing for two sentences that say the same", () => {
    expect(namedChanges("Nearly 90 percent of time is spent indoors.", "People spend nearly 90 percent of their time indoors.")).toEqual([]);
  });
});

describe("namedChanges and careful words of the same kind", () => {
  it("does not call it a drop when one approximate word replaces another", () => {
    expect(kinds("People now spend about 90 percent of their time indoors.", "People spend nearly 90 percent of their time indoors.")).toEqual([]);
    expect(kinds("It takes roughly 21 days.", "It takes around 21 days.")).toEqual([]);
  });

  it("still names a drop when no word of that kind is left", () => {
    expect(namedChanges("Americans spend more than 90 percent of their time inside.", "People spend nearly 90 percent of their time inside.")).toContainEqual({
      kind: "careful_word_dropped",
      detail: 'dropped "more than"',
    });
    expect(namedChanges("It may take up to 21 days.", "It takes about 21 days.")).toContainEqual({ kind: "careful_word_dropped", detail: 'dropped "may", "up to"' });
  });
});
