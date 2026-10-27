"""SQLite layer. The players' trainers and Pokemon are JSON objects (trainers.py, owned.py), the DM console's records
are JSON too (dm_state / dm_npcs / dm_encounters), and the battle is one JSON session. The game's data isn't in here at
all -- it's the files in docs/ (gamedata.py, species.py). migrations.py moves an older database over, once."""
import os
import sqlite3

DEFAULT_DB = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'data', 'pokedex.db'))
DB_PATH = os.environ.get('POKEDEX_DB', DEFAULT_DB)

# The trainers as they were stored until 2026-10-19 -- one column per cell of the old 52-cell rows. Now they're objects
# (trainers.py); this order is what trainers.from_row reads (the move over, migrations.py).
LEGACY_TRAINER_COLUMNS = [
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

# The players' Pokemon as they were stored until 2026-10-18 -- one column per cell of the old 62-cell rows. Now they're
# objects in owned_pokemon (owned.py); this order is what owned.from_row reads (the move over, migrations.py).
LEGACY_POKEMON_COLUMNS = [
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

# XP (dm_xp) is only the DM's (routes_dm.change_xp): it's deliberately not in the objects, which are sent to the
# players' app and written back by it -- so it never leaves the Pi through them, no player save touches it, and since it
# sits on the record itself, a Pokemon keeps its XP when it evolves. The DM's notes on a trainer (dm_notes, the user's
# call, 2026-10-27: routes_dm.set_trainer_notes) are kept the same way.
TRAINERS_TABLE = 'CREATE TABLE IF NOT EXISTS trainers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, json TEXT, dm_xp INTEGER, dm_notes TEXT)'

_SCHEMA = TRAINERS_TABLE + """;
CREATE TABLE IF NOT EXISTS owned_pokemon (id INTEGER PRIMARY KEY AUTOINCREMENT, trainer TEXT, name TEXT, json TEXT, dm_xp INTEGER);
CREATE TABLE IF NOT EXISTS music_sync (track TEXT PRIMARY KEY, started_at TEXT, listeners INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS music_listeners (track TEXT, client_id TEXT, last_seen TEXT, PRIMARY KEY (track, client_id));
CREATE TABLE IF NOT EXISTS combat_session (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS dm_state (key TEXT PRIMARY KEY, json TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS dm_npcs (id TEXT PRIMARY KEY, json TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS dm_encounters (id TEXT PRIMARY KEY, json TEXT, updated_at TEXT);
"""


def connect(path=None):
    conn = sqlite3.connect(path or DB_PATH)
    conn.execute('PRAGMA journal_mode=WAL')
    return conn


def init(path=None):
    target = path or DB_PATH
    os.makedirs(os.path.dirname(target), exist_ok=True)
    conn = connect(target)
    conn.executescript(_SCHEMA)
    _migrate(conn)
    conn.commit()
    return conn


def _migrate(conn):
    """Column additions CREATE TABLE IF NOT EXISTS won't make on an existing database, then migrations.py's moves."""
    cols = [r[1] for r in conn.execute('PRAGMA table_info(music_sync)')]
    if 'listeners' not in cols:
        conn.execute('ALTER TABLE music_sync ADD COLUMN listeners INTEGER DEFAULT 0')
    # (the old trainer rows got their XP column here; migrations.py carries it over)
    trainer_cols = [r[1] for r in conn.execute('PRAGMA table_info(trainers)')]
    if 'pinCode' in trainer_cols and 'dm_xp' not in trainer_cols:
        conn.execute('ALTER TABLE trainers ADD COLUMN dm_xp INTEGER')
    from . import migrations
    migrations.run(conn)
    # (after: an old database's trainers table is only made the new way there)
    trainer_cols = [r[1] for r in conn.execute('PRAGMA table_info(trainers)')]
    if 'json' in trainer_cols and 'dm_notes' not in trainer_cols:
        conn.execute('ALTER TABLE trainers ADD COLUMN dm_notes TEXT')
