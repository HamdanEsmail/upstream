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
- [ ] `fragment.ts`: `sentenceLink(url, sentence)`; PDFs get the plain address.
- [ ] `cite.ts`: `citation(trail)` as plain text and Markdown.

## 2. Reading the web (`src/tinyfish/`, `src/archive.ts`)

- [ ] `client.ts`: one place that adds the key, records spend, and turns failures into typed errors.
- [ ] `fetch.ts`: `readPages(urls)` for up to 10 addresses with links, dates and authors.
- [ ] `research.ts`: `startResearch`, `readResearch` (status, pages read so far, the finished report).
- [ ] `archive.ts`: `savedCopy(url, nearDate)` and `firstSeen(url)`.

## 3. A trace (`src/trace/`, D1, Workflow)

- [ ] Migrations for `traces`, `steps`, `changes`, `events`, `spend`, `limits`.
- [ ] `create.ts`: validate, reuse an identical claim, apply the visitor and daily limits, start the Workflow.
- [ ] `follow.ts`: read the page, then follow links up to five steps deep.
- [ ] `deep.ts`: start the research run (free runs first, daily cap), poll with sleeps, record progress.
- [ ] `check.ts`: re-read every proposed step, fall back to the saved copy, set the reading.
- [ ] `finish.ts`: merge, order, compare, name changes, decide, store.
- [ ] `adopt.ts`: build a trail from a research run that already finished.

## 4. Routes and pages (`src/handlers/`, `src/site/`)

- [ ] `POST /api/traces`, `GET /api/traces/:id`, `GET /api/stats`, `POST /api/admin/adopt`.
- [ ] The trail page `/t/:id`, the panel page `/panel/:id`, the home page, "How it works".
- [ ] The waiting display: steps as they arrive, a clock, the usual time, pages read so far.
- [ ] Footer credit on every page, with a test.

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
