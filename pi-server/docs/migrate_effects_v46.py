#!/usr/bin/env python3
"""Move migration, forty-sixth slice: Electrify.

Electrify ("When hit by a melee attack, you may instantly use your reaction
to force the attacker to make a CON save against your Move DC. On a
failure, the attacking move's type is changed to electric.") looked like it
needed to intercept BEFORE the attack roll/damage calculation, which would
mean threading a type override through target-picker.js's own multi-step
attack-roll/damage-roll flow -- real plumbing, not built anywhere else in
this app. It doesn't: by the time a 'damaged' reaction can even fire, the
hit has already landed using its own type's multiplier, so this is instead
a RETROACTIVE correction against the just-applied damage log entry, same
family as `reroll_damage`/`undo_crit_damage`/`negate_damage`.

New `_retype_last_damage` (routes_combat.py, `retype-last-damage` action):
reverses the ORIGINAL type multiplier to recover the raw roll
(`amount / multiplier`, a rounding approximation this app already accepts
elsewhere), recomputes the multiplier with the NEW type against the
reactor's own types (reusing `_type_multiplier` exactly like
`_apply_damage_to_target` already does), and adjusts HP by the difference.
Worth noting: this can make the hit WORSE, not just better, if the new type
happens to be one the reactor is vulnerable to -- the move's own rules text
doesn't promise otherwise, so this doesn't either.

New `kind: "retype_damage"` effect (`{newType}`, `target:"self"`,
`when:"special"` -- the Protect family's own "the human judges a contested/
conditional outcome and ticks the box after confirming it" pattern, same as
Parry/Captivate/Hover: only here it's "tick this after confirming the
attacker's CON save actually failed", not after a contested roll). Thin
client handler (`_handleRetypeDamage`) -- the server already logs the
before/after numbers clearly.

    python migrate_effects_v46.py            # dry run
    python migrate_effects_v46.py --apply
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
    'Electrify': {
        'fields': {'reactionTrigger': 'damaged', 'reactionRange': 0},
        'effects': [
            {
                'kind': 'retype_damage', 'newType': 'Electric', 'target': 'self', 'when': {'type': 'special'}, 'ends': [{'type': 'instant'}],
                'note': 'Only if the attacker fails the CON save vs your Move DC.',
            },
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
