"""route=dm -- reads and derivations for the DM console (dm-console.html), the landscape page the DM runs the game
from. Nothing here writes to the database: the DM's battle actions go through route=combat like everyone else's.

Unlike the player-facing pokemon/list, the species list here is EVERY species in the encyclopedia, not just the ones
the shared pokedex has unlocked for players -- the DM sets up encounters with Pokemon the players haven't met yet."""
import json
import os
import re
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
# Smaller DM-only records the console reads and writes whole (get-state / POST /api/dm/state), each owned by one module:
# the encounter loaded into the battle (its events, notes, terrain and weather -- js/dm/encounters.js), the last PvE
# battle that ended (routes_combat._remember_battle, marked done by the aftermath), saved Pokemon for reuse, species left
# out of the random generators, what the table TV shows outside the battle (js/dm/display-store.js), and where the
# region map on the board screen is looking (js/dm/pokenav.js).
_STATE_KEYS = {'encounter-run', 'last-battle', 'saved-pokemon', 'encounter-exclusions', 'display-scene', 'region-map-view',
               'pokedex-caught', 'saved-maps'}  # saved-maps: the DM's battle maps kept for reuse (js/dm/map-editor.js)
# The species the players have ever caught (lowercase names) -- see caught_species.
_CAUGHT_KEY = 'pokedex-caught'
# The XP each level starts at (the old DM tool's table) -- trainers and Pokemon alike. XP itself is in the trainers' and
# Pokemon's dm_xp column (db._migrate); a record with none yet counts as the start of its level.
XP_TO_LEVEL = [0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000,
               195000, 225000, 265000, 305000, 355000]
# Where the XP was kept before it moved onto the records -- read once into dm_xp, then removed.
_OLD_XP_LEDGER_KEY = 'xp-ledger'
# The pictures the DM uploads for the table TV (backgrounds) -- the files in upstream.DISPLAY_IMAGE_DIR, their names here.
_DISPLAY_IMAGES_KEY = 'display-images'
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
            bonus=json.loads(params['bonus']) if params.get('bonus') else None,
            extra_skills=[s for s in str(params.get('skills', '')).split(',') if s.strip()])}

    if action == 'species-detail':
        if not params.get('name'):
            raise ValueError('Missing species name')
        return {'status': 'success', 'data': species_detail(conn, params['name'])}

    if action == 'pokedex-config':
        return {'status': 'success', 'data': upstream.fetch_pokedex_config(conn),
                'editedHere': upstream.pokedex_config_edited_here(conn)}

    if action == 'pokedex-searchable':
        from .player_pokedex import searchable_move_overview
        return {'status': 'success', 'data': searchable_move_overview(conn)}

    if action == 'party':
        return {'status': 'success', 'data': party_overview(conn)}

    if action == 'caught-species':
        return {'status': 'success', 'data': caught_species(conn)}

    if action == 'set-caught':
        if not params.get('species'):
            raise ValueError('Missing species')
        set_caught(conn, params['species'], str(params.get('caught', '')).lower() in ('1', 'true'))
        return {'status': 'success', 'data': caught_species(conn)}

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

    if action == 'encounters':
        return {'status': 'success', 'data': list_encounters(conn)}

    if action == 'delete-encounter':
        if not params.get('id'):
            raise ValueError('Missing id')
        conn.execute('DELETE FROM dm_encounters WHERE id = ?', (params['id'],))
        conn.commit()
        return {'status': 'success'}

    if action == 'get-state':
        if params.get('key') not in _STATE_KEYS:
            raise ValueError('Unknown state: ' + str(params.get('key')))
        return {'status': 'success', 'data': _load_state(conn, params['key'])}

    if action == 'display-images':
        return {'status': 'success', 'data': list_display_images(conn)}

    if action == 'delete-display-image':
        if not params.get('id'):
            raise ValueError('Missing id')
        delete_display_image(conn, params['id'])
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
        'image': upstream.pokemon_image_url(row[2], _cell(row, 1)),
    }


def _evo_part(text, which):
    """'From: Sandit; Evolves: Bedouwara @ Level 14' -> 'Sandit' (which='from') or ['Bedouwara'] (which='evolves').
    The targets come from every "Evolves:" part (a species can have several), read exactly as the players' Pokedex
    reads them (player_pokedex.evolution_targets), so the per-target switches match what it shows."""
    if which == 'evolves':
        from .player_pokedex import evolution_targets
        return evolution_targets(text)
    for part in str(text or '').split(';'):
        key, _, value = part.partition(':')
        if key.strip().lower() == which:
            value = value.strip()
            return value if value and value != '-' else ''
    return ''


