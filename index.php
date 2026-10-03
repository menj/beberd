<?php
declare(strict_types=1);

require __DIR__ . '/includes/bootstrap.php';

fb_security_headers();

// The game runs with or without a database. Without one, defaults apply,
// scores stay in the browser, and ?scheme= / ?difficulty= still work.
$hasDb  = fb_db_ok();
$s      = fb_settings();
if (!$hasDb) {
    $q = $_GET['scheme'] ?? '';
    $s['scheme'] = is_string($q) && isset(fb_schemes()[$q]) && $q !== 'custom' ? $q : $s['scheme'];
    $q = $_GET['difficulty'] ?? '';
    $s['difficulty'] = is_string($q) && isset(fb_difficulties()[$q]) ? $q : $s['difficulty'];
}
$scheme = $s['scheme'];
$style  = $scheme === 'custom' ? fb_custom_style($s['custom']) : '';

$config = [
    'apiUrl'      => 'api.php',
    'csrf'        => $hasDb ? fb_csrf_token() : '',
    'leaderboard' => $hasDb && $s['leaderboard'],
    'showBoard'   => $hasDb && $s['leaderboard'],
    'sound'       => (bool) $s['sound'],
    'audioUrl'    => 'audio/',
];
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title><?= fb_h($s['site_title']) ?></title>
    <meta name="color-scheme" content="light dark">
    <link rel="stylesheet" href="css/game.css">
    <link rel="stylesheet" href="css/site.css">
</head>
<body class="fb-body">
    <main class="fb-shell">
        <div class="fb-game" data-scheme="<?= fb_h($scheme) ?>" data-difficulty="<?= fb_h($s['difficulty']) ?>"<?= $style ? ' style="' . fb_h($style) . '"' : '' ?>>
            <noscript>Flying Bird needs JavaScript to run.</noscript>
        </div>
    </main>
    <footer class="fb-footer"><?php if (fb_installed()): ?><a href="admin.php">Settings</a><?php else: ?><a href="install.php">Enable leaderboard &amp; settings (optional)</a><?php endif; ?></footer>

    <script type="application/json" id="fb-config"><?= json_encode($config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?></script>
    <script src="js/sprite.js"></script>
    <script src="js/game.js"></script>
</body>
</html>
