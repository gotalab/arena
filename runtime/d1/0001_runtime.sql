CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  visible INTEGER NOT NULL CHECK (visible IN (0, 1))
) STRICT;

CREATE TABLE artifacts (
  sha256 TEXT PRIMARY KEY CHECK (length(sha256) = 64)
) STRICT;

CREATE TABLE blind_assignments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  artifact_a_sha256 TEXT NOT NULL REFERENCES artifacts(sha256),
  artifact_b_sha256 TEXT NOT NULL REFERENCES artifacts(sha256),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (artifact_a_sha256 <> artifact_b_sha256)
) STRICT;

CREATE TABLE blind_choices (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES blind_assignments(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  choice TEXT NOT NULL CHECK (choice IN ('A', 'B', 'TIE', 'BOTH_BROKEN')),
  actor_sub TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX idx_runtime_choices_assignment ON blind_choices(assignment_id);