def _owned_species(conn):
    """The species the players have right now (any trainer's Pokemon, lowercase)."""
    rows = conn.execute("SELECT DISTINCT lower(trim(name)) FROM pokemon WHERE trim(coalesce(name, '')) != ''").fetchall()
    return {r[0] for r in rows}


def caught_species(conn):
    """The species the players have caught -- the Pokedex module's Poke Ball marks: {caught, owned} (lowercase names).
    `caught` is a lasting record (dm_state 'pokedex-caught'), so a species stays caught after its Pokemon evolves or is
    released: everything a player has now is added to it, as is every Pokemon registered or given (record_caught), and
    the DM can tick or untick one (set_caught). `owned`: the ones a player has right now."""
    stored = set(_load_state(conn, _CAUGHT_KEY) or [])
    owned = _owned_species(conn)
    if not owned <= stored:
        stored |= owned
        save_state(conn, _CAUGHT_KEY, sorted(stored))
    return {'caught': sorted(stored), 'owned': sorted(owned)}


def caught_before(conn, species):
    """Whether the players had already caught `species` -- asked before a new Pokemon of it is stored, since storing
    it makes it "owned" (and so caught) on the next read."""
    name = str(species or '').strip().lower()
    return name in set(_load_state(conn, _CAUGHT_KEY) or []) or name in _owned_species(conn)


def record_caught(conn, species, pokemon_row=None, first_time=False):
    """A Pokemon of `species` was just caught (registered, or given by the DM): remembered for good. The first time the
    players catch a species (`first_time`, see caught_before), they learn it: reveal_caught_species."""
    name = str(species or '').strip().lower()
    stored = set(_load_state(conn, _CAUGHT_KEY) or [])
    if name and name not in stored:
        save_state(conn, _CAUGHT_KEY, sorted(stored | {name}))
    if name and first_time:
        reveal_caught_species(conn, species, pokemon_row)


def set_caught(conn, species, caught):
    """The DM's own tick: `species` caught by the players or not. Ticking a species the players hadn't caught reveals
    it, the same as a catch (without a Pokemon of it: no moves or abilities)."""
    name = str(species or '').strip().lower()
    stored = set(_load_state(conn, _CAUGHT_KEY) or [])
    first_time = caught and name not in stored and name not in _owned_species(conn)
    stored = stored | {name} if caught else stored - {name}
    save_state(conn, _CAUGHT_KEY, sorted(stored))
    if first_time:
        reveal_caught_species(conn, species)


# What the players learn about a species the first time they catch one (the user's call, 2026-10-14): all its stats,
# the info lines (size, rarity, behaviour, habitat, activity) and senses -- plus, from the Pokemon they caught, its moves
# up to that Pokemon's level and the abilities it has.
_REVEAL_ON_CATCH = ('statAC', 'statHD', 'statVD', 'statSpeed', 'statSTR', 'statDEX', 'statCON', 'statINT', 'statWIS',
                    'statCHA', 'statSaves', 'statSkills',
                    'charSize', 'charRarity', 'charBehavior', 'charHabitat', 'charActivity',
                    'senseSight', 'senseHearing', 'senseSmell', 'senseTremorsense', 'senseEcholocation',
                    'senseTelepathy', 'senseBlindsight', 'senseDarkvision', 'senseTruesight')
_ABILITY_VISIBILITY = ('primaryAbility', 'secondaryAbility', 'hiddenAbility')  # the ability slots 0 / 1 / 2


