<?php
/**
 * Shared bootstrap: config, sessions, CSRF, escaping helpers.
 */

declare(strict_types=1);

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
    static $config = null;
    if ($config === null) {
        $config = fb_installed() ? (array) require FB_CONFIG_FILE : [];
    }
    return $config;
}

/** URL path of the directory the app lives in, e.g. "/flying-bird" or "". */
function fb_base_path(): string
{
    $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    return $dir === '.' ? '' : $dir;
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

function fb_security_headers(): void
{
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    header('Referrer-Policy: same-origin');
}

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/settings.php';
