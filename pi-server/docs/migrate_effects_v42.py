#!/usr/bin/env python3
"""Move migration, forty-second slice: Nature's Embrace -- the fifth of
protect_negate's "needs real work" remainder (see migrate_effects_v38.py's
own module docstring for the pushback that started this).

Nature's Embrace ("Whenever you sustain damage of a type you are vulnerable
to, you may use this reaction to discount the extra damage. Make a ranged
attack roll, redirecting the damage you avoided to a creature in range on a
hit.") was deferred in v37 as needing "a full reactive mini-attack-flow, not
a status." True that it needs a real attack roll against a freely chosen
target -- but `_handleBideResolve` (combat-wip.js) already proved this exact
shape works: `pickTarget`'s own `presetRoll` param pre-fills a KNOWN damage
amount (still editable) while still running the ordinary attack-roll step.
Nothing new needed there either.

The "discount the extra damage" half turned out NICER than the halving
approximation Wide Guard/Lucky Chant lean on: the damage log already
records the type multiplier that applied (`_apply_damage_to_target`'s own
`multiplier` field), so "discount the extra" is an EXACT figure --
`amount - floor(amount / multiplier)`, reducing the total back down to
what a plain 1x hit would have been. Correct for a stacked 4x vulnerability
(two type weaknesses) the same as the common 2x case, not just an
approximation of the common case like the other two moves' own halving.

New `kind: "redirect_avoided_damage"` effect (`target:"self"`, `when:"always"`
-- deterministic: `original.multiplier > 1` either holds or it doesn't, same
"check the log, tell the human if the condition wasn't met" pattern Lucky
Chant's own crit check already uses). `_handleRedirectAvoidedDamage` first
refunds the discounted amount to the reactor's own HP (same partial-refund
shape `_handleNegateDamage`/`_handleUndoCritDamage` already use), then --
only if something was actually avoided -- opens `pickTarget` with that
amount as the `presetRoll`, exactly mirroring `_handleBideResolve`'s own
miss/hit handling (a Miss just logs, a Hit calls `CombatAPI.applyDamage`
with whatever the human confirmed in the pre-filled box).

    python migrate_effects_v42.py            # dry run
    python migrate_effects_v42.py --apply
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
    "Nature's Embrace": {
        'fields': {'reactionTrigger': 'damaged', 'reactionRange': 0},
        'effects': [
            {'kind': 'redirect_avoided_damage', 'target': 'self', 'when': {'type': 'always'}, 'ends': [{'type': 'instant'}]},
        ],
    },
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
        print(f'## {name}  ({len(effects)} effect(s))  fields={spec.get("fields", {})}')
        for e in effects:
            print('   ', json.dumps(e, ensure_ascii=False))

    if not apply_it:
        return
    for name, spec in OVERRIDES.items():
        m = by_name[name]
        effects = spec['effects']
        m['effects'] = effects
        m['categories'] = rebuild_categories(m['categories'], effects)
        m.update(spec.get('fields', {}))
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
