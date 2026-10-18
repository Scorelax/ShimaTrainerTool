#!/usr/bin/env python3
"""One-time conversion: docs/DnD_pokemon.json (Benjakronk's encyclopedia rows -- 80 cells by position) ->
docs/DnD_species.json (one object per species, the shape app/species.py reads). The user's call, 2026-10-18.

    python scripts/convert_species.py            # writes docs/DnD_species.json and prints what it fixed / couldn't

What's left out: the image cells (the pictures are files on the Pi), the duplicated dex number and image, the single
move slots (41-61, the same moves as 35-40), the ability descriptions (62-64 -- DnD_abilities.json has every one,
word for word), the old one-line speed (25 -- made from `movement`) and the stat total (26 -- the sum of the six).
Numbers become numbers, lists become lists, and the evolution text becomes `evolvesInto` (`evolvesFrom` is worked out
from the other species when loading, so the two directions can never disagree).

Cleaned on the way (each one reported): empty placeholder rows, line breaks inside text, misspelled evolution
targets, "From X" without its colon, a requirement that was just "12", saving throws / skills matched to the game's
spellings (misspellings, mixed capitalisation, names without commas between them).

Done once: DnD_pokemon.json was removed afterwards, and DnD_species.json is the file to edit from now on. To run this
again, get the old file back from git first (`git show a24a84d:pi-server/docs/DnD_pokemon.json > docs/DnD_pokemon.json`)
-- and know that it overwrites DnD_species.json, edits made there since included.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from app.calculations import fix_mojibake  # noqa: E402

DOCS = os.path.join(os.path.dirname(__file__), '..', 'docs')
SRC = os.path.join(DOCS, 'DnD_pokemon.json')
OUT = os.path.join(DOCS, 'DnD_species.json')

MOVE_LEVELS = (1, 2, 6, 10, 14, 18)  # cells 35-40
MOVEMENT = ('walking', 'climbing', 'flying', 'hovering', 'swimming', 'burrowing')  # cells 65-70
SENSES = ('sight', 'hearing', 'smell', 'tremorsense', 'echolocation', 'telepathy', 'blindsight', 'darkvision', 'truesight')  # 71-79
STATS = ('strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma')  # cells 27-32

# Evolution targets spelled differently from the species they mean.
TARGET_TYPOS = {'Elqueeen': 'Elqueen', 'Agulizz': 'Agiluzz', 'Compiizard': 'Compizard', 'Lumiinarch': 'Luminarch',
                'Silivolt': 'Silvolt', 'Blaziiken': 'Blaziken'}
# Branches only the evolved species mentioned ("From: Salo" on Spectro, but no Salo branch names it): added to the
# species it evolves from, with the requirement unknown -- reported, to be filled in.
MISSING_BRANCHES = {'Spectro': 'Salo'}

ABOUT = """Every species in the game, one object each (pi-server/app/species.py reads this; converted from Benjakronk's
encyclopedia rows by scripts/convert_species.py on 2026-10-18).
  dexNumber, name, classification, description
  types: {primary, secondary|null}
  size, rarity, habitat, behavior, active
  evolvesInto: [{species, requirement (the text to show, or null when unknown), level (only for a plain "Level N")}]
    -- evolvesFrom is worked out from these when loading (a fusion lists two species).
  abilities: {primary, secondary, hidden} -- names (null when it has none); the descriptions are in DnD_abilities.json
  encounter: {minimumLevel, catchDifficulty}
  combat: {ac, hitDie, baseHP, vitalityDie, baseVP}   (dice as their size: 4 = d4)
  baseStats: {strength, dexterity, constitution, intelligence, wisdom, charisma}
  savingThrows: [..], skills: [..]
  moves: {"1": [..], "2": [..], "6": [..], "10": [..], "14": [..], "18": [..]}  -- learned at that level
  movement: {walking, climbing, flying, hovering, swimming, burrowing}  -- feet; 0 = can't
  senses: {sight, hearing, smell, tremorsense, echolocation, telepathy, blindsight, darkvision, truesight}  -- null = none
A number left null is one the encyclopedia doesn't have yet."""


def text(v):
    """A text cell, cleaned: mojibake fixed, line breaks and runs of spaces collapsed, '' -> None."""
    if v is None:
        return None
    s = re.sub(r'\s+', ' ', fix_mojibake(str(v)).replace('\\n', ' ').replace('\\', '')).strip()
    return s or None


