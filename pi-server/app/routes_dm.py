"""route=dm -- reads and derivations for the DM console (dm-console.html), the landscape page the DM runs the game
from. Nothing here writes to the database: the DM's battle actions go through route=combat like everyone else's.

Unlike the player-facing pokemon/list, the species list here is EVERY species in the encyclopedia, not just the ones
the shared pokedex has unlocked for players -- the DM sets up encounters with Pokemon the players haven't met yet."""
import json
import os
from datetime import datetime, timezone

from . import routes_combat, upstream
from .calculations import sanitize_moves, sanitize_string
from .jsutil import js_parse_int
from .routes_gamedata import calculate_type_effectiveness
from .routes_pokemon import apply_registration_stats

# The DM's battle setup (map + creatures) waiting for Start battle -- one at a time, in the dm_state table. It stays after
# the battle starts (and ends), so the same setup can be run again or tweaked; New setup clears it.
_SETUP_KEY = 'battle-setup'
_STAT_KEYS = ('str', 'dex', 'con', 'int', 'wis', 'cha')

# Encyclopedia (upstream pokemon DB) row indices used below -- see pokedex.py's _format_row for the full layout.
_ABILITY_SLOTS = ((15, 62), (16, 63), (17, 64))  # (name, description) for the primary, secondary and hidden ability
_MOVE_COLUMNS = ((35, 4), (36, 4), (37, 4), (38, 4), (39, 3), (40, 3))  # starting, L2, L6, L10, L14, L18 moves (+ max kept)
_MOVEMENT_COLUMNS = range(65, 71)  # walking, climbing, flying, hovering, swimming, burrowing
_SENSE_COLUMNS = range(71, 80)  # sight, hearing, smell, tremorsense, echolocation, telepathy, blindsight, darkvision, truesight


def handle(conn, action, params):
    if action == 'species-list':
        return {'status': 'success', 'data': species_list(conn)}

    if action == 'build-pokemon':
        if not params.get('species'):
            raise ValueError('Missing species')
        slots = [s for s in str(params.get('abilities', '0')).split(',') if s.strip() != '']
        return {'status': 'success', 'data': build_pokemon(
            conn, params['species'], js_parse_int(params.get('level')),
            nature=params.get('nature', ''), ability_slots=slots,
            nickname=params.get('nickname', ''), held_item=params.get('item', ''),
            shiny=str(params.get('shiny', '')).lower() in ('1', 'true'),
            stats=json.loads(params['stats']) if params.get('stats') else None,
            overrides=json.loads(params['overrides']) if params.get('overrides') else None)}

    if action == 'get-setup':
        return {'status': 'success', 'data': load_setup(conn)}

    if action == 'clear-setup':
        save_setup(conn, None)
        return {'status': 'success', 'data': None}

    if action == 'map-assets':
        return {'status': 'success', 'data': {
            'objects': routes_combat.list_map_objects(),
            'backgrounds': routes_combat._list_backgrounds()['backgrounds'],
            'portraits': _portraits(),
        }}

    if action == 'start-battle':
        setup = load_setup(conn)
        if not setup:
            raise ValueError('Nothing is set up yet')
        if not (setup.get('map') or {}).get('ready'):
            raise ValueError('Set up the map first')
        if not setup.get('creatures'):
            raise ValueError('Add at least one Pokémon or trainer to the battle first')
        result = routes_combat.start_prepared_session(conn, setup)
        setup['startedAt'] = datetime.now(timezone.utc).isoformat()
        save_setup(conn, setup)
        return result

    raise ValueError('Unknown dm action: ' + str(action))


def load_setup(conn):
    row = conn.execute('SELECT json FROM dm_state WHERE key = ?', (_SETUP_KEY,)).fetchone()
    return json.loads(row[0]) if row and row[0] else None


def save_setup(conn, setup):
    """Stores the whole setup the DM console sends (POST /api/dm/setup in main.py -- too big for a query string), or
    clears it (None). The console is the only writer, so last write wins."""
    if setup is not None and not isinstance(setup, dict):
        raise ValueError('setup must be an object')
    conn.execute(
        'INSERT INTO dm_state (key, json, updated_at) VALUES (?, ?, ?) '
        'ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at',
        (_SETUP_KEY, json.dumps(setup) if setup is not None else None, datetime.now(timezone.utc).isoformat()))
    conn.commit()


def _portraits():
    """The trainer portraits on the Pi (upstream.CHARACTER_IMAGE_DIR), offered for the DM's NPC trainers: [{name, url}]."""
    if not os.path.isdir(upstream.CHARACTER_IMAGE_DIR):
        return []
    names = sorted({os.path.splitext(f)[0] for f in os.listdir(upstream.CHARACTER_IMAGE_DIR)})
    return [{'name': n, 'url': url} for n in names if (url := upstream.local_character_image_url(n))]


def _cell(row, i):
    return row[i] if i < len(row) and row[i] is not None else ''


def _abilities(row):
    out = []
    for slot, (name_idx, desc_idx) in enumerate(_ABILITY_SLOTS):
        name = _cell(row, name_idx)
        if name:
            out.append({'slot': slot, 'name': str(name).strip(),
                        'description': sanitize_string(_cell(row, desc_idx)) or 'No description available'})
    return out


