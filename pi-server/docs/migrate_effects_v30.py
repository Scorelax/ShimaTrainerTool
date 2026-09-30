#!/usr/bin/env python3
"""Move migration, thirtieth slice: a careful re-read of the "fits the
schema already" bucket in unmigrated_moves.md (40 moves as of this pass,
down from the original ~91 after migrate_effects_v16/v17/v18/v19). The
category's own header text already warns most of these are "genuinely
blocked on something" despite the label -- that held up on a full re-read.
Of the 40, only THREE have a genuine, non-lossy fit today, and even those
are partial (each move keeps one clause this schema still can't express) --
same partial-implementation precedent as everywhere else in this effort.
No new mechanism, no new effect kind -- every entry below uses `stat`/
`roll`/`heal` exactly as they already exist.

  - **Artifact Light**: "add double your proficiency bonus to attack and
    damage rolls" (while an ancient artifact is in range and known to
    you -- a human-judged precondition, `when: 'special'`, same as Parry's
    own contested-roll gate) -- the ATTACK half is a clean fit: a normal
    roll already adds proficiency once, so one more `amount: 'proficiency'`
    stat effect on `attack_rolls` doubles it, the exact "add it again =
    double it" reasoning migrate_effects_v3.py's own module docstring
    already used for a different move. The DAMAGE half has no live
    consumer at all -- `damage_rolls` is listed in the schema doc's own
    `stat` vocabulary but nothing in move-effects.js ever reads it (checked
    directly: zero matches across js/). Left as a documented gap, not
    silently dropped.
  - **Omen Sense**: "For one round, opponents have disadvantage on attack
    rolls against you" is a clean self-targeted `roll` effect. The other
    half -- a reactive retaliation attack, resolved simultaneously even if
    the retaliator faints from the triggering hit -- needs a full
    reaction-triggered counter-ATTACK flow (not just eligibility+block,
    which is all the reaction system does today); left unmodeled, same
    "reactive-attack shapes" exclusion named in migrate_effects_v16.py's
    own docstring.
  - **Radiant Hope**: heals every ally in range (existing `heal` kind,
    multi-target via the ally picker, identical shape to Soothing Breeze)
    AND grants each of them advantage on their next attack roll (existing
    `roll: advantage` + `ends: uses:1`, identical shape to Sweet Scent).
    Both effects fit cleanly. The self-recoil clause ("damaging the user
    by the same amount it heals others") has no mechanism -- no heal
    effect can currently inflict damage on its own caster equal to the
    amount healed; left unmodeled.

Explicitly NOT migrated in this pass, with the specific reason each is
blocked (grouped by shared blocker, since several recur -- worth knowing if
any of these becomes its own future slice):

  - **Speed as a flat/multiplicative buff** (Agility +20ft, Autotomize
    +10ft stacking, Kinesis +20ft, Flame Charge +5ft per hit up to +30,
    Surface Glide double speed in water, Tailwind double speed for self+
    allies): `speed` is listed in the schema's own `stat` vocabulary but
    has NEVER been implemented anywhere -- statDeltas/effectiveStats don't
    handle it, and the real movement budget built for the status-conditions
    work (conditions.py's effective_speed_multiplier, `speeds`/
    `movementUsed` in routes_combat.py) reads the participant's raw stored
    `speeds` array directly, with no buffed/live-delta layer on top of it
    yet. A flat add (Agility/Autotomize/Kinesis/Flame Charge) and a
    multiplier (Surface Glide/Tailwind) are two different shapes on top of
    that, neither built.
  - **STAB doubling** (Calm Mind, Tail Glow): `increase_stab` is a
    long-standing tag with no backing mechanism anywhere -- STAB bonus is
    computed inline wherever damage is calculated, not stored as a
    modifiable stat field.
  - **"Guaranteed hit" as a grantable, held status** (Lock-On, Mind Reader,
    Thunderstorm Dance): the only existing precedent is Laser Focus's
    `guaranteed_next_crit`, a standalone flag wired directly into
    target-picker.js's own hit/crit resolution -- a "guaranteed HIT" sibling
    would need the identical kind of UI wiring (skip the AC comparison
    entirely), not just new data. A real candidate for its own small slice
    later, given how closely it mirrors something that already works.
  - **Ability/target-specific roll scoping** (Nasty Plot -- advantage only
    on WIS-power attacks; Study -- advantage only vs one specific chosen
    target): the existing `roll`/`stat` vocabulary scopes `saving_throws`
    by ability already (the `ability` field added in migrate_effects_v17.py)
    but attack_rolls has no equivalent narrowing at all.
  - **Damage reduction on defense** (Aurora Veil -- halve damage taken while
    hailing; Harden -- reduce damage taken by 1d4+MOVE): no stat field or
    mechanism represents "reduce incoming damage" anywhere in this schema.
  - **VP-cost modifiers** (Spirit Growth -- half VP for WIS-power moves):
    named as a standing gap since the schema doc's very first "Not covered
    yet" pass.
  - **"Choose which stat"** (Power Trick -- swap AC with a chosen score;
    Power Split -- replace a chosen score with an average): explicitly
    already flagged in move-effects-schema.md as needing a "one choice, two
    paired effects" extension that doesn't exist; not re-litigated here.
  - **Steal/negate an existing effect** (Aura Theft -- steal all beneficial
    effects and take one for yourself; Ink Veil -- intercept an incoming
    status and convert it into a heal instead; Topsy-Turvy -- invert every
    active stat change on a target; Miracle Eye/Odor Sleuth -- strip an
    existing type immunity, the reverse of the only immunity mechanism this
    schema has, which only ever GRANTS): each is a genuinely different
    "reach into and rewrite another status/set of statuses" mechanic, no
    shared mechanism between them worth building as one slice.
  - **Reactive/retaliatory damage** (Fire Shield -- damages a melee
    attacker automatically; Wing Buffer -- a reactive DEX save that, on a
    success, halves an already-landed hit): Wing Buffer in particular is
    architecturally close to the existing `reroll_damage` retroactive
    correction (a new effect halving instead of rerolling) and is a
    plausible small future addition; Fire Shield's automatic-retaliation-
    on-any-melee-hit has no reaction-trigger family that fits (it isn't
    the attacker reacting, it isn't a chosen reaction at all).
  - **Tracked/conditional amounts with no tracking mechanism** (Blood
    Shield -- shield equal to melee damage dealt since last turn, no
    running tally exists; Fell Stinger -- doubled modifier only if THIS
    attack faints the target, no "did this hit just faint them" condition
    exists; Imperial Guard/Power-Up Punch -- stacking bonuses tied to
    repeated triggers this schema has no resource system for).
  - **Field/terrain AoE-over-time** (Grassy Terrain, Psychic Terrain,
    Purgatory's stat-removal half): heal-over-time and turn-boundary
    damage both exist, but only as a STATUS on an individual participant --
    there's no "anyone standing in this map area, tracked live" concept at
    all. Purgatory's own primary effect (VP damage) is blocked on something
    even more fundamental first -- there is no VP-damage-application
    mechanism anywhere yet (a standing gap named since Enervation Ray/
    Energize/Spite/Grudge were first scoped).
  - **Everything else** (Divine Noodle Form's fractional-max-HP temp-HP
    shape and reach increase, Feather Dance/Miracle Eye's AC-reset-to-base,
    Foresight's ignore-immunity, Odor Sleuth's move-category-use
    restriction, Wing Command's combined dice+ability-modifier amount,
    Silent Approach's skill-check advantage -- no skill-check roll exists
    in this app at all, same limitation as every ability-check case
    already documented elsewhere): each needs its own small novel piece,
    no two share a mechanism worth grouping.

    python migrate_effects_v30.py            # dry run
    python migrate_effects_v30.py --apply
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


SPECIAL = {'type': 'special'}
ALWAYS = {'type': 'always'}
SELF = 'self'
ROUNDS1 = [{'type': 'rounds', 'n': 1}]
USES1 = [{'type': 'uses', 'n': 1}]
INSTANT = [{'type': 'instant'}]
CONC = [{'type': 'concentration'}]  # "1 minute, concentration" durations -- ends when concentration breaks, not a flat round count

OVERRIDES = {
    'Artifact Light': [
        {
            'kind': 'stat', 'stat': 'attack_rolls', 'amount': 'proficiency',
            'target': SELF, 'when': SPECIAL, 'ends': CONC,
            'note': "Only while an ancient artifact is in range and known to you -- a human judgment call, same as Parry's contested-roll gate. Also doubles damage rolls per its own text, but this schema has no live damage_rolls consumer yet (listed in the vocab, never wired up) -- not applied.",
        },
    ],
    'Omen Sense': [
        {
            'kind': 'roll', 'roll': 'disadvantage', 'on': 'attacks_against',
            'target': SELF, 'when': ALWAYS, 'ends': ROUNDS1,
            'note': 'Its own reactive retaliation-on-being-hit clause needs a full reaction-triggered counter-attack flow this schema doesn\'t have yet -- not modeled.',
        },
    ],
    'Radiant Hope': [
        {'kind': 'heal', 'amount': {'dice': '4d12', 'moveMod': True}, 'when': ALWAYS, 'ends': INSTANT},
        {
            'kind': 'roll', 'roll': 'advantage', 'on': 'attack_rolls', 'when': ALWAYS, 'ends': USES1,
            'note': "The move's own self-recoil (damaging the user by the same amount it heals others) has no mechanism -- not modeled.",
        },
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
        print(f'## {name}  ({len(effects)} effect(s))')
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
