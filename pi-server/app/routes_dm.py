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
# The Shima world clock (date, time, weather, calendar events, timers) -- js/dm/world-clock.js owns its shape.
_CLOCK_KEY = 'world-clock'
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
            overrides=json.loads(params['overrides']) if params.get('overrides') else None,
            extra_skills=[s for s in str(params.get('skills', '')).split(',') if s.strip()],
            # The battle setup's live preview of the numbers: no picture lookup (a network probe for a species never looked up).
            probe_image=str(params.get('preview', '')).lower() not in ('1', 'true'))}

    if action == 'species-detail':
        if not params.get('name'):
            raise ValueError('Missing species name')
        return {'status': 'success', 'data': species_detail(conn, params['name'])}

    if action == 'pokedex-config':
        return {'status': 'success', 'data': upstream.fetch_pokedex_config(conn),
                'editedHere': upstream.pokedex_config_edited_here(conn)}

    if action == 'party':
        return {'status': 'success', 'data': party_overview(conn)}

    if action == 'give-item':
        if not params.get('trainer') or not params.get('item'):
            raise ValueError('Missing trainer or item')
        return give_item(conn, params['trainer'], params['item'], js_parse_int(params.get('quantity')) or 1,
                         custom=str(params.get('custom', '')).lower() in ('1', 'true'),
                         description=params.get('description', ''))

    if action == 'give-money':
        if not params.get('trainer'):
            raise ValueError('Missing trainer')
        return give_money(conn, params['trainer'], js_parse_int(params.get('amount')) or 0)

    if action == 'get-clock':
        return {'status': 'success', 'data': _load_state(conn, _CLOCK_KEY)}

    if action == 'npcs':
        return {'status': 'success', 'data': list_npcs(conn)}

    if action == 'delete-npc':
        if not params.get('id'):
            raise ValueError('Missing id')
        conn.execute('DELETE FROM dm_npcs WHERE id = ?', (params['id'],))
        conn.commit()
        from . import live
        live.publish({'type': 'dm-npcs'})
        return {'status': 'success'}

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


def _find_species(conn, name):
    row = next((r for r in upstream.fetch_pokemon_db(conn) if str(_cell(r, 2)).lower() == str(name).lower()), None)
    if not row:
        raise ValueError('Unknown species: ' + str(name))
    return row


def species_detail(conn, name):
    """Everything the encyclopedia knows about one species, named -- for the DM console's Pokedex module."""
    row = _find_species(conn, name)
    evo = str(_cell(row, 14))
    return {
        'name': row[2], 'dex': _cell(row, 1), 'classification': _cell(row, 5), 'description': sanitize_string(_cell(row, 6)),
        'type1': _cell(row, 7), 'type2': _cell(row, 8),
        'size': _cell(row, 9), 'rarity': _cell(row, 10), 'habitat': _cell(row, 11), 'behavior': _cell(row, 12), 'activity': _cell(row, 13),
        'evolution': evo, 'evolvesFrom': _evo_part(evo, 'from'), 'evolvesTo': _evo_part(evo, 'evolves'),
        'catchDifficulty': _cell(row, 18), 'level': js_parse_int(_cell(row, 19)) or 1,
        'ac': _cell(row, 20), 'hitDice': _cell(row, 21), 'hp': _cell(row, 22), 'vitalityDice': _cell(row, 23), 'vp': _cell(row, 24),
        'speed': _cell(row, 25), 'movement': dict(zip(('walking', 'climbing', 'flying', 'hovering', 'swimming', 'burrowing'), (_cell(row, i) for i in _MOVEMENT_COLUMNS))),
        'stats': {k: js_parse_int(_cell(row, i)) for k, i in zip(_STAT_KEYS, range(27, 33))},
        'savingThrows': _cell(row, 33), 'skills': _cell(row, 34),
        'abilities': _abilities(row),
        'moves': {lvl: [m.strip() for m in sanitize_moves(_cell(row, i), keep).split(',') if m.strip()]
                  for lvl, (i, keep) in zip((1, 2, 6, 10, 14, 18), _MOVE_COLUMNS)},
        'senses': dict(zip(('sight', 'hearing', 'smell', 'tremorsense', 'echolocation', 'telepathy', 'blindsight', 'darkvision', 'truesight'),
                           (_cell(row, i) for i in _SENSE_COLUMNS))),
        'image': upstream.local_sprite_url(row[2]) or upstream.get_image_url(conn, row[2], _cell(row, 1)) or '',
    }


