#!/usr/bin/env python3
"""Adds a `stat: 'crit'` effect to Focus Energy -- the first move using the new
`crit` stat (see move-effects-schema.md and move-effects.js's statDeltas/
reapplyStatDeltas/baseStats/effectiveStats). Scoped narrowly on purpose: of the
14 moves still carrying the old `crit_range_mod` tag, only this one (and Laser
Focus, deferred -- see the docs/move-migration-status.md note) is an actual
LIVE, stackable, removable crit-range buff. The other ten (Karate Chop, Air
Cutter, Slash, Crabhammer, ...) just state their OWN move's fixed "crits on
19-20" -- already fully handled by the existing `base_crit` tag, which they
already carry, needing no `effects` entry at all.

    python add_focus_energy_effect.py            # dry run
    python add_focus_energy_effect.py --apply
"""
import json
import sys
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')

EFFECT = {
    'kind': 'stat', 'stat': 'crit', 'amount': 1, 'target': 'self',
    'when': {'type': 'always'},
    'ends': [{'type': 'rounds', 'n': 10}],
    'stacks': {'max': 5},
}
NEW_TAG = 'self_stat_buff_crit'
OLD_TAGS = {'crit_range_mod', 'stat_buff_self'}


def main():
    apply = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    moves = data['moves']
    m = next(x for x in moves if x['name'] == 'Focus Energy')
    if m.get('effects'):
        print('Focus Energy already has effects -- nothing to do.')
        return
    print('categories before:', m['categories'])
    new_cats, placed = [], False
    for c in m['categories']:
        if c in OLD_TAGS:
            if not placed:
                new_cats.append(NEW_TAG)
                placed = True
            continue
        new_cats.append(c)
    if not placed:
        new_cats.append(NEW_TAG)
    print('categories after: ', new_cats)
    print('effect:', json.dumps(EFFECT, indent=2))
    if not apply:
        return
    rebuilt = {}
    for k, v in m.items():
        if k == 'categories':
            rebuilt['categories'] = new_cats
            rebuilt['effects'] = [EFFECT]
        else:
            rebuilt[k] = v
    moves[moves.index(m)] = rebuilt
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('written')


if __name__ == '__main__':
    main()
