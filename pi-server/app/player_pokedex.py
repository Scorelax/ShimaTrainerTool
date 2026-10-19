"""route=game-data&action=player-pokedex -- the players' Pokedex (pokedex.html): every species in the shared pokedex
(pokedexConfig's `registered`) with only what the DM lets the players see of it (its `visibility` switches, or the
`defaults`), plus the moves the players may look up.

Benjakronk's old Pokedex site downloaded the whole encyclopedia and hid fields in the browser, so anyone could read
what they hadn't discovered yet. Here the hiding happens on the Pi: a field that's switched off never leaves it. The
switches mean what they meant on his site (its script.js getVisibility / createPokemonCard / getSearchableMoves), so
the DM console's Pokedex module (js/dm/pokedex.js) edits exactly what shows up here."""
from . import gamedata, media, species as species_data
from .calculations import fix_mojibake, sanitize_string
from .jsutil import js_parse_int

# What a switch is when neither the species' own settings nor the defaults name it (his site's DEFAULT_VISIBILITY).
_BASE_VISIBILITY = {
    'primaryType': True, 'secondaryType': True, 'description': True,
    'charSize': True, 'charRarity': True, 'charBehavior': True, 'charHabitat': True, 'charActivity': True,
    'statAC': False, 'statHD': False, 'statVD': False, 'statSpeed': False,
    'statSTR': False, 'statDEX': False, 'statCON': False, 'statINT': False, 'statWIS': False, 'statCHA': False,
    'statSaves': False, 'statSkills': False,
    'primaryAbility': False, 'secondaryAbility': False, 'hiddenAbility': False,
    'senseSight': False, 'senseHearing': False, 'senseSmell': False, 'senseTremorsense': False,
    'senseEcholocation': False, 'senseTelepathy': False, 'senseBlindsight': False, 'senseDarkvision': False,
    'senseTruesight': False,
    'evoFrom': False, 'evoTo': False, 'evoToTargets': {},
    # What each evolution takes ('Level 7 Near ports'), per target like evoToTargets -- shown only with its target (the
    # user's call, 2026-10-19: what the players have learned about how a Pokemon evolves)
    'evoReq': False, 'evoReqTargets': {},
    'moves': False, 'movesMaxLevel': 1, 'extraVisibleMoves': [],
}
# Older config files used one switch per group; his migrateVisibility spread each over its fields.
_LEGACY_GROUPS = {
    'types': ('primaryType', 'secondaryType'),
    'characteristics': ('charSize', 'charRarity', 'charBehavior', 'charHabitat', 'charActivity'),
    'stats': ('statAC', 'statHD', 'statVD', 'statSpeed', 'statSTR', 'statDEX', 'statCON', 'statINT', 'statWIS',
              'statCHA', 'statSaves', 'statSkills'),
    'senses': ('senseSight', 'senseHearing', 'senseSmell', 'senseTremorsense', 'senseEcholocation', 'senseTelepathy',
               'senseBlindsight', 'senseDarkvision', 'senseTruesight'),
    'evolution': ('evoFrom', 'evoTo'),
}

# Each switch, its label and where the species object keeps it (species.py).
_CHARACTERISTICS = (('charSize', 'Size', 'size'), ('charRarity', 'Rarity', 'rarity'), ('charBehavior', 'Behavior', 'behavior'),
                    ('charHabitat', 'Habitat', 'habitat'), ('charActivity', 'Activity', 'active'))
_COMBAT = (('statAC', 'AC', 'ac'), ('statHD', 'Hit Dice', 'hitDie'), ('statVD', 'Vitality', 'vitalityDie'), ('statSpeed', 'Speed', None))
_SCORES = (('statSTR', 'STR', 'strength'), ('statDEX', 'DEX', 'dexterity'), ('statCON', 'CON', 'constitution'),
           ('statINT', 'INT', 'intelligence'), ('statWIS', 'WIS', 'wisdom'), ('statCHA', 'CHA', 'charisma'))
