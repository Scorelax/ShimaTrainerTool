"""The players' own Pokemon -- one object each, the same shape the species have (species.py), plus what belongs to
this one Pokemon (its level, nature, current HP, moves it knows...). The user's call, 2026-10-18: until then each was
a 62-cell row in Benjakronk's sheet order (db.LEGACY_POKEMON_COLUMNS).

Stored in the owned_pokemon table, one JSON object per row (migrations.py moved the old rows over once, from_row). A
trainer's Pokemon is found by trainer + species name, as always -- a trainer has one of each species.

    {
      "trainer": "Joey", "name": "Bulbasaur", "dexNumber": 280, "nickname": "Bulby", "shiny": false,
      "level": 7, "nature": "Brave", "loyalty": 0, "heldItem": "",
      "types": {"primary": "Grass", "secondary": "Poison"},
      "abilities": [{"slot": 0, "name": "Overgrow", "description": "..."}],     # the ones it has (slot 2 = hidden)
      "combat": {"ac": 13, "hitDie": 6, "maxHP": 41, "vitalityDie": 6, "maxVP": 57,
                 "initiative": 1, "proficiency": 3, "stab": 4},
      "diceBonus": {"hitDie": 2},                                              # the DM's change to its dice, kept on evolving
      "current": {"hp": 41, "vp": 57, "ac": null, "hitDice": null, "vitalityDice": null},   # null: not used up / the max
      "stats": {"strength": 15, ..., "charisma": 10},                          # its ability scores now
      "modifiers": {"strength": 2, ..., "charisma": 0},
      "totalStats": 63,                                                        # its species' base stats added up
      "savingThrows": ["Strength"], "skills": ["Athletics", "Nature"],
      "expertise": ["Athletics"],                                              # skills with expertise (each in skills too)
      "moves": {"1": [...], "2": [...], "6": [...], "10": [...], "14": [...], "18": [...]},   # learned at each level
      "customMoves": ["Flamethrower"], "moveCharges": {"Flamethrower": {"chargesLeft": 1, "type": "SR"}},
      "evolvesInto": [{"species": "Ivysaur", "requirement": "Level 7", "level": 7}], "evolvesFrom": [],
      "movement": {"walking": 30, "climbing": 0, ...},                         # feet; 0 = can't
      "senses": {"sight": "Average", ..., "echolocation": null},
      "feats": ["Alert"], "gear": "", "statusConditions": ["Poisoned"],
      "description": "...", "size": "Small", "typeMatchups": {"Normal": 1, "Fire": 0.5, ...},  # x damage taken from each type
      "partySlot": 1, "utilitySlot": false, "cry": "", "comments": ["Found in the cave"],
      "image": "..."                                                           # only on the way out (with_image)
    }
"""
import json
import math
import re

from . import species as species_data
from .battle_lists import split_expertise
from .calculations import calculate_hp_vp, proficiency_for_level, stab_for_level, parse_feat
from .jsutil import js_parse_int, floor_div2

STATS = species_data.STATS
STAT_KEYS = dict(zip(species_data.STAT_KEYS, STATS))  # 'str' -> 'strength'
MOVE_LEVELS = species_data.MOVE_LEVELS
MOVEMENT = species_data.MOVEMENT
SENSES = species_data.SENSES
_SAVES = ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma']


# ---------------------------------------------------------------------------
# Reading and writing them
# ---------------------------------------------------------------------------

def _load(text):
    try:
        obj = json.loads(text)
    except (TypeError, ValueError):
        return None
    return obj if isinstance(obj, dict) else None


def all_owned(conn, trainer=None):
    """[(id, pokemon)] -- everyone's, or one trainer's (any capitalisation), in the order they were caught."""
    sql, args = 'SELECT id, json FROM owned_pokemon', ()
    if trainer is not None:
        sql, args = sql + ' WHERE lower(trainer) = ?', (str(trainer).lower(),)
    rows = [(i, _load(j)) for i, j in conn.execute(sql + ' ORDER BY id', args)]
    return [(i, p) for i, p in rows if p is not None]


