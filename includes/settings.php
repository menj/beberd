<?php
/**
 * Settings: defaults, option lists and per-tab sanitisation.
 * Stored as one JSON row in the settings table.
 */

declare(strict_types=1);

/** Scheme colours live in css/game.css; only labels are needed here. */
function fb_schemes(): array
{
    return [
        'auto'     => 'Auto (follows visitor)',
        'dawn'     => 'Dawn',
        'midnight' => 'Midnight',
        'mono'     => 'Mono',
        'forest'   => 'Forest',
        'contrast' => 'High contrast',
        'sunset'   => 'Sunset',
        'custom'   => 'Custom',
    ];
}

function fb_colour_fields(): array
{
    return [
        'bg1'     => 'Sky (top)',
        'bg2'     => 'Sky (bottom)',
        'hill'    => 'Hills & ground',
        'pipe'    => 'Pipes',
        'bird'    => 'Bird',
        'beak'    => 'Beak',
        'accent'  => 'Accent (buttons)',
        'ink'     => 'Text',
        'surface' => 'Cards',
    ];
}

function fb_difficulties(): array
{
    return ['easy' => 'Easy', 'normal' => 'Normal', 'hard' => 'Hard'];
}

function fb_tabs(): array
{
    return [
        'general'    => 'General',
        'appearance' => 'Appearance',
        'gameplay'   => 'Gameplay',
        'scores'     => 'Scores',
        'database'   => 'Database',
        'account'    => 'Account',
    ];
}

function fb_setting_defaults(): array
{
    return [
        'site_title'       => 'Flying Bird',
        'leaderboard'      => 1,
        'leaderboard_size' => 10,
        'scheme'           => 'auto',
        'custom'           => [
            'bg1' => '#cfe8ff', 'bg2' => '#fff1de', 'hill' => '#b9d4c3', 'pipe' => '#3d8b6e',
            'bird' => '#ffd23f', 'beak' => '#ff6b35', 'accent' => '#2f6fed', 'ink' => '#14213d', 'surface' => '#ffffff',
        ],
        'difficulty'       => 'normal',
        'sound'            => 1,
        'music'            => 1,
        'admin_cheat'      => 1,
    ];
}

function fb_settings(bool $refresh = false): array
{
    static $cache = null;
    if ($cache === null || $refresh) {
        $d     = fb_setting_defaults();
        $saved = [];
        if (fb_db_ok()) {
            $raw   = fb_setting_row(fb_db(), 'settings');
            $saved = $raw ? json_decode($raw, true) : [];
        }
        $cache = array_merge($d, is_array($saved) ? $saved : []);
        $cache['custom'] = array_merge($d['custom'], is_array($cache['custom']) ? $cache['custom'] : []);
    }
    return $cache;
}

function fb_settings_save(array $settings): void
{
    fb_setting_write(fb_db(), 'settings', json_encode($settings));
    fb_settings(true);
}

/** Apply the submitted fields of one tab onto the current settings. */
function fb_settings_sanitize(string $tab, array $in, array $current): array
{
    switch ($tab) {
        case 'general':
            $title = trim(preg_replace('/\s+/', ' ', strip_tags((string) ($in['site_title'] ?? ''))));
            $current['site_title']       = $title !== '' ? mb_substr($title, 0, 60) : 'Flying Bird';
            $current['leaderboard']      = empty($in['leaderboard']) ? 0 : 1;
            $current['leaderboard_size'] = max(3, min(50, (int) ($in['leaderboard_size'] ?? 10)));
            break;

        case 'appearance':
            $scheme = (string) ($in['scheme'] ?? 'auto');
            $current['scheme'] = isset(fb_schemes()[$scheme]) ? $scheme : 'auto';
            foreach (array_keys(fb_colour_fields()) as $key) {
                $hex = $in['custom'][$key] ?? '';
                if (is_string($hex) && preg_match('/^#[0-9a-fA-F]{6}$/', $hex)) {
                    $current['custom'][$key] = strtolower($hex);
                }
            }
            break;

        case 'gameplay':
            $d = (string) ($in['difficulty'] ?? 'normal');
            $current['difficulty'] = isset(fb_difficulties()[$d]) ? $d : 'normal';
            $current['sound']      = empty($in['sound']) ? 0 : 1;
            $current['music']      = empty($in['music']) ? 0 : 1;
            $current['admin_cheat'] = empty($in['admin_cheat']) ? 0 : 1;
            break;
    }
    return $current;
}

/** Inline CSS custom properties for the custom scheme. */
function fb_custom_style(array $custom): string
{
    $css = '';
    foreach (array_keys(fb_colour_fields()) as $key) {
        if (isset($custom[$key]) && preg_match('/^#[0-9a-f]{6}$/i', $custom[$key])) {
            $css .= '--fb-' . $key . ':' . $custom[$key] . ';';
        }
    }
    return $css;
}
