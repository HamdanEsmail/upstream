# Upstream: design

*Submission for the TinyFish Student Bounty Drop 002 "Source Hunter" bounty. Written 2026-11-11. Deadline 2026-11-17. The name: you follow a claim upstream until you reach the spring it came from.*

## 1. Intent

A number gets repeated in a hundred articles and nobody checks where it came from. Upstream is the button to click before quoting it. You highlight a number, a claim or a quotation on any page, click once, and Upstream follows it back, step by step, to where it first appeared. Every step is a real page with its link, its date and its exact wording. Between steps it shows what changed. At the end it gives one verdict, including a plain "no original source" when that is the truth.

Judges weigh, in this order: how deep the trail goes, how accurate each step is, the judgement about the claim, the experience while reading, and honesty when the origin cannot be found. The demo must show at least five real claims, one of them wrong, and TinyResearch must do essential work.

## 2. Goals, non-goals, anti-goals

**Goals**
- A Chrome extension: highlight text, right-click "Trace upstream", and a side panel shows the trail growing.
- A hosted service, so anyone can trace a claim of their own with nothing to run locally, and a page where a claim can be pasted without the extension.
- A public page for every trail (`/t/<id>`), readable without installing anything.
- Two engines. A link follower that works in seconds with free TinyFish Fetch, and TinyResearch behind it for the wider search when links stop.
- Every step re-read by Upstream itself. A step shows the sentence Upstream found on the page, never a sentence it was only told about.
- Changes between steps named by code: rounded, number changed, careful word dropped, year dropped.
- Two honest distinctions on every trail: a step the previous page really links to against one found by search, and the original against the earliest copy found.
- Saved copies from the Internet Archive when a page is gone or cut short, and its "first seen" date when a page shows none.
- "Cite it right": one click copies a citation that points at the original.

**Non-goals**
- Firefox. The bounty accepts either browser; I build for Chrome.
- Pages behind a login or a paywall. If a page cannot be read, the step says so.
- Marking claims on every page you visit. That would need permission to read all your browsing, which this tool does not ask for.
- Judging whether a claim is true in the world. Upstream reports where it came from and what changed on the way.

**Anti-goals**
- A trail that looks complete and is not. An unread step, an unverified link or a guessed date is labelled as such.
- Naming the most popular copy as the origin.
- A five-minute wait with nothing on screen.
- A demo that only replays saved cases. A judge can trace a new claim.

## 3. Constraints and verified facts

Verified on 2026-11-11 with free TinyFish calls; scripts and saved responses are in `../spikes/upstream-tests/`.

**TinyResearch**
- Enabled on both of my accounts. Two completed runs a UTC day are free on each, then $2 a run. Four runs today left both wallets unchanged.
- `POST /v1/automation/run-research-async` returns a run id; `GET /v1/research-run/<id>` returns the status and the evidence gathered so far, which fills in while the run is still going. So progress can be shown live.
- Four traces took 208, 261, 301 and 372 seconds, searched 155 to 248 pages each and read 19 to 26.
- Asked to end the report with one fenced `json` block in a fixed shape, all four runs did, and all four parsed.
- The run's own `linked` flags and dates are not reliable. It marked a quote page as linking to a source it does not link to, and gave dates that differ from the pages' own. Upstream works both out itself.
- Some steps it names cannot be read online: a 1981 newspaper article, a 1960 book, a 1989 printed report. These came back with a homepage address, a shop page or a bracketed note in place of wording.
- A saved run is 110 to 130 KB and parses in under a millisecond.

**TinyFish Fetch (free, up to 10 addresses a call, 1,000 a day)**
- Returns title, author and `published_date` for most pages.
- Strips links out of the text in every format. With `links: true` it returns a flat list of the page's links, without link text or position. `include_selectors: ["article", "main"]` narrows both text and links to the article.
- `format: "json"` returns a clean tree of headings and paragraphs.
- Re-reading the 29 sources of an earlier trace: all 29 were read, 3 of them PDFs; the claim's number was found again on 25; 20 carried a date.
- PDF text can come back flattened, with labels and figures separated.

**Internet Archive (free, no key)**
- `archive.org/wayback/available` returns the saved copy closest to a date, and Fetch reads that copy. A 2015 magazine page that is cut short today was read in full from its May 2015 copy.
- The CDX search returns the first time a page was saved.

**Cloudflare Workers free plan**
- 50 outside requests per invocation and little CPU time per step, so each Workflow step does one small thing, and one Fetch call carries up to 10 addresses. Matching a claim against a page was timed on real pages and made cheap: 2 to 3 ms for an ordinary page, 9 ms for a 157,000-character PDF. Pages are read up to 120,000 characters.
- No cron slot is needed. The Workflow sleeps and checks back.

## 4. Architecture