def reveal_caught_species(conn, species, pokemon_row=None):
    """Switches on, in the players' Pokedex (pokedexConfig), what they learn by catching `species` for the first time
    (_REVEAL_ON_CATCH), and adds the species to it. `pokemon_row`: the caught Pokemon (db.POKEMON_COLUMNS order) -- its
    level shows the moves up to it, its abilities ("0:Name;text|2:Name;text" -- the slot first) show those abilities.
    Nothing is ever switched off. Saved like the DM console's own Pokedex edits, and pushed live."""
    from . import live
    from .player_pokedex import evolution_targets
    config = json.loads(json.dumps(upstream.fetch_pokedex_config(conn) or {}))
    name = str(species or '').strip()
    key = name.lower()
    visibility = config.setdefault('visibility', {})
    vis_key = next((k for k in visibility if str(k).lower() == key), key)
    own = visibility.get(vis_key)
    if isinstance(own, dict):
        vis = dict(own)
    else:
        # No settings of its own yet: start from the defaults, as the players saw it -- including the defaults' single
        # "Evolves into" switch, spelled out per evolution of this species (own settings name each one).
        vis = json.loads(json.dumps(config.get('defaults') or {}))
        entry = next((r for r in upstream.fetch_pokemon_db(conn) if len(r) > 2 and str(r[2]).lower() == key), None)
        targets = evolution_targets(entry[14] if entry and len(entry) > 14 else '')
        vis['evoToTargets'] = {t: bool(vis.get('evoTo')) for t in targets}
    for k in _REVEAL_ON_CATCH:
        vis[k] = True
    if pokemon_row:
        level = js_parse_int(pokemon_row[4] if len(pokemon_row) > 4 else None) or 1
        vis['moves'] = True
        vis['movesMaxLevel'] = max(js_parse_int(vis.get('movesMaxLevel')) or 1, level)
        abilities = str(pokemon_row[7] if len(pokemon_row) > 7 else '')
        for slot in re.findall(r'(?:^|\|)\s*(\d)\s*:', abilities):
            if int(slot) < len(_ABILITY_VISIBILITY):
                vis[_ABILITY_VISIBILITY[int(slot)]] = True
    visibility[vis_key] = vis
    registered = config.setdefault('registered', [])
    if key not in {str(r).lower() for r in registered}:
        registered.append(name)
    upstream.store_local_pokedex_config(conn, config)
    live.publish({'dataset': 'pokedex-config', 'version': ''})


def party_overview(conn):
    """Every player trainer with all their Pokemon -- the DM console's Party module. Trainer rows and Pokemon rows in
    the usual positional shape (db.TRAINER_COLUMNS / db.POKEMON_COLUMNS), portraits and animated sprites swapped in,
    plus the XP only the DM sees: `xp` = {trainer, pokemon: [one per Pokemon row, in the same order]}, each the stored
    XP or None when there's none yet (the console counts that as the start of the record's level)."""
    from . import db
    from .routes_trainer import _with_character_image, _with_pokemon_image
    _absorb_old_xp_ledger(conn)
    xp = {'trainers': dict(conn.execute('SELECT rowid, dm_xp FROM trainers').fetchall()),
          'pokemon': dict(conn.execute('SELECT rowid, dm_xp FROM pokemon').fetchall())}
    pokemon = db.fetch_rows(conn, 'pokemon', db.POKEMON_COLUMNS)
    out = []
    for trowid, row in db.fetch_rows(conn, 'trainers', db.TRAINER_COLUMNS):
        mine = [(prowid, p) for prowid, p in pokemon if str(p[0]).lower() == str(row[1]).lower()]
        out.append({
            'trainer': _with_character_image(row),
            'pokemon': [_with_pokemon_image(p) for _, p in mine],
            'xp': {'trainer': xp['trainers'].get(trowid), 'pokemon': [xp['pokemon'].get(prowid) for prowid, _ in mine]},
        })
    return out


def _xp_start(level):
    lvl = js_parse_int(level) or 1
    return XP_TO_LEVEL[max(1, min(20, lvl))]


def level_for_xp(xp):
    return max((lvl for lvl in range(1, 21) if xp >= XP_TO_LEVEL[lvl]), default=1)


def change_xp(conn, changes):
    """Gives (or takes, or sets) XP -- POST /api/dm/xp. `changes` = [{trainer, pokemon?, add? | set?}]: `pokemon` is
    the species name of one of the trainer's Pokemon (the app's own key for them), left out for the trainer. A record
    with no XP yet starts from the XP its current level begins at. Never below 0. Only the DM sees XP, so nothing is
    pushed to the players' phones; levels aren't changed here -- the player levels up in their app (it has choices).
    Returns [{trainer, pokemon, before, xp, level, xpLevel}]."""
    from . import db
    if not isinstance(changes, list) or not changes:
        raise ValueError('Nothing to change')
    trainers = {str(r[1]).lower(): (rowid, r) for rowid, r in db.fetch_rows(conn, 'trainers', db.TRAINER_COLUMNS)}
    pokemon = {(str(r[0]).lower(), str(r[2]).lower()): (rowid, r) for rowid, r in db.fetch_rows(conn, 'pokemon', db.POKEMON_COLUMNS)}
    out = []
    for ch in changes:
        tname = str(ch.get('trainer') or '')
        species = str(ch.get('pokemon') or '')
        if species:
            found = pokemon.get((tname.lower(), species.lower()))
            table, label = 'pokemon', f"{tname}'s {species}"
            level_idx = 4
        else:
            found = trainers.get(tname.lower())
            table, label = 'trainers', tname
            level_idx = 2
        if not found:
            raise ValueError('Not found: ' + label)
        rowid, row = found
        stored = conn.execute(f'SELECT dm_xp FROM {table} WHERE rowid = ?', (rowid,)).fetchone()[0]
        before = stored if isinstance(stored, int) else _xp_start(row[level_idx])
        if ch.get('set') is not None:
            new = js_parse_int(ch.get('set'))
            if new is None:
                raise ValueError('Not a number: ' + str(ch.get('set')))
        else:
            new = before + (js_parse_int(ch.get('add')) or 0)
        new = max(0, new)
        conn.execute(f'UPDATE {table} SET dm_xp = ? WHERE rowid = ?', (new, rowid))
        out.append({'trainer': row[0] if species else row[1], 'pokemon': row[2] if species else None, 'before': before,
                    'xp': new, 'level': js_parse_int(row[level_idx]) or 1, 'xpLevel': level_for_xp(new)})
    conn.commit()
    return out


