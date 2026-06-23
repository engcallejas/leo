// Leo schema, embedded as a string so it needs no runtime file access
// (robust under Next standalone output and inside Docker). Applied idempotently.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integrations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  type           TEXT NOT NULL,
  name           TEXT NOT NULL,
  config         TEXT NOT NULL DEFAULT '{}',
  enabled        INTEGER NOT NULL DEFAULT 1,
  last_polled_at TEXT,
  last_error     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  repo_path        TEXT NOT NULL,
  base_branch      TEXT NOT NULL DEFAULT 'main',
  target_branch    TEXT NOT NULL DEFAULT '',
  prompt_rules     TEXT NOT NULL DEFAULT '',
  auto_mode        INTEGER NOT NULL DEFAULT 0,
  permission_mode  TEXT NOT NULL DEFAULT 'acceptEdits',
  allowed_tools    TEXT,
  disallowed_tools TEXT,
  model            TEXT,
  max_turns        INTEGER,
  sources          TEXT NOT NULL DEFAULT '[]',
  enabled          INTEGER NOT NULL DEFAULT 1,
  resolve_source_on_done INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  integration_id INTEGER REFERENCES integrations(id) ON DELETE SET NULL,
  source_type    TEXT NOT NULL,
  external_id    TEXT NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  url            TEXT,
  raw            TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, source_type, external_id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);

CREATE TABLE IF NOT EXISTS runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id        INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'running',
  pid            INTEGER,
  session_id     TEXT,
  num_turns      INTEGER,
  cost_usd       REAL,
  duration_ms    INTEGER,
  exit_code      INTEGER,
  result_summary TEXT,
  error          TEXT,
  log_path       TEXT NOT NULL,
  started_at     TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
`;
