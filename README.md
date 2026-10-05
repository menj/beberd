# Beberd

A minimalist, themeable flappy-style game in plain **PHP, HTML, CSS and JavaScript**.
It runs **with or without a database**. You play as Hamilton, a pixel-art bird whose wings really flap.

| | Without a database | With a database |
|---|---|---|
| Play the game | yes | yes |
| Best score | saved in the browser | saved in the browser |
| Shared leaderboard | – | yes |
| Admin panel (colour scheme, difficulty, scores) | – | yes |

**Supported databases:** MySQL / MariaDB, PostgreSQL and SQLite (all through PDO). Pick one in the installer.

## Verified scores

The leaderboard doesn't trust the browser. Every run is recorded as a seed plus the exact simulation steps at which you
flapped (the game runs on a fixed 60 steps per second, so the same inputs always give the same run). When you save a
score, the server **re-plays your run** with a port of the game's physics (`includes/replay.php`) and only accepts a score
the replay really produces. Edited scores, swapped courses (seeds), shifted flaps, impossible tapping speed, god mode and
runs on the wrong difficulty are all rejected (the checks run on every submission, about 6 ms each).

Honest limits: a determined attacker can still write a bot that flies a real, legal run, or hunt offline for an easy
*classic* seed. The **daily challenge** is immune to seed hunting because its seed comes from the date. Keep
`includes/replay.php` in step with `js/game.js` whenever you change physics, pipes or power-ups.

## Quick start

```bash
php -S localhost:8000
```

Open <http://localhost:8000>. That's it, and no set-up is needed to play.
You can preview a look with `?scheme=midnight` or `?difficulty=hard`.

## Enabling the leaderboard and settings (optional)

Open `/install.php` (there is a link in the page footer). Like the WordPress installer, it:

1. checks your server (PHP, writable folder, which database drivers are installed),
2. lets you choose **MySQL / MariaDB, PostgreSQL or SQLite**,
3. creates the database for you where the engine allows it (MySQL and PostgreSQL need a user with the right to; SQLite just creates a file),
4. **creates all tables automatically** from `database/schema.<engine>.sql`, so no manual SQL import is needed,
5. creates your admin account and writes `config.php`,
6. locks itself once finished (delete `config.php` to run it again).

The schema is versioned. If a future release changes it, tables are upgraded automatically on the next request, and the
admin **Database** tab can re-check or repair them at any time. If the database ever becomes unreachable the game keeps
working and only the leaderboard is hidden.

| Engine | PHP extension | Notes |
|---|---|---|
| MySQL / MariaDB | `pdo_mysql` | MySQL 5.7+ / MariaDB 10.3+ (tested on MariaDB 10.11) |
| PostgreSQL | `pdo_pgsql` | Tested on PostgreSQL 16 |
| SQLite | `pdo_sqlite` | SQLite 3.24+ (upserts). The file defaults to `data/beberd.sqlite`. Prefer a path outside your web root when you can |

Also requires PHP 7.4+ with `mbstring`.

## Admin panel

`/admin.php` has tabbed settings: **General** (title, leaderboard), **Appearance** (colour schemes
and custom colours), **Gameplay** (difficulty, sound), **Scores** (moderate), **Database**, **Account**.

Colour schemes are CSS custom properties in `css/game.css` (`--fb-bg1`, `--fb-pipe`, `--fb-bird`, `--fb-beak`, …).
Built in: Auto (light/dark), Dawn, Midnight, Mono, Forest, Sunset, plus Custom.

## Game modes and feel

* **Classic** is endless flying at your chosen difficulty.
* **Daily challenge** gives everyone the same pipes, coins, power-ups and goals for the day (seeded by the UTC date, always Normal difficulty).
  With a database it has its own daily leaderboard; without one your best of the day is kept in the browser.
* **Medals** at 10 (bronze), 25 (silver) and 50 (gold).
* **Levels:** every 8 pipes is a new level, and each level is a little harder: gaps tighten slightly (down to 82%),
  **moving pipes** (marked with arrows) appear more often and swing wider and faster (capped at 60px), and from level 3
  **narrow pipes** mix in. The first five pipes are always plain.
* **Power-ups** float between pipes (about one a level):
  * **Shield:** absorbs one hit (a pipe or the floor), then gives you a moment of grace to get clear.
  * **Slow-mo:** the world runs at about 60% speed for 5 seconds.
  * **Magnet:** pulls nearby coins to you for 7 seconds.
* **Coins** float between pipes too. Neither coins nor power-ups add to your score (scores stay one point per pipe, so
  leaderboard checks are unaffected, and slow-mo never makes a score look faster than it was). Coins are tracked as their own stat.
* **Daily goals:** three goals per day (for example "Collect 6 coins in one run"), the same for everyone, picked by a
  generator seeded with the date. Finish all three to build a **streak**; miss a day and it resets. Open them from the
  **Goals** link.
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

## Ghosts and share cards

* **Ghost replays:** your best run on a course is saved in the browser (a few KB) and replayed as a translucent "BEST" bird
  next to you. In the **daily challenge** it appears automatically (everyone flies the same course); in classic, press
  **Rematch** to replay your best classic run's exact course against its ghost. Assisted and god-mode runs never create ghosts.