def find(conn, trainer, name):
    """(id, pokemon) of `trainer`'s `name` (species), or (None, None)."""
    row = conn.execute('SELECT id, json FROM owned_pokemon WHERE lower(trainer) = ? AND lower(name) = ?',
                       (str(trainer or '').lower(), str(name or '').lower())).fetchone()
    return (row[0], _load(row[1])) if row else (None, None)


def insert(conn, pokemon):
    pokemon = _stored(pokemon)
    cur = conn.execute('INSERT INTO owned_pokemon (trainer, name, json) VALUES (?, ?, ?)',
                       (pokemon['trainer'], pokemon['name'], json.dumps(pokemon, ensure_ascii=False)))
    conn.commit()
    return cur.lastrowid


def save(conn, pid, pokemon):
    pokemon = _stored(pokemon)
    conn.execute('UPDATE owned_pokemon SET trainer = ?, name = ?, json = ? WHERE id = ?',
                 (pokemon['trainer'], pokemon['name'], json.dumps(pokemon, ensure_ascii=False), pid))
    conn.commit()


def delete(conn, pid):
    conn.execute('DELETE FROM owned_pokemon WHERE id = ?', (pid,))
    conn.commit()


def _stored(pokemon):
    """What's kept: everything but the picture (worked out from the species on every read, see with_image)."""
    out = {k: v for k, v in pokemon.items() if k != 'image'}
    out['trainer'] = str(out.get('trainer') or '')
    out['name'] = str(out.get('name') or '')
    return out


def with_image(pokemon, animated=True):
    """The Pokemon with the picture the app shows (media.pokemon_image_url: its animated sprite unless the player
    turned those off, else its original picture, else '' for a Poke Ball)."""
    from . import media
    return {**pokemon, 'image': media.pokemon_image_url(pokemon.get('name'), pokemon.get('dexNumber'),
                                                            shiny=bool(pokemon.get('shiny')), animated=animated)}


# ---------------------------------------------------------------------------
# The numbers that follow from the rest
# ---------------------------------------------------------------------------

def feat_names(pokemon):
    return [parse_feat(str(f))[0] for f in pokemon.get('feats') or []]


def recalculate(pokemon):
    """Max HP / VP, the modifiers, initiative, proficiency and STAB from its ability scores, level, dice, loyalty and
    feats (Tough, Tireless, Alert), in place."""
    st = pokemon.setdefault('stats', {})
    combat = pokemon.setdefault('combat', {})
    level = js_parse_int(pokemon.get('level')) or 1
    hd, vd = js_parse_int(combat.get('hitDie')) or 0, js_parse_int(combat.get('vitalityDie')) or 0
    hp, vp = calculate_hp_vp(*[js_parse_int(st.get(k)) or 0 for k in STATS], level, hd, vd, pokemon.get('loyalty') or 0)
    feats = feat_names(pokemon)
    if 'Tough' in feats:
        hp += level * 2
    if 'Tireless' in feats:
        vp += math.ceil(level / 2) * vd
    pokemon['modifiers'] = {k: floor_div2(js_parse_int(st.get(k)) or 0) for k in STATS}
    combat['maxHP'], combat['maxVP'] = hp, vp
    combat['initiative'] = pokemon['modifiers']['dexterity'] + (5 if 'Alert' in feats else 0)
    combat['proficiency'] = proficiency_for_level(level)
    combat['stab'] = stab_for_level(level)
    return pokemon


def apply_dice_bonus(pokemon, bonus):
    """The DM's change to its hit / vitality die (routes_dm.set_pokemon_dice: how far from its species' die, +2 for a
    d6 made a d8) put on its new species' die -- an evolution keeps it (the user's call, 2026-10-20). Dice stay d4-d20."""
    bonus = {k: js_parse_int(v) for k, v in (bonus or {}).items() if k in ('hitDie', 'vitalityDie') and js_parse_int(v)}
    if not bonus:
        return pokemon
    combat = pokemon.setdefault('combat', {})
    for k, v in bonus.items():
        die = js_parse_int(combat.get(k))
        if die:
            combat[k] = max(4, min(20, die + v))
    pokemon['diceBonus'] = bonus
    return pokemon


def _nature(conn, name):
    from . import gamedata
    return gamedata.nature(name)


