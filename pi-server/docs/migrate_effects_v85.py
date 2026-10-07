"""Move migration, eighty-fifth slice: Pokemon switching (Baton Pass, Lunar Dance, Healing Wish, U-turn / Volt Switch).

The shared battle tool had NO switching -- the "⇄ Switch Pokémon" popup only ever worked in the legacy local combat page (it reads a
local `bench` the shared view never built), and U-turn / Volt Switch's own data says "the trainer switch-out alternative has no
mechanic". So this slice builds it:

- **Mechanism** (routes_combat.py's `_switch_pokemon`, action `switch-pokemon`): the outgoing Pokemon goes to the bench (status
  `spectating`, keeping its HP, VP and statuses); the incoming one takes its map token and its slot in the turn order for the rest of
  the round (the order is re-sorted by initiative when the next round starts, so nobody's turn is skipped or repeated); a Pokemon
  that is new to the fight is added first as a spectator with its freshly rolled initiative. Ingrain's `trapped` refuses it. The
  trainer card's "⇄ Switch Pokémon" button now works in the shared battle (combat-wip.js builds the bench from the party and
  registers `setOnSwitchPokemon`), and the move effects below open the same picker.
- **Baton Pass** -- `switch_out` with `pass: true`: every status on the outgoing Pokemon (conditions, stat changes, rolls, temp HP --
  "negative status effects or stat changes ... substitutes, critical hit bonuses, AC increases") moves to the newcomer.
- **Lunar Dance** / **Healing Wish** -- `faint_pass_heal` (`queue-switch-heal`): the user faints (the existing `self_faint` tag) and the
  trainer's NEXT Pokemon to enter the battle -- by a switch, a new join, or being set participating -- is cured of every condition and
  healed: Lunar Dance to full HP and VP, Healing Wish by "the HP the user lost by fainting" (tracked as `hpBeforeFaint` whenever HP
  drops to 0). The picker opens right after so the trainer can send the replacement out.
- **U-turn / Volt Switch** -- a `switch_out` alongside the existing half-speed reposition, both marked `choice: chosen`, so the
  effects popup asks which of the two the move's "either ... or your trainer must switch you out" is.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from migrate_effects_v76 import rebuild_categories, ALWAYS, INSTANT

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')

SPEC = {
    'Baton Pass': [{'kind': 'switch_out', 'pass': True, 'when': ALWAYS, 'target': 'self', 'ends': INSTANT,
                    'note': "Switch out; every status on you goes to the Pokemon that replaces you."}],
    'Lunar Dance': [{'kind': 'faint_pass_heal', 'mode': 'lunar', 'when': ALWAYS, 'target': 'self', 'ends': INSTANT,
                     'note': "You faint; the next Pokemon your trainer sends out is fully healed and cured."}],
    'Healing Wish': [{'kind': 'faint_pass_heal', 'mode': 'wish', 'when': ALWAYS, 'target': 'self', 'ends': INSTANT,
                      'note': "You faint; the next Pokemon your trainer sends out is cured and recovers the HP you lost."}],
}

SWITCH_ALTERNATIVE = ('U-turn', 'Volt Switch')


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by_name = {m['name']: m for m in data['moves']}
    missing = [n for n in list(SPEC) + list(SWITCH_ALTERNATIVE) if n not in by_name]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)
    done = [n for n in SPEC if by_name[n].get('effects')] + [n for n in SWITCH_ALTERNATIVE if any(e.get('kind') == 'switch_out' for e in by_name[n].get('effects') or [])]
    if done:
        print('ERROR -- already migrated:', done)
        sys.exit(1)
    for n, effects in SPEC.items():
        print(f'## {n}', json.dumps(effects, ensure_ascii=False))
    print('## U-turn / Volt Switch: reposition_near + switch_out as a chosen pair')
    if not apply_it:
        return
    for n, effects in SPEC.items():
        m = by_name[n]
        m['effects'] = effects
        m['categories'] = rebuild_categories(m['categories'], effects)
    for n in SWITCH_ALTERNATIVE:
        m = by_name[n]
        for e in m['effects']:
            if e.get('kind') == 'reposition_near':
                e['choice'] = {'kind': 'chosen'}
                e['note'] = 'Half your speed, away from the target (not enforced). Pick this OR the trainer switch-out.'
        m['effects'].append({'kind': 'switch_out', 'pass': False, 'when': {'type': 'on_hit'}, 'target': 'self', 'ends': INSTANT,
                             'choice': {'kind': 'chosen'}, 'note': 'Your trainer switches you out as a free action.'})
        m['categories'] = rebuild_categories(m['categories'], m['effects'])
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
