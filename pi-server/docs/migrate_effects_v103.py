#!/usr/bin/env python3
"""v103: Outrage's whole rampage (the user's call, 2026-11-10: "basically the same as Rollout, plus the concentration and
the confusion"). v102 only gave it its first round's 2d8.

- `twoStage: {stage: 'rampage'}`: the first use is the ordinary one (20 VP, the recharge, and the concentration its
  "3 rounds, concentration" duration starts); using it again while that concentration lasts is free, doesn't restart
  it, and after the third round's hit ends it (combat-wip.js _twoStageFlow).
- The dice double each round of the rampage -- 2d8, 4d8, 8d8 (a `damage_note` on `self_rampage_round`, counted from
  the round the concentration started, combat.js _evaluateDamageNotes).
- "Without control": only Outrage can be used while it lasts (move_locked_to, ended with the concentration -- as Uproar).
- "When this move ends, either after the third round or from breaking concentration, you become confused": confusion
  `when: concentration_end`, put on the user by the server however the concentration ends (routes_combat.py
  _end_concentration_effects) -- no longer offered by hand after every hit.
- "...or the user becomes incapacitated": an incapacitating condition ends a rampage (routes_combat.py _apply_status).

    python migrate_effects_v103.py            # dry run
    python migrate_effects_v103.py --apply
"""
import json
import sys
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')


def main(apply):
    data = json.loads(FILE.read_text(encoding='utf-8'))
    outrage = next(m for m in data['moves'] if m['name'] == 'Outrage')
    outrage['twoStage'] = {'stage': 'rampage'}
    outrage['effects'] = [
        {'kind': 'damage_note', 'condition': {'type': 'self_rampage_round'}, 'diceMultiplierFromMagnitude': True,
         'note': 'the rampage doubles the dice each round'},
        {'kind': 'condition', 'apply': 'move_locked_to', 'value': 'Outrage', 'when': {'type': 'always'}, 'target': 'self',
         'ends': [{'type': 'concentration'}], 'note': 'While rampaging you cannot use any other move.'},
        {'kind': 'condition', 'apply': 'confused', 'when': {'type': 'concentration_end'}, 'target': 'self',
         'note': 'when the move ends, after the third round or on broken concentration'},
    ]
    cats = outrage.setdefault('categories', [])
    for t in ('damage_note', 'self_status_condition_move_locked_to'):
        if t not in cats:
            cats.append(t)
    print(json.dumps({k: outrage[k] for k in ('categories', 'twoStage', 'effects')}, indent=2))
    if apply:
        FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        print('written')


if __name__ == '__main__':
    main('--apply' in sys.argv)
