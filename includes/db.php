<?php
/**
 * Database layer. Supports MySQL/MariaDB, PostgreSQL and SQLite through PDO.
 * Everything that differs between engines (connection, quoting, upserts,
 * inserts that return ids, truncate, schema introspection) lives in this file.
 */

declare(strict_types=1);

/** Drivers the app understands, with the PDO extension each one needs. */
function fb_drivers(): array
{
    return [
        'mysql'  => ['label' => 'MySQL / MariaDB', 'ext' => 'pdo_mysql'],
        'pgsql'  => ['label' => 'PostgreSQL',      'ext' => 'pdo_pgsql'],
        'sqlite' => ['label' => 'SQLite',          'ext' => 'pdo_sqlite'],
    ];
}

function fb_driver_available(string $driver): bool
{
    $d = fb_drivers();
    return isset($d[$driver]) && extension_loaded($d[$driver]['ext']);
}

/** Active driver. Configs written before multi-driver support are MySQL. */
function fb_driver(): string
{
    $d = fb_config()['db_driver'] ?? 'mysql';
    return isset(fb_drivers()[$d]) ? $d : 'mysql';
}

/** Mutable per-request state (lets the installer run the helpers before config.php exists). */
function &fb_registry(): array
{
    static $r = [];
    return $r;
}

/** Absolute path of the SQLite file (relative paths are resolved from the app folder). */
function fb_sqlite_path(string $path): string
{
    $path = str_replace('\\', '/', $path);
    return ($path !== '' && ($path[0] === '/' || preg_match('#^[A-Za-z]:/#', $path))) ? $path : FB_ROOT . '/' . $path;
}

/**
 * Open a connection from a config array.
 * $withDb = false connects to the server only (used to create the database).
 */
function fb_connect(array $c, bool $withDb = true): PDO
{
    $driver  = $c['db_driver'] ?? 'mysql';
    if (!fb_driver_available($driver)) {
        throw new RuntimeException('The PHP extension ' . (fb_drivers()[$driver]['ext'] ?? $driver) . ' is not installed.');
    }
    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ];

    if ($driver === 'sqlite') {
        $file = fb_sqlite_path((string) ($c['db_path'] ?? ''));
        $dir  = dirname($file);
        if (!is_dir($dir) && !@mkdir($dir, 0750, true) && !is_dir($dir)) {
            throw new RuntimeException('Cannot create the folder ' . $dir);
        }
        $pdo = new PDO('sqlite:' . $file, null, null, $options);
        $pdo->exec('PRAGMA busy_timeout = 5000'); // wait for concurrent writers instead of failing
        return $pdo;
    }

    $host = (string) ($c['db_host'] ?? 'localhost');
    $port = null;
    if (strpos($host, ':') !== false) {
        [$host, $port] = explode(':', $host, 2);
    }
    $name = $withDb ? (string) ($c['db_name'] ?? '') : null;

    if ($driver === 'pgsql') {
        // Without a target database, connect to the maintenance database.
        $dsn = 'pgsql:host=' . $host . ($port ? ';port=' . (int) $port : '') . ';dbname=' . ($name ?? 'postgres');
        $pdo = new PDO($dsn, (string) ($c['db_user'] ?? ''), (string) ($c['db_pass'] ?? ''), $options);
        $pdo->exec("SET client_encoding TO 'UTF8'");
        return $pdo;
    }

    $dsn = 'mysql:host=' . $host . ($port ? ';port=' . (int) $port : '')
        . ($name !== null ? ';dbname=' . $name : '') . ';charset=utf8mb4';
    return new PDO($dsn, (string) ($c['db_user'] ?? ''), (string) ($c['db_pass'] ?? ''), $options);
}

