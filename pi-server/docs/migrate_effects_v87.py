"""Data fix, eighty-seventh slice: field-level effects are the USER's effects.

Found by driving the real battle page against a mocked server (2026-10-07): casting Spikes opened a "Who's caught in it?" target
picker. `_handleEffectsOnly` offers a move's own (target:'self') effects first, then -- if ANY effect isn't self-targeted -- asks who
the rest apply to and offers those per target. The terrain / weather / Trick Room effects (and Defog's `clear_field`, from before)
carried no `target`, so they were skipped by the first pass and only offered after a pointless target pick, once PER picked target
(a terrain zone cast three times for three picked creatures). They act on the battlefield from the user, so they are `target: 'self'`
-- offered immediately, once, with no target picker.
"""
import json
import sys
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')
FIELD_KINDS = ('set_terrain', 'set_weather', 'trick_room', 'clear_field')


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    changed = []
    for m in data['moves']:
        for e in m.get('effects') or []:
            if e['kind'] in FIELD_KINDS and e.get('target') != 'self':
                changed.append(m['name'])
                if apply_it:
                    e['target'] = 'self'
    print(f'{len(changed)} field-level effects need target:self:', ', '.join(changed))
    if apply_it:
        FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        print('written')


if __name__ == '__main__':
    main()