def species_list(conn):
    """Compact per-species summary for the DM's enemy picker, sorted by dex number. `image` is whatever is known
    without a network probe (a self-uploaded sprite, or an already-cached static image) -- build-pokemon resolves the
    real one for whatever the DM actually adds."""
    out = []
    for row in upstream.fetch_pokemon_db(conn):
        name = _cell(row, 2)
        if not name:
            continue
        out.append({
            'name': name,
            'dex': _cell(row, 1),
            'classification': _cell(row, 5),
            'type1': _cell(row, 7), 'type2': _cell(row, 8),
            'size': _cell(row, 9), 'rarity': _cell(row, 10), 'habitat': _cell(row, 11),
            'behavior': _cell(row, 12), 'activity': _cell(row, 13),
            'level': js_parse_int(_cell(row, 19)) or 1,
            'abilities': _abilities(row),
            'image': upstream.local_sprite_url(name) or upstream.get_image_url(conn, name, _cell(row, 1), probe=False) or '',
        })
    out.sort(key=lambda s: js_parse_int(s['dex']) or 0)
    return out


def build_pokemon(conn, species, level=None, nature='', ability_slots=('0',), nickname='', held_item='', shiny=False,
                  stats=None, overrides=None):
    """A full Pokemon row (db.POKEMON_COLUMNS order, the same 62-column shape a player's Pokemon has) for a wild /
    DM-controlled Pokemon, built from its encyclopedia entry the way pokemon-form.js builds one before registering,
    then run through the exact same stat maths -- but never stored. The DM console turns it into a battle
    participant with the same builder the players' own Pokemon go through (combat.js's buildPokemonCombatant).

    The DM's own changes: `stats` ({'str': 14, ...}) are final ability scores -- HP, VP, modifiers and initiative follow
    them -- and `overrides` ({'ac', 'maxHP', 'maxVP'}) are set last, as typed."""
    row = next((r for r in upstream.fetch_pokemon_db(conn) if str(_cell(r, 2)).lower() == str(species).lower()), None)
    if not row:
        raise ValueError('Unknown species: ' + str(species))
    name = row[2]
    dex = _cell(row, 1)
    level = max(1, min(20, level or js_parse_int(_cell(row, 19)) or 1))

    wanted = {str(s).strip() for s in ability_slots}
    abilities = '|'.join(f"{a['slot']}:{a['name']};{a['description']}" for a in _abilities(row) if str(a['slot']) in wanted)

    type1, type2 = _cell(row, 7), _cell(row, 8)
    matchups = calculate_type_effectiveness(conn, type1, type2 or None)

    data = [
        '',                                                   # 0: trainer name -- none, the DM controls it
        upstream.local_sprite_url(name, shiny=shiny) or upstream.get_image_url(conn, name, dex) or '',  # 1: image
        name,                                                 # 2: name
        dex,                                                  # 3: dex entry
        level,                                                # 4: level
        type1, type2,                                         # 5, 6: types
        abilities,                                            # 7: abilities
        _cell(row, 20),                                       # 8: AC
        _cell(row, 21),                                       # 9: hit dice
        '',                                                   # 10: HP (calculated)
        _cell(row, 23),                                       # 11: vitality dice
        '',                                                   # 12: VP (calculated)
        ', '.join(str(_cell(row, i) or '-') for i in _MOVEMENT_COLUMNS),  # 13: speed
        _cell(row, 26),                                       # 14: total stats
        *[_cell(row, i) for i in range(27, 33)],              # 15-20: STR..CHA
        _cell(row, 33),                                       # 21: saving throws
        _cell(row, 34),                                       # 22: skills
        *[sanitize_moves(_cell(row, i), keep) for i, keep in _MOVE_COLUMNS],  # 23-28: moves by level
        _cell(row, 14),                                       # 29: evolution requirement
        '', '',                                               # 30, 31: initiative, proficiency (calculated)
        nature or '',                                         # 32: nature
        0,                                                    # 33: loyalty -- a wild Pokemon has none
        '',                                                   # 34: STAB (calculated)
        held_item or '',                                      # 35: held item
        nickname or '',                                       # 36: nickname -- the DM's label, e.g. "Zubat B"
        '', '',                                               # 37, 38: custom moves, active party
        '', '', '', '', '', '',                               # 39-44: modifiers (calculated)
        '', '', '',                                           # 45-47: current HP / VP (calculated) / AC
        '',                                                   # 48: comment
        ', '.join(str(_cell(row, i) or '-') for i in _SENSE_COLUMNS),  # 49: senses
        '', '',                                               # 50, 51: feats, gear
        _cell(row, 6),                                        # 52: flavor text
        ', '.join(str(v) for v in matchups),                  # 53: type matchups
        '', '', '',                                           # 54-56: current HD, current VD, utility slot
        _cell(row, 9),                                        # 57: size
        '', '', '',                                           # 58-60: cry, known moves, status condition
        'Y' if shiny else '',                                 # 61: shiny
    ]
    apply_registration_stats(conn, data, {k: v for k, v in (stats or {}).items() if k in _STAT_KEYS})
    o = overrides or {}
    if js_parse_int(o.get('ac')) is not None:
        data[8] = js_parse_int(o['ac'])
    if js_parse_int(o.get('maxHP')) is not None:
        data[10] = data[45] = js_parse_int(o['maxHP'])
    if js_parse_int(o.get('maxVP')) is not None:
        data[12] = data[46] = js_parse_int(o['maxVP'])
    return data
