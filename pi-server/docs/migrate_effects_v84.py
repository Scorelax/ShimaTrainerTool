"""Move migration, eighty-fourth slice: recoil, and three more manual moves.

**Tagged `unknown`** (manual by design, decided with the user 2026-10-07): Calm Emotions (two narrative options, suppressed
effects resume when it ends), Powder and Powder Cloud (a standing coat that detonates when a fire move is used near it).

**Recoil** -- "I take a fraction of the damage as typeless self-damage". A new `recoil` effect (`fraction`, `basis`), self-targeted,
on a hit; combat-wip.js's `_handleRecoil` applies it through the ordinary damage path against the user themself (type '', so
no type-chart multiplier; temp HP absorbs first) and rounds down:
- Volt Tackle, Wild Charge, Brave Bird, Wood Hammer, Double-Edge, Head Charge, Take Down: 1/4 of the damage dealt.
- Head Smash: 1/2 of the damage dealt.
- Light of Ruin: 1/2 of "the damage rolled" -- an area move hitting several creatures with a per-target save, so there is no
  single dealt number; `basis: 'damage_rolled'` asks the table for the roll once (self effects on an AoE are offered once,
  after every target).
Detect carries a stray `recoil` tag (its text is Protect's "the damage you take instead drains your VP") -- it is a
`block_attack` already and gets no recoil effect.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from migrate_effects_v76 import rebuild_categories, INSTANT

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')

UNKNOWN = ('Calm Emotions', 'Powder', 'Powder Cloud')

# name -> (fraction, basis)
RECOIL = {
    'Volt Tackle': (0.25, 'damage_dealt'), 'Wild Charge': (0.25, 'damage_dealt'), 'Brave Bird': (0.25, 'damage_dealt'),
    'Wood Hammer': (0.25, 'damage_dealt'), 'Double-Edge': (0.25, 'damage_dealt'), 'Head Charge': (0.25, 'damage_dealt'),
    'Take Down': (0.25, 'damage_dealt'), 'Head Smash': (0.5, 'damage_dealt'), 'Light of Ruin': (0.5, 'damage_rolled'),
}


def recoil_effect(fraction, basis):
    # Light of Ruin's own damage lands whether or not a target saves, so it isn't gated on a hit; the rest are "on a hit".
    when = {'type': 'always'} if basis == 'damage_rolled' else {'type': 'on_hit'}
    return {'kind': 'recoil', 'fraction': fraction, 'basis': basis, 'damageType': '', 'when': when, 'target': 'self', 'ends': INSTANT,
            'note': f"You take {'half' if fraction == 0.5 else 'a quarter'} of the damage as typeless recoil (rounded down)."}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by_name = {m['name']: m for m in data['moves']}
    missing = [n for n in list(UNKNOWN) + list(RECOIL) if n not in by_name]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)
    done = [n for n in RECOIL if by_name[n].get('effects')]
    if done:
        print('ERROR -- already have effects:', done)
        sys.exit(1)
    for n in UNKNOWN:
        print(f'## {n} -> categories [unknown]')
    for n, (fraction, basis) in RECOIL.items():
        print(f'## {n}', json.dumps(recoil_effect(fraction, basis), ensure_ascii=False))
    if not apply_it:
        return
    for n in UNKNOWN:
        by_name[n]['categories'] = ['unknown']
    for n, (fraction, basis) in RECOIL.items():
        m = by_name[n]
        effects = [recoil_effect(fraction, basis)]
        m['effects'] = effects
        m['categories'] = rebuild_categories(m['categories'], effects)
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
