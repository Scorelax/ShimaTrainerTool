"""Move migration, seventy-sixth slice: the singletons, plus U-turn / Volt Switch.

- **Echoed Voice** -- a `damage_note` whose dice multiplier comes from a new condition
  `self_echoed_voice_multiplier` (`echoedVoiceMultiplier`, move-effects.js): read off the shared log, a
  chain of this move's hits since the last miss, each inside the opener's window (until the OPENER's next
  turn begins -- log entries now carry `turnIndex` for that), doubles per hit up to 8x for any OTHER user.
  Misses are now logged with their `move` so a miss can reset the chain.
- **Stored Power** -- a `damage_note` extra die per active positive attack/damage/AC bonus on the user
  (`self_active_buff_count` now takes `statFields`; per-stat counts are WIP-bridged as
  `activeBuffCountsByStat`).
- **Throat Chop** -- a new `disable_sound_moves` effect: a typed-in 1d4, then every move the target knows
  that carries the new `soundBased` flag gets a `move_disabled` condition for that many of its turns.
  `soundBased` is a hand-reviewed list (see SOUND_BASED below) -- edit it freely.
- **U-turn, Volt Switch** -- the "move up to half your movement speed away" half: `reposition_near`
  `anchor:'self'` with a new `maxFtFractionOfSpeed: 0.5`, on a hit. The "away from the target" direction
  and the trainer switch-out alternative are not enforced (no switch mechanic in the shared system).
- **Round, Block** need no effects (see generate_unmigrated_moves.py's HANDLED_OUTSIDE_SCHEMA): Round's
  ally-joins-the-song reaction is a reminder already in the description; Block reacts to a flee/switch-out
  attempt, which has no trigger point in this tool.
- **Cactus Bloom** stays open (needs a participant-fainted reaction trigger and death-save tracking).
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


ALWAYS = {'type': 'always'}
INSTANT = [{'type': 'instant'}]

SOUND_BASED = [
    'Bug Buzz', 'Snarl', 'Eerie Impulse', 'Disarming Voice', 'Relic Song', 'Song of the Deep', 'Chatter',
    'Grass Whistle', 'Boomburst', 'Echoed Voice', 'Echoing Screech', 'Growl', 'Hyper Voice', 'Noble Roar',
    'Perish Song', 'Roar', 'Round', 'Screech', 'Sing', 'Snore', 'Sonic Boom', 'Supersonic', 'Metal Sound',
    'Sparkling Aria', 'Uproar', 'Howl', 'Thunderous Roar',
]

OVERRIDES = {
    'Echoed Voice': {'effects': [
        {'kind': 'damage_note', 'condition': {'type': 'self_echoed_voice_multiplier'}, 'diceMultiplierFromMagnitude': True,
         'note': "Another creature's Echoed Voice is still echoing: damage dice doubled (max 8x)."},
    ]},
    'Stored Power': {'effects': [
        {'kind': 'damage_note', 'condition': {'type': 'self_active_buff_count', 'statFields': ['attack_rolls', 'damage_rolls', 'ac', 'attack_rolls_or_saving_throws']},
         'extraDice': {'amountPerUnit': 1}},
    ]},
    'Throat Chop': {'effects': [
        {'kind': 'disable_sound_moves', 'when': {'type': 'on_hit'}, 'ends': [{'type': 'instant'}]},
    ]},
    'U-turn': {'effects': [
        {'kind': 'reposition_near', 'anchor': 'self', 'maxFtFractionOfSpeed': 0.5, 'when': {'type': 'on_hit'}, 'target': 'self', 'ends': [{'type': 'instant'}],
         'note': 'Half your speed, away from the target (not enforced). The trainer switch-out alternative has no mechanic.'},
    ]},
    'Volt Switch': {'effects': [
        {'kind': 'reposition_near', 'anchor': 'self', 'maxFtFractionOfSpeed': 0.5, 'when': {'type': 'on_hit'}, 'target': 'self', 'ends': [{'type': 'instant'}],
         'note': 'Half your speed, away from the target (not enforced). The trainer switch-out alternative has no mechanic.'},
    ]},
}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    moves = data['moves']
    by_name = {m['name']: m for m in moves}

    missing = [n for n in OVERRIDES if n not in by_name]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)
    already = [n for n in OVERRIDES if by_name.get(n, {}).get('effects')]
    if already:
        print('ERROR -- already have effects (would overwrite):', already)
        sys.exit(1)

    print(f'{len(OVERRIDES)} moves getting effects')
    for name, spec in OVERRIDES.items():
        effects = spec['effects']
        print(f'## {name}  ({len(effects)} effect(s))')
        for e in effects:
            print('   ', json.dumps(e, ensure_ascii=False))

    if not apply_it:
        return
    for name, spec in OVERRIDES.items():
        m = by_name[name]
        effects = spec['effects']
        m['effects'] = effects
        m['categories'] = rebuild_categories(m['categories'], effects)
    for m in moves:
        if m['name'] in SOUND_BASED:
            m['soundBased'] = True
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
