#!/usr/bin/env python3
"""Move migration, thirty-fourth slice: correction, not a new migration --
migrate_effects_v33.py's own `note` text on Fury Cutter/Ice Ball/Rollout
said the escalating VP cost was "not auto-tracked, add it by hand." That
became stale the moment it actually got automated (combat.js's
showCombatMoveDetails + move-popup.js's new vpCostOverride, same session).
Updates the `note` field on each move's existing effect in place -- drops
the now-wrong VP-cost caveat, keeps Ice Ball/Rollout's still-true
speed-reduced-to-0 caveat (that one's still just a documented gap, not
built). Doesn't touch `effects` structurally or `categories` at all, so
this is a distinct shape from every other migrate_effects_vNN.py script
(those all populate a PREVIOUSLY-EMPTY effects list; this edits one that's
already there).

    python migrate_effects_v34.py            # dry run
    python migrate_effects_v34.py --apply
"""
import json
import sys
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')

NEW_NOTES = {
    'Fury Cutter': None,  # no other caveat -- drop the note field entirely
    'Ice Ball': "Also resets if your speed is reduced to 0 -- not checked separately.",
    'Rollout': "Also resets if your speed is reduced to 0 -- not checked separately.",
}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    moves = data['moves']
    by_name = {m['name']: m for m in moves}

    missing = [n for n in NEW_NOTES if n not in by_name]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)

    for name, new_note in NEW_NOTES.items():
        m = by_name[name]
        effect = next((e for e in m.get('effects', []) if e.get('condition', {}).get('type') == 'self_consecutive_move_hits'), None)
        if not effect:
            print(f'ERROR -- {name} has no self_consecutive_move_hits effect to correct')
            sys.exit(1)
        old_note = effect.get('note')
        print(f'## {name}')
        print(f'    old note: {old_note!r}')
        print(f'    new note: {new_note!r}')
        if apply_it:
            if new_note is None:
                effect.pop('note', None)
            else:
                effect['note'] = new_note

    if not apply_it:
        return
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
