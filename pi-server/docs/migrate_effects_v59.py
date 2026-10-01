#!/usr/bin/env python3
"""Move migration, fifty-ninth slice: the first batch out of the 35-move
"fits the schema already, just blocked on something" list (see
unmigrated_moves.md's own section 1). Read all 35 fresh rather than
trusting the coarse label (same lesson as every prior "don't repeat a
category's own summary back without checking" correction this project has
already hit) -- 14 of the 35 turned out buildable with real, reusable
mechanism, grouped by the blocker each one actually shares:

**`speed` as a buffable stat** (never wired in anywhere before this pass --
`speeds` is a whole array of movement TYPES per participant, not a flat
scalar the existing additive statDeltas machinery has any notion of, which
is exactly why it sat unbuilt despite being listed in the schema's own
vocabulary). Two new conditions.py lookups, both folded into
`_movement_budget`: `speed_bonus_entries` (flat ADDITIVE "+Nft", stacking
via the existing `stacks` mechanism) and `speed_multiplier_entries`
(MULTIPLICATIVE "double speed", combined separately since a buff doesn't
compose the same way the existing debuff-only `effective_speed_multiplier`
table does). Both support an optional `appliesTo` scope (one speed `type`
string, or `'all'` by default) so a buff that only touches ONE movement
type (Surface Glide's own "on/in water") doesn't leak onto an unrelated
one the participant also has.
- **Agility** (+20ft, any type), **Autotomize** (+10ft, stacks to +30),
  **Flame Charge** (+5ft per hit, stacks to +30, `when:"on_hit"` --
  the move's own normal damage needs no effect at all, same "nothing
  hidden" precedent as every other plain attack).
- **Kinesis** (+20ft each to walking/flying/swimming, only the speed half
  -- three separate scoped effects rather than one, since `appliesTo` is a
  single type, not a list). Its own "+2 AC when targeted by ranged
  attacks" is NOT migrated -- no "only against ranged attacks" AC scoping
  exists anywhere (AC changes apply universally), a genuinely different
  gap than speed's.
- **Surface Glide** (x2, scoped to `swimming` only) and **Tailwind** (x2,
  `'all'`, granted to the caster AND every ally in range -- the same
  target:'self' + target-unset dual-effect AoE shape Aromatherapy/Heal
  Bell already established, no new targeting code needed).

**STAB doubling** (`increase_stab`, a long-standing tag never backed by a
mechanism -- STAB is computed inline in `pokemon-types.js`'s
`computeMoveData`, not a modifiable status field). New standalone flag
condition `stab_doubled` (same family as `guaranteed_next_crit`/
`guaranteed_next_hit`), read in `computeMoveData`'s own new `stabMultiplier`
param -- WIP-only bridged (`combat-wip.js`'s `_syncLocalCombatState`
reading the holder's live statuses straight into `merged.stabMultiplier`,
threaded through combat.js's shared `showCombatMoveDetails` call site),
same "always 1 on the legacy standalone engine" limitation every other
live modifier already has. Compounds multiplicatively with Tough Claws'
own doubling, same "several sources compound" convention this app already
uses for `resistance_upgrade`.
- **Calm Mind**, **Tail Glow**.

**Standing incoming-damage shields** -- two different shapes added to the
damage-application pipeline (`_apply_damage_to_target`), both checked
AFTER the type multiplier:
- **Aurora Veil** ("halve all damage dealt to you for three rounds") --
  folded into the EXISTING `incoming_damage_multiplier` table alongside
  Mat Block/Testudo Formation (same 0.5x shape as Testudo's own incoming
  half, just without an outgoing half of its own). Its own "only while
  hailing" gate is advisory, same "surface it in the move's own text,
  trust the human" philosophy as every other weather/terrain check in
  this app (there's no structured, query-able weather-effect system).
- **Harden** ("reduce any damage dealt to you by 1d4 + MOVE") -- a FLAT
  subtraction, a different shape from a percentage, so a new sibling
  function, `incoming_flat_reduction`, keyed off a new `damage_reduction`
  condition. The reduction amount is rolled ONCE at cast time (no digital
  dice anywhere in this app) via a new `promptValueRoll` (heal-popup.js --
  generalized its shared `_promptRoll` core a third time, a bare-number
  sibling to `promptHealRoll`/`promptDrainRoll` for a condition's own
  `value` rather than an immediate HP/VP change), resolved through the same
  "mutate a clone, fall through to the normal apply-status path"
  `_offerMoveEffects` convention every other dynamic-value effect here uses.

**Aura Theft** ("the target loses ALL beneficial effects... the user gains
the effects of ONE of these, user's choice") -- a new `stat_transfer` mode,
`"steal_choice"`: every positive `kind:'stat'` status still comes OFF the
target (same as plain `'steal'`), but only ONE is recreated on the
attacker, picked via the EXISTING `pickOneStatus` popup (Psycho Shift/
Searing Flame's own "choose which status" picker, reused as-is).

**Divine Noodle Form** ("half of your current max HP as temporary bonus
HP") -- a new `temp_hp` amount shape, `{fractionOfMaxHP}`, resolved the
same dynamic-value way as Harden's roll (just a formula against the
holder's own live `maxHP`, no roll needed). Its own melee-reach increase
isn't enforced -- no positional/range system exists anywhere in this app
to enforce it against, flagged in the effect's own `note` rather than
silently dropped.

**Wing Buffer** ("on a successful [reactive] save, you take half damage")
-- the one `reactive_save` move already wired to `_handleReactiveSave`
(which auto-detects the attacker/DC and prompts the save), just never
actually applying its own OUTCOME; that function's own fallback text
literally said "apply its effect manually (e.g. half damage)" as its
anticipated example. New `kind:"halve_damage"`, applied DIRECTLY in
`_handleReactiveSave` on a PASS (the one shape here inverted from every
other save-triggered move's own convention, which fires on a FAIL) via a
new `_handleHalveDamage` -- the same retroactive-correction family as
`reroll_damage`/`negate_damage`/`undo_crit_damage`, just a flat 50% refund
with no crit gate.

**Feather Dance** ("the target cannot add proficiency to its attack
rolls") -- a new standalone condition, `no_proficiency_attacks`, checked
directly in `attackRollContext` (subtracts the HOLDER's own live
`proficiency` from their attack-roll delta -- not a fixed `stat:'attack_rolls'`
amount, since the number to subtract is whatever the holder's own
proficiency actually is, not authored data that could drift from it).

**The other 21 stay deferred this pass**, each for a reason worth
remembering rather than a guess: Fell Stinger/Power Split/Power Trick/
Nasty Plot/Study/Foresight/Imperial Guard/Power-Up Punch/Blood Shield/
Spirit Growth/Fire Shield/Ink Veil/Miracle Eye/Odor Sleuth/Topsy-Turvy/
Wing Command/Thunderstorm Dance/Silent Approach each need at least one
MORE new piece beyond what this pass already built (a "double my own
current modifier" formula gated on a new "did this hit faint the target"
when-type, a THIRD stat to pick from for Power Split/Trick's existing
avgWithTarget sentinel, ability/target-scoped attack-roll advantage beyond
saving_throws, a passive always-on retaliation-on-hit trigger with no
reaction-floor-grab involved, an accumulating log-scan-derived shield
amount, a move-type-scoped persistent "guaranteed hit" status, VP-cost
modifiers, stealing/inverting an EXISTING effect, or a real ability-check
roll this app has literally none of) -- genuinely more than one slice's
worth, not laziness. Grassy Terrain/Psychic Terrain/Purgatory share the
SAME blocker as the whole still-untouched `field_terrain` category (no
structured, query-able terrain-effect system), so fixing them ad hoc here
would duplicate work that category's own eventual pass needs anyway.

    python migrate_effects_v59.py            # dry run
    python migrate_effects_v59.py --apply
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
    'Agility': {
        'effects': [
            {'kind': 'stat', 'stat': 'speed', 'amount': 20, 'when': ALWAYS, 'target': 'self', 'ends': [{'type': 'rounds', 'n': 10}]},
        ],
    },
    'Autotomize': {
        'effects': [
            {'kind': 'stat', 'stat': 'speed', 'amount': 10, 'stacks': {'max': 3}, 'when': ALWAYS, 'target': 'self', 'ends': [{'type': 'rounds', 'n': 10}]},
        ],
    },
    'Flame Charge': {
        'effects': [
            {
                'kind': 'stat', 'stat': 'speed', 'amount': 5, 'stacks': {'max': 6}, 'when': {'type': 'on_hit'}, 'target': 'self',
                'ends': [{'type': 'encounter'}],
                'note': 'Lasts until incapacitated/switched out/combat ends -- approximated as "rest of the battle" (no incapacitation-triggered early-end hook exists).',
            },
        ],
    },
    'Kinesis': {
        'effects': [
            {'kind': 'stat', 'stat': 'speed', 'amount': 20, 'appliesTo': 'walking', 'when': ALWAYS, 'target': 'self', 'ends': [{'type': 'rounds', 'n': 10}]},
            {'kind': 'stat', 'stat': 'speed', 'amount': 20, 'appliesTo': 'flying', 'when': ALWAYS, 'target': 'self', 'ends': [{'type': 'rounds', 'n': 10}]},
            {'kind': 'stat', 'stat': 'speed', 'amount': 20, 'appliesTo': 'swimming', 'when': ALWAYS, 'target': 'self', 'ends': [{'type': 'rounds', 'n': 10}]},
        ],
    },
    'Surface Glide': {
        'effects': [
            {
                'kind': 'stat', 'stat': 'speed', 'amount': {'multiplier': 2}, 'appliesTo': 'swimming', 'when': ALWAYS, 'target': 'self',
                'ends': [{'type': 'concentration'}],
                'note': 'Duration is "1 + MOVE minutes" -- approximated as concentration-only (removed manually), no fixed round count authored.',
            },
        ],
    },
    'Tailwind': {
        'effects': [
            {'kind': 'stat', 'stat': 'speed', 'amount': {'multiplier': 2}, 'when': ALWAYS, 'target': 'self', 'ends': [{'type': 'rounds', 'n': 10}, {'type': 'concentration'}]},
            {'kind': 'stat', 'stat': 'speed', 'amount': {'multiplier': 2}, 'when': ALWAYS, 'ends': [{'type': 'rounds', 'n': 10}, {'type': 'concentration'}], 'note': 'each ally within the 30ft circle when cast'},
        ],
    },
    'Calm Mind': {
        'effects': [
            {'kind': 'condition', 'apply': 'stab_doubled', 'when': ALWAYS, 'target': 'self', 'ends': [{'type': 'rounds', 'n': 10}, {'type': 'concentration'}]},
        ],
    },
    'Tail Glow': {
        'effects': [
            {'kind': 'condition', 'apply': 'stab_doubled', 'when': ALWAYS, 'target': 'self', 'ends': [{'type': 'rounds', 'n': 10}, {'type': 'concentration'}]},
        ],
    },
    'Aurora Veil': {
        'effects': [
            {'kind': 'condition', 'apply': 'aurora_veil', 'when': ALWAYS, 'target': 'self', 'ends': [{'type': 'rounds', 'n': 3}]},
        ],
    },
    'Harden': {
        'effects': [
            {
                'kind': 'condition', 'apply': 'damage_reduction', 'value': {'dice': '1d4', 'moveMod': True}, 'when': ALWAYS, 'target': 'self',
                'ends': [{'type': 'until_turn', 'whose': 'holder', 'point': 'start', 'count': 1}],
            },
        ],
    },
    'Aura Theft': {
        'effects': [
            {'kind': 'stat_transfer', 'mode': 'steal_choice', 'when': {'type': 'save_fail', 'ability': 'CHA'}, 'ends': INSTANT},
        ],
    },
    'Divine Noodle Form': {
        'effects': [
            {
                'kind': 'temp_hp', 'amount': {'fractionOfMaxHP': 0.5}, 'when': ALWAYS, 'target': 'self', 'ends': [{'type': 'rounds', 'n': 10}],
                'note': 'Melee reach increase to 15ft is not enforced -- no positional/range system exists in this app.',
            },
        ],
    },
    'Wing Buffer': {
        'effects': [
            {'kind': 'halve_damage', 'when': {'type': 'special'}, 'target': 'self', 'ends': INSTANT},
        ],
    },
    'Feather Dance': {
        'effects': [
            {'kind': 'condition', 'apply': 'no_proficiency_attacks', 'when': {'type': 'save_fail', 'ability': 'WIS'}, 'ends': [{'type': 'rounds', 'n': 10}, {'type': 'concentration'}]},
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
