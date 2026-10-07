"""Move migration, eightieth slice: the room, ring and hazard moves (closes the field_terrain category).

All but Trick Room are tile zones cast through the same map flow as the terrain and weather moves (a `set_terrain`
effect, area picked on the battle map -- see migrate_effects_v77.py), and each carries a `rule` saying what it does for
whoever stands on its tiles. Decided with the user (2026-10-07):

- **Spikes** -- 15ft radius at a point within 60ft, 1 minute (10 rounds). A creature that enters the area or starts its
  turn there takes 1d6 + MOVE ground damage (DEX save for half), once per turn; the dice scale 1d8 / 1d10 / 2d6 at levels
  5 / 10 / 17. The server queues each hit (routes_combat.py's `_queue_hazards`, from `_advance_turn`, `_move_token` and
  forced repositioning) and the creature's owner gets a POPUP asking for the damage roll and the save result
  (hazard-popup.js); `resolve-hazard` applies it, halved on a pass. The caster's move DC and +MOVE are stored on the zone.
- **Fissure** -- 20ft radius around the target, difficult terrain with movement cost APPLIED: every cell entered inside it
  costs double (`_move_cost_ft` on the server, `moveCostFt` on the client -- the map popup previews exactly what the server
  charges, and the reach tint uses it). Flying creatures aren't slowed. The d20 ("on a 20 the target falls into the
  abyss", fails against a flyer or a target 10 levels up) is the table's -- the move text is the reminder. No duration, so
  the zone stays until its legend ✕ ends it or the battle does.
- **Rototiller** -- 50ft, 3 rounds: grass-type creatures inside double their STAB on grass-type moves (combat.js
  multiplies `stabMultiplier`).
- **Fortune Ring** -- 15ft radius at a point within 40ft, 3 rounds, concentration: moves used from inside lower the crit
  DC by 1 (2 at level 10, 3 at 17) -- `critReduction` stored on the zone at the caster's level, subtracted in
  combat-wip.js's crit check.
- **Ion Deluge** -- 50ft around the caster until the beginning of the caster's next turn (`untilSourceTurn`): a Normal-type
  move used by anyone standing in it is Electric (same type override as Weather Ball).
- **Magic Room** -- 50ft, 5 rounds, concentration: held items are suppressed for creatures inside (the move popup stops
  applying them and says so).
- **Wonder Room** -- 50ft, 1 minute (10 rounds), concentration: WIS saves become CON and CON saves become WIS for creatures
  inside (save-picker.js, via an injected resolver; the swap is shown on the roll label).
- **Trick Room** -- a new `trick_room` effect: the initiative order is reversed from the start of the NEXT round and stays
  reversed until the battle ends or Trick Room is used again (then it reverses back at the following round) --
  routes_combat.py's `_trick_room` / `_advance_turn`. The map legend shows it.

Left as unknown (the user: substantial, not worth any logic): **Shield Dome** (a barrier needing strength checks to pass and
blocking ranged attacks -- no line-of-sight in the map) and **Convergence** (a mile-wide blast that permanently reshapes
the landscape).

Distances: radii are in feet, 5ft per tile; the picker pre-fills a circle of `radiusFt` (around the caster, or armed as a
stamp for `center: 'point'` moves).
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from migrate_effects_v76 import rebuild_categories, ALWAYS, INSTANT

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')


def zone(name, description, **extra):
    return {'kind': 'set_terrain', 'name': name, 'description': description, **extra, 'when': ALWAYS, 'ends': INSTANT}


OVERRIDES = {
    'Spikes': [zone(
        'Spikes', 'Hazardous ground: a creature that enters or starts its turn here takes ground damage (DEX save for half), once per turn.',
        rounds=10, radiusFt=15, center='point', rule='spikes',
        hazard={'damageType': 'Ground', 'ability': 'DEX', 'diceTiers': [[1, '1d6'], [5, '1d8'], [10, '1d10'], [17, '2d6']], 'addMove': True})],
    'Fissure': [zone(
        'Fissure', 'Difficult terrain: grounded creatures pay double movement here. On a d20 of 20 the target falls into the abyss.',
        radiusFt=20, center='point', rule='fissure', difficult=True)],
    'Rototiller': [zone(
        'Rototiller', 'Grass-type creatures here double their STAB bonus on grass-type moves.',
        rounds=3, radiusFt=50, center='caster', rule='rototiller')],
    'Fortune Ring': [zone(
        'Fortune Ring', 'Moves used from inside the ring have a lower critical hit DC.',
        rounds=3, concentration=True, radiusFt=15, center='point', rule='fortune_ring', critTiers=[[1, 1], [10, 2], [17, 3]])],
    'Ion Deluge': [zone(
        'Ion Deluge', 'Normal-type moves used here are electric-type until the caster\'s next turn.',
        radiusFt=50, center='caster', rule='ion_deluge', untilSourceTurn=True)],
    'Magic Room': [zone(
        'Magic Room', 'Held items have no effect for creatures here.',
        rounds=5, concentration=True, radiusFt=50, center='caster', rule='magic_room')],
    'Wonder Room': [zone(
        'Wonder Room', 'For creatures here, WIS saves become CON saves and CON saves become WIS saves.',
        rounds=10, concentration=True, radiusFt=50, center='caster', rule='wonder_room')],
    'Trick Room': [{'kind': 'trick_room', 'when': ALWAYS, 'ends': INSTANT}],
}

UNKNOWN = {
    # name -> categories (kept consistent with the other `unknown` moves; Convergence keeps its damage/recharge tags)
    'Shield Dome': ['unknown'],
    'Convergence': ['damage', 'unknown', 'recharge_locked'],
}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by_name = {m['name']: m for m in data['moves']}
    missing = [n for n in list(OVERRIDES) + list(UNKNOWN) if n not in by_name]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)
    already = [n for n in OVERRIDES if by_name[n].get('effects')]
    if already:
        print('ERROR -- already have effects (would overwrite):', already)
        sys.exit(1)
    for name, effects in OVERRIDES.items():
        print(f'## {name}')
        for e in effects:
            print('   ', json.dumps(e, ensure_ascii=False))
    for name, cats in UNKNOWN.items():
        print(f'## {name} -> categories {cats}')
    if not apply_it:
        return
    for name, effects in OVERRIDES.items():
        m = by_name[name]
        m['effects'] = effects
        # rebuild_categories keeps a stale `unknown` tag (Wonder Room, Trick Room had one) -- these are handled now.
        m['categories'] = [c for c in rebuild_categories(m['categories'], effects) if c != 'unknown']
        print(name, '->', m['categories'])
    for name, cats in UNKNOWN.items():
        by_name[name]['categories'] = cats
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
