"""Move migration, seventy-fifth slice: `steal_disrupt` -- the ability-swap moves.

A new `ability_swap` effect (`mode` + `_handleAbilitySwap` in combat-wip.js) applies `ability_override`
conditions (`value` = the replaced ability's name, `value2` = the replacement "Name;description").
`effectiveAbilities` (move-effects.js) overlays them on the session's BASE abilities for the card, the
focus panel and the local combatant -- computed fresh, never written back to the DB or the stored
abilities string, so a swap ends with its status, with the combat, or when the participant leaves it
(a Pokemon swapped out) with nothing to undo. The human picks which abilities each time.
- **Entrainment** (`give`): one of THEIR abilities becomes one of YOURS. 1 minute.
- **Role Play** (`take`): one of YOURS becomes one of THEIRS. 1 minute.
- **Skill Swap** (`swap`): both directions, concentration.
- **Simple Beam** (`replace_with`): one of THEIRS becomes "Simple" (name only -- no description on file).
All four trigger on a failed WIS save.

**Psychic Fangs** needs no `effects`: it carries `ignoresReactionMoves: ["Reflect", "Light Screen"]`
(routes_combat.py's `_eligible_reactors` never offers those against it). Recorded in
generate_unmigrated_moves.py's HANDLED_OUTSIDE_SCHEMA.
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
    'Entraintment': {'effects': [{'kind': 'ability_swap', 'mode': 'give', 'when': {'type': 'save_fail', 'ability': 'WIS'}, 'ends': [{'type': 'rounds', 'n': 10}]}]},
    'Role Play': {'effects': [{'kind': 'ability_swap', 'mode': 'take', 'when': {'type': 'save_fail', 'ability': 'WIS'}, 'ends': [{'type': 'rounds', 'n': 10}]}]},
    'Skill Swap': {'effects': [{'kind': 'ability_swap', 'mode': 'swap', 'when': {'type': 'save_fail', 'ability': 'WIS'}, 'ends': [{'type': 'rounds', 'n': 10}, {'type': 'concentration'}]}]},
    'Simple Beam': {'effects': [{'kind': 'ability_swap', 'mode': 'replace_with', 'replacement': 'Simple', 'when': {'type': 'save_fail', 'ability': 'WIS'}, 'ends': [{'type': 'rounds', 'n': 10}]}]},
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
