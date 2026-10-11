"""route=dm -- reads and derivations for the DM console (dm-console.html), the landscape page the DM runs the game
from. Nothing here writes to the database: the DM's battle actions go through route=combat like everyone else's.

Unlike the player-facing pokemon/list, the species list here is EVERY species in the encyclopedia, not just the ones
the shared pokedex has unlocked for players -- the DM sets up encounters with Pokemon the players haven't met yet."""
from . import upstream
from .calculations import sanitize_moves, sanitize_string
from .jsutil import js_parse_int
from .routes_gamedata import calculate_type_effectiveness
from .routes_pokemon import apply_registration_stats

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
            shiny=str(params.get('shiny', '')).lower() in ('1', 'true'))}

    raise ValueError('Unknown dm action: ' + str(action))


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


def build_pokemon(conn, species, level=None, nature='', ability_slots=('0',), nickname='', held_item='', shiny=False):
    """A full Pokemon row (db.POKEMON_COLUMNS order, the same 62-column shape a player's Pokemon has) for a wild /
    DM-controlled Pokemon, built from its encyclopedia entry the way pokemon-form.js builds one before registering,
    then run through the exact same stat maths -- but never stored. The DM console turns it into a battle
    participant with the same builder the players' own Pokemon go through (combat.js's buildPokemonCombatant)."""
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
    apply_registration_stats(conn, data)
    return data
