# Build log

## 11 November 2026: tests before anything else

Before writing any code I ran free calls against TinyFish to find out what the two tools I planned to lean on really return. The scripts are in my working folder outside this repository; the findings are in section 3 of the [design](specs/2026-11-11-upstream-design.md).

What I learned that shaped the build:

- **TinyResearch can be shown working.** Reading a run while it is still going returns the pages it has read so far. So a five-minute wait can say "the deep search has read 24 pages so far" and not sit silent.
- **It will end its report the way I ask.** I asked for one closing block in a fixed shape. Four runs out of four did it, and all four parsed.
- **Its links and dates cannot be taken on trust.** One run marked a page as linking to a source it does not link to. Two gave a date that differed from the page's own. So Upstream works both out again from the pages.
- **Fetch strips links out of the text** but returns the page's links as a list when asked. That is enough: Upstream reads the linked pages and keeps the one that states the claim.
- **The Internet Archive fills gaps.** A 2015 magazine page that is cut short today was read in full from its saved copy, through Fetch.

Four test traces took 208 to 372 seconds and cost nothing: two research runs a day are free on each account.

## 11 November: the core, then real pages

I wrote the parts with no network first, each from a failing test: finding a claim on a page, comparing two sentences word by word, naming what changed, reading a research report's trail, ordering steps, the verdict, the link that opens a page at a sentence, the citation.

Then I ran that core over the four real reports and the live pages they cite. All 19 addresses were read and 15 of the 19 steps were confirmed. It also showed the first real fault: a claim that ran across two sentences came back as the second sentence alone, which hid the figure in the first. Fixed, with a test.

I timed the matcher on 29 real pages, because a free Cloudflare Worker allows very little processing per step. The largest page, a 157,000-character PDF, took 29 ms. I changed the matcher to check the whole page once for the exact words and to score only sentences that share words with the claim. The same page then took 9 ms, ordinary pages 2 to 3. That is why the Workflow checks one page per step.

## 11 November: the pipeline, and what the first real traces broke

With the pipeline built and passing its tests against stand-ins, I ran it on my machine against the four real reports. The first trace finished in 74 seconds with seven steps, including a linked press release the research run had not listed. It also broke things no stand-in had:

- **An undated step ended the trail as if it were the oldest.** It now sits with the dated step that follows it.
- **The verdict compared the highlight with whatever step came last.** It now uses the earliest confirmed step that has a date.
- **"About" becoming "nearly" was reported as a careful word dropped.** Careful words now come in kinds; swapping one for another of the same kind is not a drop.
- **A page that was read and did not hold the wording was credited to the page before it,** as if that page quoted it. That now happens only for a source that cannot be read itself, and only on a word-for-word quote.
- **A quotation got notes about figures and years** from pages that merely discuss it. A quotation's trail now carries none.
- **Every differing word was marked as changed.** Only the words a named change points at are marked now.

Each of these has a test that failed first.

## 11 November: the extension

The extension is small on purpose: one right-click entry, a side panel, and a marker on the page. The side panel does not draw the trail itself. It shows the markup the service draws, so the panel and the trail page cannot drift apart, and a fix to the page reaches the panel without a new install.

I checked it in a real browser by loading it and driving its panel: it loads, reads a highlight, shows a trail from the service, links to the full trail, refuses a highlight that is too short, and underlines the traced sentence with the verdict beside it. The current Chrome ignores the switch that loads an extension from the command line, so that check ran in Edge, which is the same engine. The right-click entry cannot be driven that way, so I tried it by hand in Chrome. It worked.

## 11 November: spending by accident

Before going live I looked for every way the service could spend money I had not agreed to. Three were real:

- If TinyFish refused to say how many research runs had been made today, the code fell through to a paid run. Now, not knowing means no run.
- If the note of a started run failed to save after the run had started, a retry would have started a second run. The run id is now saved before anything else.
- A run that could not be read at all was waited on for half an hour. A refusal now ends the wait at once.

I also gave Upstream its own daily reading budget of 500 pages. Fetch is free up to 1,000 pages a day on the account, and my other projects read with the same account.

## 11 November: live

Deployed to Cloudflare's free plan. The four trails were built on the live service from the morning's finished research runs, in 34 to 82 seconds each, with no step failing, the large PDFs included. Spend: $0.00. The paid reserve stays at 0 until a fresh trace has shown that a free run stays free.

## 11 November: a shallow trail was kept for ever

With the day's free deep searches used, I saw what a visitor gets: a trail from links only, marked "Not settled". That is honest. What was wrong came after it: the same sentence always opens the trail that exists, so that shallow trail would have been handed back the next day too, when the deep search was free again, and a visitor has no way to clear it.

Now a trail that finished without a deep search is traced afresh when the sentence is traced again on a later day. On the same day it still opens the saved trail, and when the day's limits leave no room for a new trace it opens the old one. A trail I listed on the first page is never cleared. The trail's summary also says what to do: trace the sentence again after midnight UTC.

## 11 November: a visitor from outside

I gave a fresh Claude (Sonnet) the address of the live site, curl, the README, and a limit of two new traces, and asked for a hard report. In 27 calls it checked two steps of two trails against their own source pages (both held the quoted wording) and scored the first impression 8 of 10, the trails 7, honesty about limits 7 and the API 6. What it found and I fixed, tests first:

- **Its two traces came back "Not settled" with no word on the page about why or what to do.** The day's deep searches were used. The trail's summary now says to trace the sentence again after midnight UTC, and the first page warns before a trace is started.
- **The footer said "0 deep searches" under four trails that each used one.** Those runs had been made before the trails were built, so nothing had counted them. A deep search is now counted for every trail that had one.
- **A trail with links only still said "TinyFish Fetch and Research".** It now names Research only when a deep search ran.
- **A trail with no step beyond the first page showed that page's own date as "the earliest step confirmed".** It now says "No steps back".
- **"4 of 4 steps back, confirmed on the page itself" included a 1981 newspaper that is not online.** A source known only because a later page quotes it is counted apart, shows no title, and opens the page that quotes it at the quoted sentence. Before, its link led to the newspaper's front page.
- **On an encyclopaedia page a whole paragraph was shown as the sentence.** Footnote marks such as [36] sat between the full stop and the next sentence. They are left out now.
- **The oldest step of one trail was cut off in the middle of a word.** The source is a PDF whose lines break inside words. Upstream now joins the lines around a sentence both ways, with a space and with nothing, and keeps the reading that fits better. On the real page the advertisement's sentence is now found word for word, and a second PDF that had been "not found" is found.
- **A step dated only "2011" ended a trail after steps dated April and May 2011.** A bare year or month now sorts as the end of that period.
- **PDF file names were shown as titles** ("Big Data Book3.indd"). A file name is no longer shown, and a long title is cut at a word.
- **The API was described only in the README, and the extension page was thin.** Both are on the site now.

Left as they are, on purpose: a scanned 1981 page whose text comes back with spaces inside words is shown as "found in slightly different words", which is what it is; and a page proposed by the deep search that does not hold the wording stays on the trail, marked as not found.

## 11 November: rounded, or changed?

Reading a road-safety page for a later trail, I saw Upstream call "1.16 million became 1.19 million" a rounding. It is not: both figures are given to the same precision, so one is simply a different figure. A change is now called rounded only when the newer figure is the older one written to fewer digits (87 as 90, 1,234 as 1,200). Anything else is "the figure changed".
