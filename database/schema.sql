-- Flying Bird schema. {prefix} is replaced by the installer.
-- Every statement is idempotent, so this file can be re-run safely.

CREATE TABLE IF NOT EXISTS `{prefix}settings` (
  `name`  VARCHAR(64) NOT NULL,
  `value` MEDIUMTEXT  NOT NULL,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `{prefix}users` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`      VARCHAR(60)  NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `created_at`    DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `{prefix}scores` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `player_name` VARCHAR(40)     NOT NULL DEFAULT '',
  `score`       INT UNSIGNED    NOT NULL DEFAULT 0,
  `duration_ms` INT UNSIGNED    NOT NULL DEFAULT 0,
  `ip_hash`     CHAR(64)        NOT NULL DEFAULT '',
  `created_at`  DATETIME        NOT NULL,
  PRIMARY KEY (`id`),
  KEY `score` (`score`),
  KEY `ip_created` (`ip_hash`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
