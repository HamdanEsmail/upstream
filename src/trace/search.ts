// The search: when the links run out, TinyFish Search is asked once for the sentence, and
// the pages it lists are read like any other. Free. A page only a search led to has no link
// to vouch for it, so it is kept only when it holds the sentence (see `findSure`) and can be
// shown to be older than the trail the links gave.
import { firstSeen } from "../archive";
import { FOLLOW_CHARS, SEARCH_ARCHIVE_LOOKUPS, SEARCH_KEEP, SEARCH_PAGES_PER_TRY, SEARCH_READ_MAX } from "../core/limits";
import { candidateLinks, siteName } from "../core/links";
import { findSure, type Found } from "../core/match";
import { sameAddress } from "../core/trail";
import type { Env } from "../env";
import { readPages, type PageRead } from "../tinyfish/fetch";
import { searchWeb } from "../tinyfish/search";
import { savedCopyAddress } from "./check";
import { addEvent, appendStep, getSteps, getTrace, markSearched, type StoredStep } from "./store";

/** A page keeps at most this many of its links. */
const LINKS_KEPT = 200;
/** The Internet Archive is given this long to say when it first saved a page. */
const ARCHIVE_WAIT_MS = 10_000;

const FULL_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The earliest full date among the steps, or null when none has one. */
function earliestDay(steps: StoredStep[]): string | null {
  let earliest: string | null = null;
  for (const s of steps) if (s.date !== null && FULL_DAY.test(s.date) && (earliest === null || s.date < earliest)) earliest = s.date;
  return earliest;
}

const wait = (ms: number): Promise<null> => new Promise((resolve) => setTimeout(() => resolve(null), ms));

/**
 * Asks Search for the highlighted sentence and returns the pages worth reading: those the
 * index dates oldest come first, and a page already in the trail, a social page or the
 * highlighted page itself is left out. When the trail has a dated step, only pages
 * published before the earliest one are asked for.
 */
export async function askSearch(env: Env, traceId: string, now: string): Promise<{ candidates: string[] }> {
  const trace = await getTrace(env.DB, traceId);
  if (!trace) throw new Error("trace_missing");
  const steps = await getSteps(env.DB, traceId);

  const asked = await searchWeb(env, trace.text, earliestDay(steps));
  if (!asked.ok) {
    await addEvent(env.DB, traceId, `The web search could not be asked (${asked.error}), so the trace goes on without it.`, now);
    return { candidates: [] };
  }
  await markSearched(env.DB, traceId, now);

  const visited = steps.map((s) => s.url).filter((u): u is string => u !== null);
  // Pages the index gives no date for keep the order it listed them in, after the dated ones.
  const oldestFirst = [...asked.listed].sort((a, b) => (a.day === b.day ? 0 : a.day === null ? 1 : b.day === null ? -1 : a.day < b.day ? -1 : 1));
  const candidates = candidateLinks(
    trace.pageUrl,
    [],
    oldestFirst.map((l) => l.url),
  )
    .filter((link) => !visited.some((v) => sameAddress(v, link)))
    .slice(0, SEARCH_READ_MAX);
  const count = candidates.length;
  await addEvent(env.DB, traceId, count === 0 ? "Searched the web for the sentence: nothing new was listed." : `Searched the web for the sentence: ${count} ${count === 1 ? "page" : "pages"} listed.`, now);
  return { candidates };
}

/**
 * The links of the oldest page Search found, for the link follower to carry on from: an
 * older page may link to where it got the sentence. Empty when Search found none.
 */
export async function linksFromSearch(env: Env, traceId: string): Promise<{ candidates: string[] }> {
  const steps = await getSteps(env.DB, traceId);
  let oldest: StoredStep | null = null;
  for (const s of steps) if (s.reachedBy === "search" && s.url !== null && s.date !== null && (oldest === null || s.date < (oldest.date as string))) oldest = s;
  if (oldest === null || oldest.url === null) return { candidates: [] };
  const visited = steps.map((s) => s.url).filter((u): u is string => u !== null);
  return { candidates: candidateLinks(oldest.url, oldest.links, []).filter((link) => !visited.some((v) => sameAddress(v, link))) };
}

type Hit = { page: Extract<PageRead, { ok: true }>; found: Found; date: string; dateSource: "page" | "archive" };

/**
 * Reads up to five of the pages Search listed and keeps those that hold the sentence and are
 * older than every step the links gave, the oldest first, three in all at most. A page that
 * gives no date is dated by the Internet Archive's first saved copy; one that cannot be
 * dated at all is not kept, because it cannot be shown to be older. `last` is true for the
 * final read of a trace, which says so when nothing was kept. Returns how many are kept so far.
 */
export async function readListed(env: Env, traceId: string, batch: string[], now: string, last = false): Promise<{ kept: number }> {
  const trace = await getTrace(env.DB, traceId);
  if (!trace) throw new Error("trace_missing");
  const steps = await getSteps(env.DB, traceId);
  let kept = steps.filter((s) => s.reachedBy === "search").length;
  const visited = steps.map((s) => s.url).filter((u): u is string => u !== null);
  const todo = batch.filter((link) => !visited.some((v) => sameAddress(v, link))).slice(0, SEARCH_PAGES_PER_TRY);

  const hits: Hit[] = [];
  if (kept < SEARCH_KEEP && todo.length > 0) {
    const earliest = earliestDay(steps.filter((s) => s.reachedBy !== "search"));
    let lookups = 0;
    for (const page of await readPages(env, todo)) {
      if (!page.ok) continue;
      const found = findSure(page.text.slice(0, FOLLOW_CHARS), trace.text);
      if (found.reading === "not_found") continue;
      let date = page.date;
      let dateSource: Hit["dateSource"] = "page";
      if (date === null && lookups < SEARCH_ARCHIVE_LOOKUPS) {
        lookups++;
        date = await Promise.race([firstSeen(page.url), wait(ARCHIVE_WAIT_MS)]);
        dateSource = "archive";
      }
      if (date === null || (earliest !== null && date >= earliest)) continue;
      hits.push({ page, found, date, dateSource });
    }
  }

  hits.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const { page, found, date, dateSource } of hits.slice(0, SEARCH_KEEP - kept)) {
    // When the address Search gave is itself an Internet Archive copy, say so.
    const saved = savedCopyAddress(page.url);
    await appendStep(env.DB, traceId, {
      url: page.url,
      publisher: siteName(page.url),
      title: page.title,
      date,
      dateSource,
      wording: found.sentence,
      reading: found.reading,
      readFrom: saved ? "archive" : "live",
      archiveUrl: saved ? page.url : null,
      reachedBy: "search",
      namesSource: null,
      quotedBy: null,
      links: page.links.slice(0, LINKS_KEPT),
      readAt: now,
    });
    await addEvent(env.DB, traceId, `The search led to ${siteName(page.url)}: found ${found.reading === "exact" ? "word for word" : "in slightly different words"}.`, now);
    kept++;
  }
  if (last && kept === 0) await addEvent(env.DB, traceId, "None of the pages the search listed is an older page that holds the sentence.", now);
  return { kept };
}
