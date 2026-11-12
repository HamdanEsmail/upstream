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

## 11 November: the fixes go live

Deployed. I then rebuilt the four trails one at a time from the same finished research runs, so the first page was never empty: each came back with the verdict it had before, in 26 to 70 seconds. The trail about the world's data now reads 7 of 7 steps found on their own pages and ends on the 2011 advertisement, word for word. The trail links in the README are new because a rebuilt trail gets a new address. Spend is still $0.00.

## 11 November: the verdict landed inside a word

Preparing the film, I read again what the extension draws on the page when a trail is done. It looked for the first 80 characters of the sentence, underlined those, and put the verdict tag where they ended. On any sentence longer than that, the underline stopped short and the tag sat in the middle of the sentence, often inside a word. My check in a real browser had only asked whether a tag and an underline existed, not where.

Now it looks for the whole sentence first. If the page does not hold it in one piece, it finds the opening words and then the closing words after them, and never stops inside a word. The browser check now asks for the whole sentence to be underlined and the tag to follow it, in four cases: a plain paragraph, one that runs through other elements, a page that words the middle of the sentence differently (so only the opening and closing words can be found), and a page that holds the opening words alone (where the mark must end at the end of a word). All four pass.

The fix to the mark went live the same afternoon. I downloaded the zip from the live site and compared its panel script with the one in this repository: identical.

## 11 November: the citation pointed at the wrong step

Filming "Cite it right", I read the citation the panel offered for the time-indoors trail. It pointed at an undated agency PDF, not at the 2001 survey the verdict rests on. The citation took the last confirmed step in the list, and since the PDF fix that list ends on an undated page that had been "not found" before.

The citation now points at the earliest dated step that was confirmed, the same step the verdict and the tally name. With no dated step it falls back to the last confirmed one.

It went live the same evening. I read all four trails before and after: the time-indoors citation now names the 2001 survey and quotes its 87%, and the other three are word for word what they were.

## 11 November: a time that was not the search's

The four trails on the first page were built from deep searches that had already finished, so I did not pay or wait for the same run twice. Their facts row showed how long that rebuilding took: "39 s" above "26 pages read by the deep search". Read together, the two say the deep search took 39 seconds. It takes 4 to 6 minutes. I saw it while checking a frame of the film.

A trail built that way now states no time. The row shows "26 pages" and "read by the deep search", and the API gives `seconds` as null. A trail traced fresh keeps its real time.

It is live. I read the row on all four trails, on the page and in the markup the extension's panel loads, and retook the picture at the top of the README, which showed the old row.

## 11 November: a free run taken on trust

Checking what TinyFish says about free research runs, I found that its API reference no longer mentions them, while its pricing page still does. My four runs this morning were not charged. That sent me back to my own code, and it had a hole: Upstream counted a run as free because fewer than two had been made that day, wrote $0 in its books, and never looked at the wallet. Had TinyFish charged for those runs, the site would have gone on showing $0.00 while paying $2 a trace.

Now Upstream reads the account's wallet before a free run and again a minute after the trail is done, so no visitor waits for it.

- A fall of $2 or more means the run was charged. It is booked at $2 and never more, because my other projects spend from the same wallets. It takes a place in the reserve, and from then on no run is called free: a deep search is started only when the reserve can pay for it. The charge is counted even when the reserve is 0, so a reserve I set later pays for one run fewer and the total stays what I agreed to.
- A wallet that cannot be read before the run means no free run is started.
- A wallet that cannot be read afterwards, or that went up because I topped it up, can no longer say what the run cost. That run is booked at $2.

The first page and the trail no longer promise that the deep search is "back at midnight" when it has been switched off this way.

One limit remains. A charge that reaches the wallet more than a minute after the trail is done is not seen. TinyFish's reference says a run is charged when it completes.

It went live the same evening: three new columns on the live database first, then the deploy. The four trails and the numbers in the footer read the same before and after. I ran one trace on the live site to see the changed steps work against the live database. The day's free runs were used, so it followed links only, finished in 7 seconds and cost nothing, and I removed it afterwards. The wallet reading itself runs for the first time with the next free run; I checked that both accounts' wallets answer in the shape the code reads.

