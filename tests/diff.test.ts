import { describe, expect, it } from "vitest";
import { wordDiff } from "../src/core/diff";

describe("wordDiff", () => {
  it("marks what the newer sentence dropped and what it added", () => {
    expect(wordDiff("It usually requires a minimum of about 21 days", "It takes 21 days")).toEqual([
      { op: "same", text: "It" },
      { op: "removed", text: "usually requires a minimum of about" },
      { op: "added", text: "takes" },
      { op: "same", text: "21 days" },
    ]);
  });

  it("ignores case and punctuation when deciding what is the same, and keeps the newer spelling", () => {
    expect(wordDiff("People, on average, spend time indoors.", "people spend time indoors")).toEqual([
      { op: "same", text: "people" },
      { op: "removed", text: "on average," },
      { op: "same", text: "spend time indoors" },
    ]);
  });

  it("is one run when nothing changed", () => {
    expect(wordDiff("Eight seconds", "Eight seconds")).toEqual([{ op: "same", text: "Eight seconds" }]);
  });

  it("handles an empty side", () => {
    expect(wordDiff("", "New words")).toEqual([{ op: "added", text: "New words" }]);
    expect(wordDiff("Old words", "")).toEqual([{ op: "removed", text: "Old words" }]);
  });
});
