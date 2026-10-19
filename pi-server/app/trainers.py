"""The players' trainers, one JSON object each (table `trainers`: id, name, json, dm_xp). The user's call, 2026-10-19:
until then each was a 52-cell row (db.LEGACY_TRAINER_COLUMNS), read by position everywhere; now the app and the server
read a trainer by name, the same way as the Pokemon (owned.py).

    {
      "name": "Joey", "pinCode": "9999", "trainerClass": "Pokemon Trainer", "region": "Johto", "level": 8,
      "image": "",                      # a picture the trainer has stored (the Pi's own address) -- sent as the picture
                                        # the app shows (media.trainer_image_url: the self-made portrait first)
      "stats":     {"strength": 14, "dexterity": 12, "constitution": 10, "intelligence": 17, "wisdom": 9, "charisma": 8},
      "modifiers": {"strength": 2, ...},
      "combat":  {"hitDie": 8, "vitalityDie": 8, "maxHP": 48, "maxVP": 76, "ac": 12, "initiative": 1,
                  "proficiency": 3, "walkingSpeed": 30},
      "current": {"hp": 48, "vp": 76, "ac": null, "hitDice": 8, "vitalityDice": 8},   # null: not set (= the max / combat.ac)
      "savingThrows": ["Strength"], "skills": ["Athletics", "Insight"],
      "expertise": ["Insight"],                                                       # skills with expertise (each in skills too)
      "feats": ["Skilled", "Linguist"], "languages": ["Elvish"],                      # languages: Linguist's three
      "money": 783, "leaguePoints": 28,
      "inventory":   [{"name": "Poke Ball", "quantity": 2}],                          # items of the item list
      "customItems": [{"name": "Old map", "description": "...", "quantity": 1}],     # the trainer's own
      "gear": ["Running Shoes"],
      "affinities": ["PSYCHIC"], "specializations": ["Alchemist"], "trainerPath": "Type Master",
      "pokeslots": 4,
      "charges": {"secondWind": 3, "rapidOrders": 0, "unbreakableBond": 0, "elementalSynergy": 0, "masterTrainer": 0},
      "battleDice":   {"max": 2, "current": 2} | null,    # Ace Trainer
      "maxPotential": "" | "STR" | "DEX" | "CON" | "Speed",  # Ace Trainer
      "tacticianPoints": 4 | null,                          # Tactician
      "surgeCommand": {"max": 1, "current": 1} | null,      # Commander, level 9
      "rallyCry":     {"max": 3, "current": 3} | null       # Commander, level 15
    }

XP is not in the object: only the DM sees it (the dm_xp column, routes_dm.change_xp).
"""
import json
import re

from .battle_lists import split_expertise
from .jsutil import js_number, js_parse_int, floor_div2

STATS = ('strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma')
CHARGES = ('secondWind', 'rapidOrders', 'unbreakableBond', 'elementalSynergy', 'masterTrainer')


# ---------------------------------------------------------------------------
# The table
# ---------------------------------------------------------------------------

def _load(text):
    try:
        t = json.loads(text) if text else None
    except ValueError:
        return None
    return t if isinstance(t, dict) else None


def all_trainers(conn):
    """[(id, trainer)] in the order they were made."""
    out = []
    for tid, text in conn.execute('SELECT id, json FROM trainers ORDER BY id').fetchall():
        t = _load(text)
        if t:
            out.append((tid, t))
    return out


def find(conn, name):
    """(id, trainer) for the trainer of that name (any case), or (None, None)."""
    for tid, text in conn.execute('SELECT id, json FROM trainers WHERE lower(name) = ? ORDER BY id',
                                  (str(name or '').strip().lower(),)).fetchall():
        t = _load(text)
        if t:
            return tid, t
    return None, None


def insert(conn, trainer):
    cur = conn.execute('INSERT INTO trainers (name, json) VALUES (?, ?)',
                       (trainer['name'], json.dumps(trainer, ensure_ascii=False)))
    conn.commit()
    return cur.lastrowid


def save(conn, tid, trainer):
    conn.execute('UPDATE trainers SET name = ?, json = ? WHERE id = ?',
                 (trainer['name'], json.dumps(trainer, ensure_ascii=False), tid))
    conn.commit()


def with_image(trainer):
    """The trainer with the picture the app shows in `image` (media.trainer_image_url)."""
    from . import media
    return {**trainer, 'image': media.trainer_image_url(trainer.get('name'), trainer.get('image'))}


