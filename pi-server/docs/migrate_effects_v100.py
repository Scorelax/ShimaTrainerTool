#!/usr/bin/env python3
"""v100: two-stage moves and concentration (the user's design, 2026-10-14).

New top-level `twoStage` (sent to the client as a flag; combat-wip.js's _twoStageFlow):

  Charge moves -- the first use charges up: the VP is paid, the `charge` effects are applied (Swords Dance's +1 AC,
  Razor Wind's +2, Sapphire Torrent's +5) and the user is `concentrating` on the move (`charging` when the move needs
  no concentration -- Dragonfire, Frost Inferno). Using it again while that lasts releases it, free: the ordinary
  attack / save / area flow, after which the concentration ends (and the charge buffs with it).

      "twoStage": {"stage": "charge", "concentration": true, "release": "action" | "bonus",
                   "window": "next_turn" | "duration", "skipInWeather": ["sun"]}

  `window` next_turn: the charge lasts until the end of the user's next turn. duration: the move's own duration
  (Swords Dance, 1 minute). `skipInWeather`: no charging needed there -- the first use goes straight off (Solar Beam,
  Solar Blade and Sun Disc in harsh sunlight, Sapphire Torrent in heavy rain).

  Hold moves -- the first use is the ordinary attack/save that grapples or restrains; while the target still has that
  condition from this user's move, using it again hits that target automatically (no attack roll, no save) for the
  move's own dice (+ MOVE when `addMove`), free.

      "twoStage": {"stage": "hold", "holdCondition": "grappled", "release": "bonus", "addMove": false}

Charge buffs that used to say `when: always` now say `when: charge` (move-effects.js's evaluateEffect never offers
those -- only the charge step applies them).

    python migrate_effects_v100.py            # dry run
    python migrate_effects_v100.py --apply
"""
import json
import sys
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')

CHARGE = {
    'Swords Dance': {'release': 'bonus', 'window': 'duration'},
    'Solar Beam': {'skipInWeather': ['sun']},
    'Solar Blade': {'skipInWeather': ['sun']},
    'Sun Disc': {'skipInWeather': ['sun']},
    'Sapphire Torrent': {'skipInWeather': ['rain']},
    'Focus Punch': {},
    'Sky Attack': {},
    'Freeze Shock': {},
    'Ice Burn': {},
    'Razor Wind': {},
    'Skull Bash': {},
    'Dragonfire': {'concentration': False},
    'Frost Inferno': {'concentration': False},
}
HOLD = {
    'Bind': {'holdCondition': 'grappled', 'release': 'bonus', 'addMove': False},
    'Rock Tomb': {'holdCondition': 'restrained', 'release': 'action', 'addMove': True},
    'Sand Tomb': {'holdCondition': 'restrained', 'release': 'action', 'addMove': True},
}
# The +AC while charging: already authored as `always` on Swords Dance / Razor Wind; missing on Sapphire Torrent.
CHARGE_BUFF = {'Swords Dance': 1, 'Razor Wind': 2, 'Sapphire Torrent': 5}


def main(apply):
    data = json.loads(FILE.read_text(encoding='utf-8'))
    seen = set()
    for m in data['moves']:
        name = m['name']
        if name in CHARGE:
            m['twoStage'] = {'stage': 'charge', 'concentration': True, 'release': 'action', 'window': 'next_turn', **CHARGE[name]}
        elif name in HOLD:
            m['twoStage'] = {'stage': 'hold', **HOLD[name]}
        else:
            continue
        seen.add(name)
        if name in CHARGE_BUFF:
            effects = m.setdefault('effects', []) or []
            m['effects'] = effects
            buff = next((e for e in effects if e.get('kind') == 'stat' and e.get('stat') == 'ac' and e.get('target') == 'self'), None)
            if buff:
                buff['when'] = {'type': 'charge'}
            else:
                effects.append({'kind': 'stat', 'stat': 'ac', 'amount': CHARGE_BUFF[name], 'when': {'type': 'charge'},
                                'target': 'self', 'ends': [{'type': 'concentration'}]})
        print(f"{name}: twoStage {m['twoStage']}" + (f" | charge AC +{CHARGE_BUFF[name]}" if name in CHARGE_BUFF else ''))
    missing = (set(CHARGE) | set(HOLD)) - seen
    if missing:
        raise SystemExit(f'not found: {sorted(missing)}')
    if apply:
        FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        print('written')


if __name__ == '__main__':
    main('--apply' in sys.argv)