def apply_registration_stats(conn, pokemon, stat_overrides=None, stat_bonus=None):
    """A freshly built Pokemon's numbers: its nature's boost / nerf on its ability scores, then the DM console's own
    ability scores (`stat_overrides`, {'str': 14}) or bonuses (`stat_bonus`, {'str': 2}) if any, then everything that
    follows from them (recalculate) -- and it starts at full HP / VP. Shared by registering a Pokemon, the DM giving
    one and the DM console's build-pokemon, so an enemy built there has exactly the numbers a player's would."""
    st = pokemon['stats'] = {k: js_parse_int((pokemon.get('stats') or {}).get(k)) for k in STATS}
    nature = _nature(conn, pokemon.get('nature')) if pokemon.get('nature') else None
    if nature:
        boost, nerf = str(nature['boostStat'] or '').lower(), str(nature['nerfStat'] or '').lower()
        if boost in st and st[boost] is not None:
            st[boost] += js_parse_int(nature['boostAmount']) or 0
        if nerf in st and st[nerf] is not None:
            st[nerf] -= js_parse_int(nature['nerfAmount']) or 0
    for k, v in (stat_overrides or {}).items():
        if k in STAT_KEYS and js_parse_int(v) is not None:
            st[STAT_KEYS[k]] = js_parse_int(v)
    for k, v in (stat_bonus or {}).items():
        if k in STAT_KEYS and js_parse_int(v) and st[STAT_KEYS[k]] is not None:
            st[STAT_KEYS[k]] += js_parse_int(v)
    recalculate(pokemon)
    pokemon['current'] = {'hp': pokemon['combat']['maxHP'], 'vp': pokemon['combat']['maxVP'], 'ac': None,
                          'hitDice': None, 'vitalityDice': None}
    return pokemon


# ---------------------------------------------------------------------------
# Making one
# ---------------------------------------------------------------------------

def _type_matchups(conn, types):
    from . import gamedata
    return gamedata.type_matchups(types.get('primary') or '', types.get('secondary') or None)


def from_species(conn, species, *, trainer='', level=None, nature='', ability_slots=(0,), nickname='', held_item='',
                 shiny=False, loyalty=0):
    """A new Pokemon of `species` with what it starts with (its species' numbers, moves, senses...), before
    apply_registration_stats -- the one builder behind registering, the DM giving one and build-pokemon."""
    sp = species_data.require(species)
    level = max(1, min(20, js_parse_int(level) or (sp.get('encounter') or {}).get('minimumLevel') or 1))
    slots = {js_parse_int(s) for s in ability_slots}
    types = {'primary': sp['types'].get('primary') or '', 'secondary': sp['types'].get('secondary') or None}
    combat = sp.get('combat') or {}
    return {
        'trainer': trainer or '', 'name': sp['name'], 'dexNumber': sp.get('dexNumber'), 'nickname': nickname or '',
        'shiny': bool(shiny), 'level': level, 'nature': nature or '', 'loyalty': js_parse_int(loyalty) or 0,
        'heldItem': held_item or '',
        'types': types,
        'abilities': [a for a in species_data.abilities(sp) if a['slot'] in slots],
        'combat': {'ac': combat.get('ac'), 'hitDie': combat.get('hitDie'), 'maxHP': None,
                   'vitalityDie': combat.get('vitalityDie'), 'maxVP': None},
        'current': {'hp': None, 'vp': None, 'ac': None, 'hitDice': None, 'vitalityDice': None},
        'stats': dict(sp.get('baseStats') or {}),
        'totalStats': species_data.stat_total(sp),
        'savingThrows': list(sp.get('savingThrows') or []),
        'skills': list(sp.get('skills') or []), 'expertise': [],
        'moves': {str(lvl): species_data.moves_at(sp, lvl) for lvl in MOVE_LEVELS},
        'customMoves': [], 'moveCharges': {},
        'evolvesInto': [dict(e) for e in sp.get('evolvesInto') or []],
        'evolvesFrom': list(sp.get('evolvesFrom') or []),
        'movement': {k: (sp.get('movement') or {}).get(k) for k in MOVEMENT},
        'senses': {k: (sp.get('senses') or {}).get(k) for k in SENSES},
        'feats': [], 'gear': '', 'statusConditions': [],
        'description': sp.get('description') or '', 'size': sp.get('size') or '',
        'typeMatchups': _type_matchups(conn, types),
        'partySlot': None, 'utilitySlot': False, 'cry': '', 'comments': [],
    }


