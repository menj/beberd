<?php
/**
 * Build a static copy of the game that needs no PHP or database:
 *
 *     php tools/build-standalone.php > standalone.html
 *
 * It renders index.php in "standalone" mode (default settings, no leaderboard, no admin).
 * Re-run it whenever index.php changes. On a static host, upload standalone.html next to
 * css/, js/, icons/ and img/ (rename it index.html if you want it to be the front page).
 */

declare(strict_types=1);

define('FB_STANDALONE_BUILD', true);
chdir(dirname(__DIR__));
$_SERVER['SCRIPT_NAME'] = '/index.php';
$_GET = [];
require dirname(__DIR__) . '/index.php';
