#!/usr/bin/env python3
"""Regenerates unmigrated_moves.md from DnD_moves_categorized_draft.json --
committed as a real script rather than the ad-hoc python one-liner this got
rebuilt from by hand after nearly every migration script since v9 (drifting
slightly each time, and easy to lose a classification fix -- see
`NEEDS_NEW_TAGS`'s own note on `conditional_damage`/`potential_damage_increase`
below, found and fixed only once this became worth writing down properly).

Four buckets, in priority order:
  1. `fits_now` -- carries a RETIRED_V3 flat tag (a leftover from the original
     pre-effects auto-categorizer) and has no `effects` yet. The exact shape
     every reaction-move and stat/roll/condition slice this whole effort has
     done started from.
  2. `needs_new` -- carries one of NEEDS_NEW_TAGS and has no `effects` yet:
     a real secondary consequence (heal, condition, buff/debuff, blocking...)
     this schema either can't express yet, or can but hasn't been migrated.
  3. `unknown_only` -- never got a category from the auto-categorizer at all.
  4. `fine_as_is` -- everything else with no `effects`: plain damage / save-
     for-damage / multi-hit / recharge moves (NO_EFFECT_NEEDED_TAGS) that
     correctly need none. NOT a backlog.

    python generate_unmigrated_moves.py
"""
import json
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')
OUT = Path(__file__).with_name('unmigrated_moves.md')

RETIRED_V3 = {
    'stat_buff_self', 'stat_buff_ally', 'stat_debuff_enemy', 'stat_debuff_self',
    'advantage_on_attack_roll', 'potential_disadvantage', 'crit_range_mod',
    'boosted_attack_rolls', 'boosted_damage_rolls', 'advantage_on_saving_throws',
    'potential_stat_increase', 'increase_stab',
}

# `conditional_damage` WAS here (in NO_EFFECT_NEEDED_TAGS) on the reasoning
# that it's just a damage FORMULA variation (target/self HP%, a visible
# status, a stat comparison, VP spent) the human already computes
# themselves when entering their damage roll -- corrected by the user: the
# point was never the arithmetic, it's that the app should still REMIND the
# player what to roll (easy to forget mid-battle), which is exactly what
# `damage_note` does (see migrate_effects_v22/v23/v24.py and earlier -- 17
# of 32 moves done that way already). Moved into NEEDS_NEW_TAGS below so
# the remaining 15 keep surfacing here instead of silently reading as
# "nothing to do" -- this exact silent-disappearance is what caught the
# original conditional_damage mistake hiding in the first place, so
# `potential_damage_increase` below is left unmoved until it's actually
# been read move-by-move, not moved on a guess.
NEEDS_NEW_TAGS = {
    'steal_disrupt', 'protect_negate', 'heal_target_or_aoe',
    'heal_self', 'drain', 'positioning', 'field_terrain', 'field_weather',
    'attack_suppression', 'movement', 'remove_item_on_target', 'lethal_faint',
    'potential_damage_increase', 'shield_temphp', 'conditional_damage',
}
NO_EFFECT_NEEDED_TAGS = {
    'damage', 'recharge_locked', 'multi_hit_aoe', 'multi_hit_same_target',
    'multi_hit_choice', 'multi_hit_combined_roll', 'guaranteed_hit',
    'variable_move_type', 'base_crit', 'fixed_special_damage', 'situational_use',
    'berry_check', 'trigger_saving_throw', 'counter_reaction_effect', 'damage_vp',
    'self_faint',
}

TAG_NOTES = {
    'steal_disrupt': 'steals or disrupts an item/ability/stat the target has',
    'protect_negate': 'blocks/negates an incoming effect (Protect-family) -- core mechanisms now exist (block_attack, prevent_faint), see move-effects-schema.md',
    'heal_target_or_aoe': "heals someone other than (or in addition to) the user",
    'drain': "heals the user for a portion of damage dealt",
    'heal_self': 'heals the user',
    'conditional_damage': 'damage that scales on a condition -- 17 of 32 already have a damage_note reminder (see migrate_effects_v22/v23/v24.py and earlier), these are the rest',
    'potential_damage_increase': 'damage that scales on a condition -- not yet read move-by-move (conditional_damage turned out to need a damage_note reminder for most of its moves; this might be the same, unverified)',
    'positioning': 'forces or requires specific battlefield positioning',
    'field_terrain': 'sets/uses a terrain effect',
    'movement': 'forced or granted movement',
    'attack_suppression': 'stops the target from attacking',
    'lethal_faint': 'special behavior when the move would faint the target',
    'remove_item_on_target': "removes/destroys the target's held item",
    'field_weather': 'sets/uses a weather effect',
    'shield_temphp': 'a damage-absorbing shield (temp_hp kind exists -- none currently need it, kept for completeness)',
}

