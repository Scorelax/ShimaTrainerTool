"""Move migration, eighty-second slice: the 13 reaction moves that had neither `effects` nor a reaction flag.

They were found 2026-10-07 by checking every move whose `action` is a reaction straight off the data -- the backlog
generator's category buckets had filed them under "pure mechanical" because `counter_reaction_effect` was never one of the
tags that marks a move as needing work. Same reaction machinery as the other 32 (utils/reaction-window.js, `pendingReaction`,
`_eligible_reactors`); three new gates on who is offered a reaction, and a handful of new effect kinds.

New top-level reaction flags (server-only, like `reactionTrigger` / `reactionRange`):
- `reactionAttackRange: 'melee' | 'ranged'` -- only offered against a melee ("Melee" range) or a ranged attack.
- `reactionAnchorHpBelowOneOver: N` -- only once the anchor is below 1/N of its max HP, rounded down (Tragic Hero: 3).
- `oncePerCreature: true` -- once per anchor creature per battle (`usedOncePerCreature` on the participant).
- trigger `moved_away` -- opened by the server when a creature walks away from a hostile one (Pursuit).

By move:
- **Reflect** (melee) / **Light Screen** (ranged) -- "take half the damage dealt": Wide Guard's `damage_multiplier` 0.5 in a
  `targeted` window, gated by attack range. (Psychic Fangs' `ignoresReactionMoves` now actually bites.)
- **Counter**, **Struggle Bug** (`damaged`, melee) and **Sucker Punch** (`targeted`, melee, before the attack is rolled) are
  ordinary damaging moves used from a reaction -- they need only the flags; the reactor takes the floor and attacks through the
  normal attack flow.
- **Revenge** (`damaged`, melee) -- a new `counter_attack`: an attack roll against the attacker at DISADVANTAGE; on a hit it
  deals the same amount of fighting damage the reactor just took (read off the shared log, pre-filled, editable).
- **Etheric Discharge** (`damaged`, melee) -- `drain_attacker_vp` gains an `ability` (this one is a DEX save) and
  `vpCostMultiplierDice`: on a failed save the attacker's move VP cost is "multiplied by 1d4", so it loses cost x (d4 - 1)
  MORE (it already paid it once). One reading of an ambiguous line -- change it in `_handleDrainAttackerVp` if you meant cost x d4.
- **Mirror Coat** (`damaged`, ranged) -- a new `reduce_damage`: roll the reduction (1d6 + MOVE, scaling by level), refund
  that much of the hit; if it reduces the hit to nothing the attack is deflected and the reactor may roll a ranged attack
  back at the attacker for the same dice of psychic damage.
- **Detect**, **Spectral Vision** (`targeted`) -- Protect's own `block_attack` (the same "first use free, later d20 over 15"
  wording, handled by hand exactly as Protect's is). Spectral Vision's "then use a move you know against your attacker" is just
  the reactor still holding the floor.
- **Magic Coat** (`targeted`) -- a `magic_coat` condition (1 round, range 50ft in `value`): `_apply_status` mirrors any negative
  condition that lands on its holder from another creature in range back onto that creature, through the ordinary path (so
  Safeguard / Misty Terrain / immunities can still stop the copy), never recursively.
- **Tragic Hero** (`damaged`, range 40ft) -- offered only once the damaged ally is below a third of its max HP and hasn't had
  it this battle; a new `extra_turn` effect (`grant-extra-turn`) hands that ally the floor the moment the caster ends the
  reaction, with a fresh movement budget and bonus action.
- **Pursuit** (`moved_away`, range 40ft) -- the server opens a window for every hostile creature (different side; in PvP,
  different owner) that the mover just got farther from. A switch-out has no trigger in this tool, so only walking away counts;
  the doubled dice for fleeing/switching out is the table's. The reactor then attacks through the normal ranged flow.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from migrate_effects_v76 import rebuild_categories, ALWAYS, INSTANT

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')

DICE_TIERS = [[1, '1d6'], [5, '1d12'], [10, '2d8'], [17, '4d6']]  # Mirror Coat's reduction and its return damage

BLOCK = {'kind': 'block_attack', 'when': ALWAYS, 'target': 'self', 'ends': INSTANT}  # Protect's exact shape

# name -> (flags, effects)
SPEC = {
    'Reflect': ({'reactionTrigger': 'targeted', 'reactionRange': 0, 'reactionAttackRange': 'melee'},
                [{'kind': 'damage_multiplier', 'multiplier': 0.5, 'target': 'self', 'when': ALWAYS, 'ends': INSTANT}]),
    'Light Screen': ({'reactionTrigger': 'targeted', 'reactionRange': 0, 'reactionAttackRange': 'ranged'},
                     [{'kind': 'damage_multiplier', 'multiplier': 0.5, 'target': 'self', 'when': ALWAYS, 'ends': INSTANT}]),
    'Counter': ({'reactionTrigger': 'damaged', 'reactionRange': 0, 'reactionAttackRange': 'melee'}, None),
    'Struggle Bug': ({'reactionTrigger': 'damaged', 'reactionRange': 0, 'reactionAttackRange': 'melee'}, None),
    'Sucker Punch': ({'reactionTrigger': 'targeted', 'reactionRange': 0, 'reactionAttackRange': 'melee'}, None),
    'Revenge': ({'reactionTrigger': 'damaged', 'reactionRange': 0, 'reactionAttackRange': 'melee'},
                [{'kind': 'counter_attack', 'damageType': 'Fighting', 'damageFrom': 'damage_taken', 'rollMode': 'disadvantage',
                  'target': 'self', 'when': ALWAYS, 'ends': INSTANT,
                  'note': 'Attack roll against your attacker with disadvantage; on a hit, the damage you just took is dealt back as fighting damage.'}]),
    'Etheric Discharge': ({'reactionTrigger': 'damaged', 'reactionRange': 0, 'reactionAttackRange': 'melee'},
                          [{'kind': 'drain_attacker_vp', 'when': {'type': 'special'}, 'ends': INSTANT, 'ability': 'DEX', 'vpCostFromLog': True,
                            'vpCostMultiplierDice': '1d4', 'healPool': 'VP', 'healFraction': 0,
                            'note': "On a failed DEX save the attacker's move VP cost is multiplied by 1d4: it loses cost x (d4 - 1) more, having already paid it once."}]),
    'Mirror Coat': ({'reactionTrigger': 'damaged', 'reactionRange': 0, 'reactionAttackRange': 'ranged'},
                    [{'kind': 'reduce_damage', 'diceTiers': DICE_TIERS, 'addMove': True,
                      'reflect': {'damageType': 'Psychic', 'diceTiers': DICE_TIERS, 'addMove': True},
                      'target': 'self', 'when': ALWAYS, 'ends': INSTANT,
                      'note': 'Reduces the hit by the roll; if that wipes it out, you may roll a ranged attack to send it back at the attacker.'}]),
    'Detect': ({'reactionTrigger': 'targeted', 'reactionRange': 0}, [dict(BLOCK)]),
    'Spectral Vision': ({'reactionTrigger': 'targeted', 'reactionRange': 0}, [dict(BLOCK)]),
    'Magic Coat': ({'reactionTrigger': 'targeted', 'reactionRange': 0},
                   [{'kind': 'condition', 'apply': 'magic_coat', 'value': 50, 'target': 'self', 'when': ALWAYS, 'ends': [{'type': 'rounds', 'n': 1}],
                     'note': 'Any negative condition an attacker in range inflicts on you this round is reflected onto them too.'}]),
    'Tragic Hero': ({'reactionTrigger': 'damaged', 'reactionRange': 40, 'reactionAnchorHpBelowOneOver': 3, 'oncePerCreature': True},
                    [{'kind': 'extra_turn', 'target': 'self', 'when': ALWAYS, 'ends': INSTANT,
                      'note': 'The damaged ally takes a new turn right after this reaction ends (once per creature per battle).'}]),
    'Pursuit': ({'reactionTrigger': 'moved_away', 'reactionRange': 40}, None),
}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by_name = {m['name']: m for m in data['moves']}
    missing = [n for n in SPEC if n not in by_name]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)
    done = [n for n in SPEC if by_name[n].get('effects') or by_name[n].get('reactionTrigger')]
    if done:
        print('ERROR -- already have effects or a reaction flag:', done)
        sys.exit(1)
    for name, (flags, effects) in SPEC.items():
        print(f'## {name}  flags={flags}')
        for e in effects or []:
            print('   ', json.dumps(e, ensure_ascii=False))
        if not apply_it:
            continue
        m = by_name[name]
        m.update(flags)
        if effects:
            m['effects'] = effects
            m['categories'] = rebuild_categories(m['categories'], effects)
    if apply_it:
        FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        print('\nwritten')


if __name__ == '__main__':
    main()
