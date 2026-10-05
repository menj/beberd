# Arcade hub

A static front page for a small arcade, meant to live at `menj.buzz/arcade/`:

```
arcade/
├── index.html  hub.css  hub.js  games.json    <- this folder's files
├── beberd/                                      <- the Beberd package, uploaded as-is
└── pixel-run/                                   <- the Pixel Run package, uploaded as-is
```

The hub reads `games.json` for the list of game folders, then each game's own `game.json`
(thumbnail, title, tagline, tags, features). Add a game by uploading its folder and adding
the folder name to `games.json`; a game with a missing or broken `game.json` is skipped.

No build step, no database, no PHP: any static host works. Per-game back-links are set in
each game ("Arcade link" in Beberd's admin, `arcade_url` in Pixel Run's config), for example `../`.

## Shared conventions

Games on the same domain cooperate through two localStorage keys, never a shared server:

* `arcade.stats`: `{ "<game id>": { best, plays, last, lastPlayed } }`, written by each game after a run and read by the hub to
  show "Your best" on each card. Games only write their own entry, and never record god-mode runs.
* `arcade_name`: the player's display name, shared by every game that asks for one.

`requirements/pixel-run.yml` lists what Pixel Run needs to do to work fully with Beberd (shared name, hub link, offline
claim, verified scores, and optional extras), with acceptance criteria. Hand it to whoever works in the Pixel Run repository.