def _absorb_old_xp_ledger(conn):
    """The XP the aftermath used to keep in one record ({trainers: {name: xp}, pokemon: {"trainer|species": xp}}, all
    lower-case) moves onto the trainers' and Pokemon's own dm_xp, once; the record is removed afterwards."""
    old = _load_state(conn, _OLD_XP_LEDGER_KEY)
    if old is None:
        return
    for name, xp in (old.get('trainers') or {}).items():
        if isinstance(xp, (int, float)):
            conn.execute('UPDATE trainers SET dm_xp = ? WHERE lower(name) = ? AND dm_xp IS NULL', (int(xp), str(name).lower()))
    for key, xp in (old.get('pokemon') or {}).items():
        trainer, _, species = str(key).partition('|')
        if isinstance(xp, (int, float)) and species:
            conn.execute('UPDATE pokemon SET dm_xp = ? WHERE lower(trainername) = ? AND lower(name) = ? AND dm_xp IS NULL',
                         (int(xp), trainer.lower(), species.lower()))
    conn.execute('DELETE FROM dm_state WHERE key = ?', (_OLD_XP_LEDGER_KEY,))
    conn.commit()


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
    return json.loads(upstream.localize_image_urls_in_text(row[0])) if row and row[0] else None


def save_clock(conn, clock):
    """Stores the whole world clock the DM console sends (POST /api/dm/clock) -- the console is the only writer."""
    if not isinstance(clock, dict) or not all(isinstance(clock.get(k), int) for k in ('year', 'month', 'day', 'hour', 'minute')):
        raise ValueError('clock needs year, month, day, hour and minute')
    conn.execute('INSERT OR REPLACE INTO dm_state (key, json, updated_at) VALUES (?, ?, ?)',
                 (_CLOCK_KEY, json.dumps(clock), datetime.now(timezone.utc).isoformat()))
    conn.commit()


def list_npcs(conn):
    """The DM's NPC library (js/dm/npcs.js owns the shape), sorted by name."""
    npcs = [json.loads(upstream.localize_image_urls_in_text(r[0])) for r in conn.execute('SELECT json FROM dm_npcs').fetchall() if r[0]]
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


def list_encounters(conn):
    """The DM's saved encounters (js/dm/encounters.js owns the shape), newest change first."""
    out = [json.loads(upstream.localize_image_urls_in_text(r[0]))
           for r in conn.execute('SELECT json FROM dm_encounters ORDER BY updated_at DESC').fetchall() if r[0]]
    return out


def save_encounter(conn, encounter):
    """Stores one encounter (POST /api/dm/encounter), new or changed -- keyed by its `id`."""
    if not isinstance(encounter, dict) or not str(encounter.get('id', '')).strip():
        raise ValueError('encounter needs an id')
    now = datetime.now(timezone.utc).isoformat()
    encounter['updatedAt'] = now
    conn.execute('INSERT OR REPLACE INTO dm_encounters (id, json, updated_at) VALUES (?, ?, ?)',
                 (str(encounter['id']), json.dumps(encounter, ensure_ascii=False), now))
    conn.commit()
    return encounter


def save_state(conn, key, data):
    """Stores one of the console's small records (_STATE_KEYS) whole, or clears it (None)."""
    if key not in _STATE_KEYS:
        raise ValueError('Unknown state: ' + str(key))
    conn.execute('INSERT OR REPLACE INTO dm_state (key, json, updated_at) VALUES (?, ?, ?)',
                 (key, json.dumps(data, ensure_ascii=False) if data is not None else None, datetime.now(timezone.utc).isoformat()))
    conn.commit()


def save_display_scene(conn, scene):
    """What the table TV shows (POST /api/dm/display-scene): a background and the pictures on it -- js/dm/display-store.js
    owns the shape. Stored, then pushed to the TV (display.html) and any other DM console."""
    from . import live
    if not isinstance(scene, dict):
        raise ValueError('scene must be an object')
    save_state(conn, 'display-scene', scene)
    live.publish({'type': 'display-scene', 'scene': scene})


