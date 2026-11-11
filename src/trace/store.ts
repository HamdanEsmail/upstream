// Everything a trace keeps in the database. No other file writes SQL.
import type { Step } from "../core/trail";
import type { Account } from "../tinyfish/client";

export type TraceStatus = "following" | "searching" | "checking" | "done" | "failed";

export type Trace = {
  id: string;
  pageUrl: string;
  text: string;
  textKey: string;
  /** The links in the highlighted paragraph. */
  near: string[];
  status: TraceStatus;
  verdict: string | null;
  reached: string | null;
  summary: string | null;
  researchRunId: string | null;
  researchAccount: Account | null;
  researchStartedAt: string | null;
  pagesRead: number;
  latestHosts: string[];
  report: string | null;
  /** The trail read out of the report, as JSON text. */
  proposed: string | null;
  spendUsd: number;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
};

export type StoredStep = Step & {
  /** For a source that is only in print: the site of the page that quotes it. */
  quotedBy: string | null;
  links: string[];
  readAt: string | null;
};

export type StoredChange = { fromPosition: number | null; toPosition: number | null; kind: string; detail: string; basis: "code" | "research" };

type Row = Record<string, unknown>;

function list(v: unknown): string[] {
  try {
    const parsed: unknown = JSON.parse(typeof v === "string" ? v : "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

function toTrace(r: Row): Trace {
  return {
    id: String(r.id),
    pageUrl: String(r.page_url),
    text: String(r.text),
    textKey: String(r.text_key),
    near: list(r.near),
    status: String(r.status) as TraceStatus,
    verdict: text(r.verdict),
    reached: text(r.reached),
    summary: text(r.summary),
    researchRunId: text(r.research_run_id),
    researchAccount: r.research_account === "main" || r.research_account === "second" ? r.research_account : null,
    researchStartedAt: text(r.research_started_at),
    pagesRead: Number(r.pages_read ?? 0),
    latestHosts: list(r.latest_hosts),
    report: text(r.report),
    proposed: text(r.proposed),
    spendUsd: Number(r.spend_usd ?? 0),
    createdAt: String(r.created_at),
    finishedAt: text(r.finished_at),
    error: text(r.error),
  };
}

export async function insertTrace(db: D1Database, t: { id: string; pageUrl: string; text: string; textKey: string; near: string[]; now: string }): Promise<void> {
  await db
    .prepare("INSERT INTO traces (id, page_url, text, text_key, near, status, created_at) VALUES (?, ?, ?, ?, ?, 'following', ?)")
    .bind(t.id, t.pageUrl, t.text, t.textKey, JSON.stringify(t.near), t.now)
    .run();
}

export async function getTrace(db: D1Database, id: string): Promise<Trace | null> {
  const row = await db.prepare("SELECT * FROM traces WHERE id = ?").bind(id).first<Row>();
  return row ? toTrace(row) : null;
}

export async function findTraceByKey(db: D1Database, textKey: string): Promise<Trace | null> {
  const row = await db.prepare("SELECT * FROM traces WHERE text_key = ?").bind(textKey).first<Row>();
  return row ? toTrace(row) : null;
}

export async function recentTraces(db: D1Database, limit: number): Promise<Trace[]> {
  const { results } = await db.prepare("SELECT * FROM traces WHERE status = 'done' ORDER BY created_at DESC LIMIT ?").bind(limit).all<Row>();
  return results.map(toTrace);
}

const COLUMNS: Record<string, string> = {
  status: "status",
  verdict: "verdict",
  reached: "reached",
  summary: "summary",
  researchRunId: "research_run_id",
  researchAccount: "research_account",
  researchStartedAt: "research_started_at",
  pagesRead: "pages_read",
  latestHosts: "latest_hosts",
  report: "report",
  proposed: "proposed",
  spendUsd: "spend_usd",
  finishedAt: "finished_at",
  error: "error",
};

export type TraceUpdate = Partial<
  Pick<Trace, "status" | "verdict" | "reached" | "summary" | "researchRunId" | "researchAccount" | "researchStartedAt" | "pagesRead" | "latestHosts" | "report" | "proposed" | "spendUsd" | "finishedAt" | "error">
>;

/** Writes only the fields given. */
export async function updateTrace(db: D1Database, id: string, fields: TraceUpdate): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [name, value] of Object.entries(fields)) {
    const column = COLUMNS[name];
    if (!column || value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(Array.isArray(value) ? JSON.stringify(value) : value);
  }
  if (sets.length === 0) return;
  await db
    .prepare(`UPDATE traces SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values, id)
    .run();
}

const STEP_COLUMNS = "url, publisher, title, date, date_source, wording, reading, read_from, archive_url, reached_by, names_source, quoted_by, links, read_at";

function stepValues(s: StoredStep): unknown[] {
  return [s.url, s.publisher, s.title, s.date, s.dateSource, s.wording, s.reading, s.readFrom, s.archiveUrl, s.reachedBy, s.namesSource, s.quotedBy, JSON.stringify(s.links), s.readAt];
}

function toStep(r: Row): StoredStep {
  return {
    url: text(r.url),
    publisher: String(r.publisher ?? ""),
    title: text(r.title),
    date: text(r.date),
    dateSource: text(r.date_source) as StoredStep["dateSource"],
    wording: text(r.wording),
    reading: String(r.reading) as StoredStep["reading"],
    readFrom: text(r.read_from) as StoredStep["readFrom"],
    archiveUrl: text(r.archive_url),
    reachedBy: String(r.reached_by) as StoredStep["reachedBy"],
    namesSource: text(r.names_source),
    quotedBy: text(r.quoted_by),
    links: list(r.links),
    readAt: text(r.read_at),
  };
}

/** Adds a step at the end of the trail and returns its position. */
export async function appendStep(db: D1Database, traceId: string, s: StoredStep): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO steps (trace_id, position, ${STEP_COLUMNS})
       VALUES (?, (SELECT COALESCE(MAX(position), -1) + 1 FROM steps WHERE trace_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING position`,
    )
    .bind(traceId, traceId, ...stepValues(s))
    .first<{ position: number }>();
  return row?.position ?? 0;
}

/** Replaces the whole trail, in the order given. */
export async function saveSteps(db: D1Database, traceId: string, steps: StoredStep[]): Promise<void> {
  const insert = db.prepare(`INSERT INTO steps (trace_id, position, ${STEP_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  await db.batch([db.prepare("DELETE FROM steps WHERE trace_id = ?").bind(traceId), ...steps.map((s, i) => insert.bind(traceId, i, ...stepValues(s)))]);
}

export async function getSteps(db: D1Database, traceId: string): Promise<StoredStep[]> {
  const { results } = await db.prepare("SELECT * FROM steps WHERE trace_id = ? ORDER BY position").bind(traceId).all<Row>();
  return results.map(toStep);
}

/** Keeps one checked step aside under its index; staging the same index again replaces it. */
export async function stageStep(db: D1Database, traceId: string, idx: number, s: StoredStep): Promise<void> {
  await db
    .prepare("INSERT INTO staged_steps (trace_id, idx, body) VALUES (?, ?, ?) ON CONFLICT (trace_id, idx) DO UPDATE SET body = excluded.body")
    .bind(traceId, idx, JSON.stringify(s))
    .run();
}

export async function getStaged(db: D1Database, traceId: string): Promise<StoredStep[]> {
  const { results } = await db.prepare("SELECT body FROM staged_steps WHERE trace_id = ? ORDER BY idx").bind(traceId).all<{ body: string }>();
  return results.map((r) => JSON.parse(r.body) as StoredStep);
}

export async function clearStaged(db: D1Database, traceId: string): Promise<void> {
  await db.prepare("DELETE FROM staged_steps WHERE trace_id = ?").bind(traceId).run();
}

export async function saveChanges(db: D1Database, traceId: string, changes: StoredChange[]): Promise<void> {
  const insert = db.prepare("INSERT INTO changes (trace_id, from_position, to_position, kind, detail, basis) VALUES (?, ?, ?, ?, ?, ?)");
  await db.batch([
    db.prepare("DELETE FROM changes WHERE trace_id = ?").bind(traceId),
    ...changes.map((c) => insert.bind(traceId, c.fromPosition, c.toPosition, c.kind, c.detail, c.basis)),
  ]);
}

export async function getChanges(db: D1Database, traceId: string): Promise<StoredChange[]> {
  const { results } = await db.prepare("SELECT from_position, to_position, kind, detail, basis FROM changes WHERE trace_id = ? ORDER BY id").bind(traceId).all<Row>();
  return results.map((r) => ({
    fromPosition: typeof r.from_position === "number" ? r.from_position : null,
    toPosition: typeof r.to_position === "number" ? r.to_position : null,
    kind: String(r.kind),
    detail: String(r.detail),
    basis: r.basis === "research" ? "research" : "code",
  }));
}

export async function addEvent(db: D1Database, traceId: string, message: string, now: string): Promise<void> {
  await db.prepare("INSERT INTO events (trace_id, at, message) VALUES (?, ?, ?)").bind(traceId, now, message).run();
}

/** The latest `limit` events, oldest first. */
export async function getEvents(db: D1Database, traceId: string, limit: number): Promise<{ at: string; message: string }[]> {
  const { results } = await db.prepare("SELECT at, message FROM events WHERE trace_id = ? ORDER BY id DESC LIMIT ?").bind(traceId, limit).all<{ at: string; message: string }>();
  return results.reverse();
}

/**
 * Takes one of `limit` slots for `name` on `day`. True when a slot was free. One statement,
 * so two traces starting together cannot both take the last slot.
 */
export async function takeSlot(db: D1Database, day: string, name: string, limit: number): Promise<boolean> {
  if (limit <= 0) return false;
  const row = await db
    .prepare("INSERT INTO limits (day, name, count) VALUES (?, ?, 1) ON CONFLICT (day, name) DO UPDATE SET count = count + 1 WHERE limits.count < ? RETURNING count")
    .bind(day, name, limit)
    .first<{ count: number }>();
  return row !== null;
}

export async function giveBack(db: D1Database, day: string, name: string): Promise<void> {
  await db.prepare("UPDATE limits SET count = MAX(count - 1, 0) WHERE day = ? AND name = ?").bind(day, name).run();
}

export async function countOf(db: D1Database, day: string, name: string): Promise<number> {
  const row = await db.prepare("SELECT count FROM limits WHERE day = ? AND name = ?").bind(day, name).first<{ count: number }>();
  return row?.count ?? 0;
}

export async function recordSpend(db: D1Database, kind: string, amountUsd: number, ref: string, now: string): Promise<void> {
  await db.prepare("INSERT INTO spend (at, kind, amount_usd, ref) VALUES (?, ?, ?, ?)").bind(now, kind, amountUsd, ref).run();
}

export async function totals(db: D1Database): Promise<{ traces: number; steps: number; deepSearches: number; spendUsd: number }> {
  const row = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM traces) AS traces, (SELECT COUNT(*) FROM steps) AS steps,
              (SELECT COUNT(*) FROM spend WHERE kind = 'research') AS deep, (SELECT COALESCE(SUM(amount_usd), 0) FROM spend) AS spent`,
    )
    .first<{ traces: number; steps: number; deep: number; spent: number }>();
  return { traces: row?.traces ?? 0, steps: row?.steps ?? 0, deepSearches: row?.deep ?? 0, spendUsd: Math.round((row?.spent ?? 0) * 100) / 100 };
}
