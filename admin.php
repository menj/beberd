<?php
/**
 * Admin panel (optional – only available once the installer has run).
 * Tabbed settings: General, Appearance, Gameplay, Scores, Database, Account.
 */

declare(strict_types=1);

require __DIR__ . '/includes/bootstrap.php';
fb_security_headers();

if (!fb_installed()) {
    fb_redirect('install.php');
}
fb_session();

$dbOk = fb_db_ok();
$tabs = fb_tabs();
$tab  = isset($_GET['tab']) && isset($tabs[$_GET['tab']]) ? (string) $_GET['tab'] : 'general';

function fb_flash(?string $msg = null, string $type = 'ok'): ?array
{
    if ($msg !== null) {
        $_SESSION['flash'] = [$type, $msg];
        return null;
    }
    $f = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);
    return $f;
}

function fb_find_user(string $username): ?array
{
    $stmt = fb_db()->prepare('SELECT * FROM ' . fb_table('users') . ' WHERE username = ?');
    $stmt->execute([$username]);
    return $stmt->fetch() ?: null;
}

/* ---------- Actions ---------- */

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = (string) ($_POST['action'] ?? '');

    if (!fb_csrf_valid($_POST['csrf'] ?? null)) {
        fb_flash('Session expired. Please try again.', 'bad');
        fb_redirect('admin.php');
    }

    if ($action === 'login' && $dbOk) {
        $user = fb_find_user(trim((string) ($_POST['username'] ?? '')));
        if ($user && password_verify((string) ($_POST['password'] ?? ''), $user['password_hash'])) {
            session_regenerate_id(true);
            $_SESSION['uid'] = (int) $user['id'];
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
            fb_redirect('admin.php');
        }
        usleep(700000); // slow down guessing
        fb_flash('Wrong username or password.', 'bad');
        fb_redirect('admin.php');
    }

    if (empty($_SESSION['uid'])) {
        fb_redirect('admin.php');
    }

    switch ($action) {
        case 'logout':
            $_SESSION = [];
            session_destroy();
            fb_redirect('admin.php');

        case 'save_settings':
            $t = (string) ($_POST['tab'] ?? '');
            if (isset($tabs[$t])) {
                fb_settings_save(fb_settings_sanitize($t, (array) ($_POST['s'] ?? []), fb_settings()));
                fb_flash('Settings saved.');
            }
            fb_redirect('admin.php?tab=' . urlencode($t));

        case 'delete_score':
            fb_scores_delete((int) ($_POST['id'] ?? 0));
            fb_flash('Score deleted.');
            fb_redirect('admin.php?tab=scores');

        case 'reset_scores':
            fb_scores_reset();
            fb_flash('All scores deleted.');
            fb_redirect('admin.php?tab=scores');

        case 'repair_db':
            fb_install_schema(fb_db(), fb_config()['db_prefix'], fb_driver());
            fb_setting_write(fb_db(), 'db_version', (string) FB_DB_VERSION);
            fb_flash('Database tables checked and repaired.');
            fb_redirect('admin.php?tab=database');

        case 'change_password':
            $new  = (string) ($_POST['new_password'] ?? '');
            $stmt = fb_db()->prepare('SELECT * FROM ' . fb_table('users') . ' WHERE id = ?');
            $stmt->execute([$_SESSION['uid']]);
            $me = $stmt->fetch();
            if (!$me || !password_verify((string) ($_POST['current_password'] ?? ''), $me['password_hash'])) {
                fb_flash('Current password is incorrect.', 'bad');
            } elseif (strlen($new) < 8 || $new !== (string) ($_POST['new_password2'] ?? '')) {
                fb_flash('New password must be 8+ characters and match the confirmation.', 'bad');
            } else {
                fb_db()->prepare('UPDATE ' . fb_table('users') . ' SET password_hash = ? WHERE id = ?')
                    ->execute([password_hash($new, PASSWORD_DEFAULT), $me['id']]);
                fb_flash('Password updated.');
            }
            fb_redirect('admin.php?tab=account');
    }
    fb_redirect('admin.php');
}

