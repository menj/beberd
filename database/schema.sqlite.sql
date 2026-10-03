-- Flying Bird schema for SQLite. {prefix} is replaced by the installer.
-- (The mode/day index is created by the migration step in includes/db.php.)
-- Every statement is idempotent. Dates are stored as UTC text ("Y-m-d H:i:s" / "Y-m-d").

CREATE TABLE IF NOT EXISTS "{prefix}settings" (
  "name"  TEXT NOT NULL PRIMARY KEY,
  "value" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "{prefix}users" (
  "id"            INTEGER PRIMARY KEY AUTOINCREMENT,
  "username"      TEXT NOT NULL UNIQUE,
  "password_hash" TEXT NOT NULL,
  "created_at"    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "{prefix}scores" (
  "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "player_name" TEXT    NOT NULL DEFAULT '',
  "score"       INTEGER NOT NULL DEFAULT 0,
  "duration_ms" INTEGER NOT NULL DEFAULT 0,
  "ip_hash"     TEXT    NOT NULL DEFAULT '',
  "mode"        TEXT    NOT NULL DEFAULT 'classic',
  "day"         TEXT    NULL,
  "created_at"  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS "{prefix}scores_score" ON "{prefix}scores" ("score");
CREATE INDEX IF NOT EXISTS "{prefix}scores_ip_created" ON "{prefix}scores" ("ip_hash", "created_at");
