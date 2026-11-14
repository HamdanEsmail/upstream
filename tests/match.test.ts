import { describe, expect, it } from "vitest";
import { findClaim, findSure } from "../src/core/match";

const PAGE = [
  "## Indoor air",
  "Most of us never think about it. People spend nearly 90 percent of their time indoors, yet indoor air is studied less than outdoor air.",
  "A full 90 percent of all the data in the world has been generated over the last two years, the researchers say.",
  "The harbour ferry leaves at noon.",
].join("\n");

describe("findClaim", () => {
  it("is exact when the page holds the claim word for word, whatever the quotes and spacing", () => {
    const found = findClaim(PAGE, "“People spend nearly 90 percent  of their time indoors, yet indoor air is studied less than outdoor air.”");
    expect(found.reading).toBe("exact");
    expect(found.sentence).toBe("People spend nearly 90 percent of their time indoors, yet indoor air is studied less than outdoor air.");
  });

  it("returns the whole sentence when the claim is only part of it", () => {
    const found = findClaim(PAGE, "nearly 90 percent of their time indoors");
    expect(found.reading).toBe("exact");
    expect(found.sentence).toBe("People spend nearly 90 percent of their time indoors, yet indoor air is studied less than outdoor air.");
  });

  it("returns every sentence a claim runs across", () => {
    const page = "Most people spend more than 90 percent of their time inside. Indeed, with travel, it is nearly 24 hours a day. The ferry leaves at noon.";
    const found = findClaim(page, "more than 90 percent of their time inside. Indeed, with travel, it is nearly 24 hours");
    expect(found.reading).toBe("exact");
    expect(found.sentence).toBe("Most people spend more than 90 percent of their time inside. Indeed, with travel, it is nearly 24 hours a day.");
  });

  it("is close when the same statement is worded a little differently", () => {
    const found = findClaim(PAGE, "A full 90% of all the data in the world has been generated over the last two years.");
    expect(found.reading).toBe("close");
    expect(found.sentence).toBe("A full 90 percent of all the data in the world has been generated over the last two years, the researchers say.");
  });

  it("treats word endings as the same word", () => {
    const found = findClaim("Researchers found that people are spending most of their days inside buildings.", "People spend most of their day inside a building");
    expect(found.reading).toBe("close");
  });

  it("is not found when the page says nothing of the kind", () => {
    expect(findClaim(PAGE, "The average attention span is now 8 seconds")).toEqual({ reading: "not_found", sentence: null, score: expect.any(Number) });
  });

  it("is not found on an empty page", () => {
    expect(findClaim("", "Anything at all here").reading).toBe("not_found");
  });

  it("does not call two sentences close because they share a number", () => {
    expect(findClaim("The ferry carries 90 percent of the island's visitors.", "People spend nearly 90 percent of their time indoors").reading).toBe("not_found");
  });
});

describe("findClaim on long pages", () => {
  it("still finds a close sentence when many unrelated sentences surround it", () => {
    const filler = Array.from({ length: 400 }, (_, i) => `The tide table for day ${i} lists two high waters and a low one.`).join(" ");
    const page = filler + " Researchers found that people are spending most of their days inside buildings. " + filler;
    expect(findClaim(page, "People spend most of their day inside a building").reading).toBe("close");
  });

  it("reads a page only up to its first 120,000 characters", () => {
    const filler = "The tide table lists two high waters and a low one. ".repeat(2400);
    expect(filler.length).toBeGreaterThan(120_000);
    expect(findClaim(filler + "People spend most of their day inside a building.", "People spend most of their day inside a building").reading).toBe("not_found");
  });
});

