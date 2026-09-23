#!/usr/bin/env python3
"""Move migration, eighteenth slice: Endure -- the other shape
migrate_effects_v19.py's own note flagged as still open under
`protect_negate`. A new `prevent_faint` effect kind (move-effects-schema.md's
own section): unlike `block_attack`, this fires on the `'damaged'` reaction
family (the damage already landed by the time the window opens), so there's
no attack left to cancel, only its outcome to retroactively override --
closer to `reroll_damage`'s own shape than to Protect's.

reactionTrigger 'damaged', reactionRange 0 (its own stated range: Self).
Same escalating "roll over 15 on a d20 after the first use" cost as the
whole Protect family, left manual for the same reason.

    python migrate_effects_v20.py            # dry run
    python migrate_effects_v20.py --apply
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


REACTION_META = {'Endure': {'trigger': 'damaged', 'range': 0}}
OVERRIDES = {
    'Endure': [
        {'kind': 'prevent_faint', 'when': {'type': 'always'}, 'target': 'self', 'ends': [{'type': 'instant'}]},
    ],
}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    moves = data['moves']
    by_name = {m['name']: m for m in moves}

    missing = [n for n in REACTION_META if n not in by_name]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)
    already = [n for n in OVERRIDES if by_name.get(n, {}).get('effects')]
    if already:
        print('ERROR -- already have effects (would overwrite):', already)
        sys.exit(1)
    already_meta = [n for n in REACTION_META if by_name.get(n, {}).get('reactionTrigger')]
    if already_meta:
        print('ERROR -- already have reaction metadata (would overwrite):', already_meta)
        sys.exit(1)

    print(f'{len(REACTION_META)} move(s) getting reaction metadata + effects')
    for name, meta in REACTION_META.items():
        print(f'## {name}  (trigger={meta["trigger"]}, range={meta["range"]}ft)')
        for e in OVERRIDES[name]:
            print('   ', json.dumps(e, ensure_ascii=False))

    if not apply_it:
        return
    for name, meta in REACTION_META.items():
        m = by_name[name]
        m['reactionTrigger'] = meta['trigger']
        m['reactionRange'] = meta['range']
        m['effects'] = OVERRIDES[name]
        m['categories'] = rebuild_categories(m['categories'], OVERRIDES[name])
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
