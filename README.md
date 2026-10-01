# Steam Achievement Tracker for Obsidian

🇩🇪 [Deutsche Version](README.de.md)

An Obsidian plugin that syncs your Steam library into your vault. Every game you've played gets its own note with playtime, progress and a checklist of every achievement, both unlocked and still open.

## Features

- **One note per game** once it has any playtime. Each note shows the cover art, a progress bar and the achievements as checkboxes. Open achievements are sorted by how many players have them, completed ones by unlock date.
- **Your own notes are safe.** Only the block between `<!-- steam-sync:start -->` and `<!-- steam-sync:end -->` is ever rewritten.
- **Automatic status folders:**
  ```
  Games/
    Up Next.md          ← focus page
    _Dashboard.md       ← Dataview overview
    0 Up Next/  1 Playing/  2 Paused/
    3 Completed/  4 Dropped/  5 No Achievements/
  ```
  - A game you haven't played for 30 days is marked paused. When you start it again, it goes back to playing.
  - A game at 100 % is marked completed.
  - Edit `status` by hand and the note moves to the matching folder on its own.
  - Games without achievements live in their own folder and stay out of the focus page and dashboard tables.
- **"Up Next" focus page:**
  - recently played games
  - games planned next
  - ⚡ quick wins: the most commonly unlocked achievements you're still missing, across all active games
  - games that are almost done
  - paused games you haven't touched in a while
- **Genres and tags** from the Steam Store: `genres`, `developer`, `release_year`, `metacritic` and `#genre/...` tags.
- **Backlog:** unplayed games are listed on the dashboard. "Plan a backlog game" turns one of them into a note.
- **Sync** on startup, on an interval (60 min by default), or from the ribbon icon or a command.
- **English and German.** The plugin language can be switched in the settings and defaults to Obsidian's language.

## Installation

1. Clone or copy this repository into `<vault>/.obsidian/plugins/steam-tracker/`:
   ```bash
   git clone https://github.com/Fynn-Pritzkau/Steam-Adchivment-Tracker.git "<vault>/.obsidian/plugins/steam-tracker"
   ```
2. In Obsidian, go to Settings → Community plugins, turn off Restricted mode, install and enable **Dataview**, then enable **Steam Tracker**.
3. Get a free Steam Web API key at https://steamcommunity.com/dev/apikey.
4. In Steam, set **Privacy Settings → "Game details: Public"**. Steam doesn't expose your achievements otherwise.
5. Open the plugin settings, enter your API key and your profile (SteamID64, profile URL or custom profile name), then hit **Sync now**.

The first sync takes a few minutes for large libraries. Genres are fetched once per game, and the Steam Store only allows about one request every 1.5 seconds. After that, syncs only touch games whose playtime has changed.

## Commands

| Command | What it does |
|---|---|
| Sync now | Syncs games whose playtime changed |
| Full resync (ignore cache) | Re-fetches everything |
| Sync this game | Syncs only the active note |
| Open Up Next | Opens the focus page |
| Plan a backlog game | Moves an unplayed game into "0 Up Next" |
| Reset dashboard | Regenerates the dashboard (the old one is kept as a backup) |

## Frontmatter

Each game note has these properties, so you can query them with Dataview:

```yaml
appid: 1091500
title: Cyberpunk 2077
status: playing        # next | playing | paused | completed | dropped
playtime_hours: 87.4
achievements_unlocked: 32
achievements_total: 57
completion: 56
last_played: 2026-09-28
perfect: false
genres: [RPG]
developer: CD PROJEKT RED
release_year: 2020
metacritic: 86
tags: [game, genre/rpg]
```

## Notes

- Your API key is stored in plain text in `data.json`, which is excluded via `.gitignore`. Be careful if you sync your vault anywhere public.
- Switching the plugin language moves your notes into the translated folders on the next sync. Command names update after reloading Obsidian.
- There's no build step: `main.js` is plain CommonJS.
