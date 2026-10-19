# Pi Server — Pokemon DnD Trainer Tool backend

FastAPI + SQLite: the whole backend of the app, running on the Pi. The app
(the PWA in the folder above) is served from the same origin and always
talks to `/api` there.

## Layout

```
pi-server/
  app/               the server (FastAPI)
  docs/              the game data: DnD_species.json, DnD_moves*.json,
                     DnD_items.json, DnD_abilities.json, DnD_natures.json,
                     DnD_feats.json, DnD_trainer_options.json,
                     DnD_conduit.json, DnD_type_chart.json (+ their tools)
  scripts/
    convert_species.py   one-time: Benjakronk's 80-cell species rows -> DnD_species.json
    species_snapshot.py  before/after check for changes to the species code
  data/pokedex.db    the database (created on first run, gitignored)
```

## 1. The data

The database is created on first run (`data/pokedex.db`, override with env
`POKEDEX_DB`). The live one is on the Pi; to work on a copy elsewhere, copy
the Pi's file (or one of its nightly backups, below) into `data/`.

- **Trainers** -- table `trainers`, one JSON object each (`app/trainers.py`
  describes every field). Until 2026-10-19 they were 52-column rows; the
  server moved them over once on its first start and kept the old table,
  renamed `trainer_rows_backup` (read by nothing).
- **The players' Pokémon** -- table `owned_pokemon`, one JSON object each
  (`app/owned.py` describes every field). Until 2026-10-18 they were 62-column
  rows in a `pokemon` table, moved over the same way (`pokemon_rows_backup`).
- **The players' Pokédex settings** -- what they may see of each species, set
  in the DM console's Pokédex module: `dm_state` key `pokedex-config`.
- **Game data** -- species, moves, items, abilities and the rules (natures,
  feats, specializations, trainer paths, affinities, trainer skills,
  nationalities, the conduit class, the type chart) are the JSON files in
  `docs/` (`app/gamedata.py`, `app/species.py`); edit, commit, pull on the Pi.
  No restart needed. The rules were database tables imported once from the
  old Google Sheet; the first start after 2026-10-19 drops them -- if the Pi's
  held anything the files don't, it's written to `data/old_rule_tables.json`
  first (compare it with `docs/`).
- **The battle** -- table `combat_session` (the running one) and what the DM
  console keeps in `dm_state` / `dm_npcs` / `dm_encounters`. A participant's
  abilities, saving throws and skills are lists (`app/battle_lists.py`); until
  2026-10-19 they were text ("0:Name;description|...", "Strength, Dexterity"),
  turned into lists on the first start.

`app/migrations.py` does every one of these moves, once.

## 2. Run the server

```
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

- API: `http://<host>:8080/api?route=test`
- The PWA is served from the same origin (the folder above `pi-server/`),
  so `http://<host>:8080/` is the app itself. Override with env `PWA_DIR`.
- DB path override: env `POKEDEX_DB`.

## 3. Pi deployment

```bash
# copy the whole project folder to the Pi, then:
cd ~/pokemon-dnd/pi-server
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
# copy your pokedex.db into pi-server/data/
```

`/etc/systemd/system/pokedex.service`:

```ini
[Unit]
Description=Pokemon DnD Trainer Tool
After=network-online.target

[Service]
User=pi
WorkingDirectory=/home/pi/pokemon-dnd/pi-server
ExecStart=/home/pi/pokemon-dnd/pi-server/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8080
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now pokedex
```

### HTTPS (Tailscale serve)

Tailscale on the Pi + each tablet, then:

```bash
sudo tailscale serve --bg 8080
```

The app is then at `https://<pi-name>.<tailnet>.ts.net/` — valid HTTPS, works
at home (LAN-speed) and away. Note uvicorn binds 127.0.0.1 above: tailscale
serve is the only way in, nothing is exposed on the LAN or internet.

Also set a **DHCP reservation** for the Pi in the router so SSH stays at a
predictable address. A dynamic public IP is irrelevant — Tailscale handles it.

### Backups (nightly)

From `crontab -e` (user `scorelax` on the live Pi):

```bash
# 04:00 local snapshot; .backup is safe while the server runs (WAL mode)
0 4 * * * sqlite3 /home/scorelax/pokemon-dnd/pi-server/data/pokedex.db ".backup /home/scorelax/backups/pokedex-$(date +\%w).db"
```

