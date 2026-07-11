"""Daily backup: mirror the mutable SQLite tables (trainers, pokemon) back
into the game spreadsheet's "Trainer Data" / "Pokemon Data" tabs, via the
small Apps Script web app in scripts/Backup_Receiver.gs.

Why the sheet: it survives the Pi entirely (power outage, dead SD card),
Google keeps version history for older days, and the tabs stay importable —
disaster recovery is "download tabs as CSV -> python scripts/import_sheets.py".

One-time setup: see the comment block in Backup_Receiver.gs, then give this
script the deployment URL and secret via env vars or flags:

    SHEETS_BACKUP_URL     https://script.google.com/macros/s/<deployment>/exec
    SHEETS_BACKUP_SECRET  same string as SECRET in Backup_Receiver.gs

Usage:
    python scripts/backup_to_sheets.py [--db path] [--url URL] [--secret S] [--dry-run]

Cron on the Pi (04:10 nightly, after the 04:00 local snapshot):
    10 4 * * * cd /home/pi/pokemon-dnd/pi-server && SHEETS_BACKUP_URL=... SHEETS_BACKUP_SECRET=... .venv/bin/python scripts/backup_to_sheets.py >> /home/pi/backup.log 2>&1
"""
import argparse
import os
import sqlite3
import sys

sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__), '..')))

from app import db  # noqa: E402

# sheet tab -> (sqlite table, columns in sheet order)
TABLES = {
    'Trainer Data': ('trainers', db.TRAINER_COLUMNS),
    'Pokemon Data': ('pokemon', db.POKEMON_COLUMNS),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', default=None, help='defaults to pi-server/data/pokedex.db')
    parser.add_argument('--url', default=None, help='Apps Script /exec URL (or env SHEETS_BACKUP_URL)')
    parser.add_argument('--secret', default=None, help='shared secret (or env SHEETS_BACKUP_SECRET)')
    parser.add_argument('--dry-run', action='store_true', help='read the DB and report row counts, send nothing')
    args = parser.parse_args()

    url = args.url or os.environ.get('SHEETS_BACKUP_URL')
    secret = args.secret or os.environ.get('SHEETS_BACKUP_SECRET')
    if not args.dry_run and not (url and secret):
        sys.exit('Set SHEETS_BACKUP_URL and SHEETS_BACKUP_SECRET (or pass --url/--secret).')

    path = os.path.abspath(args.db or db.DEFAULT_DB)
    # read-only so a backup can never block or alter the live server
    conn = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    tables = {}
    for tab, (table, columns) in TABLES.items():
        rows = [values for _rowid, values in db.fetch_rows(conn, table, columns)]
        if not rows:
            sys.exit(f'{table} is empty - refusing to overwrite the sheet with nothing.')
        tables[tab] = rows
        print(f'  {tab}: {len(rows)} rows')
    conn.close()

    if args.dry_run:
        print('Dry run - nothing sent.')
        return

    import httpx

    # Apps Script answers POST with a 302 to the actual response
    resp = httpx.post(url, json={'secret': secret, 'tables': tables},
                      follow_redirects=True, timeout=120)
    resp.raise_for_status()
    result = resp.json()
    if result.get('status') != 'ok':
        sys.exit(f'Backup failed: {result}')
    print(f'Backup ok: {result.get("written")} at {result.get("at")}')


if __name__ == '__main__':
    main()
