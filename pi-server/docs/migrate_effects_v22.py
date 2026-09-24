#!/usr/bin/env python3
"""Move migration, twentieth slice: `conditional_damage`, read move-by-move
(all 26) -- and it turned out to not actually be a gap. Every one of them is
a damage FORMULA variation (target/self HP%, a visible status already shown
as a badge, a stat comparison, VP spent so far) the human already computes
themselves when entering their damage roll, same as every other damage move
in this app -- there's no digital dice and no "damage formula" effect kind
anywhere in this schema, on purpose (see move-effects-schema.md). Reflected
in generate_unmigrated_moves.py's own updated classification: `conditional_
damage` moved out of NEEDS_NEW_TAGS into NO_EFFECT_NEEDED_TAGS.

Beat Up is the ONE exception -- its "disadvantage on the target's next
attack, if it was surrounded" clause is a real stored consequence (the app
needs to remember it for a FUTURE roll, unlike a status that's already
visible on a badge), so it gets a real effect: `when: {type:"special"}`
(same "human judges this entirely" catch-all Parry's own block_attack
effect already uses) since "surrounded" isn't something this app computes
from the battle map automatically.

Also not migrated, each already covered by an existing, separately-tracked
gap rather than anything new found here: Self-Destruct (fainting + death
saves, its own mechanic entirely), Solar Beam/Solar Blade (harsh-sunlight
conditional, `field_weather`), Spit Up (Stockpile's own stack count, the
same "read another status's stacks" gap Swallow was already excluded for).

    python migrate_effects_v22.py            # dry run
    python migrate_effects_v22.py --apply
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


OVERRIDES = {
    'Beat Up': [
        {'kind': 'roll', 'roll': 'disadvantage', 'on': 'attack_rolls', 'when': {'type': 'special'},
         'ends': [{'type': 'uses', 'n': 1}],
         'note': 'Only if the target was completely surrounded (no empty adjacent squares) when hit.'},
    ],
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

    print(f'{len(OVERRIDES)} move(s) getting effects')
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
