"""route=dm -- reads and derivations for the DM console (dm-console.html), the landscape page the DM runs the game
from. Nothing here writes to the database: the DM's battle actions go through route=combat like everyone else's.

Unlike the player-facing pokemon/list, the species list here is EVERY species in the encyclopedia, not just the ones
the shared pokedex has unlocked for players -- the DM sets up encounters with Pokemon the players haven't met yet."""
import json
import os
import re
from datetime import datetime, timezone

from . import gamedata, media, owned, routes_combat, trainers
from . import species as species_data
from .jsutil import js_parse_int

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
               'pokedex-caught', 'saved-maps',  # saved-maps: the DM's battle maps kept for reuse (js/dm/map-editor.js)
               'adventure-map',  # the Adventure module's map (js/dm/adventure.js), until the adventure starts
               'display-folders',  # the Display module's folders for its pictures: [{id, name, parent}] (js/dm/display.js)
               'display-npc-folders',  # ...and for its NPCs: {folders: [{id, name, parent}], placed: {npc id: folder id}}
               'display-planner',  # its planned scenes, waiting to be shown: [{id, name, folder, scene, shownAt}] (js/dm/display-store.js)
               'display-plan-folders',  # ...and their folders: [{id, name, parent}] (js/dm/display.js)
               # The Admin module's world (js/dm/admin-world.js, the user's call, 2026-10-20): planned events, the region's
               # locations, and the DM's own status conditions (their battle triggers run in routes_combat.py)
               'events', 'locations', 'status-conditions',
               'battle-reminders',  # the Battle module's DM-only reminders: {logFile, list: [...]} (js/dm/battle-live.js)
               'region-map',  # the region map's own record: {townsSeeded (places.json's towns made locations once, js/dm/admin-world.js), current, versions (the maps the DM uploaded, js/region-map/map-version.js)}
               'party-location'}  # where the party is: {locationId, onBoard, at, recent} (js/dm/pokenav.js)
# Saved here and heard of live by other screens ({'type': 'dm-state', 'key'}): the locations are the board screen's
# region map's names and the party's place is lit up on it (js/pages/battle-map.js), the user's call, 2026-10-20.
_LIVE_STATE_KEYS = {'locations', 'party-location', 'region-map'}  # region-map: the DM switched maps (js/region-map/map-version.js)
# The species the players have ever caught (lowercase names) -- see caught_species.
_CAUGHT_KEY = 'pokedex-caught'
# The XP each level starts at (the old DM tool's table) -- trainers and Pokemon alike. XP itself is in the trainers' and
# Pokemon's dm_xp column (db._migrate); a record with none yet counts as the start of its level.
XP_TO_LEVEL = [0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000,
               195000, 225000, 265000, 305000, 355000]
