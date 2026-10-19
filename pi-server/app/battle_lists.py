"""A battle participant's lists (the user's call, 2026-10-19: the battle keeps them as lists like the rest of the app, not
as text) -- the server's half of js/utils/battle-lists.js.

  abilities     [{slot, name, description}] -- the owned Pokemon's own shape (slot 2 = hidden, None for one the DM typed in)
  savingThrows  ["Dexterity", "Wisdom"]
  skills        ["Perception", "Stealth"]
  expertise     ["Stealth"]                  -- the skills it has expertise in (each one also in `skills`)
  feats         ["Alert"]

The same skills / expertise pair is on the trainers and the owned Pokemon (the user's call, 2026-10-19: expertise was a
"+" on the skill's name, "Stealth+", until then -- the edit pages lost it on every save).

These also read the text a participant had before ("0:Name;description|..." and "Strength, Dexterity", "Stealth+"): an
app that hasn't reloaded yet still sends it, and migrations.py turns what was stored into lists once.
"""
import re


def ability_entry(x):
    """One ability: an {slot, name, description} dict, or an old "0:Name;description" / "Name;description" / "Name"."""
    if isinstance(x, dict):
        slot = x.get('slot')
        try:
            slot = None if slot in (None, '') else int(slot)
        except (TypeError, ValueError):
            slot = None
        return {'slot': slot, 'name': str(x.get('name') or '').strip(),
                'description': str(x.get('description') or x.get('desc') or '').strip()}
    text = str(x or '').strip()
    m = re.match(r'^(\d+):(.*)$', text, re.S)
    name, _, description = (m.group(2) if m else text).partition(';')
    return {'slot': int(m.group(1)) if m else None, 'name': name.strip(), 'description': description.strip()}


def ability_list(x):
    """A participant's abilities as [{slot, name, description}] -- from the list, or from the old "...|..." text."""
    entries = x if isinstance(x, list) else str(x or '').split('|')
    return [a for a in (ability_entry(e) for e in entries) if a['name']]


def name_list(x):
    """Saving throws, skills, feats as a list of names -- from the list, or from the old comma-separated text."""
    entries = x if isinstance(x, list) else str(x or '').split(',')
    return [s for s in (str(e if e is not None else '').strip() for e in entries) if s and s.lower() != 'none']


def split_expertise(skills, expertise=()):
    """(skills, expertise) as plain names: an old "Stealth+" in `skills` is the skill plus expertise in it, and every
    expertise skill is in `skills` too. Duplicates (any case) dropped, order kept."""
    out, exp, seen, seen_exp = [], [], set(), set()
    for s in name_list(skills):
        plus = s.endswith('+')
        s = s.rstrip('+').strip()
        if s and s.lower() not in seen:
            seen.add(s.lower())
            out.append(s)
        if plus and s and s.lower() not in seen_exp:
            seen_exp.add(s.lower())
            exp.append(s)
    for s in name_list(expertise):
        s = s.rstrip('+').strip()
        if s.lower() not in seen:
            seen.add(s.lower())
            out.append(s)
        if s.lower() not in seen_exp:
            seen_exp.add(s.lower())
            exp.append(s)
    return out, exp


LIST_FIELDS = ('savingThrows', 'skills', 'feats')


def lists_of(data):
    """The list fields of an incoming participant (or a DM's edit of one), as lists -- only the ones it has. Skills
    come with their expertise (an old "Stealth+" read as both)."""
    out = {}
    if 'abilities' in data:
        out['abilities'] = ability_list(data['abilities'])
    for k in LIST_FIELDS:
        if k in data:
            out[k] = name_list(data[k])
    if 'skills' in data or 'expertise' in data:
        out['skills'], out['expertise'] = split_expertise(data.get('skills'), data.get('expertise'))
    return out
