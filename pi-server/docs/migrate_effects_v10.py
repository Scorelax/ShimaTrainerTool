#!/usr/bin/env python3
"""Move migration, eighth slice: Attract's own reroll-and-take-lower effect --
the one move migrate_effects_v9.py deliberately left without `effects` (see
its own module docstring) because the shape didn't exist yet. Adds it now:

New effect kind `reroll_damage` (move-effects-schema.md's own section covers
it): "the participant who just failed this save must reroll the damage they
dealt and take the lower result" -- a one-shot correction against an
ALREADY-APPLIED damage log entry, never a stored status (no `ends` beyond the
`instant` marker, same vocabulary entry `forced_movement` already uses for
"announced only, never stored"). combat-wip.js's `_offerMoveEffects` special-
cases this kind instead of routing it through apply-status: it looks up the
attacker's most recent damage entry against the reactor, prompts a new roll
(utils/reroll-damage-popup.js), takes the lower of the two, and refunds the
reactor's HP by the difference via update-stats -- same client-authoritative
correction the Modify Stats buttons already use for HP, not a new server
action.

`target` is left unset (defaults to "the target" per the schema, i.e. the
save_fail's own resolved participant -- the attacker who just failed the WIS
save), matching the schema's convention (`target: "self"` only when the
move's OWN USER is affected).

    python migrate_effects_v10.py            # dry run
    python migrate_effects_v10.py --apply
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from migrate_effects_v2 import tag_for

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')

OVERRIDES = {
    'Attract': [
        {'kind': 'reroll_damage', 'when': {'type': 'save_fail', 'ability': 'WIS'}, 'ends': [{'type': 'instant'}]},
    ],
}


def rebuild_categories(cats, effects):
    derived = []
    for e in effects:
        t = tag_for(e)
        if t not in derived:
            derived.append(t)
    # Attract's existing categories already carry a `stat_debuff_enemy` slot
    # from its pre-migration flat tagging (see build_move_effects.py) --
    # that's exactly the placeholder migrate_effects_v3's RETIRED_V3 set
    # would normally splice into, but v9 left Attract on its OLD tags
    # entirely (no effects meant nothing to derive). Since this is the first
    # time Attract actually gets real derived tags, just append them --
    # nothing to replace, and `stat_debuff_enemy` stays as-is (still an
    # accurate coarse description alongside the new precise one).
    out = list(cats)
    for t in derived:
        if t not in out:
            out.append(t)
    return out


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

    print(f'{len(OVERRIDES)} move(s) getting effects')
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
