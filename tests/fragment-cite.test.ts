import { describe, expect, it } from "vitest";
import { citation } from "../src/core/cite";
import { plainDate } from "../src/core/dates";
import { sentenceLink } from "../src/core/fragment";

describe("sentenceLink", () => {
  it("links to a short sentence in full, without its closing punctuation", () => {
    expect(sentenceLink("https://a.example/p", "Eight seconds is short.")).toBe("https://a.example/p#:~:text=Eight%20seconds%20is%20short");
  });

  it("links to a long sentence by its first and last four words", () => {
    expect(sentenceLink("https://a.example/p", "People spend nearly 90 percent of their time indoors, yet indoor air is studied less than outdoor air.")).toBe(
      "https://a.example/p#:~:text=People%20spend%20nearly%2090,less%20than%20outdoor%20air",
    );
  });

  it("escapes dashes, commas and ampersands, which have a meaning in such links", () => {
    expect(sentenceLink("https://a.example/p", "A well-known R&D figure, again")).toBe("https://a.example/p#:~:text=A%20well%2Dknown%20R%26D%20figure%2C%20again");
  });

  it("replaces a fragment the address already had", () => {
    expect(sentenceLink("https://a.example/p#main", "Eight seconds is short")).toBe("https://a.example/p#:~:text=Eight%20seconds%20is%20short");
  });

  it("strips the quote marks and dots around the sentence", () => {
    expect(sentenceLink("https://a.example/p", "“…people now lose focus”")).toBe("https://a.example/p#:~:text=people%20now%20lose%20focus");
  });

  it("leaves a PDF address alone, saved copies included", () => {
    expect(sentenceLink("https://a.example/report.pdf", "Any sentence here")).toBe("https://a.example/report.pdf");
    expect(sentenceLink("https://a.example/report.PDF?download=1", "Any sentence here")).toBe("https://a.example/report.PDF?download=1");
    expect(sentenceLink("https://web.archive.org/web/2015/https://a.example/report.pdf", "Any sentence here")).toBe("https://web.archive.org/web/2015/https://a.example/report.pdf");
  });

  it("leaves the address alone when there is no sentence", () => {
    expect(sentenceLink("https://a.example/p", "  ")).toBe("https://a.example/p");
  });
});

describe("plainDate", () => {
  it("writes a day, a month or a year the way a person would", () => {
    expect(plainDate("2013-05-22")).toBe("22 May 2013");
    expect(plainDate("2011-05")).toBe("May 2011");
    expect(plainDate("1960")).toBe("1960");
    expect(plainDate(null)).toBe("no date");
  });
});

describe("citation", () => {
  const origin = { publisher: "Port Board", title: "Harbour survey 2011", date: "2011-05", url: "https://ports.example/report", wording: "About 87 percent of harbours were busier." };
  const trailUrl = "https://upstream.test/t/abc";

  it("cites the original with its own wording", () => {
    expect(citation({ verdict: "changed_on_the_way", reached: "original", origin, trailUrl })).toEqual({
      plain: 'Port Board, "Harbour survey 2011" (May 2011). https://ports.example/report\nOriginal wording: "About 87 percent of harbours were busier."\nTrail: https://upstream.test/t/abc',
      markdown:
        '[Port Board, "Harbour survey 2011"](https://ports.example/report) (May 2011). Original wording: "About 87 percent of harbours were busier." [Trail](https://upstream.test/t/abc)',
    });
  });

  it("says earliest known appearance when only a copy was reached", () => {
    const made = citation({ verdict: "said_by_someone_else", reached: "earliest_copy", origin: { ...origin, title: null, date: "1981-10-11" }, trailUrl });
    expect(made.plain).toBe(
      'Earliest known appearance: Port Board (11 October 1981). https://ports.example/report\nWording there: "About 87 percent of harbours were busier."\nTrail: https://upstream.test/t/abc',
    );
  });

  it("says there is nothing to cite when no original source was found", () => {
    const made = citation({ verdict: "no_original_source", reached: "earliest_copy", origin: { ...origin, title: null, date: "2015-03-19" }, trailUrl });
    expect(made.plain).toBe("No original source is known for this claim. The trail ends at Port Board (19 March 2015): https://ports.example/report\nTrail: https://upstream.test/t/abc");
    expect(made.markdown).toBe("No original source is known for this claim. The trail ends at [Port Board](https://ports.example/report) (19 March 2015). [Trail](https://upstream.test/t/abc)");
  });

  it("handles a source that is only in print", () => {
    const made = citation({ verdict: "matches_original", reached: "original", origin: { publisher: "A 1960 book", title: null, date: "1960", url: null, wording: "A minimum of about 21 days." }, trailUrl });
    expect(made.plain).toBe('A 1960 book (1960). Not readable online.\nOriginal wording: "A minimum of about 21 days."\nTrail: https://upstream.test/t/abc');
  });

  it("points at the trail alone when nothing was settled", () => {
    expect(citation({ verdict: "not_settled", reached: "nothing", origin: null, trailUrl }).plain).toBe("The source of this claim could not be settled.\nTrail: https://upstream.test/t/abc");
  });
});
