"""Move migration, eighty-sixth slice: switch-outs as a reaction trigger (Pursuit, Block), and placing the Pokemon sent out.

**Placement.** A Pokemon sent out (any switch -- the trainer-card button, Baton Pass, U-turn / Volt Switch, Lunar Dance, Healing
Wish) no longer takes the outgoing Pokemon's tile: it appears on a free tile within 20ft (4 tiles) of its TRAINER's token, chosen on
the map (utils/token-placement-picker.js), its whole footprint on the board and clear of every other token. The server enforces it
(`_switch_placement`); without a choice it takes the free tile nearest the outgoing Pokemon.

**The switch event.** `switch-pokemon` no longer swaps instantly when a hostile creature could react: it opens a `switch_out` reaction
window anchored on the outgoing Pokemon (still on the map), holds the swap (`pendingSwitch`), and completes it when the window closes
(`_finish_pending_switch`) -- or drops it if a Block stopped it. The switching trainer's client runs the countdown, like every other
window opened outside an attack (`waitForOpenWindow`).
- **Pursuit** -- `reactionTrigger` is now a list: `moved_away` (a creature walking away) AND `switch_out` ("is switched out by their
  trainer"). It attacks the outgoing Pokemon while it is still there; the doubled dice for a switch-out are the table's.
- **Block** -- "attempts to flee or switch out ... stop it dead in its tracks": `reactionTrigger: switch_out`, range 50ft, and a new
  `cancel_switch` effect (`cancel-pending-switch`) that makes the held switch not happen. "Flee" has no trigger point in this tool
  (leaving combat isn't modelled), so only the switch half is live; it comes off the handled-outside-the-schema list.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from migrate_effects_v76 import rebuild_categories, ALWAYS, INSTANT

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')

BLOCK_EFFECTS = [{'kind': 'cancel_switch', 'when': ALWAYS, 'target': 'self', 'ends': INSTANT,
                  'note': "The opponent's switch-out doesn't happen. (Fleeing combat has no trigger in this tool -- only the switch half is live.)"}]


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by_name = {m['name']: m for m in data['moves']}
    pursuit, block = by_name['Pursuit'], by_name['Block']
    if block.get('effects') or block.get('reactionTrigger'):
        print('ERROR -- Block already migrated')
        sys.exit(1)
    print("## Pursuit reactionTrigger ->", ['moved_away', 'switch_out'])
    print('## Block: reactionTrigger switch_out, range 50;', json.dumps(BLOCK_EFFECTS))
    if not apply_it:
        return
    pursuit['reactionTrigger'] = ['moved_away', 'switch_out']
    block.update({'reactionTrigger': 'switch_out', 'reactionRange': 50})
    block['effects'] = BLOCK_EFFECTS
    block['categories'] = rebuild_categories(block['categories'], BLOCK_EFFECTS)
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
