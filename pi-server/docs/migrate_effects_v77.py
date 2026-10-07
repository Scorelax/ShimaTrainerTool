"""Move migration, seventy-seventh slice: the four terrain moves.

Electric Terrain, Grassy Terrain, Misty Terrain, Psychic Terrain -- each a `set_terrain` effect
(combat-wip.js's _offerMoveEffects) that sets the shared session terrain for 3 rounds, expiring on
the round counter (routes_combat.py's _advance_turn). Confirmed with the user: the terrain's effects
are exactly what each move's description says, nothing more. What each one does:

- **Electric Terrain** -- grounded creatures can't be asleep (conditions.py's terrain_blocked_status
  blocks a new Asleep; casting it wakes anyone already asleep), and Electric moves double their MOVE
  modifier on damage (move-effects.js's terrainDamageNote -> combat.js's _evaluateDamageNotes).
- **Grassy Terrain** -- every creature heals at the end of its turn (combat-wip.js's _promptTurnHeals),
  2d8 / 3d8 at level 5 / 4d8 at 10 / 6d8 at 17 (`healTiers`, scaled to the caster once at cast time),
  and Grass moves double their MOVE modifier.
- **Misty Terrain** -- grounded creatures can't gain new status conditions (terrain_blocked_status).
- **Psychic Terrain** -- Psychic moves double their MOVE modifier on damage, and grounded creatures can't use
  bonus actions (enforced by routes_combat.py's _use_bonus_action and by disabling the bonus-action move buttons).

"Grounded" is conditions.py's is_grounded (no flying speed / Levitate / Magnet Rise / airborne state;
Smack Down's `grounded` overrides). No "who's inside the area" tracking exists, so every effect is
field-wide -- a documented simplification.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from migrate_effects_v76 import rebuild_categories, ALWAYS, INSTANT

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')


def terrain(name, description, **extra):
    return {'kind': 'set_terrain', 'name': name, 'rounds': 3, 'description': description, **extra, 'when': ALWAYS, 'ends': INSTANT}


OVERRIDES = {
    'Electric Terrain': {'effects': [
        terrain('Electric Terrain', 'Grounded creatures cannot be asleep. Electric moves double their MOVE modifier on damage.'),
    ]},
    'Grassy Terrain': {'effects': [
        terrain('Grassy Terrain', 'All creatures heal at the end of their turn. Grass moves double their MOVE modifier on damage.',
                healTiers=[[1, '2d8'], [5, '3d8'], [10, '4d8'], [17, '6d8']]),
    ]},
    'Misty Terrain': {'effects': [
        terrain('Misty Terrain', 'Grounded creatures cannot suffer new status conditions.'),
    ]},
    'Psychic Terrain': {'effects': [
        terrain('Psychic Terrain', 'Grounded creatures cannot use bonus actions. Psychic moves double their MOVE modifier on damage.'),
    ]},
}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by_name = {m['name']: m for m in data['moves']}
    missing = [n for n in OVERRIDES if n not in by_name]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)
    already = [n for n in OVERRIDES if by_name[n].get('effects')]
    if already:
        print('ERROR -- already have effects (would overwrite):', already)
        sys.exit(1)
    for name, spec in OVERRIDES.items():
        print(f'## {name}')
        for e in spec['effects']:
            print('   ', json.dumps(e, ensure_ascii=False))
    if not apply_it:
        return
    for name, spec in OVERRIDES.items():
        m = by_name[name]
        m['effects'] = spec['effects']
        m['categories'] = rebuild_categories(m['categories'], spec['effects'])
        print(name, '->', m['categories'])
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
