"""Rework pass (2026-10-08), batch C: forced movement on the map.

`forced_movement` was a label-only condition ("move it by hand"). It becomes a real `push` effect: the caster picks the landing
tile in the reposition picker, limited to cells reached by moving straight away from (or toward) the caster -- see
combat-wip.js's _handlePush. Fields: `ft` (or `'speed'` for the target's own speed, or `bySize: [same-or-smaller, one larger,
two+ larger]`), `direction` ('away' | 'toward' | 'choice' | 'any'). Forced movement spends no movement and opens no Pursuit
window (setTokenPosition), but a hazard on the landing tile still hits.

Converted: Strength (5ft, optional), Magnetic Pulse (15ft toward or away), Circle Throw (30/15/5ft by size, any direction),
Dawn Dance (15ft, random direction rolled by the table), Lava Cannon (10ft), Roar (its speed, away).
Added where the text pushed but nothing was offered: Abyssal Surge (30ft on a failed save), Cataclysm Punch (30ft regardless of
the save), Hydro Cannon (10ft on a failed save), Telekinetic Ray (30ft any direction on a failed save).
"""
import json
import sys
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')
INSTANT = [{'type': 'instant'}]

CONVERT = {
    'Strength': {'ft': 5, 'direction': 'away', 'note': 'optional'},
    'Magnetic Pulse': {'ft': 15, 'direction': 'choice', 'note': 'only Steel types or creatures in metal armor / holding a metal weapon'},
    'Circle Throw': {'bySize': [30, 15, 5], 'direction': 'any', 'note': 'a collision with a wall or creature deals 1d6 typeless to both'},
    'Dawn Dance': {'ft': 15, 'direction': 'any', 'note': 'random direction: roll a d8 (1 = up, then clockwise)'},
    'Lava Cannon': {'ft': 10, 'direction': 'away'},
    'Roar': {'ft': 'speed', 'direction': 'away', 'note': 'in a straight line, until something stops it'},
}
ADD = {
    'Abyssal Surge': ({'type': 'save_fail', 'ability': 'DEX'}, {'ft': 30, 'direction': 'away'}),
    'Cataclysm Punch': ({'type': 'on_hit'}, {'ft': 30, 'direction': 'away', 'note': 'Huge or larger creatures are staggered instead'}),
    'Hydro Cannon': ({'type': 'save_fail', 'ability': 'DEX'}, {'ft': 10, 'direction': 'away'}),
    '6. Telekinetic Ray': ({'type': 'save_fail', 'ability': 'STR'}, {'ft': 30, 'direction': 'any'}),
}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by = {m['name']: m for m in data['moves']}
    for name, props in CONVERT.items():
        effects = by[name]['effects']
        i = next(i for i, e in enumerate(effects) if e.get('apply') == 'forced_movement')
        old = effects[i]
        new = {'kind': 'push', **props, 'when': old['when'], 'ends': INSTANT}
        if old.get('choice'):
            new['choice'] = old['choice']
        effects[i] = new
        print(name, new)
    for name, (when, props) in ADD.items():
        by[name].setdefault('effects', []).append({'kind': 'push', **props, 'when': when, 'ends': INSTANT})
        print(name, by[name]['effects'][-1])
    if apply_it:
        FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        print('written')


if __name__ == '__main__':
    main()
