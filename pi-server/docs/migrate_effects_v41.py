#!/usr/bin/env python3
"""Move migration, forty-first slice: Spiky Shield -- the fourth of
protect_negate's "needs real work" remainder (see migrate_effects_v38.py's
own module docstring for the pushback that started this).

Spiky Shield ("When you are hit by a melee attack, use your reaction to
ignore damage, dealing grass damage equal to your proficiency modifier to
the attacker instead.") was deferred in v37 as needing "a deal damage
effect kind that doesn't exist anywhere in this schema". True in the sense
that no move had ever AUTHORED one before, but the underlying PRIMITIVE
(CombatAPI.applyDamage -- attacker, target, amount, type, species, moveName)
already exists and works generically for any (source, target) pair; nothing
stopped a reaction handler from calling it with the reactor and the original
attacker's roles swapped. Building the "deal damage to the attacker" kind
was mostly writing the handler, not inventing new server plumbing.

Two new effect kinds, both `target:"self"` (this app has no team/faction
concept, and -- more directly -- Spiky Shield, like Lucky Chant, is offered
through _handleEffectsOnly's plain self-only path, which never supplies a
real targetId; "self" is the only section that renders sensibly here) and
`when:"always"` (deterministic, no human judgment call needed):
- `kind: "negate_damage"` -- reroll_damage's own retroactive-correction
  shape, a full (100%) refund against the most recent damage entry against
  the reactor instead of a human-entered reroll. `_handleNegateDamage`.
- `kind: "deal_damage"` ({amount: "proficiency" | <number>, damageType?}) --
  a flat guaranteed counter-hit against whoever that same damage entry says
  attacked. `_handleDealDamageToAttacker`.

Both read "who attacked me" from a new shared `_lastDamageAgainst(reactorId)`
helper (the most recent `damage` log entry with that `targetId`) -- the same
technique `_handleUndoCritDamage` (Lucky Chant) already used inline,
factored out here since it's now the third handler that needs it.

Deliberately NOT modeled, same manual-after-first-use precedent every other
Protect-family move in this schema already gets (no resource-tracking
mechanism for "which use number is this" exists anywhere): the escalating
"roll over 15 after the first use" cost, and its own rider that a
SUCCESSFUL (but non-natural-20) later use still "drains your VP for half
the damage amount" -- both riders only ever apply on a use this schema
already leaves manual, so there's nothing to lose by leaving them that way
too.

    python migrate_effects_v41.py            # dry run
    python migrate_effects_v41.py --apply
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
    'Spiky Shield': {
        'fields': {'reactionTrigger': 'damaged', 'reactionRange': 0},
        'effects': [
            {'kind': 'negate_damage', 'target': 'self', 'when': ALWAYS, 'ends': INSTANT},
            {
                'kind': 'deal_damage', 'amount': 'proficiency', 'damageType': 'Grass', 'target': 'self', 'when': ALWAYS, 'ends': INSTANT,
                'note': 'Deals your proficiency modifier in Grass damage to the attacker instead.',
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