# Where the XP was kept before it moved onto the records -- read once into dm_xp, then removed.
_OLD_XP_LEDGER_KEY = 'xp-ledger'
# The pictures the DM uploads for the table TV (backgrounds) -- the files in media.DISPLAY_IMAGE_DIR, their names here.
_DISPLAY_IMAGES_KEY = 'display-images'


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

    # The Admin module (admin.py): the items with their pictures, one Pokedex entry as it's kept, the splashes
    if action == 'admin-items':
        from . import admin
        return {'status': 'success', 'data': admin.item_list()}

    if action == 'admin-species':
        from . import admin
        if not params.get('name'):
            raise ValueError('Missing species name')
        return {'status': 'success', 'data': admin.species_record(params['name'])}

    if action == 'admin-battle-logs':
        from . import admin
        return {'status': 'success', 'data': admin.battle_logs([t.get('name') for _, t in trainers.all_trainers(conn) if t.get('name')])}

    if action == 'admin-battle-log':
        from . import admin
        return {'status': 'success', 'data': admin.battle_log(params.get('file'))}

    if action == 'admin-splashes':
        from . import admin
        return {'status': 'success', 'data': admin.splashes()}

    if action == 'species-detail':
        if not params.get('name'):
            raise ValueError('Missing species name')
        return {'status': 'success', 'data': species_detail(conn, params['name'])}

    if action == 'pokedex-config':
        return {'status': 'success', 'data': gamedata.pokedex_config(conn)}

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

    if action == 'start-adventure':
        settings = {k: params[k] in ('1', 'true') for k in ('canJoin', 'canMove') if params.get(k) in ('0', '1', 'true', 'false')}
        if params.get('onScreen') in ('adventure', 'region'):
            settings['onScreen'] = params['onScreen']
        return routes_combat.start_adventure(conn, _load_state(conn, 'adventure-map'), settings)

    if action == 'give-move':
        # The Party module / the battle: a move from the move list -- one it hasn't learned yet, or can't normally learn --
        # taught to a player's Pokemon for good (its custom moves, like Edit Pokemon's), or (`forget`) one taken away.
        if not params.get('trainer') or not params.get('pokemon') or not params.get('move'):
            raise ValueError('Missing trainer, Pokemon or move')
        return give_move(conn, params['trainer'], params['pokemon'], params['move'],
                         forget=str(params.get('forget', '')).lower() in ('1', 'true'))

    if action == 'pokemon-dice':
        # The Party module: a player's Pokemon's hit / vitality die set by hand (Joey's Redent, d6 -> d8)
        if not params.get('trainer') or not params.get('pokemon'):
            raise ValueError('Missing trainer or Pokemon')
        return set_pokemon_dice(conn, params['trainer'], params['pokemon'], params.get('hitDie'), params.get('vitalityDie'))

    raise ValueError('Unknown dm action: ' + str(action))


def _find_species(conn, name):
    return species_data.require(name)


def species_detail(conn, name):
    """Everything the encyclopedia knows about one species, named -- for the DM console's Pokedex module."""
    sp = _find_species(conn, name)
    combat = sp.get('combat') or {}
    return {
        'name': sp['name'], 'dex': sp.get('dexNumber'), 'classification': sp.get('classification') or '',
        'description': sp.get('description') or '',
        'type1': sp['types'].get('primary') or '', 'type2': sp['types'].get('secondary') or '',
        'size': sp.get('size') or '', 'rarity': sp.get('rarity') or '', 'habitat': sp.get('habitat') or '',
        'behavior': sp.get('behavior') or '', 'activity': sp.get('active') or '',
        'evolution': species_data.evolution_text(sp), 'evolvesFrom': ' + '.join(sp.get('evolvesFrom') or []),
        'evolvesTo': species_data.evolves_into_names(sp),
        # {target: what it takes (the text the players can be shown), or None when the encyclopedia doesn't say}
        'evolutionRequirements': {e['species']: e.get('requirement') or None for e in sp.get('evolvesInto') or []},
        # {target: [each criterion as its own line]} -- the Pokedex module shows or hides each one by itself
        'evolutionRequirementLines': {e['species']: species_data.requirement_lines(e) for e in sp.get('evolvesInto') or []},
        'catchDifficulty': (sp.get('encounter') or {}).get('catchDifficulty'),
        'level': (sp.get('encounter') or {}).get('minimumLevel') or 1,
        'ac': combat.get('ac'), 'hitDice': combat.get('hitDie'), 'hp': combat.get('baseHP'),
        'vitalityDice': combat.get('vitalityDie'), 'vp': combat.get('baseVP'),
        'speed': species_data.speed_text(sp), 'movement': species_data.movement_text(sp),
        'stats': species_data.stats(sp),
        'savingThrows': species_data.list_text(sp.get('savingThrows')), 'skills': species_data.list_text(sp.get('skills')),
        'abilities': species_data.abilities(sp),
        'moves': {lvl: species_data.moves_at(sp, lvl) for lvl in species_data.MOVE_LEVELS},
        'senses': species_data.senses_text(sp),
        'image': media.pokemon_image_url(sp['name'], sp.get('dexNumber')),
    }

def _owned_species(conn):
    """The species the players have right now (any trainer's Pokemon, lowercase)."""
    rows = conn.execute("SELECT DISTINCT lower(trim(name)) FROM owned_pokemon WHERE trim(coalesce(name, '')) != ''").fetchall()
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


