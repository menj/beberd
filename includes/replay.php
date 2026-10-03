<?php
/**
 * Server-side score verification.
 *
 * The browser records every run as a seed plus the simulation steps at which the
 * player flapped. This file re-plays that run with a faithful port of the game's
 * physics (js/game.js) and only accepts a score the replay really produces.
 * Coins and visual effects never change the outcome, so they are not simulated.
 *
 * KEEP IN SYNC with js/game.js: constants, spawnPipe(), the order of work in
 * update(), and hits(). The browser uses 64-bit floats like PHP, and every
 * operation is mirrored in the same order, so results match exactly.
 */

declare(strict_types=1);

const FBR_W = 420, FBR_H = 640, FBR_GROUND = 64;
const FBR_BIRD_X = 110, FBR_BIRD_R = 15;
const FBR_GRAVITY = 1500, FBR_FLAP = -430, FBR_MAX_FALL = 620;
const FBR_PIPE_W = 62, FBR_PIPE_SPACING = 224, FBR_POWER_R = 13;
const FBR_STEP = 1 / 60;
const FBR_MAX_STEPS = 36000; // 10 minutes of play

function fbr_difficulties(): array
{
    return ['easy' => ['gap' => 195, 'speed' => 130], 'normal' => ['gap' => 165, 'speed' => 150], 'hard' => ['gap' => 140, 'speed' => 172]];
}

/** Wrap to a signed 32-bit integer, like JavaScript's `| 0`. */
function fbr_i32(int $x): int
{
    $x &= 0xFFFFFFFF;
    return $x >= 0x80000000 ? $x - 0x100000000 : $x;
}

/** JavaScript's Math.imul: 32-bit multiply without losing bits to float conversion. */
function fbr_imul(int $a, int $b): int
{
    $a &= 0xFFFFFFFF;
    $b &= 0xFFFFFFFF;
    return fbr_i32($a * ($b & 0xFFFF) + ((($a * ($b >> 16)) & 0xFFFF) << 16));
}

/** Port of seedFrom() in js/game.js. */
function fbr_seed_from(string $str): int
{
    $h = fbr_i32(1779033703 ^ strlen($str));
    for ($i = 0, $n = strlen($str); $i < $n; $i++) {
        $h = fbr_imul($h ^ ord($str[$i]), 3432918353);
        $h = fbr_i32(fbr_i32($h << 13) | (($h & 0xFFFFFFFF) >> 19));
    }
    $h = fbr_imul($h ^ (($h & 0xFFFFFFFF) >> 16), 2246822507);
    $h = fbr_imul($h ^ (($h & 0xFFFFFFFF) >> 13), 3266489909);
    return ($h ^ (($h & 0xFFFFFFFF) >> 16)) & 0xFFFFFFFF;
}

/** The daily challenge seed for a UTC date. */
function fbr_daily_seed(string $day): int
{
    // The seed namespace is internal and must match seedFrom() in js/game.js; it is not the public name.
    return fbr_seed_from('flying-bird:' . $day);
}

final class FB_Sim
{
    public int $score = 0;
    public float $y;
    private float $vy;
    private int $rngState;
    private array $diff;
    private array $pipes = [];
    private array $powers = [];
    private int $spawned = 0;
    private float $lastGapY;
    private bool $shield = false;
    private float $slow = 0.0;
    private float $invuln = 0.0;

    public function __construct(int $seed, string $difficulty)
    {
        $this->rngState = fbr_i32($seed);
        $this->diff     = fbr_difficulties()[$difficulty];
        $this->y        = FBR_H * 0.42;
        $this->vy       = (float) FBR_FLAP; // a run starts with a flap
        $this->lastGapY = (FBR_H - FBR_GROUND) / 2;
        $this->spawnPipe(FBR_W + 120);
    }

    /** mulberry32 from js/game.js */
    private function rng(): float
    {
        $a = fbr_i32($this->rngState);
        $a = fbr_i32($a + 0x6D2B79F5);
        $this->rngState = $a;
        $t = fbr_imul(fbr_i32($a ^ (($a & 0xFFFFFFFF) >> 15)), fbr_i32(1 | $a));
        $t = fbr_i32(fbr_i32($t + fbr_imul(fbr_i32($t ^ (($t & 0xFFFFFFFF) >> 7)), fbr_i32(61 | $t))) ^ $t);
        return ((fbr_i32($t ^ (($t & 0xFFFFFFFF) >> 14))) & 0xFFFFFFFF) / 4294967296;
    }

