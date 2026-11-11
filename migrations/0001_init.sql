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
