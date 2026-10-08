"""Rework pass (2026-10-08), batch E: switching follow-ups.

- New reaction trigger `switch_in`: routes_combat.py's _perform_switch opens a window for hostile creatures when a Pokemon is sent
  out (after any switch-out window has closed). Sticky Web and Toxic Spikes ("when a creature is switched into battle, you may use
  your reaction") answer it, range 50ft. A newcomer sent out onto a hazard (Spikes) is now hit by it too.
- Pursuit: "if the creature is fleeing combat or being switched out, double the damage dice" -- a damage_note on the new
  self condition `self_reacting_to` (the trigger of the window the reactor is answering).
- New end type `source_leaves`: the status ends when its source leaves the battle (switched out, benched, removed) --
  Spirit Shackle ("while the user remains in battle"), Thousand Waves ("as long as you remain in battle").
- `requires_self.firstRoundInBattle`: Fake Out ("only usable in the first round you are in a combat") and First Impression
  ("only on the first turn the user has entered combat"); the server records `enteredRound` on joining / switching in.
"""
import json
import sys
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by = {m['name']: m for m in data['moves']}

    for n in ('Sticky Web', 'Toxic Spikes'):
        by[n].update(reactionTrigger='switch_in', reactionRange=50)
    p = by['Pursuit']
    p.setdefault('effects', []).append({'kind': 'damage_note', 'condition': {'type': 'self_reacting_to', 'any': ['switch_out']},
                                        'diceMultiplier': 2, 'note': 'It is being switched out -- damage dice doubled'})
    if 'damage_note' not in p['categories']:
        p['categories'].append('damage_note')
    for n in ('Spirit Shackle', 'Thousand Waves'):
        for e in by[n]['effects']:
            if e.get('apply') == 'trapped':
                e['ends'] = [{'type': 'source_leaves'}]
    for n, msg in (('Fake Out', 'Fake Out can only be used in your first round in the battle'),
                   ('First Impression', 'First Impression can only be used on your first turn in the battle')):
        by[n].setdefault('effects', []).insert(0, {'kind': 'requires_self', 'firstRoundInBattle': True, 'message': msg})

    for n in ('Sticky Web', 'Pursuit', 'Spirit Shackle', 'Fake Out'):
        print(n, by[n].get('reactionTrigger'), [e['kind'] for e in by[n]['effects']])
    if apply_it:
        FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        print('written')


if __name__ == '__main__':
    main()