One Cloudflare Worker (Hono, hono/jsx, D1, Workflows) on my first Cloudflare account, plus a Chrome extension that talks to it.

### 4.1 A trace, step by step

1. **Start.** `POST /api/traces` with the page address, the highlighted text and, from the extension, the links that sit in the same paragraph. An identical claim on the same page returns the trail that already exists.
2. **Read the page.** Fetch the page with its links. Find the highlighted sentence on it. This is step 1 of the trail.
3. **Follow the links.** Take the links near the highlight first, then the article's other outside links, drop navigation and social links, and fetch up to 10 in one call. A linked page that states the claim becomes the next step, marked *linked*. Repeat from that page, up to five steps deep. This pass takes seconds and the trail is already on screen.
4. **Search wider.** Start a TinyResearch run with the page, the highlight and the steps found so far. While it runs, the Workflow checks every 15 seconds and records how many pages it has read, so the panel can say so.
5. **Check what it proposes.** Read the closing `json` trail. Fetch every proposed step, one page per Workflow step. Keep the sentence Upstream finds on the page; if the live page lacks it, try the Internet Archive copy nearest the step's date. A source that cannot be read itself (only in print, or given as a site's front page) is credited to an earlier step that quotes it word for word. A page that cannot be processed at all is kept as unreadable; it costs one step, not the trail.
6. **Put the trail together.** Merge both engines' steps by address, order them from the highlighted page back to the earliest, and work out for each step how it was reached and how sure the reading is. A step with no date sits with the dated step that follows it, so it never ends the trail as if it were the oldest.
7. **Compare and decide.** Compare the earliest confirmed, dated sentence with the highlighted one, and neighbouring sentences where one restates the other; name the changes, and set the verdict. A quotation's trail carries no notes about figures or years: its pages discuss the quote rather than restate it.

### 4.2 What a step records