def add_skills(pokemon, extra):
    have = {s.lower() for s in pokemon.get('skills') or []}
    for s in extra or ():
        s = str(s).strip()
        if s and s.lower() not in have:
            pokemon['skills'].append(s)
            have.add(s.lower())


def evolve(conn, current, target, points, hidden_ability_shown):
    """`current` evolved into the species `target`: the target's species numbers, moves, senses, types... with the
    ability scores it had plus the `points` the player spent ({'str': 1, ...}), its skills plus the target's (and its expertise), the same
    ability slots (the hidden one only if the players' Pokedex shows the target's -- `hidden_ability_shown`), and
    what's its own carried over (level, nature, loyalty, nickname, item, feats, party / utility slot, current HP / VP,
    custom moves...). Move charges and status conditions start over."""
    new = from_species(conn, target, trainer=current.get('trainer'), level=current.get('level'),
                       nature=current.get('nature'), loyalty=current.get('loyalty'), nickname=current.get('nickname'),
                       held_item=current.get('heldItem'), shiny=current.get('shiny'),
                       ability_slots=[a['slot'] for a in current.get('abilities') or []
                                      if a.get('slot') != 2 or hidden_ability_shown])
    if not new['abilities']:
        new['abilities'] = [a for a in species_data.abilities(species_data.require(target)) if a['slot'] == 0]
    new['stats'] = {k: (js_parse_int((current.get('stats') or {}).get(k)) or 0)
                    + (js_parse_int((points or {}).get(short)) or 0) for short, k in STAT_KEYS.items()}
    species_skills, new['skills'] = new['skills'], list(current.get('skills') or [])
    add_skills(new, species_skills)
    new['expertise'] = list(current.get('expertise') or [])
    for k in ('customMoves', 'feats', 'gear', 'partySlot', 'utilitySlot', 'cry', 'comments'):
        new[k] = current.get(k, new[k])
    apply_dice_bonus(new, current.get('diceBonus'))
    recalculate(new)
    new['current'] = dict(current.get('current') or {})
    return new


# ---------------------------------------------------------------------------
# The old 62-cell rows
# ---------------------------------------------------------------------------

def _num(v):
    """'' / None -> None, '12' -> 12, 1.5 stays."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return int(v) if float(v).is_integer() else v
    n = js_parse_int(v)
    try:
        f = float(str(v).strip())
        return int(f) if f.is_integer() else f
    except ValueError:
        return n


def _split(v, sep=','):
    return [p.strip() for p in str(v or '').split(sep) if p.strip()]


_SPELLING = {'persuation': 'Persuasion', 'dexteriry': 'Dexterity', 'invesstigation': 'Investigation'}


def _canonical(text, known):
    """'Strength. constitution' -> ['Strength', 'Constitution']: each name in the game's spelling where it's one of
    `known` (a '+' for expertise kept; a '.' between two names read as a comma), duplicates dropped."""
    out, seen = [], set()
    for n in [p.strip() for p in re.split(r'[,.](?!\d)', str(text or '')) if p.strip()]:
        plus = n.endswith('+')
        base = n.rstrip('+').strip()
        base = _SPELLING.get(base.lower(), base)
        match = next((k for k in known if k.lower() == base.lower()), base[:1].upper() + base[1:])
        key = match.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(match + ('+' if plus else ''))
    return out


def parse_abilities(text, sp=None):
    """'0:Name;description|2:Name;description' -> [{slot, name, description}]. The oldest Pokemon have 'Name,
    description' or a bare 'Name' without the slot: the slot is then the one that ability has in its species `sp`."""
    by_name = {a['name'].lower(): a['slot'] for a in (species_data.abilities(sp) if sp else [])}
    out = []
    for i, entry in enumerate(_split(text, '|')):
        slot = None
        m = re.match(r'^\s*(\d)\s*:(.*)$', entry, re.S)
        if m:
            slot, entry = int(m.group(1)), m.group(2)
        if ';' in entry:
            name, _, desc = entry.partition(';')
        else:
            name, _, desc = entry.partition(',')
            if desc and not species_data.ability_description(name.strip()) and name.strip().lower() not in by_name:
                name, desc = entry, ''  # a comma in the name itself, not "Name, description"
        name = name.strip()
        if slot is None:
            slot = by_name.get(name.lower(), i)
        if name:  # the description as DnD_abilities.json has it now, where it knows the ability
            desc = species_data.ability_description(name) or re.sub(r'\s+', ' ', desc).strip()
            out.append({'slot': slot, 'name': name, 'description': desc})
    return out


