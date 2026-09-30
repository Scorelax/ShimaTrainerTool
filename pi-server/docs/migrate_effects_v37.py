#!/usr/bin/env python3
"""Move migration, thirty-seventh slice: `protect_negate` (20 moves), the
next category after `steal_disrupt`.

Read every move's own full text before trusting its category label, same
discipline as every category before this one. 7 of the 20 (Aqua Phase,
Astral Jet, Fly, Hyperspace Hole, Phantom Force, Phantom Tendril, Shadow
Force) already carry `ignoresProtect: true` from an earlier pass -- that IS
this category's mechanism for them (see move-effects-schema.md's own
section), and needs no `effects` entry at all: the semi-invulnerable turn
and the "with advantage" follow-up hit are the same documented, deliberately
manual simplification the already-migrated Bounce and the never-migrated
Dig/Dive already share (Bounce's own effects only model its paralysis
chance, nothing about the invisible turn or the advantage). Nothing to do
for these 7.

4 more are genuinely buildable now, composing existing mechanisms with no
new kind:
  - **Captivate**: reactionTrigger was never set on this move at all (an
    original-categorization gap, not a schema one -- every move in this
    category whose own text says "you may use a reaction" was checked, and
    NONE of the 10 reaction-shaped ones had it set). Backfilled to
    `targeted`/range 0 here since it's the one actually shipping this pass;
    the rest are left for whoever migrates each one, noted below. Reuses
    Parry's own `block_attack`+`when:"special"` pattern exactly -- "force a
    WIS save; on a fail, the attack doesn't hit" is a contested-outcome
    block the human judges and ticks after the fact, same trust model.
  - **Hover**: same reactionTrigger backfill. Two effects: `block_attack`/
    `when:"special"` (manual -- only if the triggering move was Ground-type,
    no `attacking_move_name`-vs-attack-type check exists in
    `_eligible_reactors` to automate this) for the one attack it dodges, and
    a real `granted_immunity` (Magnet Rise's own mechanism, generic against
    whatever's currently active regardless of `ends` shape) valued `"Ground"`
    with `until_turn`/holder/start/1 for "dodging Ground moves until the
    beginning of your next turn" -- no new code for either half.
  - **Mist** / **Safeguard**: both a standing "immune to some NEW incoming
    negative effect" shield -- a genuinely new mechanism, `blocking_shield()`
    in conditions.py, checked from `_apply_status` (routes_combat.py) before
    any status actually lands. Mist scopes to `kind:'stat'` with a negative
    flat amount (its own "negative stat effects or modifier changes");
    Safeguard scopes to its own named condition list (asleep/burned/
    confused/frozen/paralyzed/petrified/poisoned/slowed), not every
    condition. Neither blocks a self-sourced apply (a move's own drawback
    against its own user) -- see blocking_shield's own docstring for the
    "no team/faction concept anywhere in this app" caveat that forces this
    scoping. Safeguard ships as two effects (`target:'self'` + target-unset
    for the multi-target ally picker), same shape Haze's own AoE already
    uses; Mist is a single ordinary target-unset buff (its own text is "a
    target", not "you and all allies").

The remaining 9 are NOT migrated this pass, each for a real, different
reason (5 already scoped in move-effects-schema.md's own "Not covered yet"
section, 4 assessed fresh in this one):
  - Feint -- a reaction to a DEFENDER's own declared reaction (Protect);
    this app's one-floor-holder-at-a-time turn model has no shape for that.
  - Wide Guard -- halves rather than negates, and the reaction window would
    need to open INSIDE an AoE resolution (_handleMultiHitAoe doesn't have
    one at all).
  - Spiky Shield -- reflects damage back at the attacker; there's no "deal
    damage" effect kind anywhere in this schema to reuse.
  - Nature's Embrace -- redirects the avoided damage into a brand new attack
    roll against a DIFFERENT target; a full reactive mini-attack-flow, not a
    status.
  - Lucky Chant -- needs to intercept after the attack roll (and whether it
    crit) is known but before damage, a third reaction timing neither
    `targeted` nor `damaged` covers; crit itself isn't even determined until
    well after target-picker.js's own attack-roll step has closed.
  - Crafty Shield (assessed this pass) -- blocks only the CONDITION half of
    an incoming attack, never any accompanying damage. Reusing `block_attack`
    as-is would over-block: correct for a pure status move, wrong (free
    damage negation) for a damage+condition combo move like Thunder Punch.
    Needs a real "cancel only the status half" mechanism this schema doesn't
    have, not a documented-simplification-worthy approximation.
  - Mat Block (assessed this pass) -- not a reaction at all; a proactively-
    cast, multi-turn, AoE "immune to damage from damaging moves" shield.
    Needs a check at DAMAGE-APPLICATION time (parallel to temp_hp's own
    `_absorb_temp_hp` hook), not a reaction-window block -- a real, different
    mechanism from `block_attack`'s "cancel before the roll" shape.
  - Shield Dome (assessed this pass) -- a physical terrain barrier blocking
    movement and ranged line-of-sight through a fixed radius, needing real
    wall/LOS geometry this app's grid has no representation of at all.
    Unrelated to the Protect-family reaction-block shape entirely.
  - Testudo Formation (assessed this pass) -- compounds King's Shield's own
    already-deferred "blocks ALL damage, persists past the one triggering
    attack" gap with Wide Guard's halve-math-inside-an-AoE gap AND a
    formation-membership concept this app tracks nowhere -- not a small
    increment on anything already built.

    python migrate_effects_v37.py            # dry run
    python migrate_effects_v37.py --apply
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
    'Captivate': {
        'fields': {'reactionTrigger': 'targeted', 'reactionRange': 0},
        'effects': [
            {
                'kind': 'block_attack', 'target': 'self', 'when': SPECIAL, 'ends': INSTANT,
                'note': 'Only if the attacker fails the WIS save (vs your Move DC) this reaction forces -- tick this after confirming the save failed.',
            },
        ],
    },
    'Hover': {
        'fields': {'reactionTrigger': 'targeted', 'reactionRange': 0},
        'effects': [
            {
                'kind': 'block_attack', 'target': 'self', 'when': SPECIAL, 'ends': INSTANT,
                'note': 'Only if the triggering move was Ground-type.',
            },
            {
                'kind': 'condition', 'apply': 'granted_immunity', 'value': 'Ground', 'target': 'self', 'when': ALWAYS,
                'ends': [{'type': 'until_turn', 'whose': 'holder', 'point': 'start', 'count': 1}],
            },
        ],
    },
    'Mist': {
        'effects': [
            {'kind': 'condition', 'apply': 'mist', 'when': ALWAYS, 'ends': [{'type': 'rounds', 'n': 10}]},
        ],
    },
    'Safeguard': {
        'effects': [
            {'kind': 'condition', 'apply': 'safeguard', 'target': 'self', 'when': ALWAYS, 'ends': [{'type': 'rounds', 'n': 3}]},
            {'kind': 'condition', 'apply': 'safeguard', 'when': ALWAYS, 'ends': [{'type': 'rounds', 'n': 3}]},
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
