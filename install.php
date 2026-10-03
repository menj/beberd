<?php
/**
 * Web installer – the first-run wizard, in the spirit of WordPress.
 * Pick a database engine (MySQL/MariaDB, PostgreSQL or SQLite), and it creates the
 * database + tables, creates the admin account and writes config.php.
 * Locks itself once config.php exists.
 */

declare(strict_types=1);

require __DIR__ . '/includes/bootstrap.php';
fb_security_headers();
fb_session();

$errors = [];
$drivers = fb_drivers();
$available = array_keys(array_filter($drivers, static fn ($d) => extension_loaded($d['ext'])));

$values = [
    'db_driver' => $available[0] ?? 'mysql',
    'db_host' => 'localhost', 'db_name' => 'flying_bird', 'db_user' => '', 'db_prefix' => 'fb_',
    'db_path' => 'data/beberd.sqlite',
    'site_title' => FB_APP_NAME, 'admin_user' => 'admin',
];

$checks = [
    'PHP 7.4 or newer'                      => PHP_VERSION_ID >= 70400,
    'mbstring extension'                    => extension_loaded('mbstring'),
    'Folder is writable (to save config)'   => is_writable(FB_ROOT),
    'A database driver is available'        => $available !== [],
];
foreach ($drivers as $key => $d) {
    $checks[$d['label'] . ' (' . $d['ext'] . ')'] = extension_loaded($d['ext']);
}
// Only the first four checks block installation; driver rows are informational.
$ready = !in_array(false, array_slice($checks, 0, 4), true);