def save_region_map_view(conn, view, store=True):
    """Where the region map on the board screen (battle-map.html, outside a battle) is looking -- POST
    /api/dm/region-map-view from the DM console's PokeNav, a few times a second while the DM turns it. Pushed to the
    board every time; stored (`store`) only about once a second and where it comes to rest -- PokeNav decides -- so a
    long turn isn't a stream of writes to the Pi's SD card. {x, y, zoom, polar, azimuth, style}
    (js/region-map/region-map.js's getView)."""
    import math
    from . import live
    if not isinstance(view, dict):
        raise ValueError('view must be an object')
    try:
        clean = {k: float(view[k]) for k in ('x', 'y', 'zoom', 'polar', 'azimuth')}
    except (KeyError, TypeError, ValueError):
        raise ValueError('view needs x, y, zoom, polar and azimuth')
    if not all(math.isfinite(v) for v in clean.values()):
        raise ValueError('view numbers must be real numbers')
    clean['style'] = view.get('style') if view.get('style') in ('topo', 'painted') else 'topo'
    if store:
        save_state(conn, 'region-map-view', clean)
    live.publish({'type': 'region-map-view', 'view': clean})


_IMAGE_TYPES = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif'}
_MAX_IMAGE_BYTES = 15 * 1024 * 1024


def list_display_images(conn):
    """The pictures uploaded for the table TV, newest first: [{id, name, url, createdAt}] -- a file that's gone from
    the folder is left out."""
    out = []
    for img in _load_state(conn, _DISPLAY_IMAGES_KEY) or []:
        if os.path.isfile(os.path.join(upstream.DISPLAY_IMAGE_DIR, img.get('file', ''))):
            out.append({**img, 'url': upstream.DISPLAY_IMAGE_URL_PREFIX + img['file']})
    return sorted(out, key=lambda i: i.get('createdAt', ''), reverse=True)


def save_display_image(conn, payload):
    """POST /api/dm/display-image: a new picture ({name, data: "data:image/...;base64,..."}) is written to
    upstream.DISPLAY_IMAGE_DIR under a new random name; one already there ({id, name}) is renamed. Returns it."""
    import base64
    import re
    import secrets
    images = _load_state(conn, _DISPLAY_IMAGES_KEY) or []
    name = str(payload.get('name') or '').strip()[:80] or 'Picture'
    if payload.get('id'):
        img = next((i for i in images if i.get('id') == payload['id']), None)
        if not img:
            raise ValueError('No such picture')
        img['name'] = name
    else:
        m = re.match(r'^data:(image/[a-z+.-]+);base64,(.+)$', str(payload.get('data') or ''), re.S)
        if not m or m.group(1) not in _IMAGE_TYPES:
            raise ValueError('That isn\'t a picture (JPG, PNG, WebP or GIF)')
        raw = base64.b64decode(m.group(2))
        if len(raw) > _MAX_IMAGE_BYTES:
            raise ValueError('That picture is too big (15 MB at most)')
        os.makedirs(upstream.DISPLAY_IMAGE_DIR, exist_ok=True)
        img_id = secrets.token_hex(8)
        img = {'id': img_id, 'name': name, 'file': img_id + _IMAGE_TYPES[m.group(1)],
               'createdAt': datetime.now(timezone.utc).isoformat()}
        with open(os.path.join(upstream.DISPLAY_IMAGE_DIR, img['file']), 'wb') as f:
            f.write(raw)
        images.append(img)
    conn.execute('INSERT OR REPLACE INTO dm_state (key, json, updated_at) VALUES (?, ?, ?)',
                 (_DISPLAY_IMAGES_KEY, json.dumps(images, ensure_ascii=False), datetime.now(timezone.utc).isoformat()))
    conn.commit()
    return {**img, 'url': upstream.DISPLAY_IMAGE_URL_PREFIX + img['file']}


def delete_display_image(conn, img_id):
    images = _load_state(conn, _DISPLAY_IMAGES_KEY) or []
    img = next((i for i in images if i.get('id') == img_id), None)
    if not img:
        return
    try:
        os.remove(os.path.join(upstream.DISPLAY_IMAGE_DIR, img['file']))
    except OSError:
        pass
    conn.execute('INSERT OR REPLACE INTO dm_state (key, json, updated_at) VALUES (?, ?, ?)',
                 (_DISPLAY_IMAGES_KEY, json.dumps([i for i in images if i is not img], ensure_ascii=False),
                  datetime.now(timezone.utc).isoformat()))
    conn.commit()


