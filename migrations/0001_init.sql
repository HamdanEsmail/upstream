-- One row per traced claim.
CREATE TABLE traces (
  id TEXT PRIMARY KEY,
  page_url TEXT NOT NULL,
  text TEXT NOT NULL,
  text_key TEXT NOT NULL,
  status TEXT NOT NULL,
  verdict TEXT,
  reached TEXT,
  summary TEXT,
  research_run_id TEXT,
  research_account TEXT,
  spend_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT
);
CREATE UNIQUE INDEX traces_text_key ON traces (text_key);

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
  kind TEXT,
  read_at TEXT,
  PRIMARY KEY (trace_id, position)
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

-- Every TinyFish call that could cost money, free ones included at 0.
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
