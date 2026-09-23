#!/usr/bin/env python3
"""Move migration, tenth slice: the first batch of heal/drain moves -- a new
`heal` effect kind (see move-effects-schema.md's own section) plus 21 of the
46 moves unmigrated_moves.md listed under drain/heal_self/heal_target_or_aoe.

Two `amount` shapes, both explained fully in the schema doc:
  - {dice, moveMod?} -- a rolled heal ("regain 2d6 + MOVE hit points"), same
    "the app shows the structure, a human enters the roll" pattern as every
    other roll in this app. moveMod adds the caster's own best move-stat
    modifier (pokemon-types.js's new bestMoveStatModifier -- deliberately
    NOT computeMoveData's damageBonus, which bakes in STAB/Ace Trainer/Type
    Master/held-item bonuses a heal's "+MOVE" text was never talking about;
    the OLD combat.js heal popups already drew this same line).
  - {fractionOfDamage} -- a drain move's "heal for half the damage dealt",
    computed straight from the damage this same move-use just applied
    (combat-wip.js's ctx.damageDealt, threaded through from apply-damage's
    own damageApplied return value). 1.0 for Oblivion Wing's full-damage
    drain, 0.5 for every other drain here.

Self-only heals get target:self outright. A move that can heal either the
caster or an ally (Recover, Milk Drink) gets TWO heal effects, one of each --
same self + ally-via-multi-target-picker split Baby-Doll Eyes/Celebrate
already use for their own reaction effects, not a `choice` group (both are
independently useful, not a mutually exclusive either/or). Ally-only heals
(Heal Pulse explicitly "cannot target yourself", Soft-Boiled, Dream Mend)
get just the one target-unset effect -- pickMultipleTargets already excludes
the caster on its own.

Soul Drain is the one drain move that isn't a plain attack-roll hit -- it's
trigger_saving_throw shaped (Charisma save, damage AND two disadvantage
grants on a fail), so its heal rides on save_fail like the rest of that
move's own effects, not on_hit; also the one place this migration touches a
move that already needed OTHER new effects (the disadvantage grants) to be
fully structured, not just the heal.

NOT in this batch -- still on unmigrated_moves.md, left for a later slice:
  - VP-based drains (Enervation Ray, Energize, Spite, Grudge): a VP pool,
    not HP -- `heal`'s `updateStats` call only ever touches currentHP right
    now, and Grudge/Spite both have real resource-limit/escalating-cost
    text on top of that.
  - Multi-target AoE drains (Parabolic Charge, Tera Drain): the heal is a
    percentage of TOTAL damage across every target hit, not one hit's own
    damageDealt -- _handleMultiHitAoe's own applyDamage call site doesn't
    thread damageDealt through yet either (see the schema doc's own note).
    Parabolic Charge also caps at "5x level", a formula this schema has no
    slot for.
  - Heal-over-time / delayed / resource-limited / conditional-branch moves:
    Aqua Ring, Ingrain (recurring, needs a repeat-each-turn mechanism this
    schema doesn't have), Wish (delayed to next turn, same gap), Purify
    (level-scaled AND conditional on a status actually being removed),
    Recompose (VP, situational + once-per-long-rest), Swallow (dice scales
    with Stockpile's own stack count -- needs "read another status's
    stacks", doesn't exist), Present (crit-branches between damage OR heal,
    no "at most" natural-roll threshold in this schema, only "at least"),
    Pollen Puff (branches on whether the target is an ally, no such branch
    exists), Cactus Bloom (a death-save/consumable-item combo), Maintenance
    (resource-limited + an object/structure alternate use), Radiant Hope
    (self-damage paired with the heal, needs a `damage` effect kind that
    doesn't exist), Harmony Breath (damages enemies AND heals allies off
    the same AoE roll), Floral Healing/Grassy Terrain (terrain-conditional
    doubling -- base heal would migrate fine but Grassy Terrain's is
    recurring-per-turn to begin with, a `field_terrain` gap already noted).
  - Status-cure-only moves (Aromatherapy, Heal Bell, Refresh, Scrub Down):
    restore no HP at all -- a different mechanic (removing OTHER
    participants' statuses programmatically) entirely, out of scope for a
    heal-amount pass; already reachable by hand via each status badge's own
    Remove button.

    python migrate_effects_v12.py            # dry run
    python migrate_effects_v12.py --apply
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from migrate_effects_v2 import tag_for
from migrate_effects_v3 import RETIRED_V3

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')


def rebuild_categories(cats, effects):
    # None of drain/heal_self/heal_target_or_aoe/damage are retired tags (see
    # migrate_effects_v3.py's RETIRED_V3) -- they're still meaningful move-
    # shape markers, so for 20 of these 21 moves the derived heal tag is
    # simply appended, same as migrate_effects_v10.py did for Attract, the
    # first move in the same position. Soul Drain is the exception: its old
    # `potential_disadvantage` flat tag IS retired (superseded by its own
    # two precise derived tags below), so this still needs the splice-or-
    # append logic v9/v11 use, not the plain-append-only version an earlier
    # draft of this script had (caught before it landed -- a stale broad
    # tag would've sat redundantly next to the precise ones it replaces).
    derived = []
    for e in effects:
        t = tag_for(e)
        if t not in derived:
            derived.append(t)
    out, placed = [], False
    for c in cats:
        if c in RETIRED_V3:
            if not placed:
                out.extend(derived)
                placed = True
            continue
        out.append(c)
    if not placed:
        out.extend(derived)
    return out


ALWAYS = {'type': 'always'}
ON_HIT = {'type': 'on_hit'}
SELF = 'self'
INSTANT = [{'type': 'instant'}]


def heal_dice(dice, move_mod=True):
    return {'kind': 'heal', 'amount': {'dice': dice, 'moveMod': move_mod}, 'when': ALWAYS, 'ends': INSTANT}


def heal_dice_self(dice, move_mod=True):
    e = heal_dice(dice, move_mod)
    e['target'] = SELF
    return e


def drain(fraction=0.5, when=ON_HIT, ability=None):
    when = {'type': 'save_fail', 'ability': ability} if ability else when
    return {'kind': 'heal', 'amount': {'fractionOfDamage': fraction}, 'when': when, 'target': SELF, 'ends': INSTANT}


OVERRIDES = {
    # -- self-only dice heals --
    'Heal Order': [heal_dice_self('4d4')],
    'Moonlight': [heal_dice_self('2d6')],
    'Morning Sun': [heal_dice_self('2d6')],
    'Synthesis': [heal_dice_self('2d8')],
    # Grounded/no-move side effects left manual -- see module docstring's own
    # "not applied yet" precedent for scaling/positioning text elsewhere.
    'Roost': [heal_dice_self('2d8')],
    # Sandstorm-doubled MOVE mod left manual -- base heal only.
    'Shore Up': [heal_dice_self('2d8')],

    # -- self OR ally dice heals (two independent effects, not a choice group) --
    'Recover': [heal_dice_self('1d6'), heal_dice('1d6')],
    'Milk Drink': [heal_dice_self('2d6'), heal_dice('2d6')],

    # -- ally-only dice heals (pickMultipleTargets excludes the caster already) --
    'Soft-Boiled': [heal_dice('2d6')],
    'Heal Pulse': [heal_dice('4d4')],
    'Dream Mend': [heal_dice('3d10')],

    # -- drain: half (or, Oblivion Wing, all) the damage this hit just dealt --
    'Absorb': [drain(0.5)],
    'Drain Punch': [drain(0.5)],
    'Draining Kiss': [drain(0.5)],
    'Dream Eater': [drain(0.5)],
    'Giga Drain': [drain(0.5)],
    'Horn Leech': [drain(0.5)],
    'Leech Life': [drain(0.5)],
    'Mega Drain': [drain(0.5)],
    'Oblivion Wing': [drain(1.0)],
    # trigger_saving_throw shaped, not an attack roll -- heal rides on the
    # same CHA save_fail as its damage and disadvantage grants, not on_hit.
    # The two disadvantage grants are the "for 1 minute" clause; 1 minute =
    # 10 rounds, same unit conversion every other timed status in this
    # schema uses.
    'Soul Drain': [
        drain(0.5, ability='CHA'),
        {'kind': 'roll', 'roll': 'disadvantage', 'on': 'attack_rolls',
         'when': {'type': 'save_fail', 'ability': 'CHA'}, 'ends': [{'type': 'rounds', 'n': 10}]},
        {'kind': 'roll', 'roll': 'disadvantage', 'on': 'saving_throws',
         'when': {'type': 'save_fail', 'ability': 'CHA'}, 'ends': [{'type': 'rounds', 'n': 10}]},
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

    print(f'{len(OVERRIDES)} moves getting effects')
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