def give_pokemon(conn, trainer, cfg):
    """The aftermath's "give to trainer", and the Party module's Give Pokemon: a Pokemon goes straight into that trainer's
    team -- built the way the DM set it up (species, level, nature, abilities, held item, shiny, any ability scores and
    AC / max HP / max VP the DM gave it),
    with the same maths a player's own registration runs, stored with its static picture like register does."""
    from . import db, live
    tname = next((r[1] for _, r in db.fetch_rows(conn, 'trainers', db.TRAINER_COLUMNS) if str(r[1]).lower() == str(trainer).lower()), None)
    if not tname:
        raise ValueError('Unknown trainer: ' + str(trainer))
    species = str((cfg or {}).get('species') or '').strip()
    if not species:
        raise ValueError('Missing species')
    # The app finds a trainer's Pokemon by trainer + species name, so a second one of the same species would clash.
    if any(str(r[0]).lower() == tname.lower() and str(r[2]).lower() == species.lower()
           for _, r in db.fetch_rows(conn, 'pokemon', db.POKEMON_COLUMNS)):
        raise ValueError(f'{tname} already has a {species} -- a trainer can only have one of each species in the app.')
    row = build_pokemon(
        conn, species, js_parse_int(cfg.get('level')), nature=cfg.get('nature') or '',
        ability_slots=[str(s) for s in (cfg.get('abilities') or [0])], nickname=cfg.get('nickname') or '',
        held_item=cfg.get('item') or '', shiny=bool(cfg.get('shiny')), stats=cfg.get('stats') or None,
        overrides=cfg.get('overrides') or None, extra_skills=cfg.get('extraSkills') or ())
    row[0] = tname
    row[1] = upstream.local_pokemon_image_url(row[2], row[3]) or ''
    first_time = not caught_before(conn, row[2])
    db.insert_row(conn, 'pokemon', db.POKEMON_COLUMNS, row)
    record_caught(conn, row[2], row, first_time)
    live.publish({'type': 'trainer-data', 'trainer': tname})
    return {'status': 'success', 'message': f'{tname} got {cfg.get("nickname") or row[2]}!', 'data': row}


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


def _pretty(stem):
    """A picture's file name as a name to show: 'nurse-joy' -> 'Nurse Joy'."""
    return ' '.join(w[:1].upper() + w[1:] for w in re.split(r'[-_\s]+', stem) if w) or stem


def _portraits():
    """The portraits on the Pi, offered for the DM's NPCs and NPC trainers: [{name, file, url, own}] -- the NPC
    pictures (upstream.NPC_IMAGE_DIR, `file` = the file's name without its extension) first, then the players' own
    trainer portraits (upstream.CHARACTER_IMAGE_DIR, own=True)."""
    npcs = sorted(({'name': _pretty(stem), 'file': stem, 'url': url, 'own': False} for stem, url in upstream.npc_pictures()),
                  key=lambda p: p['name'].lower())
    own = []
    if os.path.isdir(upstream.CHARACTER_IMAGE_DIR):
        names = sorted({os.path.splitext(f)[0] for f in os.listdir(upstream.CHARACTER_IMAGE_DIR)})
        own = [{'name': n, 'file': n, 'url': url, 'own': True} for n in names if (url := upstream.local_character_image_url(n))]
    return npcs + own


def save_pokemon_image(conn, payload):
    """POST /api/dm/pokemon-image: a picture for a species that has none ({species, data: "data:image/...;base64,..."}),
    saved into the Pokemon pictures folder under Benjakronk's naming (<3-digit dex>-<sanitized name>.<ext>, e.g.
    005-scorab.png), so every page finds it the same way as his. A species that already has one is refused (nothing is
    overwritten). Returns {image (what the app shows -- a sprite still wins), picture}."""
    import base64
    row = _find_species(conn, payload.get('species') or '')
    name, dex = row[2], _cell(row, 1)
    if upstream.local_pokemon_image_url(name, dex):
        raise ValueError(f'{name} already has a picture')
    m = re.match(r'^data:(image/[a-z+.-]+);base64,(.+)$', str(payload.get('data') or ''), re.S)
    if not m or m.group(1) not in _IMAGE_TYPES or m.group(1) == 'image/gif':
        raise ValueError('That isn\'t a picture (JPG, PNG or WebP)')
    raw = base64.b64decode(m.group(2))
    if len(raw) > _MAX_IMAGE_BYTES:
        raise ValueError('That picture is too big (15 MB at most)')
    os.makedirs(upstream.POKEMON_IMAGE_DIR, exist_ok=True)
    filename = f"{str(dex).zfill(3)}-{upstream._sanitize_species_name(name)}{_IMAGE_TYPES[m.group(1)]}"
    with open(os.path.join(upstream.POKEMON_IMAGE_DIR, filename), 'wb') as f:
        f.write(raw)
    return {'image': upstream.pokemon_image_url(name, dex), 'picture': upstream.local_pokemon_image_url(name, dex) or ''}