* **Share card:** the **Share** button on the game-over card renders a 1080x1350 picture (Hamilton's expression, score,
  level or daily date, medal, the joke and your link) and hands it to the phone's native share sheet; on desktops it saves
  the image and copies the message.

## Hamilton has feelings

Hamilton reacts to what happens, not just to crashes: heart eyes for a coin, a happy arc for a cleared pipe or level-up,
a smug look for a shield or magnet, sleepy eyes in slow-mo, wide eyes with a sweat drop (and a "PHEW!") on a close call,
shock when his shield breaks, and the odd idle blink. Comic-book words pop out ("CHA-CHING!", "WHOA!", "ZZZAP!"), and a crash
gets X eyes, a tongue out, dizzy stars and a boing. The game-over card tells a joke that fits what just happened (coins,
close calls, power-ups, level), and the start and pause cards rotate silly lines.

## Accessibility and input

* **High contrast** colour scheme (black and white with yellow pipes, 16:1 and 21:1 contrast), also used automatically by
  the *Auto* scheme when the visitor's system asks for more contrast.
* **Assist mode** (toggle on the start and game-over cards): 20% wider gaps and 15% slower pipes. Assisted runs still count
  toward the story and wardrobe, but never toward best scores, medals, daily goals or the leaderboard, and the daily
  challenge is never assisted so it stays identical for everyone.
* **Gamepad:** A/B/X/Y or D-pad up flaps (and starts or restarts), Start pauses, Back/Select mutes.
* **Haptics** on supporting phones (flap, coin, power-up, crash). Switch them off from the pause card; they are never
  used for visitors who prefer reduced motion.

## Controls

| | |
|---|---|
| Flap | Space / ↑ / W / click / tap |
| Pause | P or Esc |
| Mute | M |
| Restart | R |

The layout adapts to desktop, tablet and phone (portrait and landscape), with larger touch targets and
a tap hint on touch devices.

## Hosting inside an arcade hub

Beberd is built to sit in its own folder under a hub (for example `menj.buzz/arcade/beberd/`) next to other games such as
Pixel Run, following the same "hub contract":

* **Everything is relative**, and a `<base>` tag makes `/arcade/beberd` (no trailing slash) work too. The admin cookie and
  service worker are scoped to the folder, and storage keys are prefixed `fb_`, so several games share one domain without
  clashing. Give each game its own database or SQLite file.
* **`game.json`** describes the game (title, tagline, thumbnail, icon, share image, features) so a hub can build a card
  without hard-coding anything. Keep its `version` in step with `FB_VERSION` in `includes/bootstrap.php`.
* **Admin → General** has *Arcade link* (shows a "‹ Arcade" button and a "More games" link, for example `../`) and
  *Public address* (used for share previews). Without a database, set `arcade_url` / `public_url` in `config.php`.
* **Share previews:** Open Graph and Twitter tags use `img/og.png` (1200x630); the card image is `img/thumb.png` (1280x720).
* **Shared player name:** the name you save is also stored as `arcade_name`, so games that read it can pre-fill it.
* **`standalone.html`** is a static copy with no PHP, database or leaderboard: `php tools/build-standalone.php >
  standalone.html` regenerates it. On a static host rename it to `index.html`.
* **The hub page** lives in its own repository, [menj/arcade](https://github.com/menj/arcade), which is the dev repo for
  `menj.buzz/arcade/`. It lists every game by reading its `game.json`; upload this game into the `beberd/` folder beside it.

Name: change `FB_APP_NAME` in `includes/bootstrap.php` (and `name` in `manifest.webmanifest` and `game.json`) to rename the game.

## Project layout

```
index.php          the game page          css/game.css   game + colour schemes
api.php            leaderboard JSON API   css/site.css   page chrome
install.php        web installer          css/admin.css  admin panel
admin.php          tabbed settings        js/game.js     game engine (canvas)
database/schema.*.sql                     js/sprite.js   pixel-art bird + wing frames
includes/          db, settings, replay    js/admin.js    admin behaviour
game.json, img/, tools/   arcade hub contract, share images, standalone build
js/audio.js        synthesised sound + music
sw.js, manifest.webmanifest, js/pwa.js, icons/   offline + install
```

## Security notes

* Keep `config.php`, `includes/`, `database/` and (for SQLite) `data/` private. The bundled `.htaccess` files do this on Apache.
  On nginx add: `location ~ ^/(includes|database|data)/ { deny all; }`, `location = /config.php { deny all; }` and
  `location ~ \.(sqlite3?|db)$ { deny all; }`.
* Passwords are hashed with `password_hash`, all queries are prepared, forms and the score API use CSRF tokens,
  and scores are sanity-checked and rate-limited.
* Delete `install.php` after set-up if you like. It already refuses to run once installed.

Licensed under Apache-2.0.

## Credits

Beberd started life as a fork of [Flying-Bird-Vanilla-JS](https://github.com/manoharys/Flying-Bird-Vanilla-JS) by
manoharys, a small DOM-based flappy-bird demo licensed under Apache-2.0. The game has since been rewritten from scratch
(canvas engine, PHP back end, installer, admin, replays and everything else), but the original idea and licence carry on.
Hamilton, the story and the art are original to this project.

