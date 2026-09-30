#!/usr/bin/env python3
"""Move migration, thirty-first slice: a new `guaranteed_next_hit` condition
-- guaranteed_next_crit's own sibling (Laser Focus's mechanism), for Lock-On
and Mind Reader ("a single attack roll you make next turn is guaranteed to
hit"). New `guaranteedHitStatusId()` (move-effects.js) mirrors
`guaranteedCritStatusId()` exactly -- same standalone-condition shape, same
target-picker.js wiring (skips the attack roll/AC comparison entirely,
identical to a guaranteed-crit attack), same use-status consumption in
_resolveOneHit once the attack resolves.

NOT modeled: both moves' own "you may still roll to see if you crit" clause
-- target-picker's guaranteedHit path skips the roll step outright (that's
what makes it "guaranteed" in the first place), so keeping the roll around
purely for crit-fishing purposes would need a materially different code
path (show the roll step, but suppress only the hit/miss determination),
not just reusing the existing mechanism. Left as a documented gap.

Found and fixed while wiring this in, not something introduced by it: the
"hit again?" loop for multi-hit moves (multi_hit_same_target/
multi_hit_choice) reused a single `guaranteedHit` value computed ONCE
before the first hit, across every subsequent hit in the chain -- meaning a
one-shot status (Laser Focus's crit, or this new hit-guarantee) would stay
"guaranteed" for every later hit too, even after being consumed by the
first one. Real latent bug, pre-dating this change (Laser Focus was already
exposed to it), just never hit in practice. Fixed with a new
`_guaranteedHitFor(combatantId, categories)` helper that re-checks the
LIVE session state fresh on every call instead of closing over a stale
boolean.

Thunderstorm Dance ("while concentrating, ALL electric-type moves are
guaranteed to hit") is NOT in this batch -- it isn't a one-shot "next
attack" flag like these two, it's an ongoing effect scoped to one move
TYPE, and guaranteedCritStatusId/guaranteedHitStatusId's lookup has no
concept of narrowing to a specific move type at all. A real, different
wrinkle -- left for its own slice rather than force-fit here.

    python migrate_effects_v31.py            # dry run
    python migrate_effects_v31.py --apply
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
SELF = 'self'
USES1 = [{'type': 'uses', 'n': 1}]

GUARANTEED_HIT_EFFECT = {
    'kind': 'condition', 'apply': 'guaranteed_next_hit',
    'target': SELF, 'when': ALWAYS, 'ends': USES1,
    'note': 'You may still roll to check for a crit or a high-roll effect -- not auto-supported, the guaranteed-hit path skips the roll step entirely.',
}

OVERRIDES = {
    'Lock-On': [dict(GUARANTEED_HIT_EFFECT)],
    'Mind Reader': [dict(GUARANTEED_HIT_EFFECT)],
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
        print(f'## {name}  ({len(effects)} effect(s))')
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