def save_npc_image(payload):
    """POST /api/dm/npc-image: a picture for an NPC ({name, data: "data:image/...;base64,..."}) saved into the NPC
    pictures folder as <sanitized name>.<ext> (nurse-joy.png; nurse-joy-2.png when that's taken), next to Benjakronk's
    own. Returns it as _portraits lists it."""
    import base64
    m = re.match(r'^data:(image/[a-z+.-]+);base64,(.+)$', str(payload.get('data') or ''), re.S)
    if not m or m.group(1) not in _IMAGE_TYPES:
        raise ValueError('That isn\'t a picture (JPG, PNG, WebP or GIF)')
    raw = base64.b64decode(m.group(2))
    if len(raw) > _MAX_IMAGE_BYTES:
        raise ValueError('That picture is too big (15 MB at most)')
    base = upstream._sanitize_species_name(payload.get('name') or '')[:60].strip('-') or 'npc'
    os.makedirs(upstream.NPC_IMAGE_DIR, exist_ok=True)
    taken = {os.path.splitext(f)[0].lower() for f in os.listdir(upstream.NPC_IMAGE_DIR)}
    stem, n = base, 2
    while stem in taken:
        stem, n = f'{base}-{n}', n + 1
    with open(os.path.join(upstream.NPC_IMAGE_DIR, stem + _IMAGE_TYPES[m.group(1)]), 'wb') as f:
        f.write(raw)
    return {'name': _pretty(stem), 'file': stem, 'url': upstream.local_npc_image_url(stem), 'own': False}


_BACKGROUND_TYPES = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp'}


def save_battle_image(payload):
    """POST /api/dm/battle-image: a battle-map picture uploaded from the DM console ({kind: 'object' | 'background', name,
    data: "data:image/...;base64,..."}), saved in the battle pictures folder under the names the map lists go by --
    object-<name>.png for an object (PNG only: it needs its see-through background), battle-<name>.<ext> for a background
    (JPG, PNG or WebP). Returns it the way those lists do: {key, label, url}."""
    if payload.get('kind') == 'object':
        return _save_battle_picture(payload, 'object', {'image/png': '.png'}, "An object has to be a PNG picture (with a see-through background)")
    return save_battle_background(payload)


_BATTLE_IMAGE_NAME_RE = re.compile(r'^(?:object-[\w.-]+\.png|battle-[\w.-]+\.(?:png|jpe?g|webp))$', re.IGNORECASE)


def delete_battle_image(url):
    """POST /api/dm/battle-image-delete: removes one of the battle pictures (an object-* or battle-* file) from the Pi. A
    map already using it keeps the reference, and simply stops showing that picture."""
    name = os.path.basename(str(url or '').split('?')[0])
    if not str(url or '').startswith('/battle-images/') or not _BATTLE_IMAGE_NAME_RE.match(name):
        raise ValueError("That isn't one of the battle map's pictures")
    path = os.path.join(upstream.BATTLE_IMAGE_DIR, name)
    if not os.path.isfile(path):
        raise ValueError('That picture is already gone')
    os.remove(path)


def save_battle_background(payload):
    """POST /api/dm/battle-background: a battle-map background uploaded from the DM console ({name, data: "data:image/
    ...;base64,..."}), saved in the battle pictures folder as battle-<sanitized name>.<ext> -- where Map setup and the
    players' placement screen list their backgrounds (routes_combat._list_backgrounds). A name already there gets -2, -3...
    Returns it as that list does: {key, label, url}."""
    return _save_battle_picture(payload, 'battle', _BACKGROUND_TYPES, "That isn't a picture the map can use (JPG, PNG or WebP)")


