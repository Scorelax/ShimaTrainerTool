"""Move migration, seventy-eighth slice: the weather moves.

Sunny Day, Rain Dance, Sandstorm, Hail -- each a `set_weather` effect (combat-wip.js's _offerMoveEffects) that sets the
shared session weather over an area the caster marks on the battle map (or the whole map), the same flow and the same
tile-limited zone model as the terrain moves (see migrate_effects_v77.py): `session.weather` for "all map",
`session.weatherZones` for a marked area, merged per participant by conditions.py's `fields_affecting`. Each move does
only what its own text says:

- **Sunny Day** ("harsh sunlight for 5 rounds") and **Rain Dance** ("heavy rainfall that covers the battlefield for 5
  rounds") have no mechanics of their own -- they just set the weather, named so the loose substring matches other
  moves use find them ("sun" -- Solar Beam / Solar Blade already read `self_weather_contains`, now per attacker, i.e.
  only for someone standing in it; "rain" -- Hurricane, Thunder, Storm Surge, Sapphire Torrent, Surface Glide mention it
  and are separate follow-ups).
- **Sandstorm** / **Hail** (concentration, 5 rounds, 50ft radius centered on a point in range): a non rock-/steel-/
  ground-type (Sandstorm) or non ice-type (Hail) creature that enters the area for the first time on its turn, or begins
  its turn inside, takes rock / ice damage equal to half the CASTER's level rounded up -- once per turn
  (routes_combat.py's `_apply_weather_damage`, from `_advance_turn` and `_move_token`; the zone stores `casterLevel`).
  Flat: no type-chart multiplier, the text says "an amount ... equal to half your level". Concentration isn't tracked as
  game state, so the zone is flagged `concentration` and the map legend gets an ✕ to end it by hand when the caster
  loses it (`remove-field-zone`).
- **Control Weather** (10 minutes, 5 miles, 8 hours, GM-decided conditions) is out-of-combat narration with no tabletop
  effect to automate -- recorded in generate_unmigrated_moves.py's HANDLED_OUTSIDE_SCHEMA instead.

`name` is what the weather is called on the map and in the log.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from migrate_effects_v76 import rebuild_categories, ALWAYS, INSTANT

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')


def weather(name, description, rounds=5, **extra):
    return {'kind': 'set_weather', 'name': name, 'rounds': rounds, 'description': description, **extra, 'when': ALWAYS, 'ends': INSTANT}


OVERRIDES = {
    'Sunny Day': {'effects': [weather('Harsh Sunlight', 'Harsh sunlight.')]},
    'Rain Dance': {'effects': [weather('Heavy Rain', 'Heavy rainfall.')]},
    'Sandstorm': {'effects': [
        weather('Sandstorm', 'Non rock-, steel- or ground-type creatures take rock damage (half the caster\'s level, rounded up) when they enter or start their turn here.',
                concentration=True, damage={'type': 'Rock', 'halfCasterLevel': True, 'immuneTypes': ['Rock', 'Steel', 'Ground']}),
    ]},
    'Hail': {'effects': [
        weather('Hail', 'Non ice-type creatures take ice damage (half the caster\'s level, rounded up) when they enter or start their turn here.',
                concentration=True, damage={'type': 'Ice', 'halfCasterLevel': True, 'immuneTypes': ['Ice']}),
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
