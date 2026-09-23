#!/usr/bin/env python3
"""Move migration, ninth slice: the remaining 7 reaction moves (migrate_effects_v9.py's
own module docstring named them as "next" once the reaction-window mechanism itself was
proven on Noble Roar/Sentinel Strike/Attract). Same two top-level fields as v9:
`reactionTrigger` ("targeted" | "damaged"), `reactionRange` (feet, 0 = self-only).

Six of the seven fit the two existing trigger families cleanly. One doesn't, and gets
no reaction metadata at all -- still fully usable, just not through the eligibility
system's proactive "you may react" popup (see routes_combat.py's own module docstring
on _open_reaction_window/_eligible_reactors):

  - Withdraw: "when subject to a melee or ranged attack" -- targeted, self only (range 0).
    AC +2 (the "+3 at level 10" scaling text is left unmodeled -- no migrated move has a
    level-gated amount yet, same as every other move with scaling text so far).
  - Baby-Doll Eyes: "when you OR AN ALLY IN RANGE are targeted" -- targeted, range 30ft
    (its own stated range). Two effects, same self + ally-via-picker split Celebrate
    uses below: one target:self (offered outright, no picker), one target-unset (offered
    through _handleEffectsOnly's multi-target picker) -- pickMultipleTargets itself
    excludes the caster (see its own docstring), so "protect myself" can only ever reach
    the human through the plain target:self effect, never the picker.
  - Hold Hands: "within melee range of an ally... when it's ATTACKING, +1 to its attack
    rolls, or when it's TARGETED, +1 to its AC" -- two mutually exclusive effects (choice:
    chosen, same "one pick between two options" grouping Bulk Up already uses), both
    target-unset (multi-target picker again). Only the "ally targeted" half fits an
    existing trigger family (targeted, range 5ft = melee) -- "ally about to attack" isn't
    a trigger this app tracks (would need a THIRD reaction family: "an ally is about to
    act", never built). That half stays reachable only through the plain manual React
    button (unaffected by any of this -- see combat-wip.js's .wip-react-btn), same as
    every reaction move worked before the eligibility system existed. Both effects are
    still fully structured either way; only the automatic prompt is one-sided.
  - Celebrate: "on a successful takedown of an opponent BY AN ALLY within 5ft of you" --
    the anchor event is the ALLY's own kill, not an attack against the reactor or their
    ally taking damage. Neither existing family fits at all, so this gets NO reaction
    metadata -- manual React only. Effects: advantage on the reactor's own next attack
    roll (target: self) and the same for whichever ally scored the kill (multi-target
    picker again).
  - Luminous Veil: "when you are the target of an attack... ALL creatures in [30ft]
    must make a WIS save, [failures get] disadvantage on attack rolls against you until
    the start of your next turn" -- targeted, self only (the 30ft is who's caught in the
    save, not who else can trigger the reaction). Same shape several other AoE saves
    already use (Bug Buzz, Snarl, Mud Bomb, ...): `roll disadvantage on attack_rolls`,
    target left unset so it lands on each creature that actually failed, not a blanket
    self status. "Roll a d10, on a 9-10 regain your reaction" has no reaction-economy
    counter to hook into (this app doesn't track reactions-used-per-round at all) --
    left as flavor, same as every other once-per-rest/resource mechanic this schema
    doesn't model yet.
  - Conversion 2: "after taking damage... change your type to one resistant or immune to
    [the attacking move's type]" -- damaged, self only. Fits the EXISTING `type_changed`
    condition perfectly (same mechanism Camouflage/Conversion/Reflect Type already use):
    swap to a chosen type and let the normal chart lookup do the rest, no new "guaranteed
    resistant/immune" mechanic needed -- picking correctly is on the human, same trust
    model as those three. `value` left unset -> effects-popup.js's type dropdown.
  - Skyward Soar: "before it rolls to hit... AC +10" -- targeted, self only. The "60ft in
    the air on a miss" (positioning) and "subsequent use needs a 15+" (an escalating
    resource cost) are both explicitly still-open schema gaps (see move-effects-schema.md's
    own "Not covered yet" list) -- left unmodeled, same as everywhere else that applies.

    python migrate_effects_v11.py            # dry run
    python migrate_effects_v11.py --apply
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
                out.extend(derived)
                placed = True
            continue
        out.append(c)
    if not placed:
        out.extend(derived)
    return out


ALWAYS = {'type': 'always'}
SELF = 'self'
USES1 = [{'type': 'uses', 'n': 1}]
CHOSEN = {'kind': 'chosen'}

# Move name -> {trigger, range} for the ones that fit an existing trigger family.
# Celebrate isn't here at all -- see module docstring.
REACTION_META = {
    'Withdraw': {'trigger': 'targeted', 'range': 0},
    'Baby-Doll Eyes': {'trigger': 'targeted', 'range': 30},
    'Hold Hands': {'trigger': 'targeted', 'range': 5},
    'Luminous Veil': {'trigger': 'targeted', 'range': 0},
    'Conversion 2': {'trigger': 'damaged', 'range': 0},
    'Skyward Soar': {'trigger': 'targeted', 'range': 0},
}

OVERRIDES = {
    'Withdraw': [
        {'kind': 'stat', 'stat': 'ac', 'amount': 2, 'when': ALWAYS, 'target': SELF, 'ends': USES1},
    ],
    # Self outright, ally through the multi-target picker -- matches "you or an
    # ally in range", same split Celebrate uses below.
    'Baby-Doll Eyes': [
        {'kind': 'roll', 'roll': 'disadvantage', 'on': 'attacks_against', 'when': ALWAYS, 'target': SELF, 'ends': USES1},
        {'kind': 'roll', 'roll': 'disadvantage', 'on': 'attacks_against', 'when': ALWAYS, 'ends': USES1},
    ],
    # Mutually exclusive per the move's own text ("...or..."), same choice:chosen
    # radio-pick grouping Bulk Up already uses for its attack-OR-AC pick. Both
    # target-unset -- the multi-target picker asks which ally this is for.
    'Hold Hands': [
        {'kind': 'stat', 'stat': 'attack_rolls', 'amount': 1, 'when': ALWAYS, 'ends': USES1, 'choice': CHOSEN},
        {'kind': 'stat', 'stat': 'ac', 'amount': 1, 'when': ALWAYS, 'ends': USES1, 'choice': CHOSEN},
    ],
    # No reactionTrigger (see module docstring) -- still fully structured, just
    # manual-React only. Self gets its own buff outright; the ally who scored the
    # takedown is picked through the same multi-target flow as Baby-Doll Eyes/Hold
    # Hands.
    'Celebrate': [
        {'kind': 'roll', 'roll': 'advantage', 'on': 'attack_rolls', 'when': ALWAYS, 'target': SELF, 'ends': USES1},
        {'kind': 'roll', 'roll': 'advantage', 'on': 'attack_rolls', 'when': ALWAYS, 'ends': USES1},
    ],
    # target left unset -- lands on whichever creature actually failed the save,
    # not a blanket status on the reactor. Same shape Bug Buzz/Snarl/Mud Bomb/etc.
    # already use for an AoE save's attack-roll disadvantage.
    'Luminous Veil': [
        {'kind': 'roll', 'roll': 'disadvantage', 'on': 'attack_rolls',
         'when': {'type': 'save_fail', 'ability': 'WIS'},
         'ends': [{'type': 'until_turn', 'whose': 'source', 'point': 'start'}]},
    ],
    # `value` unset -> effects-popup.js's type dropdown; the chart lookup does the
    # rest, same mechanism Camouflage/Conversion/Reflect Type already use.
    'Conversion 2': [
        {'kind': 'condition', 'apply': 'type_changed', 'when': ALWAYS, 'target': SELF, 'ends': [{'type': 'rounds', 'n': 10}]},
    ],
    'Skyward Soar': [
        {'kind': 'stat', 'stat': 'ac', 'amount': 10, 'when': ALWAYS, 'target': SELF, 'ends': USES1},
    ],
}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    moves = data['moves']
    by_name = {m['name']: m for m in moves}

    all_names = set(REACTION_META) | set(OVERRIDES)
    missing = [n for n in all_names if n not in by_name]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)
    already = [n for n in OVERRIDES if by_name.get(n, {}).get('effects')]
    if already:
        print('ERROR -- already have effects (would overwrite):', already)
        sys.exit(1)
    already_meta = [n for n in REACTION_META if by_name.get(n, {}).get('reactionTrigger')]
    if already_meta:
        print('ERROR -- already have reaction metadata (would overwrite):', already_meta)
        sys.exit(1)

    print(f'{len(all_names)} moves total -- {len(REACTION_META)} getting reaction metadata, {len(OVERRIDES)} getting effects')
    for name in sorted(all_names):
        meta = REACTION_META.get(name)
        meta_text = f'(trigger={meta["trigger"]}, range={meta["range"]}ft)' if meta else '(no reaction metadata -- manual React only)'
        print(f'## {name}  {meta_text}')
        for e in OVERRIDES.get(name, []):
            print('   ', json.dumps(e, ensure_ascii=False))

    if not apply_it:
        return
    for name in all_names:
        m = by_name[name]
        meta = REACTION_META.get(name)
        if meta:
            m['reactionTrigger'] = meta['trigger']
            m['reactionRange'] = meta['range']
        if name in OVERRIDES:
            m['effects'] = OVERRIDES[name]
            m['categories'] = rebuild_categories(m['categories'], OVERRIDES[name])
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