describe("findClaim on pages whose lines break in the middle of a sentence", () => {
  const AD = [
    "International Business Machines Corporation 2011.T",
    "o build a smarter planet, we need smarter computing—computing th",
    "at is tuned to the task, managed through the cloud and, importantly, de",
    "signed for big data.H",
    "ow big? We’re now creating 2.5 quintillion bytes daily—so much th",
    "at 90% of the data in the world today has been created in the las",
    "t two years alone. T",
    "his data is also big in another way—in its promise.",
  ].join("\n");

  it("puts a sentence back together when the lines break inside words", () => {
    const found = findClaim(AD, "We're now creating 2.5 quintillion bytes of data daily, so much that 90% of the data in the world today has been created in the last two years alone.");
    expect(found.reading).toBe("close");
    expect(found.sentence).toBe("We’re now creating 2.5 quintillion bytes daily—so much that 90% of the data in the world today has been created in the last two years alone.");
  });

  it("puts a sentence back together when the lines break between words", () => {
    const page = [
      "The survey found that respondents spent an average of 87% of their",
      "time in enclosed buildings and about 6% of their time in enclosed",
      "vehicles. The rest was spent outdoors.",
    ].join("\n");
    const found = findClaim(page, "Respondents reported spending 87% of their time in enclosed buildings and 6% of their time in enclosed vehicles.");
    expect(found).toMatchObject({
      reading: "close",
      sentence: "The survey found that respondents spent an average of 87% of their time in enclosed buildings and about 6% of their time in enclosed vehicles.",
    });
  });

  it("puts a sentence back together when the page gives one word to a line, with a tab between them", () => {
    const page = ["designed for big data.", "How", "\t", "big?", "\t", "We’re", "\t", "now", "\t", "creating", "\t", "2.5", "\t", "quintillion", "\t", "bytes", "\t", "daily—", "so much that 90% of the data in the world today has been ", "created in the last two years alone.", "This data is also big in another way."].join("\n");
    const found = findClaim(page, "We're now creating 2.5 quintillion bytes of data daily, so much that 90% of the data in the world today has been created in the last two years alone.");
    expect(found.sentence).toBe("We’re now creating 2.5 quintillion bytes daily— so much that 90% of the data in the world today has been created in the last two years alone.");
  });

  it("does not run separate list items together", () => {
    const page = ["- People spend most of their time in buildings", "- About 90 percent of homes have a kitchen", "- Indoor air is rarely measured"].join("\n");
    expect(findClaim(page, "People spend about 90 percent of their time in buildings where indoor air is rarely measured.").reading).toBe("not_found");
  });

  it("finds a claim that the reader copied with a footnote mark in it", () => {
    const page = "Goldfish have a memory span of at least three months.[36][37] By using positive reinforcement, they can be trained.";
    expect(findClaim(page, "Goldfish have a memory span of at least three months.[36][37]")).toMatchObject({ reading: "exact", sentence: "Goldfish have a memory span of at least three months." });
  });
});

// A page that only a search led to has no link to vouch for it, so it is held to more.
describe("findSure", () => {
  const DATA = "This means 90% of the world's data has been created in the last two years.";
  const INDOORS = "People spend nearly 90 percent of their time indoors, yet indoor environments are often less studied than outdoor air.";
  const page = (line: string) => `A line before it. ${line} A line after it.`;

  it("keeps a page that holds the claim word for word", () => {
    expect(findSure(page(INDOORS), INDOORS)).toMatchObject({ reading: "exact", sentence: INDOORS });
  });

  it("keeps nearly the same words when every figure of the claim is in the page's sentence", () => {
    const line = "90% of the world's data has been created in the last two years.";
    expect(findSure(page(line), DATA)).toMatchObject({ reading: "close", sentence: line });
  });

  it("refuses the same words with another figure", () => {
    expect(findSure(page("Approximately 80% of the world's data has been created in the last two years."), DATA).reading).toBe("not_found");
  });

  it("refuses the same words with one of the claim's figures missing", () => {
    expect(findSure(page("You may be familiar with the statistic that 90% of the world's data was created in the last few years."), DATA).reading).toBe("not_found");
  });

  it("refuses a looser restatement that a linked page would be allowed", () => {
    const line = "A full 90% of all the data in the world has been generated over the last two years.";
    expect(findClaim(page(line), DATA).reading).toBe("close");
    expect(findSure(page(line), DATA).reading).toBe("not_found");
  });

  it("refuses a sentence that ends differently, though it shares the figures", () => {
    const claim = "In short, it takes 21 days to build a habit and 90 days to make it permanent.";
    expect(findSure(page("My dad always told me that it takes 21 days to make a habit and 90 days to break one."), claim).reading).toBe("not_found");
  });

  it("keeps a page that holds, word for word, the part of the claim that carries its figures", () => {
    const line = "The agency estimates that people spend nearly 90 percent of their time indoors.";
    expect(findClaim(page(line), INDOORS).reading).toBe("not_found");
    expect(findSure(page(line), INDOORS)).toMatchObject({ reading: "close", sentence: line });
  });

  it("does not do that when the rest of the claim names a place or a person", () => {
    const claim = "In Norway, nearly 90 percent of new cars sold are electric.";
    expect(findSure(page("In China, nearly 90 percent of new cars sold are electric."), claim).reading).toBe("not_found");
  });

  it("does not do that when the rest of the claim gives a year", () => {
    const claim = "At the end of 2024, 123.2 million people worldwide were forcibly displaced.";
    expect(findSure(page("At the end of 2023, 123.2 million people worldwide were forcibly displaced."), claim).reading).toBe("not_found");
  });

  it("does not do that for a part too short to be a statement", () => {
    expect(findSure(page("Sales fell by 90 percent."), "Fell by 90 percent, the worst result the company has had since it was founded.").reading).toBe("not_found");
  });

  it("keeps a quotation in nearly the same words: it has no figures to check", () => {
    const claim = "Insanity is doing the same thing, over and over again, but expecting different results.";
    expect(findSure(page("The definition of insanity is doing the same thing over and over again and expecting a different result."), claim).reading).toBe("close");
  });
});
