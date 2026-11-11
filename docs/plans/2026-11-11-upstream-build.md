# Upstream: build plan

Design: `../specs/2026-11-11-upstream-design.md`. I work through this list in order and tick each item when its tests pass. Every item starts with a failing test.

## 1. The pure core (`src/core/`, no network, no database)

- [x] `text.ts`: `normalise`, `sentences`, `numbers` (digits, number words, percent, million and billion), `years`, `contentWords`.
- [x] `match.ts`: `findClaim(pageText, claim)` returns the reading (`exact`, `close`, `not_found`) and the page's own sentence.
- [x] `diff.ts`: `wordDiff(older, newer)` as same, removed and added runs.
- [x] `changes.ts`: `namedChanges(older, newer)` for `rounded`, `number_changed`, `careful_word_dropped`, `year_dropped`.
- [x] `report.ts`: `readTrail(report)` reads the closing block of a research report, cuts addresses at whitespace, rejects bracketed wording, tidies dates, and returns null when the block is missing or broken.
- [x] `links.ts`: `candidateLinks(pageUrl, links, near)` drops navigation and social links, puts the links near the highlight first, keeps 10.
- [x] `trail.ts`: `sameAddress`, `mergeSteps`, `orderSteps`, `reachedBy`.
- [x] `verdict.ts`: `decide(...)` with the precedence in the design, and which end it reached (the original or the earliest copy).
- [x] `fragment.ts`: `sentenceLink(url, sentence)`; PDFs get the plain address.
- [x] `cite.ts`: `citation(trail)` as plain text and Markdown.

## 2. Reading the web (`src/tinyfish/`, `src/archive.ts`)

- [x] `client.ts`: one place that adds the key for the chosen account and turns failures into typed errors. Spend is recorded where a paid run is started.
- [x] `fetch.ts`: `readPages(urls)` for up to 10 addresses with links, dates and authors.
- [x] `research.ts`: `startResearch`, `readResearch` (status, pages read so far, the finished report).
- [x] `archive.ts`: `savedCopy(url, nearDate)` and `firstSeen(url)`.

## 3. A trace (`src/trace/`, D1, Workflow)

- [x] Migrations for `traces`, `steps`, `changes`, `events`, `spend`, `limits`.
- [x] `create.ts`: validate, reuse an identical claim, apply the visitor and daily limits, start the Workflow.
- [x] `follow.ts`: read the page, then follow links up to five steps deep.
- [x] `deep.ts`: start the research run (free runs first, daily cap), poll with sleeps, record progress.
- [x] `check.ts`: re-read every proposed step, fall back to the saved copy, set the reading.
- [x] `finish.ts`: merge, order, compare, name changes, decide, store.
- [x] `adopt.ts`: build a trail from a research run that already finished.

## 4. Routes and pages (`src/handlers/`, `src/site/`)

- [x] `POST /api/traces`, `GET /api/traces/:id`, `GET /api/stats`, `POST /api/admin/adopt`.
- [x] The trail page `/t/:id`, the panel page `/panel/:id`, the home page, "How it works".
- [x] The waiting display: steps as they arrive, a clock, the usual time, pages read so far.
- [x] Footer credit on every page, with a test.

## 5. The extension (`extension/`)

- [ ] Manifest, the right-click entry, reading the selection and the links in its paragraph.
- [ ] The side panel that opens the service's panel page for the new trace.
- [ ] The underline and verdict on the page when the trace finishes.
- [ ] A zip that installs with "Load unpacked", and a short install page.

## 6. Proof

- [ ] Deploy, then trace the demo claims for real and keep their pages.
- [ ] A test by someone who has never seen it; fix what is really broken.
- [ ] README with a real screenshot, the build log, the runbook.
- [ ] The film and the submission texts.

## Notes from running the core over four real traces (11 November)

I ran the finished core over four real research reports and the live pages they cite. All 19 addresses were read, and 15 of the 19 steps were confirmed word for word or closely. What it taught me, for sections 3 and 4:

- Compare sentences for changes in two places only: the earliest confirmed sentence against the highlighted one (this feeds the verdict), and neighbouring steps whose sentences restate each other. A page that discusses a claim, such as a fact-check, is not a restatement; comparing it gives noise such as a stray year.
- A step whose address is a site's front page, or whose page does not hold the wording, is looked for in the other pages already read. If one of them quotes it, the step is `offline` and the wording is credited to that page.
- The page's own date wins over the date in the report. They differed on two of the four start pages.
- In PDFs the wording is often not found word for word. The step stays, marked as not found on the page.
- A claim that runs across two sentences must return both. Fixed, with a test.