_ABILITIES = (('primaryAbility', 0, False), ('secondaryAbility', 1, False), ('hiddenAbility', 2, True))
_SENSES = (('senseSight', 'Sight', 'sight'), ('senseHearing', 'Hearing', 'hearing'), ('senseSmell', 'Smell', 'smell'),
           ('senseTremorsense', 'Tremorsense', 'tremorsense'), ('senseEcholocation', 'Echolocation', 'echolocation'),
           ('senseTelepathy', 'Telepathy', 'telepathy'), ('senseBlindsight', 'Blindsight', 'blindsight'),
           ('senseDarkvision', 'Darkvision', 'darkvision'), ('senseTruesight', 'Truesight', 'truesight'))


def _text(value):
    """What the page shows for a value: text as it is, a number as text, nothing as ''."""
    return '' if value is None else sanitize_string(fix_mojibake(str(value)))

def _visibility(vis):
    """One species' switches with every key filled in -- his migrateVisibility."""
    vis = vis if isinstance(vis, dict) else {}
    out = {**_BASE_VISIBILITY, **vis}
    for old, keys in _LEGACY_GROUPS.items():
        if old in vis:
            for k in keys:
                if k not in vis:
                    out[k] = vis[old]
    for key in ('evoToTargets', 'evoReqTargets'):
        if not isinstance(out.get(key), dict):
            out[key] = {}
    if not isinstance(out.get('extraVisibleMoves'), list):
        out['extraVisibleMoves'] = []
    return out


def _shown_sense(value):
    v = str(value or '').strip()
    return bool(v) and v not in ('0', '-') and v.lower() != 'no'


def _die(value):
    v = str(value or '').strip()
    return f'd{v}' if v.isdigit() else v


def _species_entry(conn, sp, vis, own):
    """One registered species, cut down to what `vis` lets through. `own`: it has settings of its own (the evolution
    targets are then its own switches; without, the defaults' single "Evolves into" switch stands for all of them,
    as the DM console shows it)."""
    name, dex = sp['name'], sp.get('dexNumber')
    primary, secondary = _text(sp['types'].get('primary')), _text(sp['types'].get('secondary'))
    combat = sp.get('combat') or {}
    entry = {
        'name': name, 'dex': dex,
        'image': media.local_pokemon_image_url(name, dex) or media.local_sprite_url(name) or '',
        # Whether there IS a second type shows (as a split header colour) even while it's hidden -- as on his site.
        'dualType': bool(secondary),
        'primaryType': primary if vis['primaryType'] else None,
        'secondaryType': secondary if vis['secondaryType'] and secondary else None,
    }
    if vis['description']:
        entry['classification'] = _text(sp.get('classification'))
        entry['flavor'] = _text(sp.get('description'))
    entry['info'] = [{'key': key, 'label': label, 'value': _text(sp.get(field))}
                     for key, label, field in _CHARACTERISTICS if vis[key] and _text(sp.get(field))]
    entry['combat'] = [{'label': label, 'value': species_data.speed_text(sp) if field is None
                        else _die(_text(combat.get(field))) if key in ('statHD', 'statVD') else _text(combat.get(field))}
                       for key, label, field in _COMBAT if vis[key]]
    base = sp.get('baseStats') or {}
    entry['scores'] = [{'label': label, 'value': _text(base.get(field))} for key, label, field in _SCORES if vis[key]]
    entry['saves'] = species_data.list_text(sp.get('savingThrows')) if vis['statSaves'] else ''
    entry['skills'] = species_data.list_text(sp.get('skills')) if vis['statSkills'] else ''
    by_slot = {a['slot']: a for a in species_data.abilities(sp)}
    entry['abilities'] = [
        {'name': by_slot[slot]['name'], 'description': by_slot[slot]['description'], 'hidden': hidden}
        for key, slot, hidden in _ABILITIES if vis[key] and slot in by_slot]
    senses = sp.get('senses') or {}
    entry['senses'] = [{'label': label, 'value': _text(senses.get(field))}
                       for key, label, field in _SENSES if vis[key] and _shown_sense(senses.get(field))]

    parents = sp.get('evolvesFrom') or []
    evolves_from = {'fusion': len(parents) > 1, 'name': ' + '.join(parents)} if parents else None
    evolves_to = species_data.evolves_into_names(sp)
    targets = vis['evoToTargets'] if own else {t: bool(vis['evoTo']) for t in evolves_to}
    requirements = vis['evoReqTargets'] if own else {t: bool(vis['evoReq']) for t in evolves_to}
    need = {e['species']: species_data.requirement_lines(e) for e in sp.get('evolvesInto') or []}
    entry['evolution'] = {
        'from': evolves_from if vis['evoFrom'] else None,
        # [{name, requirements}] -- what it takes, one line per criterion; [] unless the DM shows it
        'to': [{'name': t, 'requirements': [_text(line) for line in need.get(t) or []] if requirements.get(t) else []}
               for t in evolves_to if targets.get(t)],
    }

    # Moves: everything learned up to movesMaxLevel, plus the extra ones the DM ticked; per level, how many stay hidden.
    entry['movesShown'] = bool(vis['moves'])
    entry['moves'], entry['hiddenMoves'] = [], {}
    if vis['moves']:
        max_level = js_parse_int(vis.get('movesMaxLevel')) or 1
        extra = {str(m).lower() for m in vis['extraVisibleMoves']}
        entry['movesMaxLevel'] = max_level
        for level in species_data.MOVE_LEVELS:
            names = species_data.moves_at(sp, level)
            shown = [m for m in names if level <= max_level or m.lower() in extra]
            entry['moves'] += [{'name': m, 'level': level, 'extra': level > max_level} for m in shown]
            if len(names) > len(shown):
                entry['hiddenMoves'][str(level)] = len(names) - len(shown)
    return entry

