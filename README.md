# Flying Bird

A minimalist, themeable flappy-style game in plain **PHP, HTML, CSS and JavaScript**.
It runs **with or without a database**.

| | Without a database | With a database |
|---|---|---|
| Play the game | yes | yes |
| Best score | saved in the browser | saved in the browser |
| Shared leaderboard | – | yes |
| Admin panel (colour scheme, difficulty, scores) | – | yes |

## Quick start

```bash
php -S localhost:8000
```

Open <http://localhost:8000>. That's it, and no set-up is needed to play.
Without a database you can still try a theme with `?scheme=midnight` or `?difficulty=hard`.

## Enabling the leaderboard and settings (optional)

Open `/install.php` (there is a link in the page footer). Like the WordPress installer, it:

1. checks your server (PHP, PDO MySQL, writable folder),
2. connects to MySQL / MariaDB and **creates the database if it doesn't exist**,
3. **creates all tables automatically** from `database/schema.sql`, so no manual SQL import is needed,
4. creates your admin account and writes `config.php`,
5. locks itself once finished (delete `config.php` to run it again).

The schema is versioned. If a future release changes it, tables are upgraded automatically on the
next request, and the admin **Database** tab can re-check or repair them at any time.
If the database ever becomes unreachable the game keeps working and only the leaderboard is hidden.

Requirements: PHP 7.4+ with `pdo_mysql` and `mbstring`; MySQL 5.7+ / MariaDB 10.3+.

## Admin panel

`/admin.php` has tabbed settings: **General** (title, leaderboard), **Appearance** (colour schemes
and custom colours), **Gameplay** (difficulty, sound), **Scores** (moderate), **Database**, **Account**.

Colour schemes are CSS custom properties in `css/game.css` (`--fb-bg1`, `--fb-pipe`, `--fb-bird`, `--fb-beak`, …).
Built in: Auto (light/dark), Dawn, Midnight, Mono, Forest, Sunset, plus Custom.

## Controls

| | |
|---|---|
| Flap | Space / ↑ / W / click / tap |
| Pause | P or Esc |
| Mute | M |
| Restart | R |

The layout adapts to desktop, tablet and phone (portrait and landscape), with larger touch targets and
a tap hint on touch devices.

## Project layout

```
index.php          the game page          css/game.css   game + colour schemes
api.php            leaderboard JSON API   css/site.css   page chrome
install.php        web installer          css/admin.css  admin panel
admin.php          tabbed settings        js/game.js     game engine (canvas)
database/schema.sql                       js/sprite.js   pixel-art bird + wing frames
includes/          db, settings, bootstrap js/admin.js    admin behaviour
audio/             sound effects
```

## Security notes

* Keep `config.php`, `includes/` and `database/` private. The bundled `.htaccess` does this on Apache.
  On nginx add: `location ~ ^/(includes|database)/ { deny all; }` and `location = /config.php { deny all; }`.
* Passwords are hashed with `password_hash`, all queries are prepared, forms and the score API use CSRF tokens,
  and scores are sanity-checked and rate-limited.
* Delete `install.php` after set-up if you like. It already refuses to run once installed.

Licensed under Apache-2.0.
