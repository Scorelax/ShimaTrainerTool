#!/usr/bin/env python3
"""Move migration, eleventh slice: everything left in migrate_effects_v12.py's
own "not in this batch" list that a genuinely reusable new mechanism unlocks
-- three additions to the `heal` kind (all in move-effects-schema.md's own
section):
  - `repeat` ("end_of_turn" | "start_of_turn") -- heal-over-time. The heal
    becomes a REAL stored status (mirrors the existing repeat-SAVE machinery,
    pendingTurnSaves/_promptTurnSaves, at the exact same two turn-boundary
    hooks) that re-triggers its own amount every time the HOLDER's own turn
    reaches that point, until its own `ends` removes it.
  - `amount.pool` ("HP", the default, or "VP") -- which resource a heal
    updates. Recompose is the one move here that needs it.
  - `amount.levelMultiple` -- a third no-roll amount shape (alongside the
    existing `dice` and `fractionOfDamage`), straight from the caster's own
    level. Aqua Ring's "regain HP equal to your level".
  - AoE-summed drain: _handleMultiHitAoe now sums damageDealt across every
    target a save-triggered blast actually damaged, and offers a self-only
    fractionOfDamage heal ONCE after its whole loop instead of per target --
    Parabolic Charge/Tera Drain heal off the AoE's total, not one target's
    own share. `capMultipleOfLevel` (Parabolic Charge's own "no more than
    5x level") clamps the result.

8 moves this slice:
  - Aqua Ring, Ingrain: heal-over-time, self-only. Aqua Ring ends on losing
    concentration (as its own text says); Ingrain ends after 3 rounds (~3 of
    the holder's own turns in this app's turn-order model, matching its
    "next three turns including this one" -- see the schema doc's own note
    on `repeat` always being HOLDER-anchored). Ingrain's own "can't move" and
    Aqua Ring's own upkeep are already just concentration/duration text, no
    new mechanic needed for those; the "can't move" restriction itself is
    left manual, same positioning-gap precedent as everywhere else.
  - Soothing Breeze, Maintenance, Floral Healing: plain ally-or-allies heals
    -- target left unset, same _handleEffectsOnly multi-target picker as
    Milk Drink's own ally half, which already supports picking SEVERAL
    targets at once ("all allies" is just "select more than one", no new AoE
    heal shape needed). Floral Healing's grassy-terrain MOVE-mod doubling is
    left manual (base heal only), same precedent as Shore Up's Sandstorm
    doubling. Maintenance's object/structure alternate use is left manual
    too -- only its creature-heal half is modeled.
  - Parabolic Charge, Tera Drain: AoE-summed drain (see above).
  - Recompose: a VP heal (`amount.pool: "VP"`), otherwise a plain self dice
    heal like any other. Its own "no enemies within melee range" situational
    gate is left manual, same precedent as every other situational-use move.

None of these five/eight also needed anything for `recharge_locked` --
that's a real, separately-built mechanic already (see this repo's own
recent "persist recharge-locked moves" work), unrelated to what a move's
own effects say once it's actually used.

NOT in this batch -- see move-effects-schema.md's own updated "Not covered
yet" note for the full per-move reasoning (Wish, Enervation Ray, Energize,
Spite, Grudge, Purify, Strength Sap, Present, Pollen Puff, Harmony Breath,
Swallow, Aromatherapy, Heal Bell, Refresh, Scrub Down).

    python migrate_effects_v13.py            # dry run
    python migrate_effects_v13.py --apply
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from migrate_effects_v2 import tag_for
from migrate_effects_v3 import RETIRED_V3

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')


def rebuild_categories(cats, effects):
    # Same splice-into-RETIRED_V3-or-append logic as migrate_effects_v9/v11
    # (and v12, after its own draft-stage fix for Soul Drain) -- none of
    # heal_self/heal_target_or_aoe/damage/drain/recharge_locked/
    # multi_hit_aoe/trigger_saving_throw are retired tags for any of these 8
    # moves, so in practice every one just appends, but reusing the combined
    # version keeps this script correct if that ever stops being true.
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
SELF = 'self'
INSTANT = [{'type': 'instant'}]


def heal_dice_self(dice, move_mod=True, pool=None):
    amount = {'dice': dice, 'moveMod': move_mod}
    if pool:
        amount['pool'] = pool
    return {'kind': 'heal', 'amount': amount, 'when': ALWAYS, 'target': SELF, 'ends': INSTANT}


def heal_dice_ally(dice, move_mod=True):
    return {'kind': 'heal', 'amount': {'dice': dice, 'moveMod': move_mod}, 'when': ALWAYS, 'ends': INSTANT}


def drain_self(fraction, cap_multiple_of_level=None):
    amount = {'fractionOfDamage': fraction}
    if cap_multiple_of_level:
        amount['capMultipleOfLevel'] = cap_multiple_of_level
    return {'kind': 'heal', 'amount': amount, 'when': ALWAYS, 'target': SELF, 'ends': INSTANT}


OVERRIDES = {
    'Aqua Ring': [
        {'kind': 'heal', 'amount': {'levelMultiple': 1}, 'when': ALWAYS, 'target': SELF,
         'repeat': 'end_of_turn', 'ends': [{'type': 'concentration'}]},
    ],
    'Ingrain': [
        {'kind': 'heal', 'amount': {'dice': '1d10', 'moveMod': True}, 'when': ALWAYS, 'target': SELF,
         'repeat': 'end_of_turn', 'ends': [{'type': 'rounds', 'n': 3}]},
    ],
    'Soothing Breeze': [heal_dice_ally('3d10')],
    'Maintenance': [heal_dice_ally('3d10')],
    'Floral Healing': [heal_dice_ally('2d8')],
    'Parabolic Charge': [drain_self(0.5, cap_multiple_of_level=5)],
    'Tera Drain': [drain_self(0.5)],
    'Recompose': [heal_dice_self('2d4', pool='VP')],
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
