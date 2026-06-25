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
  auth_method      TEXT NOT NULL DEFAULT 'inherit',
  mcp_servers      TEXT NOT NULL DEFAULT '[]',
  strict_mcp       INTEGER NOT NULL DEFAULT 0,
  hooks            TEXT NOT NULL DEFAULT '',
  spec_globs       TEXT NOT NULL DEFAULT '',
  interactive      INTEGER NOT NULL DEFAULT 0,
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
  scheduled_for  TEXT,
  source_role    TEXT NOT NULL DEFAULT 'development',
  parent_task_id INTEGER,
  chain_branch   TEXT,
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

CREATE TABLE IF NOT EXISTS plans (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id            INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title                 TEXT NOT NULL,
  objective             TEXT NOT NULL DEFAULT '',
  source_type           TEXT NOT NULL DEFAULT 'manual',
  source_integration_id INTEGER REFERENCES integrations(id) ON DELETE SET NULL,
  source_external_id    TEXT,
  source_url            TEXT,
  refined_spec          TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT 'draft',
  scheduled_for         TEXT,
  clickup_parent_id     TEXT,
  refine_pid            INTEGER,
  refine_log            TEXT,
  error                 TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_plans_project ON plans(project_id);
CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);

CREATE TABLE IF NOT EXISTS plan_steps (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id         INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  position        INTEGER NOT NULL DEFAULT 0,
  title           TEXT NOT NULL,
  spec            TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'pending',
  task_id         INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  clickup_task_id TEXT,
  result_summary  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_plan_steps_plan ON plan_steps(plan_id);

CREATE TABLE IF NOT EXISTS plan_attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id     INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  path        TEXT NOT NULL,
  mime        TEXT NOT NULL DEFAULT '',
  size        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_plan_attachments_plan ON plan_attachments(plan_id);

CREATE TABLE IF NOT EXISTS run_interactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id     INTEGER,
  kind        TEXT NOT NULL DEFAULT 'question',
  question    TEXT NOT NULL,
  options     TEXT NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'pending',
  answer      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_interactions_run ON run_interactions(run_id);
CREATE INDEX IF NOT EXISTS idx_interactions_status ON run_interactions(status);
`;