## 11 November: fifty requests, and a charge that came late

Two things I learned the same night changed this again, before any deep search had run on the live site.

**Fifty requests.** Reading Cloudflare's limits for another project, I saw that the free plan allows one Workflow run 50 requests to other hosts, and I counted what a full trace makes: the page, the links, the start of the deep search, a read of it every 15 seconds for 4 to 6 minutes, and up to five requests for each step it proposes. A typical trace comes to about 45. A slow search or a trail with many archived pages goes past 50, and the trace would have broken in the middle. The four trails on the first page never met this, because they were built from searches that had already finished. Another project of mine had broken on the same limit the day before.

A trace is now carried by several runs, one after another. The first reads the page, follows links and starts the deep search. A waiting run reads the search 40 times and hands on to the next. A checking run checks eight proposed steps and hands on. The last one does the books. Each run stays under 45 requests whatever the trace needs; a test runs a 25-minute search with twelve hard steps and counts them. A hand-over that is tried twice cannot start two runs, and one that fails marks the trace as broken, so it never shows as working for ever.

**A charge that came late.** A small TinyFish charge on my other account reached the wallet some minutes after its run had ended. So the wallet is now read ten minutes after the trail is done, not one. And a trace that breaks after its deep search has started is booked all the same: before, such a run was never looked at again.

One limit remains. A charge that reaches the wallet later than ten minutes after the trail is done is not seen, and neither is a search that is given up after 30 minutes and completes later.

It is live. To see the hand-overs on the real platform I built one test trail on the live site from a search that had already finished, under a throwaway sentence. Cloudflare's list showed its four runs, one after another: the first, `-wait-0`, `-check-0` and `-book`. The trail came out with the same steps and verdict as the one on the first page. I took it off the first page at once and removed it afterwards. What this does not show is a trace that needs more than 50 requests: that comes with the first slow search.

## 12 November: the first search of the day was charged

Until now every deep search behind a trail had been one of TinyFish's free runs: two a day on an account. I had built the wallet check the evening before because TinyFish's reference had stopped mentioning them, and I wanted one fresh trace on the live site to see the whole path work.

I started it a little after 03:00 UTC, the first research run of the day on either account: a sentence about 123.2 million forcibly displaced people, highlighted on a page that links to the UN refugee agency.

**What worked.** The trace ran from start to finish on the live service for the first time: four background runs, one after another, 7 minutes 18 seconds, 19 pages read by the deep search. The verdict is "Matches the original". The agency's own page carries the sentence word for word, and its June 2025 report gives the same figure. It is the fifth trail on the first page, and the first one where nothing changed on the way.

**What it cost.** I read both wallets by hand as well. Two minutes after the trail was done the main wallet had not moved. Five minutes after, it was $2 lower. TinyFish's pricing page, read the same hour, no longer lists free research runs: a run is $2.

Upstream found it without me. Ten minutes after the trail was done it read the wallet again, saw a fall of $2.01 against the reading it took before the run, booked the run at $2 and stopped calling runs free. The footer of every page went from $0.00 to $2.00, and the trail's own log says the search was started as a free one and was charged.

**What I changed.** The service was right and its words were wrong. The page about how it works still said the deep search is free four times a day.

- That page now says what a deep search costs, how much is set aside for them, and what happened on 12 November.
- The first page used to warn that no deep search was to be had only after a visitor had started a trace that day and got links only. Once a run has been charged, the reserve alone decides, so the page now knows before anyone tries: it says how many more deep searches the reserve pays for, or that the money set aside is used up and the saved trails show what a full search finds.
- A trail made without a deep search says the same, and no longer speaks of free runs or of midnight.

The free-run code is still there. It is what found the change, and on a database where no run has been charged it would find it again on the first run.

**What I did not do.** I had two more claims ready, both checked beforehand without cost. Each would now be $2, so I left them. And a deep search paid from the reserve has still not run on the live service: the tests cover it, but the first real one will be a visitor's.

One visitor can start six traces an hour, so one visitor can use the whole reserve. I have left that as it is and say so here.