def record_caught(conn, species, pokemon=None, first_time=False):
    """A Pokemon of `species` was just caught (registered, or given by the DM): remembered for good. The first time the
    players catch a species (`first_time`, see caught_before), they learn it: reveal_caught_species."""
    name = str(species or '').strip().lower()
    stored = set(_load_state(conn, _CAUGHT_KEY) or [])
    if name and name not in stored:
        save_state(conn, _CAUGHT_KEY, sorted(stored | {name}))
    if name and first_time:
        reveal_caught_species(conn, species, pokemon)


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


def reveal_caught_species(conn, species, pokemon=None):
    """Switches on, in the players' Pokedex (pokedexConfig), what they learn by catching `species` for the first time
    (_REVEAL_ON_CATCH), and adds the species to it. `pokemon`: the caught Pokemon (owned.py) -- its level shows the
    moves up to it, and the abilities it has show those abilities.
    Nothing is ever switched off. Saved like the DM console's own Pokedex edits, and pushed live."""
    from . import live
    config = gamedata.pokedex_config(conn)
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
        entry = species_data.get(key)
        targets = species_data.evolves_into_names(entry) if entry else []
        vis['evoToTargets'] = {t: bool(vis.get('evoTo')) for t in targets}
    for k in _REVEAL_ON_CATCH:
        vis[k] = True
    if pokemon:
        level = js_parse_int(pokemon.get('level')) or 1
        vis['moves'] = True
        vis['movesMaxLevel'] = max(js_parse_int(vis.get('movesMaxLevel')) or 1, level)
        for a in pokemon.get('abilities') or []:
            if isinstance(a.get('slot'), int) and 0 <= a['slot'] < len(_ABILITY_VISIBILITY):
                vis[_ABILITY_VISIBILITY[a['slot']]] = True
    visibility[vis_key] = vis
    registered = config.setdefault('registered', [])
    if key not in {str(r).lower() for r in registered}:
        registered.append(name)
    gamedata.store_pokedex_config(conn, config)
    live.publish({'type': 'pokedex-config', 'version': ''})


