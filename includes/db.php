<?php
/**
 * Database layer: connection, schema installer, migrations and score queries.
 */

declare(strict_types=1);

function fb_connect(string $host, string $user, string $pass, ?string $name = null): PDO
{
    $port = null;
    if (strpos($host, ':') !== false) {
        [$host, $port] = explode(':', $host, 2);
    }
    $dsn = 'mysql:host=' . $host . ($port ? ';port=' . (int) $port : '')
        . ($name !== null ? ';dbname=' . $name : '') . ';charset=utf8mb4';

    return new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
}

/** Shared connection. Also self-heals: missing tables or an old schema are fixed automatically. */
function fb_db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    $c   = fb_config();
    $pdo = fb_connect($c['db_host'], $c['db_user'], $c['db_pass'], $c['db_name']);

    try {
        $version = (int) fb_setting_row($pdo, 'db_version');
    } catch (PDOException $e) {
        $version = 0; // tables missing
    }
    if ($version < FB_DB_VERSION) {
        fb_install_schema($pdo, $c['db_prefix']);
        fb_setting_write($pdo, 'db_version', (string) FB_DB_VERSION);
    }
    return $pdo;
}

/** True when a database is configured and reachable. The game itself never requires one. */
function fb_db_ok(): bool
{
    static $ok = null;
    if ($ok === null) {
        $ok = false;
        if (fb_installed()) {
            try {
                fb_db();
                $ok = true;
            } catch (Throwable $e) {
                error_log('Flying Bird: database unavailable: ' . $e->getMessage());
            }
        }
    }
    return $ok;
}

function fb_table(string $name): string
{
    return '`' . fb_config()['db_prefix'] . $name . '`';
}

/** Run database/schema.sql with the table prefix applied. */
function fb_install_schema(PDO $pdo, string $prefix): void
{
    $sql = file_get_contents(FB_ROOT . '/database/schema.sql');
    if ($sql === false) {
        throw new RuntimeException('database/schema.sql is missing.');
    }
    $sql = preg_replace('/^--.*$/m', '', $sql);
    $sql = str_replace('{prefix}', $prefix, $sql);
    foreach (array_filter(array_map('trim', explode(';', $sql))) as $statement) {
        $pdo->exec($statement);
    }
    // Future schema changes go here, guarded by version, e.g.:
    // if ($from < 2) { $pdo->exec("ALTER TABLE ..."); }
}

function fb_setting_row(PDO $pdo, string $name): ?string
{
    $stmt = $pdo->prepare('SELECT `value` FROM ' . fb_table('settings') . ' WHERE `name` = ?');
    $stmt->execute([$name]);
    $v = $stmt->fetchColumn();
    return $v === false ? null : (string) $v;
}

function fb_setting_write(PDO $pdo, string $name, string $value): void
{
    $pdo->prepare('REPLACE INTO ' . fb_table('settings') . ' (`name`, `value`) VALUES (?, ?)')
        ->execute([$name, $value]);
}

/* ---------- Scores ---------- */

function fb_scores_top(int $limit): array
{
    $limit = max(1, min(100, $limit));
    $rows  = fb_db()->query('SELECT player_name AS name, score FROM ' . fb_table('scores')
        . ' ORDER BY score DESC, id ASC LIMIT ' . $limit)->fetchAll();
    foreach ($rows as &$r) {
        $r['score'] = (int) $r['score'];
    }
    return $rows;
}

function fb_scores_add(string $name, int $score, int $durationMs, string $ipHash): int
{
    $pdo = fb_db();
    $pdo->prepare('INSERT INTO ' . fb_table('scores') . ' (player_name, score, duration_ms, ip_hash, created_at) VALUES (?,?,?,?,?)')
        ->execute([mb_substr($name, 0, 40), $score, $durationMs, $ipHash, gmdate('Y-m-d H:i:s')]);
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
    return fb_db()->query('SELECT id, player_name, score, created_at FROM ' . fb_table('scores')
        . ' ORDER BY id DESC LIMIT ' . (int) $perPage . ' OFFSET ' . (int) $offset)->fetchAll();
}

function fb_scores_delete(int $id): void
{
    fb_db()->prepare('DELETE FROM ' . fb_table('scores') . ' WHERE id = ?')->execute([$id]);
}

function fb_scores_reset(): void
{
    fb_db()->exec('TRUNCATE TABLE ' . fb_table('scores'));
}
