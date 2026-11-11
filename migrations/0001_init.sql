-- One row per traced claim.
CREATE TABLE traces (
  id TEXT PRIMARY KEY,
  page_url TEXT NOT NULL,
  text TEXT NOT NULL,
  text_key TEXT NOT NULL,
  -- The links in the highlighted paragraph, as a JSON list. Sent by the extension.
  near TEXT NOT NULL DEFAULT '[]',
  -- following, searching, checking, done or failed
  status TEXT NOT NULL,
  verdict TEXT,
  reached TEXT,
  summary TEXT,
  research_run_id TEXT,
  research_account TEXT,
  research_started_at TEXT,
  -- How far the deep search has got, for the waiting display.
  pages_read INTEGER NOT NULL DEFAULT 0,
  latest_hosts TEXT NOT NULL DEFAULT '[]',
  -- The finished research report, and the trail read out of it (JSON).
  report TEXT,
  proposed TEXT,
  spend_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT
);
CREATE UNIQUE INDEX traces_text_key ON traces (text_key);
CREATE INDEX traces_created ON traces (created_at);

-- The steps of a trail, the highlighted page at position 0.
CREATE TABLE steps (
  trace_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  url TEXT,
  publisher TEXT NOT NULL DEFAULT '',
  title TEXT,
  date TEXT,
  date_source TEXT,
  wording TEXT,
  reading TEXT NOT NULL,
  read_from TEXT,
  archive_url TEXT,
  reached_by TEXT NOT NULL,
  names_source TEXT,
  -- For a source that is only in print: the site of the page that quotes it.
  quoted_by TEXT,
  -- The page's own links, as a JSON list. Used to tell a linked step from a found one.
  links TEXT NOT NULL DEFAULT '[]',
  read_at TEXT,
  PRIMARY KEY (trace_id, position)
);

-- Steps the deep search proposed, each checked on its own, waiting to be merged.
CREATE TABLE staged_steps (
  trace_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (trace_id, idx)
);

-- What changed between two steps. basis: 'code' or 'research'.
CREATE TABLE changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT NOT NULL,
  from_position INTEGER,
  to_position INTEGER,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  basis TEXT NOT NULL
);
CREATE INDEX changes_trace ON changes (trace_id);

-- The progress log the panel reads while a trace runs.
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT NOT NULL,
  at TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX events_trace ON events (trace_id);

-- Every deep search started, free ones included at 0.
CREATE TABLE spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount_usd REAL NOT NULL,
  ref TEXT NOT NULL
);

-- Daily counters: new traces, deep searches per account, traces per visitor.
CREATE TABLE limits (
  day TEXT NOT NULL,
  name TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (day, name)
);