if (fb_installed()) {
    $state = 'locked';
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST' && $ready) {
    $state = 'form';
    if (!fb_csrf_valid($_POST['csrf'] ?? null)) {
        $errors[] = 'Your session expired. Please try again.';
    }
    foreach (array_keys($values) as $k) {
        $values[$k] = trim((string) ($_POST[$k] ?? ''));
    }
    $driver    = $values['db_driver'];
    $dbPass    = (string) ($_POST['db_pass'] ?? '');
    $adminPass = (string) ($_POST['admin_pass'] ?? '');

    if (!in_array($driver, $available, true)) {
        $errors[] = 'Choose a database engine that is installed on this server.';
    } elseif ($driver === 'sqlite') {
        $path = $values['db_path'];
        if (!preg_match('#^[A-Za-z0-9_./-]{1,200}\.(sqlite3?|db)$#', $path) || strpos($path, '..') !== false) {
            $errors[] = 'SQLite file must be a simple path ending in .sqlite, .sqlite3 or .db (no "..").';
        }
    } else {
        if ($values['db_host'] === '' || $values['db_name'] === '' || $values['db_user'] === '') {
            $errors[] = 'Database host, name and user are required.';
        }
        if (!preg_match('/^[A-Za-z0-9_]+$/', $values['db_name'])) {
            $errors[] = 'Database name may only contain letters, numbers and underscores.';
        }
    }
    if (!preg_match('/^[A-Za-z0-9_]{0,20}$/', $values['db_prefix'])) {
        $errors[] = 'Table prefix may only contain letters, numbers and underscores (max 20).';
    }
    if (!preg_match('/^[A-Za-z0-9_.-]{3,60}$/', $values['admin_user'])) {
        $errors[] = 'Admin username must be 3–60 characters (letters, numbers, . _ -).';
    }
    if (strlen($adminPass) < 8) {
        $errors[] = 'Admin password must be at least 8 characters.';
    }
    if ($adminPass !== (string) ($_POST['admin_pass2'] ?? '')) {
        $errors[] = 'The admin passwords do not match.';
    }

    if (!$errors) {
        try {
            $config = [
                'db_driver' => $driver,
                'db_host'   => $values['db_host'],
                'db_name'   => $values['db_name'],
                'db_user'   => $values['db_user'],
                'db_pass'   => $dbPass,
                'db_prefix' => $values['db_prefix'],
                'db_path'   => $values['db_path'],
                'salt'      => bin2hex(random_bytes(16)),
            ];

            // 1. Create the database where the engine allows it, then connect.
            if ($driver !== 'sqlite') {
                fb_create_database($config);
            }
            $pdo = fb_connect($config);

            // Let the shared helpers run before config.php exists.
            $reg = &fb_registry();
            $reg['config'] = $config;
            $reg['pdo']    = $pdo;
            $reg['ok']     = true;

            // 2. Create tables.
            fb_install_schema($pdo, $values['db_prefix'], $driver);

            // 3. Seed settings + admin account.
            $settings = fb_setting_defaults();
            $settings['site_title'] = $values['site_title'] !== '' ? mb_substr(strip_tags($values['site_title']), 0, 60) : FB_APP_NAME;
            fb_setting_write($pdo, 'settings', json_encode($settings));
            fb_setting_write($pdo, 'db_version', (string) FB_DB_VERSION);
            $pdo->prepare('INSERT INTO ' . fb_table('users') . ' (username, password_hash, created_at) VALUES (?,?,?)')
                ->execute([$values['admin_user'], password_hash($adminPass, PASSWORD_DEFAULT), gmdate('Y-m-d H:i:s')]);

            // 4. SQLite lives in a plain file: keep it private.
            if ($driver === 'sqlite') {
                $file = fb_sqlite_path($values['db_path']);
                @chmod($file, 0640);
                $dir = dirname($file);
                if (strpos($dir, FB_ROOT) === 0 && !is_file($dir . '/.htaccess')) {
                    @file_put_contents($dir . '/.htaccess', "Require all denied\n");
                    @file_put_contents($dir . '/index.html', '');
                }
            }

            // 5. Write config.php last: its existence marks the install as complete.
            $php = "<?php\n// Generated by install.php. Delete this file to run the installer again.\nreturn " . var_export($config, true) . ";\n";
            $tmp = FB_CONFIG_FILE . '.tmp';
            if (file_put_contents($tmp, $php, LOCK_EX) === false || !rename($tmp, FB_CONFIG_FILE)) {
                throw new RuntimeException('Could not write config.php. Make the folder writable and retry.');
            }
            @chmod(FB_CONFIG_FILE, 0640);
            $state = 'done';
        } catch (Throwable $e) {
            $errors[] = $e instanceof PDOException ? 'Database error: ' . $e->getMessage() : $e->getMessage();
        }
    }
} else {
    $state = 'form';
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex">
    <?= fb_base_tag() ?>
    <title>Install · <?= fb_h(FB_APP_NAME) ?></title>
    <link rel="stylesheet" href="css/site.css">
</head>
<body class="fb-body">
<main class="fb-shell">
    <div class="fb-panel fb-narrow">
        <h1 class="fb-h1"><?= fb_h(FB_APP_NAME) ?></h1>

        <?php if ($state === 'locked'): ?>
            <p class="fb-muted">Already installed. To run the installer again, delete <code>config.php</code>.</p>
            <p><a class="fb-btn" href="index.php">Play the game</a></p>

        <?php elseif ($state === 'done'): ?>
            <p class="fb-ok">Installed on <?= fb_h($drivers[$values['db_driver']]['label']) ?>. The tables were created and your admin account is ready.</p>
            <p><a class="fb-btn" href="index.php">Play the game</a></p>
            <p><a class="fb-btn fb-btn-ghost" href="admin.php">Open settings</a></p>
            <p class="fb-muted">For safety you may delete <code>install.php</code> now.</p>

        <?php else: ?>
            <p class="fb-muted">One-minute set-up. Choose a database engine and <?= fb_h(FB_APP_NAME) ?> will create the tables for you. No SQL import needed. The game also works without any database.</p>

            <ul class="fb-checks">
                <?php foreach ($checks as $label => $ok): ?>
                    <li class="<?= $ok ? 'is-ok' : 'is-bad' ?>"><?= fb_h($label) ?></li>
                <?php endforeach; ?>
            </ul>

            <?php foreach ($errors as $err): ?>
                <div class="fb-alert" role="alert"><?= fb_h($err) ?></div>
            <?php endforeach; ?>

            <form method="post" class="fb-form-stack" autocomplete="off" id="fb-install">
                <?= fb_csrf_field() ?>
                <h2 class="fb-h2">Database</h2>
                <label>Engine
                    <select name="db_driver" id="fb-driver">
                        <?php foreach ($drivers as $key => $d): $on = extension_loaded($d['ext']); ?>
                            <option value="<?= fb_h($key) ?>" <?= $values['db_driver'] === $key ? 'selected' : '' ?><?= $on ? '' : ' disabled' ?>><?= fb_h($d['label'] . ($on ? '' : ' (not installed)')) ?></option>
                        <?php endforeach; ?>
                    </select>
                </label>

                <div class="fb-form-stack" data-for="mysql pgsql">
                    <label>Host <input name="db_host" value="<?= fb_h($values['db_host']) ?>" placeholder="localhost or host:port"></label>
                    <label>Database name <input name="db_name" value="<?= fb_h($values['db_name']) ?>"></label>
                    <label>Username <input name="db_user" value="<?= fb_h($values['db_user']) ?>"></label>
                    <label>Password <input name="db_pass" type="password"></label>
                </div>
                <div class="fb-form-stack" data-for="sqlite">
                    <label>SQLite file <input name="db_path" value="<?= fb_h($values['db_path']) ?>"></label>
                    <p class="fb-muted">Created for you. Relative paths live inside this folder and are protected by a <code>.htaccess</code> file. On nginx, or for extra safety, use an absolute path outside your web root.</p>
                </div>
                <label>Table prefix <input name="db_prefix" value="<?= fb_h($values['db_prefix']) ?>"></label>

                <h2 class="fb-h2">Site</h2>
                <label>Site title <input name="site_title" value="<?= fb_h($values['site_title']) ?>"></label>
                <label>Admin username <input name="admin_user" value="<?= fb_h($values['admin_user']) ?>"></label>
                <label>Admin password <input name="admin_pass" type="password" minlength="8"></label>
                <label>Repeat password <input name="admin_pass2" type="password" minlength="8"></label>

                <button class="fb-btn" type="submit"<?= $ready ? '' : ' disabled' ?>>Install</button>
            </form>
            <script src="js/install.js"></script>
        <?php endif; ?>
    </div>
</main>
</body>
</html>
