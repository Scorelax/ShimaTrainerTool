#!/usr/bin/env python3
"""Move migration, forty-seventh slice: Heal Block, Strength Sap, Spectral
Surge, Snatch -- `steal_disrupt`'s last hard group, all sharing one real
structural gap: each reacts to an ENEMY'S OWN self-targeted move (a
self-buff or self-heal) before it lands, and `_handleEffectsOnly`
(combat-wip.js's self-only move flow) never opened ANY reaction window at
all -- every other reaction in this app fires off a 'targeted'/'damaged'
window tied to an externally-chosen target, which a self-only move never
has.

Fixed with one new trigger, `'beneficial'` (routes_combat.py's own
open-reaction-window validation, `_eligible_reactors`'s eligibility logic is
already trigger-name-agnostic so needed no other server change), opened
from `_handleEffectsOnly` right before a move's own effects are offered.
Anchored on the CASTER themselves (both anchorId and attackerId -- there's
no separate "target" here, the caster IS who the reaction concerns). A
block cancels the move's own effects entirely, INCLUDING any ally-targeting
half of a mixed move (Tailwind-style "you and all allies") -- a documented
simplification, same "cancels the whole attack" precedent `block_attack`
already has elsewhere (Crafty Shield), since this app has no mechanism to
selectively cancel just one target's own share of a shared effect.

Two of the four need nothing beyond that new window plus EXISTING kinds:

- **Heal Block** ("preventing the recovery of health... any items or VP
  consumed... are lost"): plain `block_attack`, reused as-is.
- **Strength Sap** ("negate the increase and convert it into healing
  energy, recovering 1d10 + MOVE hit points"): `block_attack` + a plain
  `heal` effect (`{dice: "1d10", moveMod: true}`, target:"self") -- the
  heal amount has no connection to whatever was negated, so no new
  mechanism needed for it at all.

The other two needed one new kind, `steal_buff` -- "steal the stat bonus"/
"you gain the positive effect", fired `when:"special"` (Parry/Captivate/
Hover's own "the human judges a contested/conditional outcome and ticks the
box" pattern): both moves' own trigger involves a THIRD PARTY (the caster)
making an attack roll or a saving throw, a shape `_handleEffectsOnly`'s
self-only architecture has nowhere to run (the exact gap its own docstring
already calls out for Guard Split). `_handleStealBuff` reads
`session.pendingReaction`'s own `moveName`/`attackerId` (still the live
window -- the reactor only reaches their own move-use while holding the
floor for it) to find the CASTER's own authored `kind:'stat', target:'self'`
effects, blocks them (reusing `block-pending-attack`, which is trigger-
agnostic), and reapplies them to the reactor instead. Scoped to stat buffs
only -- same "steal only the stat changes" precedent Spectral Thief's own
`stat_transfer` `steal` mode already uses; Snatch's own broader wording
("curing a negative status effect... healing... etc") isn't covered.

- **Spectral Surge** ("make a ranged attack roll, stealing the stat bonus
  on a hit"): `steal_buff`, note: tick only if the ranged attack actually
  hits the caster.
- **Snatch** ("force it to make a WIS save... on a failure, you gain the
  positive effect"): `steal_buff`, note: tick only if the caster's own WIS
  save (against your Move DC) actually fails.

    python migrate_effects_v47.py            # dry run
    python migrate_effects_v47.py --apply
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
SPECIAL = {'type': 'special'}
INSTANT = [{'type': 'instant'}]

OVERRIDES = {
    'Heal Block': {
        'fields': {'reactionTrigger': 'beneficial', 'reactionRange': 40},
        'effects': [
            {'kind': 'block_attack', 'target': 'self', 'when': ALWAYS, 'ends': INSTANT},
        ],
    },
    'Strength Sap': {
        'fields': {'reactionTrigger': 'beneficial', 'reactionRange': 15},
        'effects': [
            {'kind': 'block_attack', 'target': 'self', 'when': ALWAYS, 'ends': INSTANT},
            {'kind': 'heal', 'amount': {'dice': '1d10', 'moveMod': True}, 'target': 'self', 'when': ALWAYS, 'ends': INSTANT},
        ],
    },
    'Spectral Surge': {
        'fields': {'reactionTrigger': 'beneficial', 'reactionRange': 30},
        'effects': [
            {
                'kind': 'steal_buff', 'target': 'self', 'when': SPECIAL, 'ends': INSTANT,
                'note': 'Only if your ranged attack roll actually hits the creature using the stat-boosting move.',
            },
        ],
    },
    'Snatch': {
        'fields': {'reactionTrigger': 'beneficial', 'reactionRange': 30},
        'effects': [
            {
                'kind': 'steal_buff', 'target': 'self', 'when': SPECIAL, 'ends': INSTANT,
                'note': "Only if the caster's own WIS save (vs your Move DC) actually fails. Scoped to stat buffs only -- healing/status-curing \"positive effects\" aren't covered.",
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
