"""The game's data: the files in docs/ -- items, moves, natures, feats, a trainer's choices (specializations, paths,
affinities, trainer skills, nationalities), the conduit class and the type chart (species are species.py's) -- and the
players' Pokedex settings, which the DM console keeps in the database.

Every file is read again only when it changes, so an edit pulled onto the Pi shows at once, without a restart. (The
user's call, 2026-10-19: the rule tables used to be database tables imported once from the old Google Sheet; they're
files now like the species, and nothing is fetched from anywhere.)
"""
import json
import os
from datetime import datetime, timezone

from .db import DB_PATH

DOCS = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'docs'))
ITEMS_FILE = os.path.join(DOCS, 'DnD_items.json')
# The move list with the user's own categorization and effects (routes_combat.py reads the whole of each move).
MOVES_FILE = os.path.join(DOCS, 'DnD_moves_categorized_draft.json')
NATURES_FILE = os.path.join(DOCS, 'DnD_natures.json')
FEATS_FILE = os.path.join(DOCS, 'DnD_feats.json')
TRAINER_OPTIONS_FILE = os.path.join(DOCS, 'DnD_trainer_options.json')
CONDUIT_FILE = os.path.join(DOCS, 'DnD_conduit.json')
TYPE_CHART_FILE = os.path.join(DOCS, 'DnD_type_chart.json')
# The items the DM added or edited in the DM console's Admin module (admin.py) -- in the data folder, not docs/ (git keeps
# docs/, and an edit there would block the next pull): {lowercase name: item}, laid over ITEMS_FILE's.
ITEMS_OVERLAY_FILE = os.path.join(os.path.dirname(DB_PATH), 'admin_items.json')
# ...and the moves (the user's call, 2026-10-25: the Admin module's Moves tab): {lowercase name: only what the DM set --
# the fields he changed (an added move: all of them) and its `review` mark} -- laid over MOVES_FILE's records field by
# field, so the effects and categories the code comes with (and later fixes to them) still come through.
MOVES_OVERLAY_FILE = os.path.join(os.path.dirname(DB_PATH), 'admin_moves.json')
FILES = (ITEMS_FILE, MOVES_FILE, NATURES_FILE, FEATS_FILE, TRAINER_OPTIONS_FILE, CONDUIT_FILE, TYPE_CHART_FILE,
         ITEMS_OVERLAY_FILE, MOVES_OVERLAY_FILE)

_files = {}  # path -> ((mtime_ns, size), parsed file)
_NOTHING = {}  # what a missing / broken file reads as -- the same object every time (callers compare by identity)


def read_file(path):
    """The parsed file -- {} when it's missing or broken (every caller treats a miss as "nothing there"). Callers treat
    the result as read-only: it's shared until the file changes."""
    try:
        st = os.stat(path)
        stamp = (st.st_mtime_ns, st.st_size)
        cached = _files.get(path)
        if cached and cached[0] == stamp:
            return cached[1]
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        _files[path] = (stamp, data)
        return data
    except (OSError, ValueError):
        return _NOTHING


# ---------------------------------------------------------------------------
# Items and moves
# ---------------------------------------------------------------------------

_items = (None, None, [])  # (the file's list, the overlay it was made with, the items)


def items():
    """[{name, category, price, description, effect}] -- price a number, None, or a text ("Not sold"). The file's, with the
    DM's added / edited ones laid over (an edited one keeps its place, an added one comes after the file's)."""
    global _items
    base, overlay = read_file(ITEMS_FILE).get('items') or [], read_file(ITEMS_OVERLAY_FILE)
    if _items[0] is not base or _items[1] is not overlay:
        extra = {k: v for k, v in (overlay or {}).items() if isinstance(v, dict) and v.get('name')}
        merged = [extra.pop(str(i.get('name', '')).lower(), i) for i in base] + list(extra.values())
        _items = (base, overlay, merged)
    return _items[2]


# What a move the DM added has before he's said otherwise (a move in the file has the file's)
NEW_MOVE = {'type': 'Normal', 'action': '1 action', 'range': '', 'reaction': False, 'categories': [],
            'duration': {'raw': 'Instantaneous', 'rounds': 0, 'concentration': False, 'varies': False},
            'description': '', 'moveStat': 'None', 'vpCost': '', 'scaling': '', 'attackRoll': False}
_move_records = (None, None, [])  # (the file's list, the overlay it was made with, the moves)


def move_records():
    """Every move, effects and categories included: the file's, with what the DM changed laid over (MOVES_OVERLAY_FILE)
    -- an edited one keeps its place, an added one comes after the file's."""
    global _move_records
    base, overlay = read_file(MOVES_FILE).get('moves') or [], read_file(MOVES_OVERLAY_FILE)
    if _move_records[0] is not base or _move_records[1] is not overlay:
        extra = {k: v for k, v in (overlay or {}).items() if isinstance(v, dict) and v.get('name')}
        merged = []
        for m in base:
            patch = extra.pop(str(m.get('name', '')).lower(), None)
            merged.append({**m, **patch, 'name': m['name']} if patch else m)
        merged += [{**NEW_MOVE, **v} for v in extra.values()]
        _move_records = (base, overlay, merged)
    return _move_records[2]


_MOVE_FIELDS = ('name', 'type', 'moveStat', 'action', 'vpCost', 'duration', 'range', 'description', 'scaling')
_moves = (None, [])  # (the records list it was made from, the moves)