def _feet(v):
    """'30ft' -> 30, '-' -> 0 (can't), '' -> None."""
    s = str(v or '').strip()
    if not s:
        return None
    if s in ('-', '0'):
        return 0
    return js_parse_int(re.sub(r'^\D+', '', s)) or 0


def parse_move_charges(text):
    """'Ice Beam(1)(SR),Flamethrower(0)(LR)' -> {'Ice Beam': {'chargesLeft': 1, 'type': 'SR'}, ...}."""
    out = {}
    for part in _split(text):
        m = re.match(r'^(.+?)\((\d+)\)\((\w+)\)$', part)
        if m:
            out[m.group(1)] = {'chargesLeft': int(m.group(2)), 'type': m.group(3)}
    return out


def _old_type_matchups(types, text):
    """The chart worked out again from the Pokemon's types -- or, when they aren't types, the old cell's numbers (in
    the chart's order) named after their types."""
    from . import gamedata
    return (gamedata.type_matchups(types.get('primary') or '', types.get('secondary') or None)
            or dict(zip(gamedata.type_names(), [_num(v) for v in _split(text)])))


def from_row(row):
    """One of the old 62-cell rows (db.LEGACY_POKEMON_COLUMNS order) as a Pokemon object -- the move over
    (migrations.py)."""
    r = list(row) + [''] * (62 - len(row))
    types = {'primary': str(r[5] or ''), 'secondary': str(r[6] or '') or None}
    sp = species_data.get(r[2])
    moves = {str(lvl): _split(r[23 + i]) for i, lvl in enumerate(MOVE_LEVELS)}
    movement = _split(r[13])
    senses = [s.strip() for s in str(r[49] or '').split(',')]
    party = js_parse_int(r[38])
    return {
        'trainer': str(r[0] or ''), 'name': str(r[2] or ''), 'dexNumber': _num(r[3]), 'nickname': str(r[36] or ''),
        'shiny': str(r[61]) == 'Y', 'level': _num(r[4]) or 1, 'nature': str(r[32] or ''), 'loyalty': _num(r[33]) or 0,
        'heldItem': str(r[35] or ''),
        'types': types,
        'abilities': parse_abilities(r[7], sp),
        'combat': {'ac': _num(r[8]), 'hitDie': _num(r[9]), 'maxHP': _num(r[10]), 'vitalityDie': _num(r[11]),
                   'maxVP': _num(r[12]), 'initiative': _num(r[30]), 'proficiency': _num(r[31]), 'stab': _num(r[34])},
        'current': {'hp': _num(r[45]), 'vp': _num(r[46]), 'ac': _num(r[47]), 'hitDice': _num(r[54]),
                    'vitalityDice': _num(r[55])},
        'stats': {k: _num(r[15 + i]) for i, k in enumerate(STATS)},
        'modifiers': {k: _num(r[39 + i]) for i, k in enumerate(STATS)},
        'totalStats': _num(r[14]),
        'savingThrows': _canonical(r[21], _SAVES),
        **dict(zip(('skills', 'expertise'), split_expertise(_canonical(r[22], _SKILLS)))),
        'moves': moves,
        'customMoves': _split(r[37]),
        'moveCharges': parse_move_charges(r[59]),
        'evolvesInto': [dict(e) for e in (sp or {}).get('evolvesInto') or []],
        'evolvesFrom': list((sp or {}).get('evolvesFrom') or []),
        'movement': {k: _feet(movement[i]) if i < len(movement) else None for i, k in enumerate(MOVEMENT)},
        'senses': {k: (senses[i] if i < len(senses) and senses[i] not in ('', '-') else None)
                   for i, k in enumerate(SENSES)},
        'feats': _split(r[50]),
        'gear': str(r[51] or ''),
        'statusConditions': _split(r[60]),
        'description': str(r[52] or ''),
        'size': str(r[57] or ''),
        'typeMatchups': _old_type_matchups(types, r[53]),
        'partySlot': party if party else None,
        'utilitySlot': str(r[56]).strip() == '1',
        'cry': str(r[58] or ''),
        'comments': _split(r[48], ';'),
    }