def number(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return int(v) if float(v).is_integer() else v
    s = str(v or '').strip()
    return int(s) if re.fullmatch(r'-?\d+', s) else None


SAVING_THROWS = ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma']
SKILLS = ['Acrobatics', 'Animal Handling', 'Arcana', 'Athletics', 'Deception', 'History', 'Insight', 'Intimidation',
          'Investigation', 'Medicine', 'Nature', 'Perception', 'Performance', 'Persuasion', 'Religion', 'Sleight of Hand',
          'Stealth', 'Survival']  # js/dm/dm-common.js's spellings


def word_list(v, known, name, what, report):
    """'Dexterity, constitution' -> ['Dexterity', 'Constitution'] -- matched to the game's own spellings ('Sleight of
    Hand'); a '.' between two names is read as a comma. One it doesn't know is kept, first letter capitalised."""
    out = []
    for part in re.split(r'[,.](?!\d)', str(v or '')):
        part = text(part)
        if not part or part.lower() in ('none', '-'):
            continue
        part = re.sub(r'\b(\w+)\b', lambda m: SPELLING.get(m.group(1).lower(), m.group(1)), part)
        match = next((k for k in known if k.lower() == part.lower()), None)
        names = None if match else _split_words(part, known)
        if match:
            out.append(match)
        elif names:  # "Strength Dexterity" -- names written without commas
            report.append(f'{name}: {what}s {part!r} read as {names}')
            out.extend(names)
        else:
            report.append(f'{name}: {what} {part!r} isn\'t one of the game\'s -- kept as written, check it')
            out.append(part[:1].upper() + part[1:])
    return out


# Misspellings in the saving throw / skill cells.
SPELLING = {'persuation': 'Persuasion', 'dexteriry': 'Dexterity', 'invesstigation': 'Investigation'}


def _split_words(part, known):
    """'Perception Survival Nature' -> ['Perception', 'Survival', 'Nature'] when the whole text is known names (longest
    first, so 'Sleight of Hand' stays one), else None."""
    rest, out = part.lower(), []
    while rest:
        k = next((k for k in sorted(known, key=len, reverse=True) if rest.startswith(k.lower())
                  and (len(rest) == len(k) or rest[len(k)] == ' ')), None)
        if not k:
            return None
        out.append(k)
        rest = rest[len(k):].strip()
    return out


def feet(v):
    """'25ft' / '25ft.' -> 25, '-' -> 0 (can't), '' -> None (unknown)."""
    s = str(v or '').strip()
    if not s:
        return None
    m = re.fullmatch(r'(\d+)\s*ft\.?', s)
    if m:
        return int(m.group(1))
    if s == '-':
        return 0
    raise ValueError(f'movement {s!r}')


def sense(v):
    s = str(v or '').strip()
    return None if not s or s == '-' else s


def evolution(name, cell, names, report):
    """The "Evolves:" parts of the old evolution cell -> [{species, requirement, level}]. ("From:" parts are dropped --
    evolvesFrom is worked out from everyone's evolvesInto; checked against the old text below.)"""
    raw = text(cell) or ''
    out = []
    if not raw or raw.lower() == 'none':
        return out
    for part in raw.split(';'):
        part = part.strip()
        key, sep, value = part.partition(':')
        if not sep and part.lower().startswith('from '):
            continue  # "From Mograyn" -- a From part without its colon
        if key.strip().lower() == 'from':
            continue
        if key.strip().lower() != 'evolves':
            report.append(f'{name}: evolution part not understood, left out: {part!r}')
            continue
        if '@' in value:
            target, requirement = (x.strip() for x in value.split('@', 1))
        else:  # "Evolves: Lunatrice with Sun Stone and Moon Stone"
            target, _, requirement = value.strip().partition(' with ')
            target, requirement = target.strip(), requirement.strip()
            report.append(f'{name}: no "@" in {part!r} -- read as {target} ({requirement})')
        if target in TARGET_TYPOS:
            report.append(f'{name}: evolution target {target!r} is a misspelling of {TARGET_TYPOS[target]!r} -- fixed')
            target = TARGET_TYPOS[target]
        if target not in names:
            report.append(f'{name}: evolves into {target!r}, which isn\'t a species -- kept as written')
        if re.fullmatch(r'\d+', requirement):
            report.append(f'{name}: requirement {requirement!r} read as "Level {requirement}"')
            requirement = f'Level {requirement}'
        level = re.fullmatch(r'Level (\d+)', requirement)
        entry = {'species': target, 'requirement': requirement or None}
        if level:
            entry['level'] = int(level.group(1))
        out.append(entry)
    return out


def convert(row, names, report):
    name = text(row[2])
    stats = [number(row[i]) for i in range(27, 33)]
    if any(s is None for s in stats):
        report.append(f'{name}: has no ability scores / numbers yet in the encyclopedia -- left null')
    return {
        'dexNumber': number(row[1]),
        'name': name,
        'classification': text(row[5]),
        'description': text(row[6]),
        'types': {'primary': text(row[7]), 'secondary': text(row[8])},
        'size': text(row[9]),
        'rarity': text(row[10]),
        'habitat': text(row[11]),
        'behavior': text(row[12]),
        'active': text(row[13]),
        'evolvesInto': evolution(name, row[14], names, report),
        'abilities': {'primary': text(row[15]), 'secondary': text(row[16]), 'hidden': text(row[17])},
        'encounter': {'minimumLevel': number(row[19]), 'catchDifficulty': number(row[18])},
        'combat': {'ac': number(row[20]), 'hitDie': number(row[21]), 'baseHP': number(row[22]),
                   'vitalityDie': number(row[23]), 'baseVP': number(row[24])},
        'baseStats': dict(zip(STATS, stats)),
        'savingThrows': word_list(row[33], SAVING_THROWS, name, 'saving throw', report),
        'skills': word_list(row[34], SKILLS, name, 'skill', report),
        'moves': {str(lvl): [m for m in (text(x) for x in str(row[35 + i] or '').split(',')) if m]
                  for i, lvl in enumerate(MOVE_LEVELS)},
        'movement': dict(zip(MOVEMENT, (feet(row[i]) for i in range(65, 71)))),
        'senses': dict(zip(SENSES, (sense(row[i]) for i in range(71, 80)))),
    }


def check(species, rows, report):
    """What the old cells said that the new shape works out instead -- each disagreement reported."""
    by_name = {s['name']: s for s in species}
    derived = {}
    for s in species:
        for e in s['evolvesInto']:
            derived.setdefault(e['species'], []).append(s['name'])
    for row in rows:
        name = text(row[2])
        stated = []
        for part in (text(row[14]) or '').split(';'):
            key, sep, value = part.strip().partition(':')
            if not sep and part.strip().lower().startswith('from '):
                key, value = 'from', part.strip()[5:]
            if key.strip().lower() == 'from':
                stated = sorted(n.strip() for n in value.split('@')[0].split('+') if n.strip() and n.strip() != '-')
        got = sorted(derived.get(name, []))
        if stated != got:
            report.append(f'{name}: the old "From" said {stated or "nothing"}, the evolutions say {got or "nothing"} -- '
                          f'{"the evolutions win" if got else "kept by adding the branch"}')
        # The old one-line speed must come back the same from `movement`.
        s = by_name[name]
        made = ', '.join(f'{ft}ft. {k.title()}' for k, ft in s['movement'].items() if ft)
        old = re.sub(r'\s+', ' ', str(row[25] or '')).strip()
        if made != old and not old.startswith('. '):
            report.append(f'{name}: speed {old!r} vs movement {made!r}')


def dumps(data):
    """JSON for hand-editing: indented, but a list of plain values (moves, skills...) or a small object of plain values
    (types, movement...) on one line. app/species.py writes the file the same way."""
    def plain(v):
        return not isinstance(v, (dict, list))

    def fmt(v, ind):
        pad = '  ' * (ind + 1)
        if isinstance(v, list):
            if all(plain(x) for x in v):
                return json.dumps(v, ensure_ascii=False)
            return '[\n' + ',\n'.join(pad + fmt(x, ind + 1) for x in v) + '\n' + '  ' * ind + ']'
        if isinstance(v, dict):
            if v and all(plain(x) for x in v.values()) and len(json.dumps(v, ensure_ascii=False)) <= 110:
                return json.dumps(v, ensure_ascii=False)
            return '{\n' + ',\n'.join(f'{pad}{json.dumps(k, ensure_ascii=False)}: {fmt(x, ind + 1)}' for k, x in v.items()) + '\n' + '  ' * ind + '}'
        return json.dumps(v, ensure_ascii=False)
    return fmt(data, 0) + '\n'


def main():
    rows = [r for r in json.load(open(SRC, encoding='utf-8'))['pokemon'] if str(r[2] or '').strip()]
    names = {text(r[2]) for r in rows}
    report = []
    species = [convert(r, names, report) for r in rows]
    for child, parent in MISSING_BRANCHES.items():
        p = next(s for s in species if s['name'] == parent)
        if not any(e['species'] == child for e in p['evolvesInto']):
            p['evolvesInto'].append({'species': child, 'requirement': None})
            report.append(f'{parent}: evolves into {child} (only {child} said so) -- added, requirement unknown: fill it in')
    check(species, rows, report)
    species.sort(key=lambda s: (s['dexNumber'] is None, s['dexNumber'] or 0))
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(dumps({'_about': ABOUT, 'species': species}))
    print(f'{len(species)} species -> {os.path.normpath(OUT)} ({len(json.load(open(SRC, encoding="utf-8"))["pokemon"]) - len(rows)} empty rows left out)')
    print('\n'.join(report))


if __name__ == '__main__':
    main()