def _move_details(conn):
    """{lowercase name: move} from the move list, in the shape the page shows."""
    out = {}
    for m in gamedata.moves():
        out[str(m['name']).lower()] = {
            'name': m['name'], 'type': m['type'], 'power': m['moveStat'], 'time': m['action'], 'vp': m['vpCost'],
            'duration': m['duration'], 'range': m['range'], 'description': fix_mojibake(m['description']),
            'higher': fix_mojibake(str(m['scaling'] or '').strip()),
        }
    return out


def player_pokedex(conn):
    config = gamedata.pokedex_config(conn)
    registered = {str(n).lower() for n in config.get('registered') or []}
    own_settings = {str(k).lower(): v for k, v in (config.get('visibility') or {}).items()}
    defaults = config.get('defaults') or {}

    species = []
    for sp in species_data.all_species():  # in dex order
        if sp['name'].lower() not in registered:
            continue
        own = own_settings.get(sp['name'].lower())
        species.append(_species_entry(conn, sp, _visibility(own if own else defaults), bool(own)))
    # The DM console's "caught by the players" record: a Poke Ball next to the name.
    from .routes_dm import caught_species
    caught = set(caught_species(conn)['caught'])
    for s in species:
        s['caught'] = str(s['name']).lower() in caught

    # The moves the players may look up: every move a species shows, plus the ones the DM made searchable on their own.
    details = _move_details(conn)
    searchable = {m['name'].lower() for s in species for m in s['moves']}
    searchable |= {str(m).lower() for m in config.get('extraSearchableMoves') or []}
    moves = sorted((details[n] for n in searchable if n in details), key=lambda m: str(m['name']).lower())
    return {'species': species, 'moves': moves}


def searchable_move_overview(conn):
    """For the DM console's "Searchable moves" page: every move (name + type), and which of them the players can
    already look up because a species in their Pokedex shows it."""
    via_pokemon = sorted({m['name'] for s in player_pokedex(conn)['species'] for m in s['moves']})
    moves = [{'name': m['name'], 'type': m['type']} for m in _move_details(conn).values()]
    moves.sort(key=lambda m: str(m['name']).lower())
    return {'moves': moves, 'viaPokemon': via_pokemon}
