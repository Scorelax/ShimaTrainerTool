"""One-time migration: Google Sheets CSV exports -> SQLite.

Export each tab of the game spreadsheet (File > Download > CSV, one file per
tab) into a folder, named exactly after the tab:

    Trainer Data.csv        (required)
    Pokemon Data.csv        (required)
    Natures.csv             (required)
    Trainer Feat.csv        (required)
    Feat list.csv           (required)
    Type Chart.csv          (required)
    Conduit Awakening.csv   (optional - conduit characters)
    Conduit Battle Style.csv
    Conduit Features.csv

The "Item list" tab is NOT needed - items come from Benjakronk's upstream
source (run refresh_upstream.py afterwards for those).

Usage:
    python scripts/import_sheets.py --csv-dir path/to/exports [--db path/to/pokedex.db]

Re-running wipes and re-imports every table (upstream snapshots are kept).
"""
import argparse
import csv
import os
import re
import sys

sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__), '..')))

from app import db  # noqa: E402
from app.calculations import sanitize_string  # noqa: E402

_INT_RE = re.compile(r'^[+-]?\d+$')
_FLOAT_RE = re.compile(r'^[+-]?(\d+\.\d*|\.\d+|\d+[eE][+-]?\d+|\d+\.\d*[eE][+-]?\d+)$')


def coerce(value):
    """Mimic Sheets getValues(): numeric-looking cells become numbers."""
    s = value.strip() if isinstance(value, str) else value
    if s == '' or s is None:
        return ''
    if isinstance(s, str):
        if _INT_RE.match(s):
            return int(s)
        if _FLOAT_RE.match(s):
            return float(s)
        # Norwegian-locale CSV exports write decimals as 0,5
        comma = s.replace(',', '.', 1)
        if s.count(',') == 1 and '.' not in s and _FLOAT_RE.match(comma):
            return float(comma)
    return s


def read_csv(path):
    with open(path, newline='', encoding='utf-8-sig') as f:
        return [row for row in csv.reader(f)]


def cell(rows, row_1based, col_1based):
    """getRange-style access; missing cells are ''. 1-based like Sheets."""
    r, c = row_1based - 1, col_1based - 1
    if r < len(rows) and c < len(rows[r]):
        return rows[r][c]
    return ''


def get_range(rows, row, col, num_rows, num_cols):
    return [[cell(rows, row + i, col + j) for j in range(num_cols)]
            for i in range(num_rows)]


def import_grid(conn, table, columns, rows, width):
    """Data rows (row 2+) of a full-sheet tab -> table, in order."""
    conn.execute(f'DELETE FROM {table}')
    count = 0
    for raw in rows[1:]:
        values = [coerce(cell) for cell in raw[:width]]
        values += [''] * (width - len(values))
        if all(v == '' for v in values):
            continue  # Sheets' getDataRange stops at the last row with content
        db.insert_row(conn, table, columns, values)
        count += 1
    return count


