"""Move migration, seventy-ninth slice: the moves whose text depends on the weather (closes the weather category).

All of them read the weather the USER is standing in -- a tile-limited weather only counts for whoever is on it
(move-effects.js's weathersAffecting), matched by loose name substring like Solar Beam's `self_weather_contains`.

- **Storm Surge** ("can only be used while it is raining") and **Aurora Veil** ("only able to be activated while it is
  hailing"): a new `requires_weather` effect -- the move popup's Use button is disabled with the message when the
  weather isn't there (combat.js's showCombatMoveDetails, same mechanism as Stockpile's "no stacks" gate).
- **Hurricane** ("roll the attack with advantage during rain, disadvantage in harsh sunlight"): a new
  `attack_roll_weather` effect, applied to the attack roll in target-picker.js through an injected resolver
  (`setWeatherAttackModeResolver`) and merged with the roll's other advantage/disadvantage -- opposite sources cancel.
- **Weather Ball** (type follows the weather): a new `move_type_by_weather` effect. combat.js swaps the move's type
  before anything else reads it, so STAB, the popup and the damage that lands are all in the new type. Cloudy is
  Normal, the move's own type, so it needs no entry; Foggy -> Fairy / Snow -> Ice are matched by name (DM-typed).
- **Shore Up** ("in a Sandstorm your MOVE modifier is doubled") and **Surface Glide** ("if it is raining, all surfaces
  are considered to be water for you"): `ifWeather` variants on the existing effect -- when the weather matches as the
  effect is offered (applyWeatherVariants), `amount.moveModMultiplier: 2` / `appliesTo: 'all'` are set on it. Resolved
  once when the move is used, so a status already running doesn't change if the rain stops.
- **Thunder** ("in heavy rain or storms you may center this on a point within 60ft") and **Sapphire Torrent** ("during
  heavy rain, this move does not need charging"): positional centering and the two-turn charge are both table-managed
  in this app, so these are `noteOnly` damage_notes -- the move popup shows the reminder when it's raining.

Also fixes a long-standing gap this exposed: a status' `appliesTo` (which movement type a speed buff covers) was never
forwarded by buildStatusSpec nor kept by the server's _STATUS_FIELDS, so Surface Glide's "on/in water only" and Kinesis'
per-type scoping silently became "all movement types".
"""
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from migrate_effects_v76 import rebuild_categories

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')

RAIN = ['rain']


def note_only(any_of, note):
    return {'kind': 'damage_note', 'condition': {'type': 'self_weather_contains', 'any': any_of}, 'noteOnly': True, 'note': note}


# name -> function(existing effects list) -> new effects list
def add(*new):
    return lambda existing: existing + list(new)


def surface_glide(existing):
    out = copy.deepcopy(existing)
    for e in out:
        if e.get('kind') == 'stat' and e.get('stat') == 'speed':
            e['ifWeather'] = [{'any': RAIN, 'set': {'appliesTo': 'all'}}]
            e['note'] = ('Duration is "1 + MOVE minutes" -- approximated as concentration-only (removed manually). '
                         'Doubles speed on/in water; when used while it is raining every surface counts as water, so it doubles every movement type.')
    return out


def shore_up(existing):
    out = copy.deepcopy(existing)
    for e in out:
        if e.get('kind') == 'heal':
            e['ifWeather'] = [{'any': ['sand'], 'set': {'amount.moveModMultiplier': 2}}]
    return out


CHANGES = {
    'Storm Surge': add({'kind': 'requires_weather', 'any': RAIN, 'message': 'Storm Surge can only be used while it is raining'}),
    'Aurora Veil': add({'kind': 'requires_weather', 'any': ['hail'], 'message': 'Aurora Veil can only be activated while it is hailing'}),
    'Hurricane': add({'kind': 'attack_roll_weather', 'rules': [
        {'any': RAIN, 'mode': 'advantage', 'note': 'Raining: advantage on the attack roll'},
        {'any': ['sun'], 'mode': 'disadvantage', 'note': 'Harsh sunlight: disadvantage on the attack roll'},
    ]}),
    'Weather Ball': add({'kind': 'move_type_by_weather', 'types': [
        {'any': ['sun'], 'type': 'Fire'}, {'any': RAIN, 'type': 'Water'}, {'any': ['sand'], 'type': 'Rock'},
        {'any': ['hail', 'snow'], 'type': 'Ice'}, {'any': ['fog'], 'type': 'Fairy'},
    ]}),
    'Thunder': add(note_only(RAIN + ['storm'], 'Heavy rain or storm: you may center this move on a point within 60ft instead of on yourself')),
    'Sapphire Torrent': add(note_only(RAIN, 'Heavy rain: this move does not need charging -- release it right away')),
    'Surface Glide': surface_glide,
    'Shore Up': shore_up,
}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by_name = {m['name']: m for m in data['moves']}
    missing = [n for n in CHANGES if n not in by_name]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)
    done = [n for n in CHANGES if any(e.get('kind') in ('requires_weather', 'attack_roll_weather', 'move_type_by_weather') or e.get('ifWeather') or e.get('noteOnly')
                                      for e in by_name[n].get('effects') or [])]
    if done:
        print('ERROR -- already migrated:', done)
        sys.exit(1)
    for name, fn in CHANGES.items():
        effects = fn(by_name[name].get('effects') or [])
        print(f'## {name}  ({len(effects)} effect(s))')
        for e in effects:
            print('   ', json.dumps(e, ensure_ascii=False))
        if apply_it:
            m = by_name[name]
            m['effects'] = effects
            m['categories'] = rebuild_categories(m['categories'], effects)
    if apply_it:
        FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        print('\nwritten')


if __name__ == '__main__':
    main()
