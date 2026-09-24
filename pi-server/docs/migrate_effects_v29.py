#!/usr/bin/env python3
"""Move migration, twenty-ninth slice: Solar Beam and Solar Blade. "If this
move is used in harsh sunlight, double your MOVE modifier for damage and it
can be used on the turn it is activated, without concentration." Identical
mechanics between the two (one ranged/AoE, one melee) -- same effect either
way, and the same two-turn "charge, then attack" structure as the existing
"vanish, then attack next turn" family (Aqua Phase, Dig, Dive, Fly, Phantom
Force, Shadow Force -- see migrate_effects_v18.py's own reasoning) that was
deliberately left unmodeled: the human just uses the move's own "attack"
half on their actual attack turn, nothing here enforces the turn structure
or concentration itself. The only thing that needed real support was the
harsh-sunlight check, and that needed weather to actually be visible to
whoever's using the move -- not just the DM's own screen, which is all the
existing weather badge (combat.js's own global-conditions bar) ever was
before this (routes_combat.py gained set-weather/set-terrain, a real
shared-session field, same session data every other player already reads).

New self-conditional condition (combat.js's own _evaluateDamageNotes):
`self_weather_contains` -- a loose case-insensitive substring match against
the (freeform, DM-typed) weather name, not an exact string. New flatBonus
source, `"moveModifier"` (self-conditional side; the target-conditional
side already had it, Wring Out) -- one more copy of the move's own stat
modifier.

    python migrate_effects_v29.py            # dry run
    python migrate_effects_v29.py --apply
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
                for t in derived:
                    if t not in out:
                        out.append(t)
                placed = True
            continue
        out.append(c)
    if not placed:
        for t in derived:
            if t not in out:
                out.append(t)
    return out


SUN_EFFECT = [
    {'kind': 'damage_note', 'condition': {'type': 'self_weather_contains', 'any': ['sun']},
     'flatBonus': 'moveModifier', 'note': 'Harsh sunlight -- double your move modifier for damage'},
]

OVERRIDES = {
    'Solar Beam': SUN_EFFECT,
    'Solar Blade': SUN_EFFECT,
}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    moves = data['moves']
    by_name = {m['name']: m for m in moves}

    missing = [n for n in OVERRIDES if n not in by_name]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)
    already = [n for n in OVERRIDES if by_name.get(n, {}).get('effects')]
    if already:
        print('ERROR -- already have effects (would overwrite):', already)
        sys.exit(1)

    print(f'{len(OVERRIDES)} moves getting effects')
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