def import_static(conn, table, cols, data, sanitize=(), skip_empty_names=True):
    conn.execute(f'DELETE FROM {table}')
    count = 0
    for i, row in enumerate(data):
        values = [coerce(v) for v in row]
        values = [sanitize_string(v) if j in sanitize else v for j, v in enumerate(values)]
        if skip_empty_names and all(v == '' for v in values):
            continue
        placeholders = ', '.join('?' for _ in cols)
        conn.execute(
            f'INSERT INTO {table} (ord, {", ".join(cols)}) VALUES (?, {placeholders})',
            [i] + [db._adapt(v) for v in values])
        count += 1
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv-dir', required=True)
    parser.add_argument('--db', default=None, help='defaults to pi-server/data/pokedex.db')
    args = parser.parse_args()

    db_path = args.db or db.DEFAULT_DB
    conn = db.init(db_path)
    print(f'Importing into {db_path}')

    def load(name, required=True):
        path = os.path.join(args.csv_dir, name)
        if not os.path.isfile(path):
            if required:
                sys.exit(f'MISSING required file: {path}')
            print(f'  skipped (not found): {name}')
            return None
        return read_csv(path)

    # --- main data ---
    trainers = load('Trainer Data.csv')
    n = import_grid(conn, 'trainers', db.TRAINER_COLUMNS, trainers, 52)
    print(f'  trainers: {n} rows')

    pokemon = load('Pokemon Data.csv')
    n = import_grid(conn, 'pokemon', db.POKEMON_COLUMNS, pokemon, 62)
    print(f'  pokemon: {n} rows')

    natures = load('Natures.csv')
    data = [r[:5] + [''] * (5 - len(r[:5])) for r in natures[1:] if any(c.strip() for c in r)]
    n = import_static(conn, 'natures', ['name', 'boostStat', 'boostAmount', 'nerfStat', 'nerfAmount'], data)
    print(f'  natures: {n} rows')

    # --- Trainer Feat tab: several ranges on one sheet ---
    tf = load('Trainer Feat.csv')
    n = import_static(conn, 'trainer_paths',
                      ['name', 'l3name', 'l3short', 'l3effect', 'l5name', 'l5short', 'l5effect',
                       'l9name', 'l9short', 'l9effect', 'l15name', 'l15short', 'l15effect'],
                      get_range(tf, 2, 1, 4, 13))
    print(f'  trainer_paths: {n} rows')
    n = import_static(conn, 'specializations', ['name', 'shortEffect', 'effect'],
                      get_range(tf, 11, 1, 18, 3), sanitize=(0, 1, 2))
    print(f'  specializations: {n} rows')
    n = import_static(conn, 'trainer_skills', ['level', 'name', 'shortEffect', 'fullEffect'],
                      get_range(tf, 31, 1, 8, 4), sanitize=(1, 2, 3))
    print(f'  trainer_skills: {n} rows')
    n = import_static(conn, 'affinities',
                      ['name', 'shortEffect', 'effect', 'improvedShortEffect', 'improvedEffect'],
                      get_range(tf, 58, 1, 18, 5), sanitize=(0, 1, 2, 3, 4))
    print(f'  affinities: {n} rows')
    n = import_static(conn, 'nationalities', ['nationality', 'regionBuff', 'effect'],
                      get_range(tf, 79, 1, 10, 3), sanitize=(0, 1, 2))
    print(f'  nationalities: {n} rows')

    # --- Feat list tab ---
    fl = load('Feat list.csv')
    n = import_static(conn, 'trainer_feats', ['name', 'effect'], get_range(fl, 2, 1, 35, 2))
    print(f'  trainer_feats: {n} rows')
    n = import_static(conn, 'pokemon_feats', ['name', 'effect'], get_range(fl, 42, 1, 29, 2))
    print(f'  pokemon_feats: {n} rows')

    # --- Type Chart tab ---
    tc = load('Type Chart.csv')
    conn.execute('DELETE FROM type_chart_attack')
    conn.execute('DELETE FROM type_chart_defend')
    conn.execute('DELETE FROM type_chart_matrix')
    attack = [cell(tc, 3 + i, 2) for i in range(18)]   # B3:B20
    defend = [cell(tc, 2, 3 + j) for j in range(18)]   # C2:T2
    for i, t in enumerate(attack):
        conn.execute('INSERT INTO type_chart_attack (ord, type) VALUES (?, ?)', (i, t))
    for j, t in enumerate(defend):
        conn.execute('INSERT INTO type_chart_defend (ord, type) VALUES (?, ?)', (j, t))
    for i in range(18):
        for j in range(18):
            conn.execute('INSERT INTO type_chart_matrix (attack_ord, defend_ord, value) VALUES (?, ?, ?)',
                         (i, j, coerce(cell(tc, 3 + i, 3 + j))))
    print(f'  type chart: {len(attack)}x{len(defend)} matrix')

    # --- Conduit tabs (optional) ---
    ca = load('Conduit Awakening.csv', required=False)
    if ca:
        n = import_static(conn, 'conduit_awakening_rows', ['c1', 'c2', 'c3', 'c4'],
                          get_range(ca, 2, 1, 72, 4), sanitize=(0, 1, 2, 3), skip_empty_names=False)
        print(f'  conduit_awakening_rows: {n} rows')
    cbs = load('Conduit Battle Style.csv', required=False)
    if cbs:
        n = import_static(conn, 'conduit_battle_styles', ['name', 'effect'],
                          get_range(cbs, 2, 1, 6, 2), sanitize=(0, 1))
        print(f'  conduit_battle_styles: {n} rows')
    cf = load('Conduit Features.csv', required=False)
    if cf:
        n = import_static(conn, 'conduit_features', ['name', 'stage1Effect', 'stage2Effect', 'stage3Effect'],
                          get_range(cf, 2, 1, 10, 4), sanitize=(0, 1, 2, 3))
        print(f'  conduit_features: {n} rows')

    conn.commit()
    conn.close()
    print('Done. Next: python scripts/refresh_upstream.py to snapshot the pokedex/moves/items.')


if __name__ == '__main__':
    main()