/** Create the database itself if the server allows it (not applicable to SQLite). */
function fb_create_database(array $c): void
{
    $driver = $c['db_driver'] ?? 'mysql';
    if ($driver === 'sqlite') {
        return; // the file is created on first connect
    }
    $name = (string) $c['db_name'];
    try {
        $server = fb_connect($c, false);
        if ($driver === 'mysql') {
            $server->exec('CREATE DATABASE IF NOT EXISTS `' . $name . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        } elseif ($driver === 'pgsql') {
            $stmt = $server->prepare('SELECT 1 FROM pg_database WHERE datname = ?');
            $stmt->execute([$name]);
            if (!$stmt->fetchColumn()) {
                $server->exec('CREATE DATABASE "' . $name . '" ENCODING \'UTF8\'');
            }
        }
    } catch (PDOException $e) {
        // No CREATE privilege: fine if the database already exists; connecting next will say if not.
    }
}

/** Quote an identifier for the active driver. */
function fb_ident(string $name, ?string $driver = null): string
{
    return ($driver ?? fb_driver()) === 'mysql' ? '`' . $name . '`' : '"' . $name . '"';
}

function fb_table(string $name): string
{
    return fb_ident(fb_config()['db_prefix'] . $name);
}

/** Shared connection. Also self-heals: missing tables or an old schema are fixed automatically. */
function fb_db(): PDO
{
    $r = &fb_registry();
    if (isset($r['pdo'])) {
        return $r['pdo'];
    }
    $c   = fb_config();
    $pdo = fb_connect($c);
    $r['pdo'] = $pdo;

    try {
        $version = (int) fb_setting_row($pdo, 'db_version');
    } catch (PDOException $e) {
        $version = 0; // tables missing
    }
    if ($version < FB_DB_VERSION) {
        fb_install_schema($pdo, $c['db_prefix'], fb_driver());
        fb_setting_write($pdo, 'db_version', (string) FB_DB_VERSION);
    }
    return $pdo;
}

/** True when a database is configured and reachable. The game itself never requires one. */
function fb_db_ok(): bool
{
    $r = &fb_registry();
    if (!isset($r['ok'])) {
        $r['ok'] = false;
        if (fb_installed()) {
            try {
                fb_db();
                $r['ok'] = true;
            } catch (Throwable $e) {
                unset($r['pdo']);
                error_log('Flying Bird: database unavailable: ' . $e->getMessage());
            }
        }
    }
    return $r['ok'];
}

/** Run database/schema.<driver>.sql with the table prefix applied, then any migrations. */
function fb_install_schema(PDO $pdo, string $prefix, string $driver): void
{
    $file = FB_ROOT . '/database/schema.' . $driver . '.sql';
    $sql  = is_file($file) ? file_get_contents($file) : false;
    if ($sql === false) {
        throw new RuntimeException('database/schema.' . $driver . '.sql is missing.');
    }
    $sql = preg_replace('/^--.*$/m', '', $sql);
    $sql = str_replace('{prefix}', $prefix, $sql);
    foreach (array_filter(array_map('trim', explode(';', $sql))) as $statement) {
        $pdo->exec($statement);
    }

    // Migrations. Each step is idempotent, so this is also safe as a "repair".
    // v2: daily challenge columns on the scores table (fresh installs already have them).
    $table = fb_ident($prefix . 'scores', $driver);
    $q     = static fn (string $n): string => fb_ident($n, $driver);
    if (!fb_column_exists($pdo, $driver, $prefix . 'scores', 'mode')) {
        $pdo->exec("ALTER TABLE $table ADD COLUMN " . $q('mode') . " VARCHAR(10) NOT NULL DEFAULT 'classic'");
    }
    $addedDay = !fb_column_exists($pdo, $driver, $prefix . 'scores', 'day');
    if ($addedDay) {
        $pdo->exec("ALTER TABLE $table ADD COLUMN " . $q('day') . ($driver === 'sqlite' ? ' TEXT NULL' : ' DATE NULL'));
    }
    // The index covers the v2 columns, so it is created here (after they exist), not in the schema file.
    // MySQL's fresh schema already includes it; only an upgraded MySQL table needs it added.
    $index = $q($prefix . 'scores_mode_day_score');
    $cols  = '(' . $q('mode') . ', ' . $q('day') . ', ' . $q('score') . ')';
    if ($driver === 'mysql') {
        if ($addedDay) {
            $pdo->exec("CREATE INDEX $index ON $table $cols");
        }
    } else {
        $pdo->exec("CREATE INDEX IF NOT EXISTS $index ON $table $cols");
    }
}

function fb_column_exists(PDO $pdo, string $driver, string $table, string $column): bool
{
    if ($driver === 'sqlite') {
        foreach ($pdo->query('PRAGMA table_info(' . fb_ident($table, 'sqlite') . ')')->fetchAll() as $row) {
            if (strcasecmp((string) $row['name'], $column) === 0) {
                return true;
            }
        }
        return false;
    }
    $schema = $driver === 'pgsql' ? 'current_schema()' : 'DATABASE()';
    $stmt   = $pdo->prepare("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = $schema AND table_name = ? AND column_name = ?");
    $stmt->execute([$table, $column]);
    return (bool) $stmt->fetchColumn();
}

function fb_setting_row(PDO $pdo, string $name): ?string
{
    $stmt = $pdo->prepare('SELECT value FROM ' . fb_table('settings') . ' WHERE name = ?');
    $stmt->execute([$name]);
    $v = $stmt->fetchColumn();
    return $v === false ? null : (string) $v;
}

function fb_setting_write(PDO $pdo, string $name, string $value): void
{
    $t = fb_table('settings');
    switch (fb_driver()) {
        case 'mysql':
            $sql = "REPLACE INTO $t (name, value) VALUES (?, ?)";
            break;
        default: // sqlite (3.24+) and PostgreSQL share this upsert syntax
            $sql = "INSERT INTO $t (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value";
    }
    $pdo->prepare($sql)->execute([$name, $value]);
}

/* ---------- Scores ---------- */

/** Daily challenges are keyed by UTC date. */
function fb_today(): string
{
    return gmdate('Y-m-d');
}

/** Accept today's date, plus yesterday's for a short grace period around midnight UTC. */
function fb_day_valid(string $day): bool
{
    return $day === fb_today() || $day === gmdate('Y-m-d', time() - 3600);
}

function fb_scores_top(int $limit, string $mode = 'classic', ?string $day = null): array
{
    $limit = max(1, min(100, $limit));
    if ($mode === 'daily') {
        $stmt = fb_db()->prepare('SELECT player_name AS name, score FROM ' . fb_table('scores')
            . " WHERE mode = 'daily' AND day = ? ORDER BY score DESC, id ASC LIMIT " . $limit);
        $stmt->execute([$day ?: fb_today()]);
    } else {
        $stmt = fb_db()->query('SELECT player_name AS name, score FROM ' . fb_table('scores')
            . " WHERE mode = 'classic' ORDER BY score DESC, id ASC LIMIT " . $limit);
    }
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['score'] = (int) $r['score'];
    }
    return $rows;
}