def moves():
    """The move list the app reads: [{name, type, moveStat, action, vpCost, duration, range, description, scaling}],
    all text -- moveStat "STR/DEX" (or "None"), action "1 bonus action", duration "Instantaneous", scaling the "At
    higher levels" text. The effects and categories stay on the Pi (routes_combat.py)."""
    global _moves
    records = move_records()
    if _moves[0] is not records:
        out = []
        for m in records:
            mv = {k: m.get(k) if m.get(k) is not None else '' for k in _MOVE_FIELDS}
            mv['duration'] = (m.get('duration') or {}).get('raw', '') if isinstance(m.get('duration'), dict) else str(mv['duration'])
            out.append(mv)
        _moves = (records, out)
    return _moves[1]


def find_move(name):
    """One move of moves() by name (any case), or None."""
    wanted = str(name or '').strip().lower()
    return next((m for m in moves() if str(m['name']).strip().lower() == wanted), None) if wanted else None


# ---------------------------------------------------------------------------
# The rules
# ---------------------------------------------------------------------------

def natures():
    """[{name, boostStat, boostAmount, nerfStat, nerfAmount}]"""
    return read_file(NATURES_FILE).get('natures') or []


def nature(name):
    wanted = str(name or '').strip().lower()
    return next((n for n in natures() if str(n['name']).lower() == wanted), None) if wanted else None


def trainer_feats():
    return read_file(FEATS_FILE).get('trainerFeats') or []


def pokemon_feats():
    return read_file(FEATS_FILE).get('pokemonFeats') or []


def _option(key):
    return read_file(TRAINER_OPTIONS_FILE).get(key) or []


def specializations():
    return _option('specializations')


def trainer_paths():
    return _option('trainerPaths')


def affinities():
    return _option('affinities')


def trainer_skills():
    return _option('trainerSkills')


def nationalities():
    return _option('nationalities')


def conduit():
    """{features, battleStyles, typeAwakenings}"""
    data = read_file(CONDUIT_FILE)
    return {'features': data.get('features') or [], 'battleStyles': data.get('battleStyles') or [],
            'typeAwakenings': data.get('typeAwakenings') or {}}


def type_names():
    """The 18 types, in the chart's order ("Normal", "Fighting", ...)."""
    return read_file(TYPE_CHART_FILE).get('types') or []


def type_matchups(type1, type2=None):
    """{attacking type: x damage} against a Pokemon of type1 (and type2) -- every type, in the chart's order, the two
    defending types multiplied (0.25 / 4 possible; the battle clamps those). {} when type1 (or a given type2) isn't a
    type."""
    chart = read_file(TYPE_CHART_FILE).get('chart') or {}
    names = {t.lower(): t for t in type_names()}
    d1 = names.get(str(type1 or '').strip().lower())
    d2 = names.get(str(type2 or '').strip().lower()) if type2 else None
    if not d1 or (type2 and not d2):
        return {}
    out = {}
    for attack in type_names():
        row = chart.get(attack) or {}
        value = _num(row.get(d1, 1)) * (_num(row.get(d2, 1)) if d2 else 1)
        out[attack] = int(value) if float(value).is_integer() else value
    return out


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 1.0


# ---------------------------------------------------------------------------
# The players' Pokedex settings (the DM console's Pokedex module)
# ---------------------------------------------------------------------------

POKEDEX_CONFIG_KEY = 'pokedex-config'  # in dm_state
_EMPTY_POKEDEX_CONFIG = {'registered': [], 'visibility': {}, 'defaults': {}, 'extraSearchableMoves': [], 'splashCount': 0}


def pokedex_config(conn):
    """{registered: [species], visibility: {species: {field: bool}}, defaults: {...}, extraSearchableMoves, ...} --
    what the players may see of each species."""
    row = conn.execute('SELECT json FROM dm_state WHERE key = ?', (POKEDEX_CONFIG_KEY,)).fetchone()
    try:
        return json.loads(row[0]) if row and row[0] else json.loads(json.dumps(_EMPTY_POKEDEX_CONFIG))
    except ValueError:
        return json.loads(json.dumps(_EMPTY_POKEDEX_CONFIG))


def store_pokedex_config(conn, data):
    """Saves what the DM console's Pokedex module set (its updated_at moves the data version on, so devices refresh)."""
    if not isinstance(data, dict) or not isinstance(data.get('registered'), list):
        raise ValueError("The Pokedex settings must be an object with a 'registered' list")
    if 'visibility' in data and not isinstance(data['visibility'], dict):
        raise ValueError("'visibility' must be an object")
    conn.execute('INSERT OR REPLACE INTO dm_state (key, json, updated_at) VALUES (?, ?, ?)',
                 (POKEDEX_CONFIG_KEY, json.dumps(data, ensure_ascii=False), datetime.now(timezone.utc).isoformat()))
    conn.commit()


def registered_pokemon_names(conn):
    return pokedex_config(conn).get('registered', [])


def data_version(conn, extra_paths=()):
    """When the Pokedex settings were last saved, and when each data file last changed -- the X-Data-Version every
    response carries, which tells the devices to drop the game data they keep."""
    row = conn.execute('SELECT updated_at FROM dm_state WHERE key = ?', (POKEDEX_CONFIG_KEY,)).fetchone()
    parts = [(row and row[0]) or 'none']
    for path in FILES + tuple(extra_paths):
        try:
            parts.append(str(int(os.path.getmtime(path))))
        except OSError:
            parts.append('-')
    return '|'.join(parts)