$flash    = fb_flash();
$loggedIn = !empty($_SESSION['uid']);
$s        = $dbOk ? fb_settings() : fb_setting_defaults();

function fb_input_name(string $field): string
{
    return 's[' . $field . ']';
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex">
    <title>Settings · <?= fb_h($s['site_title']) ?></title>
    <meta name="color-scheme" content="light dark">
    <link rel="stylesheet" href="css/game.css">
    <link rel="stylesheet" href="css/site.css">
    <link rel="stylesheet" href="css/admin.css">
</head>
<body class="fb-body">
<main class="fb-shell fb-top">
<div class="fb-panel fb-wide">
    <header class="fb-admin-head">
        <h1 class="fb-h1">Flying Bird</h1>
        <nav class="fb-links">
            <a href="index.php">View game</a>
            <?php if ($loggedIn): ?>
                <form method="post"><?= fb_csrf_field() ?><input type="hidden" name="action" value="logout"><button class="fb-link-btn">Log out</button></form>
            <?php endif; ?>
        </nav>
    </header>

    <?php if ($flash): ?>
        <div class="fb-alert <?= $flash[0] === 'ok' ? 'fb-alert-ok' : '' ?>" role="status"><?= fb_h($flash[1]) ?></div>
    <?php endif; ?>

    <?php if (!$dbOk): ?>
        <div class="fb-alert" role="alert">The database is not reachable, so settings are unavailable. The game itself keeps working. Check the credentials in <code>config.php</code>.</div>
    <?php elseif (!$loggedIn): ?>
        <form method="post" class="fb-form-stack fb-narrow-form">
            <?= fb_csrf_field() ?>
            <input type="hidden" name="action" value="login">
            <label>Username <input name="username" autocomplete="username" required autofocus></label>
            <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
            <button class="fb-btn" type="submit">Log in</button>
        </form>
    <?php else: ?>
        <nav class="fb-tabs" aria-label="Settings sections">
            <?php foreach ($tabs as $key => $label): ?>
                <a href="admin.php?tab=<?= fb_h($key) ?>"<?= $key === $tab ? ' class="is-active" aria-current="page"' : '' ?>><?= fb_h($label) ?></a>
            <?php endforeach; ?>
        </nav>

        <section class="fb-tab-panel">
        <?php
        /** Open / close a settings form for one tab. */
        $open  = static function (string $t): void {
            echo '<form method="post">' . fb_csrf_field()
                . '<input type="hidden" name="action" value="save_settings"><input type="hidden" name="tab" value="' . fb_h($t) . '">';
        };
        $close = static function (): void {
            echo '<p><button class="fb-btn fb-btn-auto" type="submit">Save changes</button></p></form>';
        };

        if ($tab === 'general'):
            $open('general'); ?>
            <div class="fb-field"><label for="f-title">Site title</label>
                <input id="f-title" name="<?= fb_input_name('site_title') ?>" value="<?= fb_h($s['site_title']) ?>" maxlength="60"></div>
            <div class="fb-field"><span class="fb-label">Leaderboard</span>
                <label class="fb-check"><input type="checkbox" name="<?= fb_input_name('leaderboard') ?>" value="1" <?= $s['leaderboard'] ? 'checked' : '' ?>> Enable the public leaderboard</label></div>
            <div class="fb-field"><label for="f-size">Entries shown</label>
                <input id="f-size" type="number" min="3" max="50" name="<?= fb_input_name('leaderboard_size') ?>" value="<?= (int) $s['leaderboard_size'] ?>"></div>
            <?php $close();

        elseif ($tab === 'appearance'):
            $open('appearance'); ?>
            <h2 class="fb-h2">Colour scheme</h2>
            <div class="fb-schemes" role="radiogroup">
                <?php foreach (fb_schemes() as $key => $label): ?>
                    <label class="fb-scheme">
                        <input type="radio" name="<?= fb_input_name('scheme') ?>" value="<?= fb_h($key) ?>" <?= $s['scheme'] === $key ? 'checked' : '' ?>>
                        <span class="fb-swatch fb-game" data-scheme="<?= fb_h($key) ?>"<?= $key === 'custom' ? ' style="' . fb_h(fb_custom_style($s['custom'])) . '"' : '' ?>>
                            <i style="background:linear-gradient(var(--fb-bg1),var(--fb-bg2))"></i><i style="background:var(--fb-pipe)"></i><i style="background:var(--fb-bird)"></i><i style="background:var(--fb-accent)"></i>
                        </span>
                        <span class="fb-scheme-name"><?= fb_h($label) ?></span>
                    </label>
                <?php endforeach; ?>
            </div>
            <div class="fb-custom" hidden>
                <h2 class="fb-h2">Custom colours</h2>
                <div class="fb-colours">
                    <?php foreach (fb_colour_fields() as $key => $label): ?>
                        <label class="fb-colour"><input type="color" data-token="<?= fb_h($key) ?>" name="s[custom][<?= fb_h($key) ?>]" value="<?= fb_h($s['custom'][$key]) ?>"><span><?= fb_h($label) ?></span></label>
                    <?php endforeach; ?>
                </div>
            </div>
            <?php $close();

        elseif ($tab === 'gameplay'):
            $open('gameplay'); ?>
            <div class="fb-field"><span class="fb-label">Difficulty</span>
                <?php foreach (fb_difficulties() as $key => $label): ?>
                    <label class="fb-check"><input type="radio" name="<?= fb_input_name('difficulty') ?>" value="<?= fb_h($key) ?>" <?= $s['difficulty'] === $key ? 'checked' : '' ?>> <?= fb_h($label) ?></label>
                <?php endforeach; ?>
                <p class="fb-muted">Controls gap size and scroll speed.</p></div>
            <div class="fb-field"><span class="fb-label">Sound</span>
                <label class="fb-check"><input type="checkbox" name="<?= fb_input_name('sound') ?>" value="1" <?= $s['sound'] ? 'checked' : '' ?>> On by default (players can mute with M)</label>
                <label class="fb-check"><input type="checkbox" name="<?= fb_input_name('music') ?>" value="1" <?= $s['music'] ? 'checked' : '' ?>> Background music (speeds up as the score climbs)</label></div>
            <div class="fb-field"><span class="fb-label">Admin cheat</span>
                <label class="fb-check"><input type="checkbox" name="<?= fb_input_name('admin_cheat') ?>" value="1" <?= $s['admin_cheat'] ? 'checked' : '' ?>> Enable god mode for logged-in admins</label>
                <p class="fb-muted">While logged in here, type <code>IDDQD</code> on the game page (or use the shield button) to toggle god mode. Visitors never get it, and god-mode runs are not recorded in scores, medals or unlocks.</p></div>
            <?php $close();

        elseif ($tab === 'scores'):
            $per = 20;
            $page = max(1, (int) ($_GET['p'] ?? 1));
            $total = fb_scores_count();
            $rows = fb_scores_page($per, $page); ?>
            <p class="fb-muted"><?= number_format($total) ?> score<?= $total === 1 ? '' : 's' ?> recorded.</p>
            <table class="fb-table">
                <thead><tr><th>Player</th><th>Score</th><th>Mode</th><th>Date (UTC)</th><th></th></tr></thead>
                <tbody>
                <?php if (!$rows): ?><tr><td colspan="5" class="fb-muted">No scores yet.</td></tr><?php endif; ?>
                <?php foreach ($rows as $r): ?>
                    <tr>
                        <td><?= fb_h($r['player_name']) ?></td>
                        <td><strong><?= (int) $r['score'] ?></strong></td>
                        <td><?= $r['mode'] === 'daily' ? 'Daily ' . fb_h($r['day']) : 'Classic' ?></td>
                        <td><?= fb_h($r['created_at']) ?></td>
                        <td class="fb-right"><form method="post"><?= fb_csrf_field() ?><input type="hidden" name="action" value="delete_score"><input type="hidden" name="id" value="<?= (int) $r['id'] ?>"><button class="fb-link-btn fb-danger-text">Delete</button></form></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
            <?php if ($total > $per): ?>
                <p class="fb-pager">
                    <?php if ($page > 1): ?><a href="admin.php?tab=scores&amp;p=<?= $page - 1 ?>">‹ Newer</a><?php endif; ?>
                    <?php if ($page * $per < $total): ?><a href="admin.php?tab=scores&amp;p=<?= $page + 1 ?>">Older ›</a><?php endif; ?>
                </p>
            <?php endif; ?>
            <?php if ($total): ?>
            <form method="post" data-confirm="Delete ALL scores? This cannot be undone."><?= fb_csrf_field() ?><input type="hidden" name="action" value="reset_scores"><button class="fb-btn fb-btn-ghost fb-btn-auto fb-danger-text">Delete all scores</button></form>
            <?php endif;

        elseif ($tab === 'database'):
            $pdo = fb_db();
            $tables = ['settings', 'users', 'scores'];
            $c = fb_config(); ?>
            <p class="fb-muted">Tables are created and upgraded automatically by the installer and whenever the schema version changes. No manual SQL import is needed.</p>
            <table class="fb-table">
                <tbody>
                    <tr><th>Server</th><td><?= fb_h($pdo->getAttribute(PDO::ATTR_SERVER_VERSION)) ?></td></tr>
                    <tr><th>Engine</th><td><?= fb_h(fb_drivers()[fb_driver()]['label']) ?></td></tr>
                    <tr><th>Database</th><td><?php if (fb_driver() === 'sqlite'): ?><code><?= fb_h($c['db_path']) ?></code><?php else: ?><code><?= fb_h($c['db_name']) ?></code> on <code><?= fb_h($c['db_host']) ?></code><?php endif; ?></td></tr>
                    <tr><th>Schema version</th><td><?= (int) fb_setting_row($pdo, 'db_version') ?> / <?= FB_DB_VERSION ?></td></tr>
                    <?php foreach ($tables as $t):
                        try { $n = (int) $pdo->query('SELECT COUNT(*) FROM ' . fb_table($t))->fetchColumn(); $ok = true; } catch (Throwable $e) { $n = 0; $ok = false; } ?>
                        <tr><th><code><?= fb_h($c['db_prefix'] . $t) ?></code></th><td><span class="fb-pill <?= $ok ? 'is-ok' : 'is-bad' ?>"><?= $ok ? 'OK' : 'Missing' ?></span> <?= $ok ? number_format($n) . ' rows' : '' ?></td></tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
            <form method="post"><?= fb_csrf_field() ?><input type="hidden" name="action" value="repair_db"><button class="fb-btn fb-btn-auto">Check &amp; repair tables</button> <span class="fb-muted">Safe to run; existing data is kept.</span></form>
            <?php

        elseif ($tab === 'account'): ?>
            <form method="post" class="fb-form-stack fb-narrow-form"><?= fb_csrf_field() ?>
                <input type="hidden" name="action" value="change_password">
                <label>Current password <input type="password" name="current_password" autocomplete="current-password" required></label>
                <label>New password <input type="password" name="new_password" minlength="8" autocomplete="new-password" required></label>
                <label>Repeat new password <input type="password" name="new_password2" minlength="8" autocomplete="new-password" required></label>
                <button class="fb-btn fb-btn-auto" type="submit">Update password</button>
            </form>
        <?php endif; ?>
        </section>
    <?php endif; ?>
</div>
</main>
<script src="js/admin.js"></script>
</body>
</html>