function fb_scores_add(string $name, int $score, int $durationMs, string $ipHash, string $mode = 'classic', ?string $day = null): int
{
    $pdo  = fb_db();
    $sql  = 'INSERT INTO ' . fb_table('scores') . ' (player_name, score, duration_ms, ip_hash, mode, day, created_at) VALUES (?,?,?,?,?,?,?)';
    $args = [mb_substr($name, 0, 40), $score, $durationMs, $ipHash, $mode, $mode === 'daily' ? $day : null, gmdate('Y-m-d H:i:s')];
    if (fb_driver() === 'pgsql') {
        $stmt = $pdo->prepare($sql . ' RETURNING id'); // lastInsertId() needs a sequence name on PostgreSQL
        $stmt->execute($args);
        return (int) $stmt->fetchColumn();
    }
    $pdo->prepare($sql)->execute($args);
    return (int) $pdo->lastInsertId();
}

function fb_scores_recent_from(string $ipHash, int $seconds): bool
{
    $stmt = fb_db()->prepare('SELECT 1 FROM ' . fb_table('scores') . ' WHERE ip_hash = ? AND created_at > ? LIMIT 1');
    $stmt->execute([$ipHash, gmdate('Y-m-d H:i:s', time() - $seconds)]);
    return (bool) $stmt->fetchColumn();
}

function fb_scores_count(): int
{
    return (int) fb_db()->query('SELECT COUNT(*) FROM ' . fb_table('scores'))->fetchColumn();
}

function fb_scores_page(int $perPage, int $page): array
{
    $offset = max(0, ($page - 1) * $perPage);
    return fb_db()->query('SELECT id, player_name, score, mode, day, created_at FROM ' . fb_table('scores')
        . ' ORDER BY id DESC LIMIT ' . (int) $perPage . ' OFFSET ' . (int) $offset)->fetchAll();
}

function fb_scores_delete(int $id): void
{
    fb_db()->prepare('DELETE FROM ' . fb_table('scores') . ' WHERE id = ?')->execute([$id]);
}

function fb_scores_reset(): void
{
    // SQLite has no TRUNCATE.
    fb_db()->exec((fb_driver() === 'sqlite' ? 'DELETE FROM ' : 'TRUNCATE TABLE ') . fb_table('scores'));
}
