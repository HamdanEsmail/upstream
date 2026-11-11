import { describe, expect, it } from "vitest";
import { contentWords, normalise, numbers, sentences, years } from "../src/core/text";

describe("normalise", () => {
  it("straightens quotes and dashes, joins whitespace and lowers case", () => {
    expect(normalise("  “Nearly  90 percent” — of\ntime  ")).toBe('"nearly 90 percent" - of time');
  });

  it("drops soft hyphens and zero-width characters", () => {
    expect(normalise("at­ten​tion")).toBe("attention");
  });
});

describe("sentences", () => {
  it("splits on full stops, question marks and line breaks", () => {
    expect(sentences("People spend 90 percent of time indoors. Is that true? Yes.\nA new line")).toEqual([
      "People spend 90 percent of time indoors.",
      "Is that true?",
      "Yes.",
      "A new line",
    ]);
  });

  it("does not split inside a decimal, an abbreviation or a closing quote", () => {
    expect(sentences('The U.S. figure is 87.5 percent, said Dr. Hale. "It is high." Then it fell.')).toEqual([
      "The U.S. figure is 87.5 percent, said Dr. Hale.",
      '"It is high."',
      "Then it fell.",
    ]);
  });

  it("strips markdown heading marks and list bullets", () => {
    expect(sentences("## A heading\n- First point here.\n* Second point")).toEqual(["A heading", "First point here.", "Second point"]);
  });
});

describe("numbers", () => {
  it("reads digits with commas and decimals", () => {
    expect(numbers("It rose from 2,325.5 to 4000 in a year").map((n) => n.value)).toEqual([2325.5, 4000]);
  });

  it("reads percent signs and the words percent and per cent", () => {
    expect(numbers("90% of data, 87 percent indoors, 6 per cent in cars")).toEqual([
      { value: 90, unit: "percent", raw: "90%" },
      { value: 87, unit: "percent", raw: "87 percent" },
      { value: 6, unit: "percent", raw: "6 per cent" },
    ]);
  });

  it("scales by thousand, million, billion and trillion", () => {
    expect(numbers("2.33 billion people and 2,325.5 million people").map((n) => n.value)).toEqual([2_330_000_000, 2_325_500_000]);
  });

  it("reads number words", () => {
    expect(numbers("after eight seconds, not twelve, and twenty-one days").map((n) => n.value)).toEqual([8, 12, 21]);
  });

  it("does not count a four-digit year as a quantity", () => {
    expect(numbers("In 2013 it was 8 seconds").map((n) => n.value)).toEqual([8]);
  });
});

describe("years", () => {
  it("finds four-digit years between 1500 and 2099", () => {
    expect(years("From 1989 to 2001, about 3000 people; the 2000s")).toEqual([1989, 2001]);
  });
});

describe("contentWords", () => {
  it("keeps the words that carry meaning", () => {
    expect(contentWords("The average human attention span is now 8 seconds")).toEqual(["average", "human", "attention", "span", "now", "8", "seconds"]);
  });
});

describe("sentences on a page with footnote marks", () => {
  it("ends a sentence at a footnote mark and leaves the mark out", () => {
    const text = "Goldfish have a memory span of at least three months.[36][37] By using positive reinforcement, they can be trained.[a] Some say otherwise.[citation needed] The end.";
    expect(sentences(text)).toEqual([
      "Goldfish have a memory span of at least three months.",
      "By using positive reinforcement, they can be trained.",
      "Some say otherwise.",
      "The end.",
    ]);
  });

  it("keeps square brackets that are not footnote marks", () => {
    expect(sentences("The court held [that] the rule applies [sic] in 2019.")).toEqual(["The court held [that] the rule applies [sic] in 2019."]);
  });
});
