// Reads the trail a research report proposes. Nothing in it is trusted yet: every step is
// re-read later. This only turns the closing block into tidy, typed values.

export type ResearchVerdict = "matches_original" | "changed_on_the_way" | "said_by_someone_else" | "outdated" | "no_original_source";

export type ProposedStep = {
  /** Null when the report gave no web address: a source that exists only in print. */
  url: string | null;
  publisher: string;
  /** A year, a year and month, or a full day. Null when the report did not know. */
  date: string | null;
  wording: string | null;
  namesSource: string | null;
  /** What the report says about a link from the step before. Checked separately. */
  saidLinked: boolean;
};

export type ProposedTrail = {
  steps: ProposedStep[];
  origin: { found: boolean; url: string | null; kind: string; note: string };
  changes: string[];
  verdict: ResearchVerdict | null;
  summary: string;
};

const VERDICTS: readonly string[] = ["matches_original", "changed_on_the_way", "said_by_someone_else", "outdated", "no_original_source"];

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The address alone: reports sometimes add a note after it. */
function webAddress(v: unknown): string | null {
  const first = text(v).split(/\s+/)[0] ?? "";
  if (!/^https?:\/\//i.test(first)) return null;
  try {
    new URL(first);
    return first;
  } catch {
    return null;
  }
}

function wording(v: unknown): string | null {
  const t = text(v);
  return t === "" || /^\[[\s\S]*\]$/.test(t) ? null : t;
}

function namedSource(v: unknown): string | null {
  const t = text(v);
  return t === "" || /^none\b/i.test(t) ? null : t;
}

function date(v: unknown): string | null {
  const t = text(v);
  return /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(t) ? t : null;
}

function step(v: unknown): ProposedStep | null {
  if (v === null || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  return {
    url: webAddress(s.url),
    publisher: text(s.publisher),
    date: date(s.date),
    wording: wording(s.wording),
    namesSource: namedSource(s.names_source),
    saidLinked: s.linked === true,
  };
}

/** The trail in the report's last fenced json block, or null when there is none to use. */
export function readTrail(report: string): ProposedTrail | null {
  const blocks = [...report.matchAll(/```json\s*([\s\S]*?)```/g)];
  const last = blocks[blocks.length - 1];
  if (!last) return null;
  let body: unknown;
  try {
    body = JSON.parse(last[1] ?? "");
  } catch {
    return null;
  }
  if (body === null || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.steps)) return null;
  const steps = b.steps.map(step).filter((s): s is ProposedStep => s !== null);
  if (steps.length === 0) return null;

  const o = (b.origin !== null && typeof b.origin === "object" ? b.origin : {}) as Record<string, unknown>;
  const verdict = text(b.verdict);
  return {
    steps,
    origin: { found: o.found === true, url: webAddress(o.url), kind: text(o.kind) || "other", note: text(o.note) },
    changes: Array.isArray(b.changes) ? b.changes.map(text).filter((c) => c !== "").slice(0, 8) : [],
    verdict: VERDICTS.includes(verdict) ? (verdict as ResearchVerdict) : null,
    summary: text(b.summary),
  };
}
