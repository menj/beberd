<?php
/**
 * JSON API:  GET  api.php[?mode=daily&day=YYYY-MM-DD] -> top scores
 *            POST api.php -> save a score  {name, score, replay:{seed, mode, day, difficulty, steps, flaps}}
 */

declare(strict_types=1);

require __DIR__ . '/includes/bootstrap.php';
fb_security_headers();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function fb_json(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

if (!fb_db_ok()) {
    // No database: the game still works; it just has no shared leaderboard.
    fb_json($_SERVER['REQUEST_METHOD'] === 'GET' ? 200 : 503, $_SERVER['REQUEST_METHOD'] === 'GET' ? [] : ['message' => 'Leaderboard unavailable.']);
}

try {
    $s = fb_settings();
    if (!$s['leaderboard']) {
        fb_json(200, $_SERVER['REQUEST_METHOD'] === 'GET' ? [] : ['message' => 'The leaderboard is disabled.']);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $mode = ($_GET['mode'] ?? '') === 'daily' ? 'daily' : 'classic';
        $day  = isset($_GET['day']) && is_string($_GET['day']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['day']) ? $_GET['day'] : fb_today();
        fb_json(200, fb_scores_top((int) $s['leaderboard_size'], $mode, $day));
    }
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        fb_json(405, ['message' => 'Method not allowed.']);
    }

    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? null;
    if (!fb_csrf_valid($token)) {
        fb_json(403, ['message' => 'Session expired. Reload the page.']);
    }

    $in = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($in)) {
        fb_json(400, ['message' => 'Invalid request.']);
    }

    // The server re-plays the run from its seed and flaps; only a score the replay really
    // produces is accepted, so edited scores, god mode and impossible runs are rejected.
    $replay = isset($in['replay']) && is_array($in['replay']) ? $in['replay'] : null;
    if ($replay === null) {
        fb_json(400, ['message' => 'Please reload the page to update the game.']);
    }
    $check = fb_replay_verify($replay, (string) $s['difficulty']);
    if (!$check['ok'] || $check['score'] < 1 || (int) ($in['score'] ?? -1) !== $check['score']) {
        error_log('Beberd: rejected run (' . ($check['error'] ?? 'score mismatch') . ')');
        fb_json(400, ['message' => 'That run could not be verified.']);
    }
    $score    = $check['score'];
    $duration = (int) round($check['steps'] * 1000 / 60);
    $mode     = $replay['mode'] === 'daily' ? 'daily' : 'classic';
    $day      = $mode === 'daily' ? (string) $replay['day'] : '';

    $ipHash = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . fb_config()['salt']);
    if (fb_scores_recent_from($ipHash, 5)) {
        fb_json(429, ['message' => 'Slow down a little.']);
    }

    $name = (string) ($in['name'] ?? '');
    $name = trim(preg_replace('/[\x00-\x1F\x7F<>]/u', '', $name) ?? '');
    $name = $name !== '' ? mb_substr($name, 0, 24) : 'Anonymous';

    fb_scores_add($name, $score, $duration, $ipHash, $mode, $day);
    fb_json(200, ['scores' => fb_scores_top((int) $s['leaderboard_size'], $mode, $day)]);
} catch (Throwable $e) {
    error_log('Beberd API: ' . $e->getMessage());
    fb_json(500, ['message' => 'Server error.']);
}