def party_overview(conn):
    """Every player trainer with all their Pokemon -- the DM console's Party module: the trainers and their Pokemon as
    objects (trainers.py, owned.py), portraits and animated sprites swapped in, plus the XP only the DM sees: `xp` =
    {trainer, pokemon: [one per Pokemon, in the same order]}, each the stored XP or None when there's none yet (the
    console counts that as the start of the record's level)."""
    _absorb_old_xp_ledger(conn)
    trainer_xp = dict(conn.execute('SELECT id, dm_xp FROM trainers').fetchall())
    pokemon_xp = dict(conn.execute('SELECT id, dm_xp FROM owned_pokemon').fetchall())
    pokemon = owned.all_owned(conn)
    out = []
    for tid, t in trainers.all_trainers(conn):
        mine = [(pid, p) for pid, p in pokemon if str(p.get('trainer')).lower() == str(t['name']).lower()]
        out.append({
            'trainer': trainers.with_image(t),
            'pokemon': [owned.with_image(p) for _, p in mine],
            'xp': {'trainer': trainer_xp.get(tid), 'pokemon': [pokemon_xp.get(pid) for pid, _ in mine]},
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
    if not isinstance(changes, list) or not changes:
        raise ValueError('Nothing to change')
    out = []
    for ch in changes:
        tname = str(ch.get('trainer') or '')
        species = str(ch.get('pokemon') or '')
        if species:
            pid, p = owned.find(conn, tname, species)
            if pid is None:
                raise ValueError(f"Not found: {tname}'s {species}")
            table, key, level = 'owned_pokemon', ('id', pid), p.get('level')
            who, what = p.get('trainer'), p.get('name')
        else:
            tid, t = trainers.find(conn, tname)
            if tid is None:
                raise ValueError('Not found: ' + tname)
            table, key, level = 'trainers', ('id', tid), t.get('level')
            who, what = t['name'], None
        stored = conn.execute(f'SELECT dm_xp FROM {table} WHERE {key[0]} = ?', (key[1],)).fetchone()[0]
        before = stored if isinstance(stored, int) else _xp_start(level)
        if ch.get('set') is not None:
            new = js_parse_int(ch.get('set'))
            if new is None:
                raise ValueError('Not a number: ' + str(ch.get('set')))
        else:
            new = before + (js_parse_int(ch.get('add')) or 0)
        new = max(0, new)
        conn.execute(f'UPDATE {table} SET dm_xp = ? WHERE {key[0]} = ?', (new, key[1]))
        out.append({'trainer': who, 'pokemon': what, 'before': before,
                    'xp': new, 'level': js_parse_int(level) or 1, 'xpLevel': level_for_xp(new)})
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
            conn.execute('UPDATE owned_pokemon SET dm_xp = ? WHERE lower(trainer) = ? AND lower(name) = ? AND dm_xp IS NULL',
                         (int(xp), trainer.lower(), species.lower()))
    conn.execute('DELETE FROM dm_state WHERE key = ?', (_OLD_XP_LEDGER_KEY,))
    conn.commit()


def give_item(conn, trainer_name, item, quantity, custom=False, description=''):
    """Adds `quantity` of `item` to the trainer's inventory (a negative quantity takes some away; at 0 it's gone) --
    read, changed and written in one go, so a change the player just made isn't overwritten."""
    from . import live
    tid, trainer = trainers.find(conn, trainer_name)
    if tid is None:
        raise ValueError('Trainer not found: ' + trainer_name)
    trainers.add_item(trainer, item, quantity, custom=custom, description=description)
    trainers.save(conn, tid, trainer)
    live.publish({'type': 'trainer-data', 'trainer': trainer['name']})
    return {'status': 'success', 'inventory': trainer['inventory'], 'customItems': trainer['customItems']}


def give_move(conn, trainer_name, pokemon_name, move, forget=False):
    """Teaches `move` to the trainer's Pokemon (one of its custom moves -- the ones on top of what its levels give it), or
    with `forget` takes one of those away. The move has to be on the move list."""
    from . import live, owned
    pid, mon = owned.find(conn, trainer_name, pokemon_name)
    if pid is None:
        raise ValueError(f'{trainer_name} has no {pokemon_name}')
    found = gamedata.find_move(move)
    if not found and not forget:
        raise ValueError(f'No move called {move}')
    name = found['name'] if found else str(move).strip()
    custom = [m for m in (mon.get('customMoves') or []) if str(m).strip()]
    if forget:
        custom = [m for m in custom if m.lower() != name.lower()]
    elif not any(m.lower() == name.lower() for m in custom):
        custom.append(name)
    mon['customMoves'] = custom
    owned.save(conn, pid, mon)
    live.publish({'type': 'trainer-data', 'trainer': mon.get('trainer') or trainer_name})
    return {'status': 'success', 'data': {'customMoves': custom}}


_DIE_SIZES = (4, 6, 8, 10, 12, 20)


def set_pokemon_dice(conn, trainer_name, pokemon_name, hit_die, vitality_die):
    """The DM sets a player's Pokemon's hit and vitality die by hand (the user's call, 2026-10-20). Kept as how far it is
    from its species' own die (`diceBonus`, d6 -> d8 is +2), which goes on with it when it evolves (owned.evolve: the
    evolution's d8 becomes a d10). Max HP / VP follow."""
    from . import live, owned, species as species_data
    pid, mon = owned.find(conn, trainer_name, pokemon_name)
    if pid is None:
        raise ValueError(f'{trainer_name} has no {pokemon_name}')
    base = (species_data.get(mon.get('name')) or {}).get('combat') or {}
    combat = mon.setdefault('combat', {})
    bonus = dict(mon.get('diceBonus') or {})
    for key, value in (('hitDie', hit_die), ('vitalityDie', vitality_die)):
        if value in (None, ''):
            continue
        die = js_parse_int(value)
        if die not in _DIE_SIZES:
            raise ValueError(f'A die is one of d{", d".join(map(str, _DIE_SIZES))}')
        combat[key] = die
        own = js_parse_int(base.get(key))
        bonus[key] = die - own if own else 0
    mon['diceBonus'] = {k: v for k, v in bonus.items() if v}
    owned.recalculate(mon)
    owned.save(conn, pid, mon)
    live.publish({'type': 'trainer-data', 'trainer': mon.get('trainer') or trainer_name})
    return {'status': 'success', 'data': {'combat': combat, 'diceBonus': mon['diceBonus']}}


def give_money(conn, trainer_name, amount):
    """Adds `amount` (negative takes some away, never below 0) to the trainer's money, in one go."""
    from . import live
    tid, trainer = trainers.find(conn, trainer_name)
    if tid is None:
        raise ValueError('Trainer not found: ' + trainer_name)
    trainer['money'] = max(0, (js_parse_int(trainer.get('money')) or 0) + amount)
    trainers.save(conn, tid, trainer)
    live.publish({'type': 'trainer-data', 'trainer': trainer['name']})
    return {'status': 'success', 'money': trainer['money']}


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


def list_encounters(conn):
    """The DM's saved encounters (js/dm/encounters.js owns the shape), newest change first."""
    out = [json.loads(r[0])
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
    if key in _LIVE_STATE_KEYS:
        from . import live
        live.publish({'type': 'dm-state', 'key': key})


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
        if os.path.isfile(os.path.join(media.DISPLAY_IMAGE_DIR, img.get('file', ''))):
            out.append({**img, 'url': media.DISPLAY_IMAGE_URL_PREFIX + img['file']})
    return sorted(out, key=lambda i: i.get('createdAt', ''), reverse=True)


def save_admin_picture(payload):
    """POST /api/dm/admin-picture: a picture for an event or a location ({data: "data:image/...;base64,..."}) written to
    media.ADMIN_IMAGE_DIR under a new random name -> {url}."""
    import base64
    import secrets
    m = re.match(r'^data:(image/[a-z+.-]+);base64,(.+)$', str(payload.get('data') or ''), re.S)
    if not m or m.group(1) not in _IMAGE_TYPES:
        raise ValueError("That isn't a picture (JPG, PNG, WebP or GIF)")
    raw = base64.b64decode(m.group(2))
    if len(raw) > _MAX_IMAGE_BYTES:
        raise ValueError('That picture is too big (15 MB at most)')
    os.makedirs(media.ADMIN_IMAGE_DIR, exist_ok=True)
    name = secrets.token_hex(8) + _IMAGE_TYPES[m.group(1)]
    with open(os.path.join(media.ADMIN_IMAGE_DIR, name), 'wb') as f:
        f.write(raw)
    return {'url': media.ADMIN_IMAGE_URL_PREFIX + name}


def save_display_image(conn, payload):
    """POST /api/dm/display-image: a new picture ({name, data: "data:image/...;base64,...", folder}) is written to
    media.DISPLAY_IMAGE_DIR under a new random name; one already there ({id, name} / {id, folder}) is renamed or moved to
    another folder ('' = the top). Returns it."""
    import base64
    import re
    import secrets
    images = _load_state(conn, _DISPLAY_IMAGES_KEY) or []
    name = str(payload.get('name') or '').strip()[:80] or 'Picture'
    if payload.get('id'):
        img = next((i for i in images if i.get('id') == payload['id']), None)
        if not img:
            raise ValueError('No such picture')
        if 'name' in payload:
            img['name'] = name
        if 'folder' in payload:
            img['folder'] = str(payload.get('folder') or '')
    else:
        m = re.match(r'^data:(image/[a-z+.-]+);base64,(.+)$', str(payload.get('data') or ''), re.S)
        if not m or m.group(1) not in _IMAGE_TYPES:
            raise ValueError('That isn\'t a picture (JPG, PNG, WebP or GIF)')
        raw = base64.b64decode(m.group(2))
        if len(raw) > _MAX_IMAGE_BYTES:
            raise ValueError('That picture is too big (15 MB at most)')
        os.makedirs(media.DISPLAY_IMAGE_DIR, exist_ok=True)
        img_id = secrets.token_hex(8)
        img = {'id': img_id, 'name': name, 'file': img_id + _IMAGE_TYPES[m.group(1)], 'folder': str(payload.get('folder') or ''),
               'createdAt': datetime.now(timezone.utc).isoformat()}
        with open(os.path.join(media.DISPLAY_IMAGE_DIR, img['file']), 'wb') as f:
            f.write(raw)
        images.append(img)
    conn.execute('INSERT OR REPLACE INTO dm_state (key, json, updated_at) VALUES (?, ?, ?)',
                 (_DISPLAY_IMAGES_KEY, json.dumps(images, ensure_ascii=False), datetime.now(timezone.utc).isoformat()))
    conn.commit()
    return {**img, 'url': media.DISPLAY_IMAGE_URL_PREFIX + img['file']}


def delete_display_image(conn, img_id):
    images = _load_state(conn, _DISPLAY_IMAGES_KEY) or []
    img = next((i for i in images if i.get('id') == img_id), None)
    if not img:
        return
    try:
        os.remove(os.path.join(media.DISPLAY_IMAGE_DIR, img['file']))
    except OSError:
        pass
    conn.execute('INSERT OR REPLACE INTO dm_state (key, json, updated_at) VALUES (?, ?, ?)',
                 (_DISPLAY_IMAGES_KEY, json.dumps([i for i in images if i is not img], ensure_ascii=False),
                  datetime.now(timezone.utc).isoformat()))
    conn.commit()


def give_pokemon(conn, trainer, cfg):
    """The aftermath's "give to trainer", and the Party module's Give Pokemon: a Pokemon goes straight into that trainer's
    team -- built the way the DM set it up (species, level, nature, abilities, held item, shiny, any ability scores and
    AC / max HP / max VP the DM gave it, moves taught on top: customMoves),
    with the same maths a player's own registration runs, stored with its static picture like register does."""
    from . import live
    tname = (trainers.find(conn, trainer)[1] or {}).get('name')
    if not tname:
        raise ValueError('Unknown trainer: ' + str(trainer))
    species = str((cfg or {}).get('species') or '').strip()
    if not species:
        raise ValueError('Missing species')
    # The app finds a trainer's Pokemon by trainer + species name, so a second one of the same species would clash.
    if owned.find(conn, tname, species)[0] is not None:
        raise ValueError(f'{tname} already has a {species} -- a trainer can only have one of each species in the app.')
    pokemon = build_pokemon(
        conn, species, js_parse_int(cfg.get('level')), nature=cfg.get('nature') or '',
        ability_slots=cfg.get('abilities') or [0], nickname=cfg.get('nickname') or '',
        held_item=cfg.get('item') or '', shiny=bool(cfg.get('shiny')), stats=cfg.get('stats') or None,
        overrides=cfg.get('overrides') or None, extra_skills=cfg.get('extraSkills') or ())
    pokemon['trainer'] = tname
    # Moves taught on top (the Give Pokemon popup's "Teach a move"): any move on the move list, kept as its custom moves
    taught = [m['name'] for m in (gamedata.find_move(x) for x in (cfg.get('customMoves') or [])) if m]
    if taught:
        pokemon['customMoves'] = list(dict.fromkeys([*(pokemon.get('customMoves') or []), *taught]))
    first_time = not caught_before(conn, pokemon['name'])
    owned.insert(conn, pokemon)
    record_caught(conn, pokemon['name'], pokemon, first_time)
    live.publish({'type': 'trainer-data', 'trainer': tname})
    return {'status': 'success', 'message': f'{tname} got {cfg.get("nickname") or pokemon["name"]}!',
            'data': owned.with_image(pokemon)}


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
    pictures (media.NPC_IMAGE_DIR, `file` = the file's name without its extension) first, then the players' own
    trainer portraits (media.CHARACTER_IMAGE_DIR, own=True)."""
    npcs = sorted(({'name': _pretty(stem), 'file': stem, 'url': url, 'own': False} for stem, url in media.npc_pictures()),
                  key=lambda p: p['name'].lower())
    own = []
    if os.path.isdir(media.CHARACTER_IMAGE_DIR):
        names = sorted({os.path.splitext(f)[0] for f in os.listdir(media.CHARACTER_IMAGE_DIR)})
        own = [{'name': n, 'file': n, 'url': url, 'own': True} for n in names if (url := media.local_character_image_url(n))]
    return npcs + own


def save_pokemon_image(conn, payload):
    """POST /api/dm/pokemon-image: a picture for a species that has none ({species, data: "data:image/...;base64,..."}),
    saved into the Pokemon pictures folder under its naming (<3-digit dex>-<sanitized name>.<ext>, e.g.
    005-scorab.png), so every page finds it the same way as the others. A species that already has one is refused (nothing is
    overwritten). Returns {image (what the app shows -- a sprite still wins), picture}."""
    import base64
    sp = _find_species(conn, payload.get('species') or '')
    name, dex = sp['name'], sp.get('dexNumber')
    if media.local_pokemon_image_url(name, dex):
        raise ValueError(f'{name} already has a picture')
    m = re.match(r'^data:(image/[a-z+.-]+);base64,(.+)$', str(payload.get('data') or ''), re.S)
    if not m or m.group(1) not in _IMAGE_TYPES or m.group(1) == 'image/gif':
        raise ValueError('That isn\'t a picture (JPG, PNG or WebP)')
    raw = base64.b64decode(m.group(2))
    if len(raw) > _MAX_IMAGE_BYTES:
        raise ValueError('That picture is too big (15 MB at most)')
    os.makedirs(media.POKEMON_IMAGE_DIR, exist_ok=True)
    filename = f"{str(dex).zfill(3)}-{media._sanitize_species_name(name)}{_IMAGE_TYPES[m.group(1)]}"
    with open(os.path.join(media.POKEMON_IMAGE_DIR, filename), 'wb') as f:
        f.write(raw)
    return {'image': media.pokemon_image_url(name, dex), 'picture': media.local_pokemon_image_url(name, dex) or ''}


def save_npc_image(payload):
    """POST /api/dm/npc-image: a picture for an NPC ({name, data: "data:image/...;base64,..."}) saved into the NPC
    pictures folder as <sanitized name>.<ext> (nurse-joy.png; nurse-joy-2.png when that's taken), next to the
    others. Returns it as _portraits lists it."""
    import base64
    m = re.match(r'^data:(image/[a-z+.-]+);base64,(.+)$', str(payload.get('data') or ''), re.S)
    if not m or m.group(1) not in _IMAGE_TYPES:
        raise ValueError('That isn\'t a picture (JPG, PNG, WebP or GIF)')
    raw = base64.b64decode(m.group(2))
    if len(raw) > _MAX_IMAGE_BYTES:
        raise ValueError('That picture is too big (15 MB at most)')
    base = media._sanitize_species_name(payload.get('name') or '')[:60].strip('-') or 'npc'
    os.makedirs(media.NPC_IMAGE_DIR, exist_ok=True)
    taken = {os.path.splitext(f)[0].lower() for f in os.listdir(media.NPC_IMAGE_DIR)}
    stem, n = base, 2
    while stem in taken:
        stem, n = f'{base}-{n}', n + 1
    with open(os.path.join(media.NPC_IMAGE_DIR, stem + _IMAGE_TYPES[m.group(1)]), 'wb') as f:
        f.write(raw)
    return {'name': _pretty(stem), 'file': stem, 'url': media.local_npc_image_url(stem), 'own': False}


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
    path = os.path.join(media.BATTLE_IMAGE_DIR, name)
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
    base = media._sanitize_species_name(name)[:50].strip('-') or ('object' if prefix == 'object' else 'background')
    os.makedirs(media.BATTLE_IMAGE_DIR, exist_ok=True)
    taken = {os.path.splitext(f)[0].lower() for f in os.listdir(media.BATTLE_IMAGE_DIR)}
    key, n = base, 2
    while f'{prefix}-{key}'.lower() in taken:
        key, n = f'{base}-{n}', n + 1
    filename = f'{prefix}-{key}{types[m.group(1)]}'
    with open(os.path.join(media.BATTLE_IMAGE_DIR, filename), 'wb') as f:
        f.write(raw)
    return {'key': key, 'label': key.replace('_', ' ').replace('-', ' ').title(), 'url': f'/battle-images/{filename}'}


def species_list(conn):
    """Compact per-species summary for the DM's enemy picker, sorted by dex number. `image`: the self-uploaded sprite,
    else the original picture (`picture`)."""
    out = []
    for sp in species_data.all_species():
        name, dex = sp['name'], sp.get('dexNumber')
        combat = sp.get('combat') or {}
        out.append({
            'name': name,
            'dex': dex,
            'classification': sp.get('classification') or '',
            'type1': sp['types'].get('primary') or '', 'type2': sp['types'].get('secondary') or '',
            'size': sp.get('size') or '', 'rarity': sp.get('rarity') or '', 'habitat': sp.get('habitat') or '',
            'behavior': sp.get('behavior') or '', 'activity': sp.get('active') or '',
            'evolution': species_data.evolution_text(sp),  # "From: X; Evolves: Y @ Level 14" -- the encounter generator's stage filter
            'level': (sp.get('encounter') or {}).get('minimumLevel') or 1,
            # The encyclopedia's own numbers (before level, nature or anything the DM changes).
            'base': {
                **species_data.stats(sp),
                'ac': combat.get('ac'), 'hitDice': combat.get('hitDie'), 'vitalityDice': combat.get('vitalityDie'),
                'speed': species_data.speed_text(sp), 'savingThrows': species_data.list_text(sp.get('savingThrows')),
                'skills': species_data.list_text(sp.get('skills')),
            },
            'abilities': species_data.abilities(sp),
            # The still picture (media.POKEMON_IMAGE_DIR) -- the Display module offers it beside the animated sprite.
            'picture': media.local_pokemon_image_url(name, dex) or '',
        })
        out[-1]['image'] = media.local_sprite_url(name) or out[-1]['picture']
    return out

def build_pokemon(conn, species, level=None, nature='', ability_slots=(0,), nickname='', held_item='', shiny=False,
                  stats=None, overrides=None, extra_skills=(), bonus=None):
    """A Pokemon (owned.py's object, no trainer) for a wild / DM-controlled Pokemon, built from its species exactly
    like a player's registered one (owned.from_species + owned.apply_registration_stats) -- but not stored. The DM
    console turns it into a battle participant with the same builder the players' own Pokemon go through
    (combat.js's buildPokemonCombatant).

    The DM's own changes: `stats` ({'str': 14, ...}) are final ability scores -- HP, VP, modifiers and initiative follow
    them -- `overrides` ({'ac', 'maxHP', 'maxVP'}) are set last, as typed, and `extra_skills` are proficiencies it has on
    top of its species' own. `bonus` (Encounter setup: {'str': 2, 'ac': 1, 'maxHP': 5, ...}) is added to what the
    numbers come out as -- ability-score bonuses before HP/VP and modifiers follow them, AC/HP/VP ones at the end."""
    pokemon = owned.from_species(conn, species, level=level, nature=nature, ability_slots=ability_slots,
                                 nickname=nickname, held_item=held_item, shiny=shiny)
    owned.add_skills(pokemon, extra_skills)
    bonus = {k: js_parse_int(v) for k, v in (bonus or {}).items() if js_parse_int(v)}
    owned.apply_registration_stats(conn, pokemon, {k: v for k, v in (stats or {}).items() if k in owned.STAT_KEYS},
                                   {k: v for k, v in bonus.items() if k in owned.STAT_KEYS})
    combat, current = pokemon['combat'], pokemon['current']
    o = overrides or {}
    if js_parse_int(o.get('ac')) is not None:
        combat['ac'] = js_parse_int(o['ac'])
    if js_parse_int(o.get('maxHP')) is not None:
        combat['maxHP'] = current['hp'] = js_parse_int(o['maxHP'])
    if js_parse_int(o.get('maxVP')) is not None:
        combat['maxVP'] = current['vp'] = js_parse_int(o['maxVP'])
    if bonus.get('ac'):
        combat['ac'] = (js_parse_int(combat.get('ac')) or 0) + bonus['ac']
    if bonus.get('maxHP'):
        combat['maxHP'] = current['hp'] = max(1, (js_parse_int(combat.get('maxHP')) or 0) + bonus['maxHP'])
    if bonus.get('maxVP'):
        combat['maxVP'] = current['vp'] = max(0, (js_parse_int(combat.get('maxVP')) or 0) + bonus['maxVP'])
    return owned.with_image(pokemon)
