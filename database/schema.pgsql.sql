-- Flying Bird schema for PostgreSQL. {prefix} is replaced by the installer.
-- (The mode/day index is created by the migration step in includes/db.php.)
-- Every statement is idempotent, so this file can be re-run safely.

CREATE TABLE IF NOT EXISTS "{prefix}settings" (
  "name"  VARCHAR(64) NOT NULL PRIMARY KEY,
  "value" TEXT        NOT NULL
);

CREATE TABLE IF NOT EXISTS "{prefix}users" (
  "id"            SERIAL       PRIMARY KEY,
  "username"      VARCHAR(60)  NOT NULL UNIQUE,
  "password_hash" VARCHAR(255) NOT NULL,
  "created_at"    TIMESTAMP    NOT NULL
);

CREATE TABLE IF NOT EXISTS "{prefix}scores" (
  "id"          BIGSERIAL   PRIMARY KEY,
  "player_name" VARCHAR(40) NOT NULL DEFAULT '',
  "score"       INTEGER     NOT NULL DEFAULT 0,
  "duration_ms" INTEGER     NOT NULL DEFAULT 0,
  "ip_hash"     CHAR(64)    NOT NULL DEFAULT '',
  "mode"        VARCHAR(10) NOT NULL DEFAULT 'classic',
  "day"         DATE        NULL,
  "created_at"  TIMESTAMP   NOT NULL
);

CREATE INDEX IF NOT EXISTS "{prefix}scores_score" ON "{prefix}scores" ("score");
CREATE INDEX IF NOT EXISTS "{prefix}scores_ip_created" ON "{prefix}scores" ("ip_hash", "created_at");