    public function flap(): void
    {
        $this->vy = (float) FBR_FLAP;
    }

    private function spawnPipe(float $x): void
    {
        $n = $this->spawned++;
        $level = 1 + intdiv($n, 8);
        $u1 = $this->rng(); $u2 = $this->rng(); $u3 = $this->rng(); $u4 = $this->rng(); $u5 = $this->rng();
        $pMove   = $n >= 5 ? min(0.5, 0.15 + 0.05 * ($level - 1)) : 0;
        $pNarrow = $level >= 3 ? min(0.3, 0.1 + 0.04 * ($level - 3)) : 0;
        $kind = 'normal';
        if ($u2 < $pMove) { $kind = 'moving'; } elseif ($u2 < $pMove + $pNarrow) { $kind = 'narrow'; }
        $gap = $this->diff['gap'] * max(0.82, 1 - 0.025 * ($level - 1)) * ($kind === 'narrow' ? 0.88 : 1);
        $amp = $kind === 'moving' ? min(60, 30 + 5 * ($level - 1)) : 0;
        $margin = 90;
        $freq = min(2.3, 1.5 + 0.1 * ($level - 1));
        $min = $margin + $gap / 2 + $amp;
        $max = FBR_H - FBR_GROUND - $margin - $gap / 2 - $amp;
        $target = $min + $u1 * ($max - $min);
        $baseY = max($min, min($max, $this->lastGapY + max(-170, min(170, $target - $this->lastGapY))));
        $this->lastGapY = $baseY;
        $phase = $u1 * 6.283;
        $this->pipes[] = ['x' => $x, 'baseY' => $baseY, 'gapY' => $baseY + $amp * sin($phase), 'gap' => $gap,
            'kind' => $kind, 'amp' => $amp, 'freq' => $freq, 't' => $phase, 'passed' => false];
        if ($n >= 4 && $u3 < 0.14) {
            $kinds = ['shield', 'slow', 'magnet'];
            $this->powers[] = ['x' => $x + FBR_PIPE_W / 2 + FBR_PIPE_SPACING / 2,
                'y' => max(150, min(FBR_H - FBR_GROUND - 60, $baseY + ($u5 - 0.5) * 80)), 'kind' => $kinds[(int) floor($u4 * 3)]];
        }
        // (otherwise a coin may spawn; coins cannot change the outcome, so they are not simulated)
    }

    private function hits(array $pipe): bool
    {
        $half  = $pipe['gap'] / 2;
        $rects = [[$pipe['x'], -10, FBR_PIPE_W, $pipe['gapY'] - $half + 10], [$pipe['x'], $pipe['gapY'] + $half, FBR_PIPE_W, FBR_H]];
        foreach ($rects as $r) {
            $cx = max($r[0], min(FBR_BIRD_X, $r[0] + $r[2]));
            $cy = max($r[1], min($this->y, $r[1] + $r[3]));
            $dx = FBR_BIRD_X - $cx;
            $dy = $this->y - $cy;
            if ($dx * $dx + $dy * $dy < (FBR_BIRD_R - 3) * (FBR_BIRD_R - 3)) { return true; }
        }
        return false;
    }

    private function breakShield(): void
    {
        $this->shield = false;
        $this->invuln = 1.2;
    }

