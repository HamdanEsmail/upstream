// Nothing the deep search proposes is shown on its word. Each step is read again here,
// one page per call, and keeps only the sentence found on the page.
import { firstSeen, savedCopy } from "../archive";
import { PROPOSED_MAX } from "../core/limits";
import { siteName } from "../core/links";
import { findClaim } from "../core/match";
import { readTrail, type ProposedTrail } from "../core/report";
import { sameAddress } from "../core/trail";
import type { Env } from "../env";
import { readPages } from "../tinyfish/fetch";
import { addEvent, getSteps, getTrace, stageStep, updateTrace, type StoredStep, type Trace } from "./store";

/** A page keeps at most this many of its links. */
const LINKS_KEPT = 200;

export function proposedOf(trace: Trace): ProposedTrail | null {
  if (trace.proposed === null) return null;
  try {
    return JSON.parse(trace.proposed) as ProposedTrail;
  } catch {
    return null;
  }
}

/** Reads the trail out of the finished report and returns how many steps there are to check. */
export async function loadProposed(env: Env, traceId: string, now: string): Promise<number> {
  const trace = await getTrace(env.DB, traceId);
  if (!trace) throw new Error("trace_missing");
  const trail = trace.report === null ? null : readTrail(trace.report);
  if (trail === null) {
    await addEvent(env.DB, traceId, "The deep search returned no trail that could be read.", now);
    return 0;
  }
  const kept: ProposedTrail = { ...trail, steps: trail.steps.slice(0, PROPOSED_MAX) };
  await updateTrace(env.DB, traceId, { proposed: JSON.stringify(kept) });
  await addEvent(env.DB, traceId, `Checking the ${kept.steps.length} steps it proposed, one page at a time.`, now);
  return kept.steps.length;
}

/** Checks the proposed step at `index` and puts the result aside for the finish. */
export async function checkProposed(env: Env, traceId: string, index: number, now: string): Promise<void> {
  const trace = await getTrace(env.DB, traceId);
  if (!trace) throw new Error("trace_missing");
  const trail = proposedOf(trace);
  const p = trail?.steps[index];
  if (!trail || !p) return;

  // A page the link follower already read is not read again.
  const known = p.url === null ? undefined : (await getSteps(env.DB, traceId)).find((s) => s.url !== null && sameAddress(s.url, p.url as string));
  if (known) {
    await stageStep(env.DB, traceId, index, { ...known, namesSource: known.namesSource ?? p.namesSource });
    return;
  }

  const step: StoredStep = {
    url: p.url,
    publisher: p.publisher !== "" ? p.publisher : siteName(p.url),
    title: null,
    date: p.date,
    dateSource: p.date ? "research" : null,
    wording: null,
    reading: p.url === null ? "offline" : "unreadable",
    readFrom: null,
    archiveUrl: null,
    reachedBy: "search",
    namesSource: p.namesSource,
    quotedBy: null,
    links: [],
    readAt: now,
  };
  const site = p.url === null ? step.publisher : siteName(p.url);
  let message = p.url === null ? `${site} is not readable online.` : `Checked ${site}: the page could not be read.`;

  if (p.url !== null) {
    const [page] = await readPages(env, [p.url]);
    if (page && page.ok) {
      step.title = page.title;
      step.links = page.links.slice(0, LINKS_KEPT);
      if (page.date) {
        step.date = page.date;
        step.dateSource = "page";
      }
      step.reading = "not_found";
      message = `Checked ${site}: the wording was not found on the page.`;
      const found = p.wording === null ? null : findClaim(page.text, p.wording);
      if (found && found.reading !== "not_found") {
        step.wording = found.sentence;
        step.reading = found.reading;
        step.readFrom = "live";
        message = `Checked ${site}: found ${found.reading === "exact" ? "word for word" : "in slightly different words"}.`;
      }
    }

    // A page that is gone or changed may still say it in a saved copy.
    if (step.wording === null && p.wording !== null) {
      const copy = await savedCopy(p.url, p.date);
      const [saved] = copy === null ? [] : await readPages(env, [copy.url]);
      const found = saved && saved.ok ? findClaim(saved.text, p.wording) : null;
      if (copy !== null && found && found.reading !== "not_found") {
        step.wording = found.sentence;
        step.reading = found.reading;
        step.readFrom = "archive";
        step.archiveUrl = copy.url;
        message = `Checked ${site}: found ${found.reading === "exact" ? "word for word" : "in slightly different words"} in a saved copy.`;
      }
    }
  }

  // A source that cannot be read itself may be quoted by the step before it.
  const before = index > 0 ? (trail.steps[index - 1]?.url ?? null) : null;
  if (step.wording === null && p.wording !== null && before !== null) {
    const [quoting] = await readPages(env, [before]);
    const found = quoting && quoting.ok ? findClaim(quoting.text, p.wording) : null;
    if (found && found.reading !== "not_found") {
      step.wording = found.sentence;
      step.reading = "offline";
      step.quotedBy = siteName(before);
      message = `${site} is not readable online; ${step.quotedBy} quotes it.`;
    }
  }

  if (step.date === null && p.url !== null) {
    const seen = await firstSeen(p.url);
    if (seen !== null) {
      step.date = seen;
      step.dateSource = "archive";
    }
  }
  await stageStep(env.DB, traceId, index, step);
  await addEvent(env.DB, traceId, message, now);
}
