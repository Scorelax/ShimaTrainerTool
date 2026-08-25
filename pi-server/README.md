# Pi Server — Pokemon DnD Trainer Tool backend

FastAPI + SQLite replacement for the Google Apps Script backend. Speaks the
exact same `GET ?route=...&action=...` contract and returns the same
positional-array JSON, so the **only frontend change is one line** in
`js/api.js` (see Cutover below).

## Layout

```
pi-server/
  app/               the server (FastAPI)
  scripts/
    import_sheets.py     one-time: Google Sheets CSV exports -> SQLite
    refresh_upstream.py  snapshot Benjakronk's pokedex/moves/items
  data/pokedex.db    the database (created on first run, gitignored)
```

## 1. Migrate the data (once, on any machine)

1. In the game spreadsheet: **File → Download → Comma-separated values** for
   each tab, saved into one folder with the tab's exact name:
   `Trainer Data.csv`, `Pokemon Data.csv`, `Natures.csv`, `Trainer Feat.csv`,
   `Feat list.csv`, `Type Chart.csv`, and optionally the three Conduit tabs.
   (The `Item list` tab is not needed — items come from the upstream source.)
2. ```
   cd pi-server
   python -m venv .venv
   .venv/Scripts/pip install -r requirements.txt        (Windows)
   .venv/bin/pip install -r requirements.txt            (Pi/Linux)
   python scripts/import_sheets.py --csv-dir path/to/exports
   python scripts/refresh_upstream.py
   ```

Re-running `import_sheets.py` wipes and re-imports (upstream snapshots kept).

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
# copy your pokedex.db into pi-server/data/  (or run the import on the Pi)
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

Two layers, both from `crontab -e` (actual entries on the live Pi, user `scorelax`):

```bash
# 04:00 local snapshot; .backup is safe while the server runs (WAL mode)
0 4 * * * sqlite3 /home/scorelax/pokemon-dnd/pi-server/data/pokedex.db ".backup /home/scorelax/backups/pokedex-$(date +\%w).db"
# 04:15 Google Sheets mirror (survives the Pi entirely)
15 4 * * * cd /home/scorelax/pokemon-dnd/pi-server && SHEETS_BACKUP_URL=... SHEETS_BACKUP_SECRET=... .venv/bin/python scripts/backup_to_sheets.py >> /home/scorelax/backup.log 2>&1
```

1. **Local snapshot** — weekday-numbered files give a rolling 7-day history.
   Ideally point it at a USB stick, not the SD card.
2. **Sheets mirror** — `scripts/backup_to_sheets.py` writes the trainers and
   pokemon tables back into the game spreadsheet's `Trainer Data` /
   `Pokemon Data` tabs (headers untouched), so the tabs stay importable:
   full disaster recovery = download tabs as CSV → `import_sheets.py`.
   One-time setup is described in `scripts/Backup_Receiver.gs`. Older days
   are recoverable via the spreadsheet's File → Version history.
   Note: after cutover the sheet is a mirror, not the admin UI — manual
   edits to those two tabs get overwritten nightly.

### Upstream data mirror (daily)

`scripts/refresh_upstream.py` fetches Benjakronk's pokemon/moves/items/
pokedex-config snapshots and stores them in SQLite. Already scheduled on the
live Pi:

```bash
# 16:00 daily upstream snapshot refresh
0 16 * * * cd /home/scorelax/pokemon-dnd/pi-server && .venv/bin/python scripts/refresh_upstream.py >> /home/scorelax/logs/dnd/upstream.log 2>&1
```

(Note this job logs to `~/logs/dnd/upstream.log`, unlike the flat `~/backup.log`
the other two jobs use — an existing inconsistency, not a typo.)

With this scheduled, the in-app **Reset Cache** button is a rare manual
override — only needed if you want data sooner than the next run (e.g.
Benjakronk added a species same-day and you want it live immediately). A
failed fetch keeps the previous snapshot either way, so a bad run doesn't
wipe anything.

### Live upstream push (from Benjakronk's admin panel)

`POST /api/upstream-push` with header `X-Push-Key: <secret>` and body
`{"dataset": "pokedex-config", "data": ...}` stores the shared player-visible
pokedex snapshot immediately — no waiting on GitHub raw's 5-minute CDN. This
is the one upstream dataset that actually changes mid-session; pokemon-db,
moves, and items stay on the nightly mirror above — see `PUSHABLE_DATASETS`
in `app/upstream.py` to add another dataset to the push path later. Guarded
by env `UPSTREAM_PUSH_KEY` on the service; **the endpoint is disabled (503)
until that env var is set.** The full connect-and-use guide for Benjakronk is
`docs/benjakronk-guide.md`. His own repo stays the source of truth: the
nightly mirror still re-fetches from GitHub raw, the push is just the fast
path.

### Splash image mirror (daily)

Splash images are mirrored locally so loading screens don't wait on GitHub.
One-time setup on the Pi (a sparse clone downloads only the splashes folder):

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/Benjakronk/shima-pokedex ~/shima-splashes
cd ~/shima-splashes && git sparse-checkout set images/splashes
```

Daily sync from `crontab -e` (04:30, after the backups):

```bash
30 4 * * * cd /home/scorelax/shima-splashes && git pull --quiet >> /home/scorelax/splash-sync.log 2>&1
```

The server serves the folder at `/splashes/` and lists it via
`?route=game-data&action=splash-list` (folder path override: env `SPLASH_DIR`).
The frontend uses the mirror when served by the pi-server and falls back to
GitHub if the mirror is missing. Restart the service after the first clone so
the `/splashes` mount appears.

## 4. Cutover (and rollback)

In `js/api.js`, change `baseUrl` to the Pi:

```js
baseUrl: 'https://<pi-name>.<tailnet>.ts.net/api',
```

The Apps Script deployment stays untouched — **rollback = revert that line.**

## Admin

Google Sheets is no longer the admin UI. Edit data with
[DB Browser for SQLite](https://sqlitebrowser.org/) — tables `trainers` and
`pokemon` have one named column per old sheet column, in the same order.
Stop the server first (or use "Write Changes" promptly): SQLite locks the DB
while DB Browser holds unsaved changes.

The app's **Reset Cache** button re-fetches the upstream snapshots
(pokedex/moves/items/config), same as before.
