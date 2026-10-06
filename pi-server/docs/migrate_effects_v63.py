"""Move migration, sixty-third slice.

**Fire Shield** -- "whenever a creature within 5 feet hits you with a melee attack, the shield
erupts: the attacker takes 2d8 fire damage." A passive retaliation (user chose the "automatic
prompt, no reaction window" design): a `condition` `retaliation_on_melee_hit`, `value` = the
damage type, `value2` = the dice. After a MELEE hit (the attacking move's range is Melee) lands on
a holder, combat-wip.js's `_maybeMeleeRetaliate` prompts for the roll and calls the new
`apply-retaliation` server action, which applies it to the attacker off-turn (no turn check, gated
on the holder really carrying the status). The prompt appears on the device that resolved the hit,
not the holder's. The light/cold-resistance flavour is not modeled. 5ft proximity isn't checked: a
melee hit already implies adjacency.
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
    'Fire Shield': {
        'effects': [
            {'kind': 'condition', 'apply': 'retaliation_on_melee_hit', 'value': 'Fire', 'value2': '2d8', 'when': ALWAYS, 'target': 'self',
             'ends': [{'type': 'rounds', 'n': 600}],
             'note': 'Cold-resistance and light flavour not modeled.'},
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
