<?php
/**
 * JSON API:  GET  api.php[?mode=daily&day=YYYY-MM-DD] -> top scores
 *            POST api.php -> save a score  {name, score, duration, mode, day}
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

    $in       = json_decode((string) file_get_contents('php://input'), true);
    $score    = is_array($in) ? (int) ($in['score'] ?? 0) : 0;
    $duration = is_array($in) ? (int) ($in['duration'] ?? 0) : 0;
    if ($score < 1 || $score > 100000) {
        fb_json(400, ['message' => 'Invalid score.']);
    }
    // Plausibility: nobody clears a pipe faster than ~0.7 s on average.
    if ($duration < $score * 700) {
        fb_json(400, ['message' => 'That score could not be verified.']);
    }

    $mode = is_array($in) && ($in['mode'] ?? '') === 'daily' ? 'daily' : 'classic';
    $day  = is_array($in) ? (string) ($in['day'] ?? '') : '';
    if ($mode === 'daily' && !fb_day_valid($day)) {
        fb_json(400, ['message' => "That daily challenge has ended."]);
    }

    $ipHash = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . fb_config()['salt']);
    if (fb_scores_recent_from($ipHash, 5)) {
        fb_json(429, ['message' => 'Slow down a little.']);
    }

    $name = is_array($in) ? (string) ($in['name'] ?? '') : '';
    $name = trim(preg_replace('/[\x00-\x1F\x7F<>]/u', '', $name) ?? '');
    $name = $name !== '' ? mb_substr($name, 0, 24) : 'Anonymous';

    fb_scores_add($name, $score, $duration, $ipHash, $mode, $day);
    fb_json(200, ['scores' => fb_scores_top((int) $s['leaderboard_size'], $mode, $day)]);
} catch (Throwable $e) {
    error_log('Flying Bird API: ' . $e->getMessage());
    fb_json(500, ['message' => 'Server error.']);
}