# Moves that are DONE but will never carry an `effects` array -- implemented
# entirely as bespoke code instead of the generic schema (same reasoning as
# Ingrain/Swallow's own name-matched special-casing, just with nothing
# generic left over to also record here). Excluded up front so classify()
# never has to reason about them, and so they can't silently reappear as
# "needs work" the way conditional_damage itself just did.
HANDLED_OUTSIDE_SCHEMA = {
    'Bide',  # two-phase damage-taken-then-retaliate -- see combat.js's _handleBideClick /
             # combat-wip.js's _handleBideResolve / routes_combat.py's _bide_use.
    'Swallow',  # heal dice x Stockpile stacks -- combat.js's _isDirectHeal branch, was already
                # done before this comment even mentioned it, just never added here.
    'Spit Up',  # damage dice x Stockpile stacks -- combat.js's own sibling branch to Swallow's.
    'Formation Strike',  # damage dice x a per-use player-typed formation size (showCombatPrompt) --
                          # nothing else in this app can know that number.
    'Archive Blast',  # damage dice x distinct move types witnessed since the user joined (the
                       # shared log, combat-wip.js's _witnessedMoveTypesSince) -- WIP-only, same
                       # limitation as Bide.
}


def classify(moves):
    no_effects = [m for m in moves if not m.get('effects') and m['name'] not in HANDLED_OUTSIDE_SCHEMA]
    fits_now, needs_new, unknown_only, fine_as_is = [], [], [], []
    for m in no_effects:
        cats = set(m.get('categories', []))
        if cats & RETIRED_V3:
            fits_now.append(m)
        elif cats & NEEDS_NEW_TAGS:
            needs_new.append(m)
        elif cats == {'unknown'} or (cats - NO_EFFECT_NEEDED_TAGS) == {'unknown'}:
            unknown_only.append(m)
        else:
            fine_as_is.append(m)
    return no_effects, fits_now, needs_new, unknown_only, fine_as_is


def main():
    data = json.loads(FILE.read_text(encoding='utf-8'))
    moves = data['moves']
    no_effects, fits_now, needs_new, unknown_only, fine_as_is = classify(moves)

    lines = ['# Moves still without structured `effects`\n']
    lines.append(
        f'_Generated by generate_unmigrated_moves.py against DnD_moves_categorized_draft.json -- '
        f'{len(moves)} moves total, {len(no_effects)} with no `effects` array yet.\n'
        'See move-effects-schema.md for the schema itself and its own "Not covered yet" section '
        'for the gap-by-gap reasoning._\n'
    )

    lines.append(f'\n## 1. Fits the schema already, just not migrated yet ({len(fits_now)})\n')
    lines.append(
        "What remains here is genuinely blocked on something -- movement speed (deferred), a "
        '"guaranteed hit" grantable status (needs a real target-picker.js UI change, not just '
        'data), ability/target-specific roll scoping beyond saving throws, VP-cost modifiers, '
        '"choose which stat", resource/stacking links to other moves, reactive-attack shapes, or '
        'an outright novel mechanic. See migrate_effects_v16/v17/v18.py\'s own module docstrings '
        'for the full reasoning already worked out per move.\n'
    )
    for m in sorted(fits_now, key=lambda m: m['name']):
        cats = ', '.join(c for c in m['categories'] if c in RETIRED_V3)
        lines.append(f"- **{m['name']}** ({cats}) -- {m['description'][:140]}")

    lines.append(f'\n## 2. Needs a new effect kind / mechanism ({len(needs_new)})\n')
    by_tag = {}
    for m in needs_new:
        for t in set(m.get('categories', [])) & NEEDS_NEW_TAGS:
            by_tag.setdefault(t, []).append(m)
    for tag in sorted(by_tag, key=lambda t: -len(by_tag[t])):
        group = by_tag[tag]
        lines.append(f"\n### {tag} ({len(group)}) -- {TAG_NOTES.get(tag, '')}")
        for m in sorted(group, key=lambda m: m['name']):
            lines.append(f"- {m['name']}")

    lines.append(f'\n## 3. "unknown" category, needs manual review before anything else ({len(unknown_only)})\n')
    for m in sorted(unknown_only, key=lambda m: m['name']):
        lines.append(f"- **{m['name']}** -- {m['description'][:140]}")

    lines.append(f'\n## 4. Pure mechanical shape -- correctly has no `effects`, nothing to do ({len(fine_as_is)})\n')
    lines.append(
        'Plain damage / save-for-damage / multi-hit / recharge / conditional-damage-formula moves '
        'with no secondary effect to encode -- the damage math itself is always the human\'s own '
        '(no digital dice, no "damage formula" effect kind anywhere in this schema, on purpose). '
        'Listed only so this file accounts for all remaining moves -- not a backlog.\n'
    )

    OUT.write_text('\n'.join(lines), encoding='utf-8')
    print(f'written {OUT.name} -- no_effects={len(no_effects)} fits_now={len(fits_now)} '
          f'needs_new={len(needs_new)} unknown={len(unknown_only)} fine={len(fine_as_is)}')


if __name__ == '__main__':
    main()
