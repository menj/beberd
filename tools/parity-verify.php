<?php
/**
 * Parity check, PHP side: reads runs recorded by tools/parity-harness.js (one JSON object per line on
 * stdin: {"replay": {...}, "score": N, "official": "normal"}) and re-plays each one with the server's
 * verifier (includes/replay.php). "official" is the difficulty the server treats as official for that
 * run (falls back to the replay's own difficulty). Prints one line per FAILING run and a final summary,
 * and exits non-zero on any mismatch, on a run the harness could not record, or on a short count.
 *
 *   node tools/parity-harness.js 200 | php tools/parity-verify.php
 */
declare(strict_types=1);

require __DIR__ . '/../includes/replay.php';
if (!function_exists('fb_day_valid')) {
    function fb_day_valid(string $day): bool { return $day === gmdate('Y-m-d') || $day === gmdate('Y-m-d', time() - 3600); }
}

$total = $bad = 0;
$expected = null; $missing = 0;
while (($line = fgets(STDIN)) !== false) {
    $line = trim($line);
    if ($line === '') { continue; }
    $run = json_decode($line, true);
    if (is_array($run) && isset($run['harness'])) { $expected = (int) ($run['harness']['runs'] ?? 0); $missing = (int) ($run['harness']['missing'] ?? 0); continue; }
    if (!is_array($run) || !isset($run['replay'])) { continue; }
    $total++;
    $r = $run['replay'];
    $res = fb_replay_verify($r, (string) ($run['official'] ?? $r['difficulty'] ?? 'normal'));
    $ok = !empty($res['ok']) && (int) $res['score'] === (int) $run['score'] && (int) $res['steps'] === (int) $r['steps'];
    if (!$ok) {
        $bad++;
        fwrite(STDOUT, sprintf("FAIL #%d mode=%s diff=%s browser score=%d steps=%d -> server %s\n", $total, $r['mode'], $r['difficulty'],
            $run['score'], $r['steps'], json_encode($res)));
    }
}
if ($missing > 0) { $bad += $missing; echo "$missing run(s) produced no replay: parity check is incomplete\n"; }
if ($expected === null) { $bad++; echo "no harness summary line: the harness did not finish\n"; }
elseif ($total + $missing !== $expected) { $bad++; echo "expected $expected runs, verified $total\n"; }
printf("%d runs, %d mismatches\n", $total, $bad);
exit($bad === 0 && $total > 0 ? 0 : 1);