# ---------------------------------------------------------------------------
# A new trainer (new-journey.js)
# ---------------------------------------------------------------------------

def proficiency_for(level):
    level = js_number(level) or 1
    return 2 if level <= 4 else 3 if level <= 8 else 4 if level <= 12 else 5 if level <= 16 else 6


def pokeslots_for(trainer_class, level):
    """How many Pokemon the trainer can have in their party."""
    level = js_number(level) or 0
    if trainer_class == 'Pokemon Trainer':
        return 3 if 1 <= level <= 4 else 4 if 5 <= level <= 9 else 5 if 10 <= level <= 15 else 6 if 16 <= level <= 20 else 3
    return 0 if 1 <= level <= 4 else 1 if 5 <= level <= 15 else 2 if 16 <= level <= 20 else 0


def create(form):
    """The trainer the new-journey form describes (its fields as text: name, pinCode, level, hitDice, vitalityDice, the
    six ability scores, walkingSpeed, savingThrows, skills [list], money, inventory [JSON list of {name, quantity}],
    leaguePoints, nationality, trainerClass), with its HP / VP, AC, initiative, proficiency and party size worked
    out."""
    from .calculations import calculate_hp_vp
    stats = {k: js_number(form.get(k)) for k in STATS}
    level = js_number(form.get('level'))
    modifiers = {k: floor_div2(v) for k, v in stats.items()}
    hit_die, vitality_die = js_parse_int(form.get('hitDice')), js_parse_int(form.get('vitalityDice'))
    hp, vp = calculate_hp_vp(*(stats[k] for k in STATS), level, hit_die, vitality_die, 0)
    inventory = [{'name': str(i.get('name')), 'quantity': js_parse_int(i.get('quantity')) or 1}
                 for i in json.loads(form.get('inventory') or '[]') if i.get('name')]
    return {
        'name': str(form.get('name') or '').strip(), 'pinCode': str(form.get('pinCode') or ''),
        'trainerClass': form.get('trainerClass') or '', 'region': form.get('nationality') or '', 'level': level,
        'image': '',
        'stats': stats, 'modifiers': modifiers,
        'combat': {'hitDie': hit_die, 'vitalityDie': vitality_die, 'maxHP': hp, 'maxVP': vp,
                   'ac': 10 + modifiers['dexterity'], 'initiative': modifiers['dexterity'],
                   'proficiency': proficiency_for(level), 'walkingSpeed': js_parse_int(form.get('walkingSpeed')) or 30},
        'current': {'hp': None, 'vp': None, 'ac': None, 'hitDice': None, 'vitalityDice': None},
        'savingThrows': _split(form.get('savingThrows')),
        'skills': [str(s) for s in form.get('skills') or [] if str(s).strip()] if isinstance(form.get('skills'), list)
        else _split(form.get('skills')),
        'expertise': [],
        'feats': [], 'languages': [],
        'money': js_parse_int(form.get('money')) or 0, 'leaguePoints': js_parse_int(form.get('leaguePoints')) or 0,
        'inventory': inventory, 'customItems': [], 'gear': [],
        'affinities': [], 'specializations': [], 'trainerPath': '',
        'pokeslots': pokeslots_for(form.get('trainerClass'), level),
        'charges': {k: 0 for k in CHARGES},
        'battleDice': None, 'maxPotential': '', 'tacticianPoints': None, 'surgeCommand': None, 'rallyCry': None,
    }


# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------

def add_item(trainer, name, quantity, custom=False, description=''):
    """Adds `quantity` of an item (a negative one takes some away; at 0 it's gone) -- to `customItems` for one of the
    trainer's own, else `inventory`."""
    key = 'customItems' if custom else 'inventory'
    items = trainer.setdefault(key, [])
    name = str(name or '').strip()
    entry = next((i for i in items if str(i.get('name', '')).lower() == name.lower()), None)
    if entry:
        entry['quantity'] = (js_parse_int(entry.get('quantity')) or 0) + quantity
        if custom and description:
            entry['description'] = description
    elif quantity > 0:
        items.append({'name': name, 'description': description or '', 'quantity': quantity} if custom
                     else {'name': name, 'quantity': quantity})
    trainer[key] = [i for i in items if (js_parse_int(i.get('quantity')) or 0) > 0]


# ---------------------------------------------------------------------------
# The old rows (the move over, once -- migrations.py)
# ---------------------------------------------------------------------------