def _evo_part(text, which):
    """'From: Sandit; Evolves: Bedouwara @ Level 14' -> 'Sandit' (which='from') or ['Bedouwara'] (which='evolves'); the
    names after "Evolves:" can be several (", " / " or " / "/") and each may carry its condition after an "@"."""
    import re
    for part in str(text or '').split(';'):
        key, _, value = part.partition(':')
        if key.strip().lower() == which:
            value = value.strip()
            if which == 'from':
                return value if value and value != '-' else ''
            names = [re.split(r'\s*@', n)[0].strip() for n in re.split(r',|/|\bor\b', value)]
            return [n for n in names if n and n != '-']
    return '' if which == 'from' else []


def party_overview(conn):
    """Every player trainer with all their Pokemon -- the DM console's Party module. Trainer rows and Pokemon rows in
    the usual positional shape (db.TRAINER_COLUMNS / db.POKEMON_COLUMNS), portraits and animated sprites swapped in."""
    from . import db
    from .routes_trainer import _with_character_image, _with_local_sprite
    pokemon = [row for _, row in db.fetch_rows(conn, 'pokemon', db.POKEMON_COLUMNS)]
    return [{
        'trainer': _with_character_image(row),
        'pokemon': [_with_local_sprite(p) for p in pokemon if str(p[0]).lower() == str(row[1]).lower()],
    } for _, row in db.fetch_rows(conn, 'trainers', db.TRAINER_COLUMNS)]


def _parse_inventory(text):
    """A trainer's inventory cell -> (regular [[name, qty]], custom [{name, description, quantity}]). Regular items are
    "Potion (x2), Antidote (x1)" (named after the items list); custom ones are JSON after a ##CUSTOM## marker -- the same
    format trainer-info.js reads and writes."""
    import re
    text = str(text or '')
    regular_text, _, custom_text = text.partition('##CUSTOM##')
    regular = []
    # Each entry runs up to its own "(xN)" -- some names have a comma in them ("Tent, small (x1)"), so a plain split on
    # commas would cut them in two. Whatever is left after the last "(xN)" is entries without a count (1 each).
    end = 0
    for m in re.finditer(r'(.*?)\(x(\d+)\)\s*,?', regular_text):
        name = m.group(1).strip().strip(',').strip()
        if name:
            regular.append([name, int(m.group(2))])
        end = m.end()
    for part in regular_text[end:].split(','):
        part = part.strip()
        if part and part.lower() != 'none':
            regular.append([part, 1])
    try:
        custom = json.loads(custom_text) if custom_text else []
    except ValueError:
        custom = []
    return regular, custom if isinstance(custom, list) else []


def _format_inventory(regular, custom):
    text = ', '.join(f'{name} (x{qty})' for name, qty in regular if qty > 0)
    custom = [c for c in custom if (c.get('quantity') or 0) > 0]
    return f'{text}##CUSTOM##{json.dumps(custom, ensure_ascii=False)}' if custom else text


def give_item(conn, trainer_name, item, quantity, custom=False, description=''):
    """Adds `quantity` of `item` to the trainer's inventory (a negative quantity takes some away; at 0 it's gone) --
    read, changed and written in one go, so a change the player just made isn't overwritten."""
    from . import db, live
    from .routes_trainer import _find_trainer_rowid
    rowid = _find_trainer_rowid(conn, trainer_name)
    if rowid is None:
        raise ValueError('Trainer not found: ' + trainer_name)
    current = conn.execute('SELECT "inventory" FROM trainers WHERE rowid = ?', (rowid,)).fetchone()[0]
    regular, custom_items = _parse_inventory(current)
    item = item.strip()
    if custom:
        entry = next((c for c in custom_items if str(c.get('name', '')).lower() == item.lower()), None)
        if entry:
            entry['quantity'] = (js_parse_int(entry.get('quantity')) or 0) + quantity
            if description:
                entry['description'] = description
        elif quantity > 0:
            custom_items.append({'name': item, 'description': description or '', 'quantity': quantity})
    else:
        entry = next((r for r in regular if r[0].lower() == item.lower()), None)
        if entry:
            entry[1] += quantity
        elif quantity > 0:
            regular.append([item, quantity])
    new_value = _format_inventory(regular, custom_items)
    db.set_cell(conn, 'trainers', rowid, 'inventory', new_value)
    live.publish({'type': 'trainer-data', 'trainer': trainer_name})
    return {'status': 'success', 'inventory': new_value}


def give_money(conn, trainer_name, amount):
    """Adds `amount` (negative takes some away, never below 0) to the trainer's money, in one go."""
    from . import db, live
    from .routes_trainer import _find_trainer_rowid
    rowid = _find_trainer_rowid(conn, trainer_name)
    if rowid is None:
        raise ValueError('Trainer not found: ' + trainer_name)
    current = js_parse_int(conn.execute('SELECT "money" FROM trainers WHERE rowid = ?', (rowid,)).fetchone()[0]) or 0
    new_value = max(0, current + amount)
    db.set_cell(conn, 'trainers', rowid, 'money', json.dumps(new_value))  # same bare-number string the money route stores
    live.publish({'type': 'trainer-data', 'trainer': trainer_name})
    return {'status': 'success', 'money': new_value}


