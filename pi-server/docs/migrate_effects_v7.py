#!/usr/bin/env python3
"""Move migration, fifth slice: player/random choice of which stat -- Bulk
Up and Acupressure. Both fit the schema's EXISTING `choice` field with no new
engine work: `{kind:"chosen"}` groups into a radio pick in the effects popup,
`{kind:"random", die, roll}` groups into a "type in what you rolled, it
picks the matching row" table (see move-effects.js's groupEffects /
effects-popup.js) -- this is the first time either has actually been used by
a real move's data.

Bulk Up: user's call -- each use is an independent choice (can end up mixed,
e.g. +2 attack / +3 AC from different picks), not locked to the first pick,
so it's just two ordinary stacking effects sharing one `chosen` group.

Acupressure: temp HP (row 3) is now a real mechanic (see routes_combat.py's
_absorb_temp_hp / move-effects.js's tempHpRemaining -- built same session,
user's own call to do it for real rather than defer or fake the display) --
all six rows included.

Power Trick and Power Split remain deliberately NOT in this batch -- Power
Trick needs a "one choice, two paired effects" extension (a swap needs both
sides applied together) that the user said to hold for later; Power Split
combines that same need with a target-average resolution, so it waits too.

    python migrate_effects_v7.py            # dry run
    python migrate_effects_v7.py --apply
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from migrate_effects_v2 import tag_for
from migrate_effects_v3 import RETIRED_V3

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')


def rebuild_categories(cats, effects):
    derived = []
    for e in effects:
        t = tag_for(e)
        if t not in derived:
            derived.append(t)
    out, placed = [], False
    for c in cats:
        if c in RETIRED_V3:
            if not placed:
                out.extend(derived)
                placed = True
            continue
        out.append(c)
    if not placed:
        out.extend(derived)
    return out


ALWAYS = {'type': 'always'}
SELF = 'self'
D_BULK_UP = [{'type': 'rounds', 'n': 10}, {'type': 'concentration'}]  # 1 minute, concentration
D_ACUPRESSURE = [{'type': 'rounds', 'n': 10}]  # 1 minute, no concentration


def STAT(stat, amount, choice, stacks=None):
    e = {'kind': 'stat', 'stat': stat, 'amount': amount, 'when': ALWAYS, 'target': SELF, 'ends': D_BULK_UP, 'choice': choice}
    if stacks:
        e['stacks'] = {'max': stacks}
    return e


def ACU(kind, choice, **kw):
    e = {'kind': kind, 'when': ALWAYS, 'target': SELF, 'ends': D_ACUPRESSURE, 'choice': choice}
    e.update(kw)
    return e


CHOSEN = {'kind': 'chosen'}
ROLL = lambda n: {'kind': 'random', 'die': 'd6', 'roll': n}  # noqa: E731

OVERRIDES = {
    'Bulk Up': [
        STAT('attack_rolls', 1, CHOSEN, stacks=5),
        STAT('ac', 1, CHOSEN, stacks=5),
    ],
    'Acupressure': [
        ACU('stat', ROLL(1), stat='attack_rolls', amount=1),
        ACU('stat', ROLL(2), stat='damage_rolls', amount=2),
        ACU('temp_hp', ROLL(3), amount=10),
        ACU('stat', ROLL(4), stat='saving_throws', amount=1),
        ACU('stat', ROLL(5), stat='crit', amount=1),
        ACU('stat', ROLL(6), stat='ac', amount=1),
    ],
}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    moves = data['moves']
    by_name = {m['name']: m for m in moves}

    missing = [n for n in OVERRIDES if n not in by_name]
    already = [n for n in OVERRIDES if by_name.get(n, {}).get('effects')]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)
    if already:
        print('ERROR -- already have effects (would overwrite):', already)
        sys.exit(1)

    print(f'{len(OVERRIDES)} moves, {sum(len(v) for v in OVERRIDES.values())} effects')
    for name, effects in OVERRIDES.items():
        print(f'## {name}')
        for e in effects:
            print('   ', json.dumps(e, ensure_ascii=False))

    if not apply_it:
        return
    for name, effects in OVERRIDES.items():
        m = by_name[name]
        m['effects'] = effects
        m['categories'] = rebuild_categories(m['categories'], effects)
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