def _save_battle_picture(payload, prefix, types, wrong_type):
    """Saves an uploaded battle picture as <prefix>-<sanitized name><ext> (a name already there gets -2, -3...)."""
    import base64
    m = re.match(r'^data:(image/[a-z+.-]+);base64,(.+)$', str(payload.get('data') or ''), re.S)
    if not m or m.group(1) not in types:
        raise ValueError(wrong_type)
    raw = base64.b64decode(m.group(2))
    if len(raw) > _MAX_IMAGE_BYTES:
        raise ValueError('That picture is too big (15 MB at most)')
    # A name typed with the prefix already ("object-tree") isn't doubled up.
    name = re.sub(rf'^{prefix}-', '', str(payload.get('name') or '').strip(), flags=re.IGNORECASE)
    base = upstream._sanitize_species_name(name)[:50].strip('-') or ('object' if prefix == 'object' else 'background')
    os.makedirs(upstream.BATTLE_IMAGE_DIR, exist_ok=True)
    taken = {os.path.splitext(f)[0].lower() for f in os.listdir(upstream.BATTLE_IMAGE_DIR)}
    key, n = base, 2
    while f'{prefix}-{key}'.lower() in taken:
        key, n = f'{base}-{n}', n + 1
    filename = f'{prefix}-{key}{types[m.group(1)]}'
    with open(os.path.join(upstream.BATTLE_IMAGE_DIR, filename), 'wb') as f:
        f.write(raw)
    return {'key': key, 'label': key.replace('_', ' ').replace('-', ' ').title(), 'url': f'/battle-images/{filename}'}


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
    """Compact per-species summary for the DM's enemy picker, sorted by dex number. `image`: the self-uploaded sprite,
    else the original picture (`picture`)."""
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
            'evolution': _cell(row, 14),  # "From: X; Evolves: Y @ Level 14" -- the encounter generator's stage filter
            'level': js_parse_int(_cell(row, 19)) or 1,
            # The encyclopedia's own numbers (before level, nature or anything the DM changes).
            'base': {
                **{k: js_parse_int(_cell(row, i)) for k, i in zip(_STAT_KEYS, range(27, 33))},
                'ac': js_parse_int(_cell(row, 20)), 'hitDice': js_parse_int(_cell(row, 21)), 'vitalityDice': js_parse_int(_cell(row, 23)),
                'speed': _cell(row, 25), 'savingThrows': _cell(row, 33), 'skills': _cell(row, 34),
            },
            'abilities': _abilities(row),
            # The still picture (Benjakronk's, on the Pi) -- the Display module offers it beside the animated sprite.
            'picture': upstream.local_pokemon_image_url(name, _cell(row, 1)) or '',
        })
        out[-1]['image'] = upstream.local_sprite_url(name) or out[-1]['picture']
    out.sort(key=lambda s: js_parse_int(s['dex']) or 0)
    return out


def build_pokemon(conn, species, level=None, nature='', ability_slots=('0',), nickname='', held_item='', shiny=False,
                  stats=None, overrides=None, extra_skills=(), bonus=None):
    """A full Pokemon row (db.POKEMON_COLUMNS order, the same 62-column shape a player's Pokemon has) for a wild /
    DM-controlled Pokemon, built from its encyclopedia entry the way pokemon-form.js builds one before registering,
    then run through the exact same stat maths -- but never stored. The DM console turns it into a battle
    participant with the same builder the players' own Pokemon go through (combat.js's buildPokemonCombatant).

    The DM's own changes: `stats` ({'str': 14, ...}) are final ability scores -- HP, VP, modifiers and initiative follow
    them -- `overrides` ({'ac', 'maxHP', 'maxVP'}) are set last, as typed, and `extra_skills` are proficiencies it has on
    top of its species' own. `bonus` (Encounter setup: {'str': 2, 'ac': 1, 'maxHP': 5, ...}) is added to what the
    numbers come out as -- ability-score bonuses before HP/VP and modifiers follow them, AC/HP/VP ones at the end."""
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
        upstream.pokemon_image_url(name, dex, shiny=shiny),  # 1: image
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
    bonus = {k: js_parse_int(v) for k, v in (bonus or {}).items() if js_parse_int(v)}
    apply_registration_stats(conn, data, {k: v for k, v in (stats or {}).items() if k in _STAT_KEYS},
                             {k: v for k, v in bonus.items() if k in _STAT_KEYS})
    o = overrides or {}
    if js_parse_int(o.get('ac')) is not None:
        data[8] = js_parse_int(o['ac'])
    if js_parse_int(o.get('maxHP')) is not None:
        data[10] = data[45] = js_parse_int(o['maxHP'])
    if js_parse_int(o.get('maxVP')) is not None:
        data[12] = data[46] = js_parse_int(o['maxVP'])
    if bonus.get('ac'):
        data[8] = (js_parse_int(data[8]) or 0) + bonus['ac']
    if bonus.get('maxHP'):
        data[10] = data[45] = max(1, (js_parse_int(data[10]) or 0) + bonus['maxHP'])
    if bonus.get('maxVP'):
        data[12] = data[46] = max(0, (js_parse_int(data[12]) or 0) + bonus['maxVP'])
    return data
