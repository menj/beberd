<?php
/**
 * Shared bootstrap: config, sessions, CSRF, escaping helpers.
 */

declare(strict_types=1);

/** The game's public name. Change it here (and in manifest.webmanifest) to rename the game. */
const FB_APP_NAME   = 'Beberd';
const FB_VERSION    = '2.0.0';
const FB_DB_VERSION = 2;

define('FB_ROOT', dirname(__DIR__));
define('FB_CONFIG_FILE', FB_ROOT . '/config.php');

function fb_h($value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function fb_installed(): bool
{
    return is_file(FB_CONFIG_FILE);
}

function fb_config(): array
{
    $r = &fb_registry();
    if (!isset($r['config'])) {
        $r['config'] = fb_installed() ? (array) require FB_CONFIG_FILE : [];
    }
    return $r['config'];
}

/** URL path of the directory the app lives in, e.g. "/arcade/beberd" or "". */
function fb_base_path(): string
{
    $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    return $dir === '.' ? '' : $dir;
}

/** A <base> tag so every relative URL resolves inside this game's folder, even at "/arcade/beberd" without a trailing slash. */
function fb_base_tag(): string
{
    return '<base href="' . fb_h(fb_base_path() . '/') . '">';
}

/** Only allow path-like or http(s) links for the arcade back-link and public URL settings. */
function fb_safe_url($value): string
{
    $v = trim((string) $value);
    return preg_match('~^(/|\.{1,2}/|https?://)[^\s<>"\']*$~', $v) ? $v : '';
}

/** This game's full public address (for share previews): the setting, else detected from the request. */
function fb_public_url(string $configured = ''): string
{
    $c = fb_safe_url($configured);
    if ($c !== '' && preg_match('~^https?://~', $c)) {
        return rtrim($c, '/') . '/';
    }
    $https  = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    $host   = preg_replace('/[^A-Za-z0-9.\-:\[\]]/', '', (string) ($_SERVER['HTTP_HOST'] ?? 'localhost'));
    return ($https ? 'https://' : 'http://') . $host . fb_base_path() . '/';
}

function fb_redirect(string $path): void
{
    header('Location: ' . fb_base_path() . '/' . ltrim($path, '/'));
    exit;
}

function fb_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    session_name('fb_session');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => fb_base_path() ?: '/',
        'secure'   => $https,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function fb_csrf_token(): string
{
    fb_session();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function fb_csrf_valid(?string $token): bool
{
    fb_session();
    return !empty($_SESSION['csrf']) && is_string($token) && hash_equals($_SESSION['csrf'], $token);
}

function fb_csrf_field(): string
{
    return '<input type="hidden" name="csrf" value="' . fb_h(fb_csrf_token()) . '">';
}

/** True when the visitor is logged in to the admin panel (server-side session). */
function fb_is_admin(): bool
{
    fb_session();
    return !empty($_SESSION['uid']);
}

function fb_security_headers(): void
{
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    header('Referrer-Policy: same-origin');
}

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/replay.php';