- **Address, publisher, title.**
- **Date and where the date came from:** the page itself, the Internet Archive's first saved copy, or the research run (shown as "date given by the research run").
- **Wording:** the sentence found on the page.
- **Reading:** `exact` (found word for word), `close` (same number and most of the words; the page's own sentence is shown), `not_found` (page read, claim not on it), `unreadable` (page could not be read), `offline` (named by another step and not readable online; the wording is credited to the page that quotes it).
- **Read from:** the live page or a saved copy, with the copy's date.
- **Reached by:** `link` (the previous page links to it, checked against that page's links), `named` (the previous page names it without a link), `search` (found by search).
- **Kind of document** for the last step: study, report, dataset, book, speech, interview, or a copy.

"Open at the sentence" is a link that opens the page scrolled to the sentence and highlights it (a browser text fragment). For PDFs the link opens the file; I do not promise the highlight there.

### 4.3 Changes

Worked out by code from two confirmed sentences, and labelled as such:
- `rounded`: the newer figure is the older one written to fewer digits (87 percent became 90 percent).
- `number_changed`: the figures differ in any other way, the same precision included (1.16 million became 1.19 million).
- `careful_word_dropped`: a word such as about, nearly, up to, at least, a minimum of, may, estimated is in the older sentence and missing from the newer one.
- `year_dropped`: the older sentence carries a year and the newer one does not, or gains "now" or "today".

Changes the research run describes and code cannot check (the group of people, the speaker) are shown under "noted by the research run".

### 4.4 Verdict

One headline, chosen in this order of precedence:
1. **Said by someone else**: a quotation whose earliest confirmed appearance has a different speaker or author.
2. **No original source**: the trail ends on a page that gives no source, and no study, report or dataset was confirmed.
3. **Changed on the way**: an original was confirmed and the claim differs from it in number or in a careful word.
4. **Out of date**: an original was confirmed, the claim reads as current, and the original is five or more years old.
5. **Matches the original**: an original was confirmed and the claim agrees with it.
6. **Not settled**: the steps that matter could not be read.

The verdict line always says which it reached: the original, or the earliest copy found.

### 4.5 Routes

| Route | What it does |
|---|---|
| `POST /api/traces` | Start a trace, or return the existing one |
| `GET /api/traces/:id` | The trail as JSON: status, progress, steps, changes, verdict |
| `GET /t/:id` | The public trail page |
| `GET /api/traces/:id/fragment` | The trail's markup alone, which the side panel shows |
| `POST /trace` | The form on the first page; redirects to the trail |
| `GET /` | Trace a claim, traced so far, get the extension, how it works |
| `GET /api/stats` | Traces, steps read, spend |
| `POST /api/admin/adopt` | Admin only: build a trail from a research run that already finished, by run id and account |
| `POST /api/admin/traces/:id/feature` | Admin only: list a trail on the first page, or take it off |
| `DELETE /api/admin/traces/:id` | Admin only: remove a trail |

### 4.6 The extension

Manifest V3. Permissions: `activeTab`, `scripting`, `contextMenus`, `sidePanel`, `storage`, and the service's own address. It reads the page only when I click, and sends only the highlighted text, the page address and the links in that paragraph. The side panel shows the trail markup the service draws, so the trail looks the same everywhere and a fix does not need a new install. When a trace finishes, the highlighted sentence on the page gets an underline and the verdict beside it.

### 4.7 While it waits

The panel shows steps as they arrive, a clock, the usual time ("4 to 6 minutes for the deep search"), and what the deep search is doing ("24 pages read so far"). The first step is on screen within seconds.

### 4.8 Look

Its own world, "The Line": the trail is a river drawn like a line map, one stop per source, a solid line where a page links on and a dashed line where the next step was found by search, a black square where the trail goes cold. Warm white ground, ink borders, one water blue for the line, one rust tone for changed words. Newsreader for the quoted wording, Instrument Sans for everything else. The look sheet is in `../spikes/upstream-look/`.

## 5. Data model (D1)

- `traces`: id, page_url, text, text_key (for reuse), near (the links in the highlighted paragraph), status, verdict, reached (original or earliest copy), summary, research_run_id, research_account, pages_read and latest_hosts (for the waiting display), report, proposed, spend_usd, featured, created_at, finished_at, error.
- `steps`: trace_id, position, url, publisher, title, date, date_source, wording, reading, read_from, archive_url, reached_by, names_source, quoted_by, links, read_at.
- `staged_steps`: the steps the deep search proposed, each checked on its own, waiting to be merged.
- `changes`: trace_id, from_position, to_position, kind, detail, basis (code or research run).
- `events`: trace_id, at, message. The progress log the panel reads.
- `spend`: at, kind, amount_usd, ref.
- `limits`: day, counter name, count.

## 6. Security, privacy and spend

- The TinyFish keys live only in the Worker's secrets. The extension holds no key.
- Starting a trace is public, so it is limited: text of 12 to 600 characters, a public http or https address, 6 new traces per visitor per hour and 40 a day overall. Upstream reads at most 500 pages a day, because my other projects read with the same free allowance, and starts no new trace when fewer than 40 reads are left.
- Only trails I choose are listed on the first page. A visitor's own trace is reachable by its link alone.
- Deep searches: free runs are used first, on my main account and then on my second. After that a run is paid for from a fixed reserve (`PAID_DEEP_BUDGET_USD`, $6 in all). When both are used, a trace still runs the link follower and says plainly that the deep search is back the next day; the first page warns of it before a trace is started, and a trail made that way is traced afresh when its sentence is traced again on a later day. If TinyFish will not say how many runs were made today, no run is started: not knowing is never a reason to spend. The run id is saved before anything else, so a retried step cannot start a second run.
- Admin routes need a token.
- Nothing about a visitor is stored beyond the claim and the page address they chose to trace.

## 7. Demo and proof

Five or more real claims, each highlighted on a real page that states it as fact, covering different verdicts. Tested so far, as starting points: a "90 percent of time indoors" line (six steps, back to a 2001 study that measured 87 percent), a "90% of the world's data" line (six steps, back to a 2011 advert with no data behind it), a famous misattributed quotation (earliest appearance 1981), the 21-day habit rule (a 1960 book that said "a minimum of about 21 days"), and the 8-second attention span (no original source). Still to find: a claim that simply matches its original.

The film shows a live trace from highlight to verdict.

## 8. Testing

Vitest in the Workers pool. Tests never touch the network; TinyFish and the Internet Archive are replaced by fakes. The matching, comparing, change-naming, verdict, trail-merging, report-reading, text-fragment and citation code are pure functions with their own tests. Fixtures are invented pages and invented names. The report reader is tested against awkward input: an address followed by a note, bracketed wording, a missing or broken closing block.

## 9. Delivery order

1. The pure core: text, matching, comparing, changes, verdict, report reader.
2. TinyFish and Internet Archive clients, the Workflow, the database.
3. The API, the trail page, the panel page, the home page.
4. The extension.
5. The demo traces, run for real.
6. A test by someone who has never seen it, and fixes.
7. The film and the submission texts.

## 10. Left open in this design

- Whether the README names the well-known people and organisations that demo claims are about.
- A "check this page" button that marks every number in an article as linked or not. Only after everything above works.
- Offering the extension through the Chrome Web Store as well as a zip.

## 11. Repository conventions

TypeScript, ESM, strict. Hono 4 with hono/jsx. No new dependencies. `npm run check` runs the type check, the tests and a dry-run deploy. Secrets stay in `.dev.vars` and are never committed. Every page footer says "Built by Hamdan Esmail" with a link to my GitHub.
