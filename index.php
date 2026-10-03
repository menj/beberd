<?php
declare(strict_types=1);

require __DIR__ . '/includes/bootstrap.php';

fb_security_headers();

// tools/build-standalone.php defines FB_STANDALONE_BUILD to render a static, server-free copy of this page.
$standalone = defined('FB_STANDALONE_BUILD');

// The game runs with or without a database. Without one, defaults apply and
// scores stay in the browser. ?scheme= / ?difficulty= preview a look either way.
$hasDb  = !$standalone && fb_db_ok();
$s      = $standalone ? fb_setting_defaults() : fb_settings();
$q = $_GET['scheme'] ?? '';
if (is_string($q) && isset(fb_schemes()[$q]) && ($q !== 'custom' || $hasDb)) {
    $s['scheme'] = $q;
}
$q = $_GET['difficulty'] ?? '';
if (is_string($q) && isset(fb_difficulties()[$q])) {
    $s['difficulty'] = $q;
}
$scheme = $s['scheme'];
$style  = $scheme === 'custom' ? fb_custom_style($s['custom']) : '';

// Admin-only cheat: decided on the server from the admin session, never from the URL.
$isAdmin = $hasDb && !empty($s['admin_cheat']) && fb_is_admin();

// Hosting inside an arcade hub: back-link and share-preview address (settings first, then config.php).
$arcadeUrl  = $standalone ? '' : fb_safe_url($s['arcade_url'] !== '' ? $s['arcade_url'] : (fb_config()['arcade_url'] ?? ''));
$publicUrl  = $standalone ? '' : fb_public_url($s['public_url'] !== '' ? $s['public_url'] : (string) (fb_config()['public_url'] ?? ''));
$shareDesc  = 'Help Hamilton cross the Great Pipes. A tiny bird, a daily challenge, power-ups and a lot of pipes.';
if ($isAdmin) {
    header('Cache-Control: no-store'); // keep the admin-enabled page out of shared caches
}

$config = [
    'apiUrl'      => 'api.php',
    'csrf'        => $hasDb ? fb_csrf_token() : '',
    'leaderboard' => $hasDb && $s['leaderboard'],
    'showBoard'   => $hasDb && $s['leaderboard'],
    'appName'     => FB_APP_NAME,
    'sound'       => (bool) $s['sound'],
    'admin'       => $isAdmin,
    'music'       => (bool) $s['music'],
    'today'       => $standalone ? null : fb_today(),
    'arcadeUrl'   => $arcadeUrl,
    'startMode'   => ($_GET['mode'] ?? '') === 'daily' ? 'daily' : 'classic', // app shortcut / deep link
];
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <?= $standalone ? '' : fb_base_tag() ?>

    <title><?= fb_h($s['site_title']) ?></title>
    <meta name="description" content="<?= fb_h($shareDesc) ?>">
    <meta property="og:type" content="website">
    <meta property="og:title" content="<?= fb_h($s['site_title']) ?>">
    <meta property="og:description" content="<?= fb_h($shareDesc) ?>">
    <meta property="og:image" content="<?= fb_h($publicUrl) ?>img/og.png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <?php if ($publicUrl !== ''): ?><meta property="og:url" content="<?= fb_h($publicUrl) ?>">
    <?php endif; ?><meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="<?= fb_h($s['site_title']) ?>">
    <meta name="twitter:description" content="<?= fb_h($shareDesc) ?>">
    <meta name="twitter:image" content="<?= fb_h($publicUrl) ?>img/og.png">
    <meta name="color-scheme" content="light dark">
    <meta name="theme-color" content="#0b1026">
    <link rel="manifest" href="manifest.webmanifest">
    <link rel="icon" href="icons/icon.svg" type="image/svg+xml">
    <link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-title" content="<?= fb_h(FB_APP_NAME) ?>">
    <link rel="stylesheet" href="css/game.css">
    <link rel="stylesheet" href="css/site.css">
</head>
<body class="fb-body">
    <main class="fb-shell">
        <div class="fb-game" data-scheme="<?= fb_h($scheme) ?>" data-difficulty="<?= fb_h($s['difficulty']) ?>"<?= $style ? ' style="' . fb_h($style) . '"' : '' ?>>
            <noscript><?= fb_h(FB_APP_NAME) ?> needs JavaScript to run.</noscript>
        </div>
    </main>
    <footer class="fb-footer"><?php if ($standalone): ?><?php elseif (fb_installed()): ?><a href="admin.php">Settings</a><?php else: ?><a href="install.php">Enable leaderboard &amp; settings (optional)</a><?php endif; ?></footer>

    <script type="application/json" id="fb-config"><?= json_encode($config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?></script>
    <script src="js/sprite.js"></script>
    <script src="js/audio.js"></script>
    <script src="js/game.js"></script>
    <script src="js/pwa.js"></script>
</body>
</html>
