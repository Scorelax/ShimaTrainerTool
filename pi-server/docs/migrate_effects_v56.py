#!/usr/bin/env python3
"""Move migration, fifty-sixth slice: `drain` (4 moves) -- heals the user
for a portion of damage dealt, same family Absorb/Drain Punch/Parabolic
Charge/Soul Drain/Tera Drain already cover, EXCEPT all four of these drain
VP instead of HP:

- **Energize** (bonus action, recharge, 15ft radius CON save, "losing 2d8
  VP on a failure... Regain half of the total amount of VP drained") and
  **Enervation Ray** (single target CON save, "the user regains half of the
  damage dealt as VP") need NOTHING new in the `effects` vocabulary at all
  -- a plain `heal` effect with the EXISTING `pool:"VP"` field (already
  built, just never exercised by a `fractionOfDamage` amount before -- see
  Recompose's own flat-dice VP heal) does the drain-back half exactly like
  Parabolic Charge/Soul Drain/Tera Drain already do for HP. The one REAL
  gap was upstream of `effects` entirely: `ctx.damageDealt` (what
  `fractionOfDamage` reads) is only ever populated from
  `CombatAPI.applyDamage`'s own result, which always wrote to `currentHP` --
  there was no way for either move's own PRIMARY damage to land on VP in
  the first place. Fixed at the one spot that actually does the writing,
  `routes_combat.py`'s `_apply_damage_to_target`, now taking a `pool`
  param: keeps the SAME type-effectiveness multiplier (both moves' own text
  still names a damage type), but skips the HP-specific shields nothing in
  this dataset gives VP an equivalent of (temp HP absorption, Mat Block/
  Testudo Formation's standing reduction) and writes to `currentVP`
  instead. Threaded through via the already-existing `damage_vp` hand
  category (untouched by any derived-tag rebuild, since no effect `kind`
  produces it) -- a new client-side `_applyPrimaryDamage` (combat-wip.js)
  wraps `CombatAPI.applyDamage` with this one tag check, dropped into the
  two EXISTING save-triggered damage call sites (`_handleSaveTriggered`,
  `_handleMultiHitAoe`'s own loop) so both moves -- and any future
  `damage_vp` move using either flow (Purgatory) -- get VP-pool support for
  free, no per-move special-casing.

- **Grudge** (reaction: "when a move reduces you to zero HP, force the
  attacker to WIS save... on a fail, it loses 3d10 VP, and [the first time
  this encounter] you regain it as HP") and **Spite** (reaction: "when hit,
  force the attacker to WIS save... on a fail, it loses the VP it SPENT on
  the move, and you gain an equal amount") share Encore/Torment's own real
  structural gap from `attack_suppression`: the effect's own "target" is the
  ORIGINAL ATTACKER, a third party relative to the reactor, auto-resolved
  from the still-live `session.pendingReaction` the same way
  (`_handleEffectsOnly`'s own pendingReaction-anchored auto-targeting,
  already built, needed no changes). New `kind:"drain_attacker_vp"`,
  `when:"special"` (Grudge's own extra "only if this reduced YOU to zero
  HP" gate has to run BEFORE any save is even offered -- no `when`
  vocabulary covers that, so the whole flow is self-contained in one new
  handler, `_handleDrainAttackerVp`, same shape as `_handlePreventFaint`/
  `_handleStealBuff`). Two different amount sources needed:
  - Grudge's own flat "3d10 VP" is a genuinely un-rollable-elsewhere amount
    (no digital dice anywhere in this app) -- a new `promptDrainRoll`
    (heal-popup.js, generalized this pass into a shared `_promptRoll` core
    alongside the existing `promptHealRoll`, same "type in what you
    rolled" pattern, just worded for a drain instead of a heal).
  - Spite's own "whatever VP the attacking move actually cost" needs no
    roll at all -- that figure was already deducted and logged
    (`_apply_move`'s own `vpCost` on every 'move-used' entry). A new
    `_vpCostOfMoveUsed` log-scan (same backward-walk convention as
    `_lastMoveUsedBy`) reads it straight off the shared log instead.
  Grudge's own escalating "subsequent uses this encounter need a DC15 d20
  roll for the healing to land" stays manual -- same precedent as the whole
  Protect family's own escalating cost.

**Bugfix, same pass**: Encore and Torment (`attack_suppression`,
`migrate_effects_v55.py`) shipped with real `effects` but no top-level
`reactionTrigger`/`reactionRange` fields -- `_eligible_reactors`
(`routes_combat.py`) gates purely on `m.get('reactionTrigger') == trigger`,
so without it NEITHER move could ever actually open as a reaction; the
whole mechanism built for them was unreachable. v55's own OVERRIDES simply
never set it (every earlier reaction-move pass -- v46, v47 -- DID, via a
sibling `fields` key next to `effects`, so this was a plain oversight, not
a gap in the mechanism). Fixed here via a fields-only patch (their
`effects` are untouched) rather than silently left for a future pass.

    python migrate_effects_v56.py            # dry run
    python migrate_effects_v56.py --apply
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
    'Energize': {
        'effects': [
            {
                'kind': 'heal', 'amount': {'fractionOfDamage': 0.5, 'pool': 'VP'}, 'when': ALWAYS,
                'target': 'self', 'ends': INSTANT,
                'note': 'Same AoE-drain-back shape as Parabolic Charge/Tera Drain, just VP instead of HP.',
            },
        ],
    },
    '5. Enervation Ray': {
        'effects': [
            {
                'kind': 'heal', 'amount': {'fractionOfDamage': 0.5, 'pool': 'VP'}, 'when': {'type': 'save_fail', 'ability': 'CON'},
                'target': 'self', 'ends': INSTANT,
                'note': 'Same single-target drain-back shape as Soul Drain, just VP instead of HP.',
            },
        ],
    },
    'Grudge': {
        'fields': {'reactionTrigger': 'damaged', 'reactionRange': 50},
        'effects': [
            {
                'kind': 'drain_attacker_vp', 'when': SPECIAL, 'ends': INSTANT,
                'dice': '3d10', 'healPool': 'HP', 'healFraction': 1.0, 'requireZeroHp': True,
                'note': 'Only if this hit reduced you to 0 HP, and only after confirming the attacker\'s WIS save actually fails. Subsequent uses this encounter need a manual DC15 d20 roll for the healing to land.',
            },
        ],
    },
    'Spite': {
        'fields': {'reactionTrigger': 'damaged', 'reactionRange': 30},
        'effects': [
            {
                'kind': 'drain_attacker_vp', 'when': SPECIAL, 'ends': INSTANT,
                'vpCostFromLog': True, 'healPool': 'VP', 'healFraction': 1.0,
                'note': "Drains exactly what the attacker's own move cost in VP, read off the shared log -- only after confirming its WIS save actually fails.",
            },
        ],
    },
}

# Fields-only -- Encore/Torment already have correct `effects` from v55,
# this only patches the reactionTrigger/reactionRange bug described above.
FIELDS_ONLY_FIXES = {
    'Encore': {'reactionTrigger': 'targeted', 'reactionRange': 100},
    'Torment': {'reactionTrigger': 'damaged', 'reactionRange': 30},
}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    moves = data['moves']
    by_name = {m['name']: m for m in moves}

    missing = [n for n in OVERRIDES if n not in by_name]
    missing += [n for n in FIELDS_ONLY_FIXES if n not in by_name]
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

    print(f'\n{len(FIELDS_ONLY_FIXES)} moves getting a fields-only bugfix (effects untouched)')
    for name, fields in FIELDS_ONLY_FIXES.items():
        current = {k: by_name[name].get(k) for k in fields}
        print(f'## {name}  {current} -> {fields}')

    if not apply_it:
        return
    for name, spec in OVERRIDES.items():
        m = by_name[name]
        effects = spec['effects']
        m['effects'] = effects
        m['categories'] = rebuild_categories(m['categories'], effects)
        m.update(spec.get('fields', {}))
    for name, fields in FIELDS_ONLY_FIXES.items():
        by_name[name].update(fields)
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
