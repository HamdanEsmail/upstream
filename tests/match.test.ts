import { describe, expect, it } from "vitest";
import { findClaim } from "../src/core/match";

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