Weekday-numbered files give a rolling 7-day history. Ideally point it at a
USB stick, not the SD card -- and copy one somewhere off the Pi now and then.
(`scripts/backup_to_sheets.py` is gone: **remove its 04:15 line from the
crontab** if it's still there.)

To restore: stop the service, copy a backup over `data/pokedex.db`, start it.

Nothing else needs scheduling: nothing is fetched from anywhere. (The daily
`refresh_upstream.py` that re-fetched the Pokédex settings from Benjakronk's
GitHub repo is gone -- **remove its 16:00 line from the crontab** if it's still
there.)

### The pictures

Every picture comes from the Pi (`app/media.py`), in `~/pokemon-dnd/images/`
-- first copied from the `images/` folders of Benjakronk's Pokédex repo:

| Repo folder         | Pi folder (env override)                          | Served at               |
|---------------------|---------------------------------------------------|-------------------------|
| `images/pokemon`    | `pokemon-images` (`POKEMON_IMAGE_DIR`)            | `/pokemon-images/`      |
| `images/characters` | `npc` (`NPC_IMAGE_DIR`) -- also the DM console's NPC uploads | `/npc-images/` |
| `images/badges`     | `badges` (`BADGE_DIR`)                            | `/badges/`              |
| `images/splashes`   | `splashes` (`SPLASH_DIR`)                         | `/splashes/`            |

Next to them, `images/display-images` (`DISPLAY_IMAGE_DIR`, served at
`/display-images/`) holds the pictures uploaded in the DM console's Display
module. The server makes the folders at startup if they're missing, and new files
show up without a restart. What the app shows is worked out on every read
(`media.pokemon_image_url` / `media.trainer_image_url`): a Pokémon's
animated sprite, else its original picture; a trainer's self-made portrait,
else the NPC picture of that name. (Addresses in Benjakronk's repo stored
before the pictures moved onto the Pi were made the Pi's own once, by
`migrations.py`.)

### Animated sprites (self-uploaded, local only)

Drop hand-made `.mp4` files into
`~/pokemon-dnd/pokemon-sprites` (folder path override: env `SPRITE_DIR`),
named `<sanitized-species-name>.mp4` -- lowercase, non-alphanumeric
characters collapsed to `-` (e.g. "Mr. Mime" → `mr-mime.mp4`), same rule
`media.local_pokemon_image_url()` uses for the original pictures, just
without the dex-id prefix. `.gif` was supported early on but has since been dropped
entirely -- animated GIF decoding runs frame-by-frame in software with no
hardware acceleration, and paying that continuously (especially with
several sprites animating on screen at once) was laggier overall than MP4's
one-time decode-startup pause, plus real video compression means much
smaller files.

No restart needed to pick up new files day-to-day
(checked live via a filesystem stat on every request,
`media.local_sprite_url()`) -- only the first time, so the `/gifs` mount
appears (the URL prefix stays `/gifs` even after the folder's `pokemon-gifs` →
`pokemon-sprites` rename and the gif-format drop -- it's baked into every
Pokemon's stored image URL in the live DB, so renaming it would 404 all of
them until each got re-saved; treat it as a legacy path name at this point,
unrelated to file format). Applies to any owned Pokémon whose species has a
matching file, including ones already registered before it existed; falls
back to the original picture otherwise. Shiny Pokémon look for
`<sanitized-species-name>-shiny.mp4` first, then the non-shiny variant, then
the original picture.

### Evolution transition videos (self-uploaded, local only)

Same idea, separate folder: drop `.mp4` files into
`~/pokemon-dnd/evolution_video` (folder path override: env
`EVOLUTION_VIDEO_DIR`), named `<sanitized-pre-evolved>_<sanitized-evolved>.mp4`
(e.g. `pikachu_raichu.mp4` -- underscore as the separator between the two
species is unambiguous since the sanitizer already turns every other
character into a hyphen). When a player confirms an evolution that has a
matching file, it plays as a full-screen fade transition (with the
evolution loop music, not the video's own audio track, which is muted)
instead of the plain splash-art loading screen; falls back to the splash
screen untouched when no video exists for that specific pair. Same
live-filesystem-check, no-caching-layer, no-restart-to-add-files pattern as
the sprites above -- only the very first file needs a restart, so the
`/evolution-videos` mount appears.

### Battle animations (self-uploaded, local only)

Same idea again: drop `.mp4` files into `~/pokemon-dnd/battle-animations`
(folder path override: env `BATTLE_ANIMATION_DIR`), named
`<sanitized-species-name>.mp4` -- one clip per species, no per-move variants.
In combat, the move-confirmation popup always shows that Pokémon's regular
sprite (the animated sprite above, or the static image if none was
uploaded); if a matching battle-animation file exists it's preloaded in the
background as soon as the Pokémon enters combat, then played over that same
spot the instant the player confirms a move, before the popup closes and VP
is deducted. Falls straight through with no delay when no file exists for
that species. Same live-filesystem-check, no-caching-layer,
no-restart-to-add-files pattern as the other two -- only the very first file
needs a restart, so the `/battle-animations` mount appears.


## Admin

Edit data with [DB Browser for SQLite](https://sqlitebrowser.org/) on a copy,
or on the Pi with the service stopped (SQLite locks the database while DB
Browser holds unsaved changes). A trainer is one row of `trainers`, a
player's Pokémon one row of `owned_pokemon` -- the `json` column is the whole
object (keep `name` / `trainer` the same as inside it).
