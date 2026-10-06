"""Move migration, seventy-fourth slice: the `lethal_faint` category (user's call: only the damage and
the faint, never the "death"/"dust" part -- that's outside this tool).

- **Guillotine, Horn Drill, Explosion** -- a new `faint_on_roll` effect (`min:20`, `levelGap:10`):
  `_handleFaintOnRoll` asks for ONE d20 per use (cached on the shared ctx, so Explosion's several
  creatures share it), auto-fails against a target whose level is 10+ above the caster's, and on a
  success sets the target's HP to 0. Explosion's "all creatures within 5ft" is a human multi-pick
  (the existing effects-only target picker). Explosion's once-per-long-rest (2 at level 10, 3 at 18)
  limit isn't tracked.
- **10. Death Ray, 9. Disintegration Ray** -- the damage is the ordinary save-for-damage flow they
  already have; only the lethal clause was missing, and that's out of scope, so the `lethal_faint`
  tag is simply dropped (they correctly need no `effects`).
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


ALWAYS = {'type': 'always'}
INSTANT = [{'type': 'instant'}]

OVERRIDES = {
    'Guillotine': {'effects': [{'kind': 'faint_on_roll', 'min': 20, 'levelGap': 10, 'when': ALWAYS, 'ends': INSTANT}]},
    'Horn Drill': {'effects': [{'kind': 'faint_on_roll', 'min': 20, 'levelGap': 10, 'when': ALWAYS, 'ends': INSTANT}]},
    'Explosion': {'effects': [{'kind': 'faint_on_roll', 'min': 20, 'levelGap': 10, 'when': ALWAYS, 'ends': INSTANT,
                               'note': 'Pick every creature within 5ft of the point. Once-per-long-rest limit not tracked.'}]},
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
    for name, spec in OVERRIDES.items():
        effects = spec['effects']
        print(f'## {name}  ({len(effects)} effect(s))')
        for e in effects:
            print('   ', json.dumps(e, ensure_ascii=False))

    if not apply_it:
        return
    for name, spec in OVERRIDES.items():
        m = by_name[name]
        effects = spec['effects']
        m['effects'] = effects
        m['categories'] = rebuild_categories(m['categories'], effects)
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