def _load_state(conn, key):
    row = conn.execute('SELECT json FROM dm_state WHERE key = ?', (key,)).fetchone()
    return json.loads(row[0]) if row and row[0] else None


def save_clock(conn, clock):
    """Stores the whole world clock the DM console sends (POST /api/dm/clock) -- the console is the only writer."""
    if not isinstance(clock, dict) or not all(isinstance(clock.get(k), int) for k in ('year', 'month', 'day', 'hour', 'minute')):
        raise ValueError('clock needs year, month, day, hour and minute')
    conn.execute('INSERT OR REPLACE INTO dm_state (key, json, updated_at) VALUES (?, ?, ?)',
                 (_CLOCK_KEY, json.dumps(clock), datetime.now(timezone.utc).isoformat()))
    conn.commit()


def list_npcs(conn):
    """The DM's NPC library (js/dm/npcs.js owns the shape), sorted by name."""
    npcs = [json.loads(r[0]) for r in conn.execute('SELECT json FROM dm_npcs').fetchall() if r[0]]
    return sorted(npcs, key=lambda n: str(n.get('name', '')).lower())


def save_npc(conn, npc):
    """Stores one NPC (POST /api/dm/npc), new or changed -- keyed by its `id`."""
    if not isinstance(npc, dict) or not str(npc.get('id', '')).strip():
        raise ValueError('npc needs an id')
    now = datetime.now(timezone.utc).isoformat()
    npc['updatedAt'] = now
    conn.execute('INSERT OR REPLACE INTO dm_npcs (id, json, updated_at) VALUES (?, ?, ?)',
                 (str(npc['id']), json.dumps(npc, ensure_ascii=False), now))
    conn.commit()
    return npc


def load_setup(conn):
    return _load_state(conn, _SETUP_KEY)


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
            # The encyclopedia's own numbers (before level, nature or anything the DM changes).
            'base': {
                **{k: js_parse_int(_cell(row, i)) for k, i in zip(_STAT_KEYS, range(27, 33))},
                'ac': js_parse_int(_cell(row, 20)), 'hitDice': js_parse_int(_cell(row, 21)), 'vitalityDice': js_parse_int(_cell(row, 23)),
                'speed': _cell(row, 25), 'savingThrows': _cell(row, 33), 'skills': _cell(row, 34),
            },
            'abilities': _abilities(row),
            'image': upstream.local_sprite_url(name) or upstream.get_image_url(conn, name, _cell(row, 1), probe=False) or '',
        })
    out.sort(key=lambda s: js_parse_int(s['dex']) or 0)
    return out


def build_pokemon(conn, species, level=None, nature='', ability_slots=('0',), nickname='', held_item='', shiny=False,
                  stats=None, overrides=None, extra_skills=(), probe_image=True):
    """A full Pokemon row (db.POKEMON_COLUMNS order, the same 62-column shape a player's Pokemon has) for a wild /
    DM-controlled Pokemon, built from its encyclopedia entry the way pokemon-form.js builds one before registering,
    then run through the exact same stat maths -- but never stored. The DM console turns it into a battle
    participant with the same builder the players' own Pokemon go through (combat.js's buildPokemonCombatant).

    The DM's own changes: `stats` ({'str': 14, ...}) are final ability scores -- HP, VP, modifiers and initiative follow
    them -- `overrides` ({'ac', 'maxHP', 'maxVP'}) are set last, as typed, and `extra_skills` are proficiencies it has on
    top of its species' own."""
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
        upstream.local_sprite_url(name, shiny=shiny) or upstream.get_image_url(conn, name, dex, probe=probe_image) or '',  # 1: image
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
    skills = [s.strip() for s in str(data[22] or '').split(',') if s.strip()]
    for extra in extra_skills or ():
        if extra.strip() and extra.strip().lower() not in {s.lower() for s in skills}:
            skills.append(extra.strip())
    data[22] = ', '.join(skills)
    apply_registration_stats(conn, data, {k: v for k, v in (stats or {}).items() if k in _STAT_KEYS})
    o = overrides or {}
    if js_parse_int(o.get('ac')) is not None:
        data[8] = js_parse_int(o['ac'])
    if js_parse_int(o.get('maxHP')) is not None:
        data[10] = data[45] = js_parse_int(o['maxHP'])
    if js_parse_int(o.get('maxVP')) is not None:
        data[12] = data[46] = js_parse_int(o['maxVP'])
    return data
