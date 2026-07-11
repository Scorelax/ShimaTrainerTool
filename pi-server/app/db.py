"""SQLite layer. One column per sheet column, in the exact positional order of
the Apps Script COLUMN_INDICES constants, so positional-array responses are
reconstructed by selecting columns in order."""
import os
import sqlite3

DEFAULT_DB = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'data', 'pokedex.db'))
DB_PATH = os.environ.get('POKEDEX_DB', DEFAULT_DB)

# Order mirrors TRAINER_COLUMN_INDICES (0..51)
TRAINER_COLUMNS = [
    'image', 'name', 'level', 'hitDice', 'vitalityDice',
    'strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma',
    'hp', 'vp', 'ac', 'walkingSpeed', 'savingThrows', 'initiative', 'proficiency',
    'skills', 'money', 'inventory', 'leaguePoints', 'pinCode',
    'affinity', 'specialization', 'trainerpath', 'pokeslots',
    'strmodifier', 'dexmodifier', 'conmodifier', 'intmodifier', 'wismodifier', 'chamodifier',
    'feats', 'currentHP', 'currentVP', 'currentAC', 'gear', 'region', 'trainerClass',
    'secondWindCharges', 'rapidOrdersCharges', 'unbreakableBondCharges',
    'elementalSynergyCharges', 'masterTrainerCharges', 'battleDice', 'maxPotential',
    'currentHD', 'currentVD', 'tacticianPoints', 'commander9', 'commander15',
]

# Order mirrors POKEMON_COLUMN_INDICES (0..61)
POKEMON_COLUMNS = [
    'trainername', 'image', 'name', 'dexentry', 'level',
    'primarytype', 'secondarytype', 'ability', 'ac', 'hitdice', 'hp',
    'vitalitydice', 'vp', 'speed', 'totalstats',
    'strenght', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma',
    'savingthrows', 'skills',
    'startingmoves', 'level2moves', 'level6moves', 'level10moves', 'level14moves', 'level18moves',
    'evolutionrequirement', 'initiative', 'proficiencybonus', 'nature', 'loyalty', 'stab',
    'helditem', 'nickname', 'custommoves', 'inactiveparty',
    'strmodifier', 'dexmodifier', 'conmodifier', 'intmodifier', 'wismodifier', 'chamodifier',
    'currentHP', 'currentVP', 'currentAC', 'comment', 'senses', 'feats', 'gear',
    'flavortext', 'typematchups', 'currentHD', 'currentVD', 'utilityslot',
    'size', 'cry', 'knownmoves', 'statuscondition', 'shiny',
]

_SCHEMA = """
CREATE TABLE IF NOT EXISTS trainers ({trainer_cols});
CREATE TABLE IF NOT EXISTS pokemon ({pokemon_cols});
CREATE TABLE IF NOT EXISTS natures (ord INTEGER PRIMARY KEY, name, boostStat, boostAmount, nerfStat, nerfAmount);
CREATE TABLE IF NOT EXISTS specializations (ord INTEGER PRIMARY KEY, name, shortEffect, effect);
CREATE TABLE IF NOT EXISTS trainer_paths (
    ord INTEGER PRIMARY KEY, name,
    l3name, l3short, l3effect,
    l5name, l5short, l5effect,
    l9name, l9short, l9effect,
    l15name, l15short, l15effect
);
CREATE TABLE IF NOT EXISTS affinities (ord INTEGER PRIMARY KEY, name, shortEffect, effect, improvedShortEffect, improvedEffect);
CREATE TABLE IF NOT EXISTS trainer_skills (ord INTEGER PRIMARY KEY, level, name, shortEffect, fullEffect);
CREATE TABLE IF NOT EXISTS nationalities (ord INTEGER PRIMARY KEY, nationality, regionBuff, effect);
CREATE TABLE IF NOT EXISTS trainer_feats (ord INTEGER PRIMARY KEY, name, effect);
CREATE TABLE IF NOT EXISTS pokemon_feats (ord INTEGER PRIMARY KEY, name, effect);
CREATE TABLE IF NOT EXISTS conduit_features (ord INTEGER PRIMARY KEY, name, stage1Effect, stage2Effect, stage3Effect);
CREATE TABLE IF NOT EXISTS conduit_battle_styles (ord INTEGER PRIMARY KEY, name, effect);
CREATE TABLE IF NOT EXISTS conduit_awakening_rows (ord INTEGER PRIMARY KEY, c1, c2, c3, c4);
CREATE TABLE IF NOT EXISTS type_chart_attack (ord INTEGER PRIMARY KEY, type);
CREATE TABLE IF NOT EXISTS type_chart_defend (ord INTEGER PRIMARY KEY, type);
CREATE TABLE IF NOT EXISTS type_chart_matrix (attack_ord INTEGER, defend_ord INTEGER, value, PRIMARY KEY (attack_ord, defend_ord));
CREATE TABLE IF NOT EXISTS upstream_cache (key TEXT PRIMARY KEY, json TEXT, fetched_at TEXT);
CREATE TABLE IF NOT EXISTS image_cache (key TEXT PRIMARY KEY, url TEXT);
"""


def _schema_sql():
    return _SCHEMA.format(
        trainer_cols=', '.join(f'"{c}"' for c in TRAINER_COLUMNS),
        pokemon_cols=', '.join(f'"{c}"' for c in POKEMON_COLUMNS),
    )


def connect(path=None):
    conn = sqlite3.connect(path or DB_PATH)
    conn.execute('PRAGMA journal_mode=WAL')
    return conn


def init(path=None):
    target = path or DB_PATH
    os.makedirs(os.path.dirname(target), exist_ok=True)
    conn = connect(target)
    conn.executescript(_schema_sql())
    conn.commit()
    return conn


def fetch_rows(conn, table, columns):
    """All data rows as (rowid, [values...]) in sheet order. None -> ''
    to mirror the Apps Script null/undefined -> '' normalization."""
    sql = f'SELECT rowid, {", ".join(chr(34) + c + chr(34) for c in columns)} FROM {table} ORDER BY rowid'
    return [(r[0], ['' if v is None else v for v in r[1:]]) for r in conn.execute(sql)]


def insert_row(conn, table, columns, values):
    """Append a row (Sheets appendRow). Pads/truncates to the column count."""
    vals = list(values)[:len(columns)]
    vals += [''] * (len(columns) - len(vals))
    placeholders = ', '.join('?' for _ in columns)
    cols = ', '.join(f'"{c}"' for c in columns)
    conn.execute(f'INSERT INTO {table} ({cols}) VALUES ({placeholders})', [_adapt(v) for v in vals])
    conn.commit()


def update_row(conn, table, rowid, columns, values):
    """Overwrite the first len(values) columns of a row (Sheets setValues)."""
    vals = list(values)[:len(columns)]
    cols = columns[:len(vals)]
    assignments = ', '.join(f'"{c}" = ?' for c in cols)
    conn.execute(f'UPDATE {table} SET {assignments} WHERE rowid = ?', [_adapt(v) for v in vals] + [rowid])
    conn.commit()


def set_cell(conn, table, rowid, column, value):
    """Write a single cell (Sheets getRange().setValue())."""
    conn.execute(f'UPDATE {table} SET "{column}" = ? WHERE rowid = ?', (_adapt(value), rowid))
    conn.commit()


def _adapt(value):
    """SQLite can't store dicts/lists; anything non-scalar becomes its JSON string."""
    if isinstance(value, (dict, list)):
        import json
        return json.dumps(value)
    return value