    /** Advance one fixed step. Returns true if the bird died during it. */
    public function step(): bool
    {
        $dt = FBR_STEP;
        $this->invuln = max(0, $this->invuln - $dt);
        $this->slow   = max(0, $this->slow - $dt);
        if ($this->slow > 0) { $dt *= 0.62; }
        $speed = $this->diff['speed'] + min($this->score * 2.5, 60);

        $this->vy = min($this->vy + FBR_GRAVITY * $dt, FBR_MAX_FALL);
        $this->y += $this->vy * $dt;
        if ($this->y < FBR_BIRD_R) { $this->y = (float) FBR_BIRD_R; $this->vy = 0.0; }

        for ($i = count($this->powers) - 1; $i >= 0; $i--) {
            $this->powers[$i]['x'] -= $speed * $dt;
            $pw  = $this->powers[$i];
            $pdx = $pw['x'] - FBR_BIRD_X;
            $pdy = $pw['y'] - $this->y;
            if ($pdx * $pdx + $pdy * $pdy < (FBR_BIRD_R + FBR_POWER_R - 2) * (FBR_BIRD_R + FBR_POWER_R - 2)) {
                array_splice($this->powers, $i, 1);
                if ($pw['kind'] === 'shield') { $this->shield = true; } elseif ($pw['kind'] === 'slow') { $this->slow = 5.0; }
            } elseif ($pw['x'] < -FBR_POWER_R * 2) {
                array_splice($this->powers, $i, 1);
            }
        }

        for ($i = count($this->pipes) - 1; $i >= 0; $i--) {
            $this->pipes[$i]['x'] -= $speed * $dt;
            if ($this->pipes[$i]['kind'] === 'moving') {
                $this->pipes[$i]['t'] += $dt * $this->pipes[$i]['freq'];
                $this->pipes[$i]['gapY'] = $this->pipes[$i]['baseY'] + $this->pipes[$i]['amp'] * sin($this->pipes[$i]['t']);
            }
            $pipe = $this->pipes[$i];
            if ($pipe['x'] + FBR_PIPE_W < -10) { array_splice($this->pipes, $i, 1); continue; }
            if (!$pipe['passed'] && $pipe['x'] + FBR_PIPE_W < FBR_BIRD_X - FBR_BIRD_R) {
                $this->pipes[$i]['passed'] = true;
                $this->score++;
            }
            if ($this->invuln <= 0 && $this->hits($pipe)) {
                if ($this->shield) { $this->breakShield(); } else { return true; }
            }
        }
        $last = $this->pipes ? $this->pipes[count($this->pipes) - 1] : null;
        if ($last === null || $last['x'] < FBR_W - FBR_PIPE_SPACING + 40) { $this->spawnPipe(FBR_W + 40); }

        if ($this->y + FBR_BIRD_R >= FBR_H - FBR_GROUND) {
            $this->y = (float) (FBR_H - FBR_GROUND - FBR_BIRD_R);
            if ($this->invuln > 0 || $this->shield) {
                if ($this->invuln <= 0) { $this->breakShield(); }
                $this->vy = FBR_FLAP * 0.9;
            } else {
                return true;
            }
        }
        return false;
    }
}

/**
 * Verify a submitted replay.
 *
 * @param array  $r        Decoded replay from the browser.
 * @param string $official Difficulty configured on the server (classic runs must use it).
 * @return array{ok:bool, score?:int, steps?:int, error?:string}
 */
function fb_replay_verify(array $r, string $official): array
{
    $bad = static fn (string $why): array => ['ok' => false, 'error' => $why];

    $seed  = $r['seed'] ?? null;
    $mode  = $r['mode'] ?? '';
    $steps = $r['steps'] ?? null;
    $flaps = $r['flaps'] ?? null;
    $diff  = $r['difficulty'] ?? '';
    $day   = (string) ($r['day'] ?? '');

    if (!is_int($seed) || $seed < 0 || $seed > 0xFFFFFFFF) { return $bad('seed'); }
    if (!is_int($steps) || $steps < 1 || $steps > FBR_MAX_STEPS) { return $bad('steps'); }
    if (!is_array($flaps) || count($flaps) > 20000) { return $bad('flaps'); }
    if (!isset(fbr_difficulties()[$diff])) { return $bad('difficulty'); }
    if ($mode === 'daily') {
        if ($diff !== 'normal' || !fb_day_valid($day) || $seed !== fbr_daily_seed($day)) { return $bad('daily course'); }
    } elseif ($mode === 'classic') {
        if ($diff !== $official) { return $bad('difficulty is not the official one'); }
    } else {
        return $bad('mode');
    }

    // Decode flap deltas into absolute step numbers.
    $abs = []; $at = 0;
    foreach ($flaps as $d) {
        if (!is_int($d) || $d < 0) { return $bad('flap'); }
        $at += $d;
        if ($at > $steps) { return $bad('flap after end'); }
        $abs[] = $at;
    }
    // Humans cannot tap faster than this: at most 14 flaps in any one-second window.
    for ($i = 14, $n = count($abs); $i < $n; $i++) {
        if ($abs[$i] - $abs[$i - 14] < 60) { return $bad('inhuman tapping'); }
    }

    $sim = new FB_Sim($seed, $diff);
    $p = 0; $n = count($abs);
    for ($s = 0; $s < $steps; $s++) {
        while ($p < $n && $abs[$p] === $s) { $sim->flap(); $p++; }
        if ($sim->step()) {
            if ($s + 1 !== $steps) { return $bad('run ended at a different time'); }
            return ['ok' => true, 'score' => $sim->score, 'steps' => $steps];
        }
    }
    return $bad('bird survived the replay');
}