_SKILLS = ['Acrobatics', 'Animal Handling', 'Arcana', 'Athletics', 'Deception', 'History', 'Insight', 'Intimidation',
           'Investigation', 'Medicine', 'Nature', 'Perception', 'Performance', 'Persuasion', 'Religion',
           'Sleight of Hand', 'Stealth', 'Survival']


# ---------------------------------------------------------------------------
# Feats (edit-pokemon.js: pokemon/recalculate-stats)
# ---------------------------------------------------------------------------

# A feat that adds 1 to an ability score (up to 20) and, for some, proficiency in a skill
_STAT_FEATS = {
    'Acrobat': ('dexterity', 'Acrobatics'),
    'Actor': ('charisma', None),
    'Brawny': ('strength', 'Athletics'),
    'Durable': ('constitution', None),
    'Perceptive': ('wisdom', 'Perception'),
    'Quick-Fingered': ('dexterity', None),
    'Stealthy': ('dexterity', 'Stealth'),
}
# A feat that adds 1 to the ability score the player picks: "Athlete (DEX)"
_CHOICE_FEATS = {
    'Athlete': ('STR', 'DEX'),
    'Observant': ('INT', 'WIS'),
    'Resilient': ('STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'),
}


def apply_feat_changes(pokemon, old_feats, new_feats):
    """The Pokemon's feats went from `old_feats` to `new_feats` (lists): what each one removed gave is taken back and
    what each one added gives is added (ability scores, skills -- expertise in it when it was proficient already --,
    AC Up, Mobile's 10ft walking), then everything that follows is worked out again (recalculate, which
    also counts Tough, Tireless and Alert). In place; returns it."""
    old_feats = [str(f).strip() for f in old_feats or [] if str(f).strip()]
    new_feats = [str(f).strip() for f in new_feats or [] if str(f).strip()]
    st = pokemon.setdefault('stats', {})
    for k in STATS:
        st[k] = js_parse_int(st.get(k)) or 0
    combat = pokemon.setdefault('combat', {})
    movement = pokemon.setdefault('movement', {})
    pokemon['skills'], pokemon['expertise'] = split_expertise(pokemon.get('skills'), pokemon.get('expertise'))
    skills, expertise = pokemon['skills'], pokemon['expertise']

    def add_skill(name):
        if any(s.lower() == name.lower() for s in skills):
            if not any(s.lower() == name.lower() for s in expertise):
                expertise.append(name)
        else:
            skills.append(name)

    def remove_skill(name):
        if any(s.lower() == name.lower() for s in expertise):
            expertise[:] = [s for s in expertise if s.lower() != name.lower()]
        else:
            skills[:] = [s for s in skills if s.lower() != name.lower()]

    def apply(feat, direction):
        name, choice = parse_feat(feat)
        if name in _STAT_FEATS:
            stat, skill = _STAT_FEATS[name]
            if direction > 0 and st[stat] < 20:
                st[stat] += 1
            elif direction < 0 and st[stat] > 1:
                st[stat] -= 1
            if skill:
                (add_skill if direction > 0 else remove_skill)(skill)
        elif name in _CHOICE_FEATS:
            stat = STAT_KEYS.get(str(choice).lower()) if choice in _CHOICE_FEATS[name] else None
            if stat and direction > 0 and st[stat] < 20:
                st[stat] += 1
            elif stat and direction < 0 and st[stat] > 1:
                st[stat] -= 1
        elif name == 'AC Up':
            combat['ac'] = (js_parse_int(combat.get('ac')) or 0) + direction
        elif name == 'Mobile':
            movement['walking'] = max(0, (js_parse_int(movement.get('walking')) or 30) + 10 * direction)

    for feat in old_feats:
        if feat not in new_feats:
            apply(feat, -1)
    for feat in new_feats:
        if feat not in old_feats:
            apply(feat, +1)
    pokemon['feats'] = new_feats
    return recalculate(pokemon)
