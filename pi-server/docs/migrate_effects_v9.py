#!/usr/bin/env python3
"""Move migration, seventh slice: reaction-triggered effects, phase 1 -- the
three moves chosen to prove the new reaction-window system end to end (see
move-effects-schema.md's reaction section, routes_combat.py's own module
docstring on _open_reaction_window/_eligible_reactors) before migrating the
other 7. Two new TOP-LEVEL fields (not inside `effects` -- these say WHEN the
move can be OFFERED as a reaction at all, not what it does once used):
`reactionTrigger`: "targeted" | "damaged", `reactionRange`: feet (0 = only
ever protects its own user; a real range lets someone ELSE within it react
on another participant's behalf, e.g. Sentinel Strike).

Noble Roar and Sentinel Strike fit the existing effects schema cleanly --
plain advantage/disadvantage grants, same as anything else migrated this
session. Attract does NOT -- "force the attacker to reroll their damage and
take the lower result" is a genuinely new effect shape (reroll-and-take-
lower) that doesn't exist yet, so it ships with reactionTrigger/reactionRange
only (the window itself correctly opens and lets someone grab the floor to
react) but no `effects` -- same partial-implementation precedent as Acid
Armor/Elemental Surge earlier this session. Sentinel Strike's own damage-
redirect ("take the hit instead of your ally") is likewise left to the table
-- the attacker simply re-targets the protector once told about it, no new
mechanic needed for that half; only its "next attack has advantage" clause
is structured.

    python migrate_effects_v9.py            # dry run
    python migrate_effects_v9.py --apply
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

REACTION_META = {
    # reactionRange 0 -- only ever protects the reactor themselves.
    'Noble Roar': {'trigger': 'targeted', 'range': 0},
    # 5ft -- adjacent, per its own description ("an ally adjacent to you").
    'Sentinel Strike': {'trigger': 'targeted', 'range': 5},
    'Attract': {'trigger': 'damaged', 'range': 0},
}

OVERRIDES = {
    # "impose disadvantage on the attack roll" once targeted -- consumed the
    # instant that one attack roll is confirmed, same USES1 pattern every
    # other "next roll" effect in this schema already uses.
    'Noble Roar': [
        {'kind': 'roll', 'roll': 'disadvantage', 'on': 'attacks_against', 'when': ALWAYS, 'target': SELF, 'ends': USES1},
    ],
    # "your next attack against that target has advantage" -- the redirect
    # itself (taking the hit instead of the ally) is a table call, not
    # something this effect needs to encode.
    'Sentinel Strike': [
        {'kind': 'roll', 'roll': 'advantage', 'on': 'attack_rolls', 'when': ALWAYS, 'target': SELF, 'ends': USES1},
    ],
    # No effects -- see module docstring. reactionTrigger/reactionRange alone
    # still make it a real, selectable reaction opportunity.
}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    moves = data['moves']
    by_name = {m['name']: m for m in moves}

    missing = [n for n in REACTION_META if n not in by_name]
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

    print(f'{len(REACTION_META)} moves getting reaction metadata, {len(OVERRIDES)} also getting effects')
    for name, meta in REACTION_META.items():
        effects = OVERRIDES.get(name, [])
        print(f'## {name}  (trigger={meta["trigger"]}, range={meta["range"]}ft)')
        for e in effects:
            print('   ', json.dumps(e, ensure_ascii=False))

    if not apply_it:
        return
    for name, meta in REACTION_META.items():
        m = by_name[name]
        m['reactionTrigger'] = meta['trigger']
        m['reactionRange'] = meta['range']
        if name in OVERRIDES:
            m['effects'] = OVERRIDES[name]
            m['categories'] = rebuild_categories(m['categories'], OVERRIDES[name])
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