def _split(text):
    text = str(text if text is not None else '').strip()
    if not text or text.lower() == 'none':
        return []
    return [p.strip() for p in text.split(',') if p.strip() and p.strip().lower() != 'none']


def _num(v):
    n = js_number(v)
    if n != n or v in ('', None):  # NaN / empty
        return None
    return int(n) if float(n).is_integer() else n


def _pair(text):
    """"2 - 1" -> {max: 2, current: 1}; '' -> None."""
    m = re.match(r'^\s*(-?\d+)\s*-\s*(-?\d+)\s*$', str(text or ''))
    return {'max': int(m.group(1)), 'current': int(m.group(2))} if m else None


def parse_inventory(text):
    """The old inventory cell -> (inventory, customItems). Regular items are "Potion (x2), Antidote (x1)" -- each entry
    runs up to its own "(xN)", since some names have a comma in them ("Tent, small (x1)") -- and whatever is left after
    the last "(xN)" is entries without a count (1 each); custom ones are JSON after a ##CUSTOM## marker."""
    text = str(text or '')
    regular_text, _, custom_text = text.partition('##CUSTOM##')
    regular, end = [], 0
    for m in re.finditer(r'(.*?)\(x(\d+)\)\s*,?', regular_text):
        name = m.group(1).strip().strip(',').strip()
        if name:
            regular.append({'name': name, 'quantity': int(m.group(2))})
        end = m.end()
    for part in regular_text[end:].split(','):
        part = part.strip()
        if part and part.lower() != 'none':
            regular.append({'name': part, 'quantity': 1})
    try:
        custom = json.loads(custom_text) if custom_text else []
    except ValueError:
        custom = []
    custom = [{'name': str(c.get('name') or ''), 'description': str(c.get('description') or ''),
               'quantity': js_parse_int(c.get('quantity')) or 1}
              for c in (custom if isinstance(custom, list) else []) if isinstance(c, dict) and c.get('name')]
    return regular, custom


def from_row(r, image=''):
    """One of the old 52-cell rows (LEGACY_TRAINER_COLUMNS order) as a trainer object. `image`: the stored picture,
    already made one of the Pi's own addresses (migrations.py). The modifiers are worked out again from the ability
    scores -- some old rows had text or nothing in them."""
    r = list(r) + [''] * (52 - len(r))
    stats = {k: _num(r[5 + i]) or 10 for i, k in enumerate(STATS)}
    feats, languages = [], []
    for entry in _split(r[33]):
        name, _, data = entry.partition(':')
        feats.append(name.strip())
        if name.strip() == 'Linguist' and data:
            languages = [l.strip() for l in data.split('|') if l.strip()]
    inventory, custom = parse_inventory(r[20])
    current_ac = _num(r[36])
    return {
        'name': str(r[1]).strip(), 'pinCode': str(r[22] if r[22] is not None else '').strip(),
        'trainerClass': str(r[39] or ''), 'region': str(r[38] or ''), 'level': _num(r[2]) or 1,
        'image': image or '',
        'stats': stats, 'modifiers': {k: floor_div2(v) for k, v in stats.items()},
        'combat': {'hitDie': _num(r[3]), 'vitalityDie': _num(r[4]), 'maxHP': _num(r[11]), 'maxVP': _num(r[12]),
                   'ac': _num(r[13]), 'initiative': _num(r[16]), 'proficiency': _num(r[17]),
                   'walkingSpeed': js_parse_int(r[14]) or 30},
        'current': {'hp': _num(r[34]), 'vp': _num(r[35]), 'ac': current_ac, 'hitDice': _num(r[47]),
                    'vitalityDice': _num(r[48])},
        'savingThrows': _split(r[15]), **dict(zip(('skills', 'expertise'), split_expertise(_split(r[18])))),
        'feats': feats, 'languages': languages,
        'money': js_parse_int(r[19]) or 0, 'leaguePoints': js_parse_int(r[21]) or 0,
        'inventory': inventory, 'customItems': custom, 'gear': _split(r[37]),
        'affinities': _split(r[23]), 'specializations': _split(r[24]), 'trainerPath': str(r[25] or '').strip(),
        'pokeslots': _num(r[26]) or 0,
        'charges': {k: _num(r[40 + i]) or 0 for i, k in enumerate(CHARGES)},
        'battleDice': _pair(r[45]), 'maxPotential': str(r[46] or '').strip(),
        'tacticianPoints': _num(r[49]), 'surgeCommand': _pair(r[50]), 'rallyCry': _pair(r[51]),
    }
