// The fast engine: read the highlighted page, then follow its links to pages that state
// the same claim. Free, and each try is one TinyFish Fetch call.
import { FOLLOW_CHARS, FOLLOW_PAGES_PER_TRY } from "../core/limits";
import { candidateLinks, siteName } from "../core/links";
import { findClaim, type Found } from "../core/match";
import { sameAddress } from "../core/trail";
import type { Env } from "../env";
import { readPages, type PageRead } from "../tinyfish/fetch";
import { addEvent, appendStep, getSteps, getTrace, saveSteps, type StoredStep } from "./store";

/** A page keeps at most this many of its links. */
const LINKS_KEPT = 200;

/** Reads the highlighted page and stores it as the first step. Returns the links worth following. */
export async function readStart(env: Env, traceId: string, now: string): Promise<{ candidates: string[] }> {
  const trace = await getTrace(env.DB, traceId);
  if (!trace) throw new Error("trace_missing");
  const [page] = await readPages(env, [trace.pageUrl]);

  const step: StoredStep = {
    url: trace.pageUrl,
    publisher: siteName(trace.pageUrl),
    title: null,
    date: null,
    dateSource: null,
    // What the reader highlighted; replaced below by the page's own sentence when it is found.
    wording: trace.text,
    reading: "unreadable",
    readFrom: null,
    archiveUrl: null,
    reachedBy: "start",
    namesSource: null,
    quotedBy: null,
    links: [],
    readAt: now,
  };
  let message = "Could not read the page you highlighted. The trace works from the highlight itself.";
  if (page && page.ok) {
    const found = findClaim(page.text, trace.text);
    step.title = page.title;
    step.date = page.date;
    step.dateSource = page.date ? "page" : null;
    step.wording = found.sentence ?? trace.text;
    step.reading = found.reading;
    step.readFrom = "live";
    step.links = page.links.slice(0, LINKS_KEPT);
    message =
      found.reading === "not_found"
        ? "Read the page. The highlighted words were not found in its text, so the trace works from the highlight itself."
        : "Read the page you highlighted.";
  }
  await saveSteps(env.DB, traceId, [step]);
  await addEvent(env.DB, traceId, message, now);
  return { candidates: candidateLinks(trace.pageUrl, step.links, trace.near) };
}

/**
 * Reads up to five linked pages and keeps the one that states the claim best. The claim is
 * looked for as highlighted first, then as the latest step words it.
 */
export async function followOnce(env: Env, traceId: string, candidates: string[], now: string): Promise<{ found: boolean; candidates: string[] }> {
  const trace = await getTrace(env.DB, traceId);
  if (!trace) throw new Error("trace_missing");
  const steps = await getSteps(env.DB, traceId);
  const visited = steps.map((s) => s.url).filter((u): u is string => u !== null);
  const fresh = (link: string) => !visited.some((v) => sameAddress(v, link));
  const todo = candidates.filter(fresh).slice(0, FOLLOW_PAGES_PER_TRY);
  if (todo.length === 0) return { found: false, candidates: [] };

  const latest = steps[steps.length - 1]?.wording ?? null;
  const claims = latest !== null && latest !== trace.text ? [trace.text, latest] : [trace.text];
  let best: { page: Extract<PageRead, { ok: true }>; found: Found; rank: number } | null = null;
  for (const page of await readPages(env, todo)) {
    if (!page.ok) continue;
    const head = page.text.slice(0, FOLLOW_CHARS);
    for (const claim of claims) {
      const found = findClaim(head, claim);
      if (found.reading === "not_found") continue;
      const rank = (found.reading === "exact" ? 2 : 1) + found.score / 10;
      if (best === null || rank > best.rank) best = { page, found, rank };
      break;
    }
  }
  if (best === null) return { found: false, candidates: [] };

  const { page, found } = best;
  await appendStep(env.DB, traceId, {
    url: page.url,
    publisher: siteName(page.url),
    title: page.title,
    date: page.date,
    dateSource: page.date ? "page" : null,
    wording: found.sentence,
    reading: found.reading,
    readFrom: "live",
    archiveUrl: null,
    reachedBy: "link",
    namesSource: null,
    quotedBy: null,
    links: page.links.slice(0, LINKS_KEPT),
    readAt: now,
  });
  await addEvent(env.DB, traceId, `Followed a link to ${siteName(page.url)}.`, now);
  return { found: true, candidates: candidateLinks(page.url, page.links, []).filter((link) => fresh(link) && !sameAddress(link, page.url)) };
}
