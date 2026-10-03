# Flying Bird

A minimalist, themeable flappy-style game in plain **PHP, HTML, CSS and JavaScript**.
It runs **with or without a database**. You play as Hamilton, a pixel-art bird whose wings really flap.

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
You can preview a look with `?scheme=midnight` or `?difficulty=hard`.

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

## Game modes and feel

* **Classic** is endless flying at your chosen difficulty.
* **Daily challenge** gives everyone the same pipes for the day (seeded by the UTC date, always Normal difficulty).
  With a database it has its own daily leaderboard; without one your best of the day is kept in the browser.
* **Medals** at 10 (bronze), 25 (silver) and 50 (gold).
* **Feel:** squash-and-stretch flaps, feather trail, score pop, and on impact a flash, screen shake, hit-stop and pixel burst
  (all disabled for visitors who prefer reduced motion).
* **Sound:** every effect and the background music loop are synthesised with Web Audio, so there are no audio files.
  The streak is audible: the point chime rises in pitch with your score, and the music speeds up.

## Hamilton's story and wardrobe

* **Story:** six short chapters about Hamilton, the smallest bird on Pipe Hill, who sets out to cross the Great Pipes.
  Chapter 1 appears on first launch; later chapters unlock as you clear pipes (10, 50, 150, 300, 600), and short
  captions appear in flight at score milestones. Reread them any time from the **Story** link.
* **Wardrobe:** four colour looks (Ember, Frost, Shadow, Golden) and four hats (Cap, Shades, Party hat, Crown),
  unlocked by total pipes cleared, a best score, or finishing a daily challenge. Progress is stored in the browser.

## Install as an app (PWA)

The game is installable and **works offline**. Serve it over HTTPS (or `localhost`) and use your browser's
*Install* option, or the *Install app* link in the page footer. A service worker (`sw.js`) caches the game; the
leaderboard, admin and installer always go to the network. Bump `VERSION` in `sw.js` when you ship changes to
force clients to refresh. The Daily challenge is also available as an app shortcut.

## Admin cheat (god mode)

Log in at `/admin.php`, open the game, and type **`IDDQD`** (or tap the shield button in the top bar) to toggle god mode:
you can't die, Hamilton turns ghostly and leaves a rainbow trail. It can be switched off in **Gameplay → Admin cheat**.

* Only available while you are logged in as admin. The server decides this from your session; there is no URL flag or
  public code, and visitors never see the button.
* God-mode runs are **never recorded**: no leaderboard entry, medals, bests, story or wardrobe progress.
* It needs the database (that is where the admin account lives).
* It is a client-side convenience, not a security boundary: someone who edits the page's JavaScript could change their own
  local game, which is why scores are also sanity-checked on the server.

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
js/audio.js        synthesised sound + music
sw.js, manifest.webmanifest, js/pwa.js, icons/   offline + install
```

## Security notes

* Keep `config.php`, `includes/` and `database/` private. The bundled `.htaccess` does this on Apache.
  On nginx add: `location ~ ^/(includes|database)/ { deny all; }` and `location = /config.php { deny all; }`.
* Passwords are hashed with `password_hash`, all queries are prepared, forms and the score API use CSRF tokens,
  and scores are sanity-checked and rate-limited.
* Delete `install.php` after set-up if you like. It already refuses to run once installed.

Licensed under Apache-2.0.
