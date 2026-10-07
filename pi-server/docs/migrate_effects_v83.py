"""Move migration, eighty-third slice: the "pure mechanical" moves that turned out to have a real mechanic.

Found by the 2026-10-07 text audit of the moves the backlog generator called "nothing to do". Handled here (each reuses an
existing mechanism unless noted):

- **Sacred Sword, Secret Sword, Chip Away** -- "ignores any boosts affecting the target's AC": a new `ignoresTargetAcBoosts`
  flag (a cousin of Phantom Tendril's `ignoresTargetStatChanges`): the attack roll skips the target's POSITIVE AC changes only
  (a debuff still counts). Client-visible, via list-move-categories' flags.
- **False Swipe** -- "if this attack would normally cause a creature to faint, it is reduced to 1HP instead": a server-side
  `leavesAtOneHp` flag checked in `_apply_damage_to_target` (only when the hit would take it from above 1 HP to 0 or below).
  The crit "dazed -20 capture DC" is a capture mechanic this tool doesn't have.
- **Draco Meteor** -- "your next attack is rolled at disadvantage; if that attack requires a saving throw the target has
  advantage": two self statuses consumed by the next attack, a `roll` disadvantage on attack rolls and a `roll` advantage on
  saves against its moves. Each is spent by the attack that uses it, so a leftover one (the next attack was a roll, not a save)
  is removed by tapping its badge.
- **Endeavor** / **Pain Split** -- a new `hp_equalize` effect on a failed save: Endeavor brings the target's HP down to the
  caster's (only if it is higher; `requires_round: 2` blocks it in the first round of combat), Pain Split sends both to the
  average (rounded down), nobody above their max.
- **Rapid Spin** -- `cure_named` on the user for grappled / restrained / seeded (Leech Seed's condition).
- **Sparkling Aria** -- `cure_named` burned on every creature it touches.
- **Uproar** -- a 30ft zone around the caster for 3 rounds (concentration), `rule: uproar`: it wakes everyone inside and
  nobody inside can fall asleep (conditions.py's `terrain_blocked_status`, `_wake_electric_sleepers`), and at the START of each
  creature's turn inside (not on entering, never the caster) the Spikes-style hazard popup asks for the 2d8 + MOVE normal damage
  and the CON save (`hazard.only: 'start'`, `excludeSource`). The caster is locked to Uproar for the duration
  (`move_locked_to`). Its damage dice belong to the zone, so it is `zoneOnly` and no longer carries the damage / save / AoE
  categories that would have made casting it deal damage immediately.
- **Embargo** -- an `embargo` condition on a failed WIS save, 1 minute (10 rounds): the move popup stops applying that
  creature's held items (same suppression as Magic Room). Trainer items are the table's.
- **Fling** -- `consume_item` on the user: their first-listed held item is removed. "The GM may rule additional effects" stays
  with the GM.
- **Quash** -- a new `quash` effect on a failed WIS save: the target goes to the bottom of this round's initiative order, and the
  real order returns when the next round starts; a creature that has already had its turn is unaffected.
- **Foul Play** -- a target-conditional `damage_note` with `moveModifierFromTarget`: the damage's MOVE modifier is the TARGET's
  best of the move's stats (STR / WIS), not the attacker's. A target with no ability data gets a note to do it by hand.
- **Spud Bomb** -- a new `secondary_damage` effect: after the grass hit, on a failed CON save the target takes an equal
  amount of fire damage (the raw damage of the hit, before the type chart).

**Spikes fix.** Spikes' category list still carried the old `damage` / `trigger_saving_throw`, so casting it would have opened
the single-target save flow instead of just placing the zone. It is now `zoneOnly` with those removed.

Not done, on purpose: **Calm Emotions** (two narrative options and "suppressed effects resume when the spell ends"),
**Powder** / **Powder Cloud** (a standing coat that detonates when a fire move is used near it), the recoil and berry-check
moves, and Baton Pass / Lunar Dance / Healing Wish (no switch mechanic) -- left manual for now.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from migrate_effects_v76 import rebuild_categories, ALWAYS, INSTANT

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')


def roll_status(roll, on):
    return {'kind': 'roll', 'roll': roll, 'on': on, 'when': ALWAYS, 'target': 'self', 'ends': [{'type': 'uses', 'n': 1}]}


# name -> (flags, effects or None, categories to drop)
SPEC = {
    'Sacred Sword': ({'ignoresTargetAcBoosts': True}, None, ()),
    'Secret Sword': ({'ignoresTargetAcBoosts': True}, None, ()),
    'Chip Away': ({'ignoresTargetAcBoosts': True}, None, ()),
    'False Swipe': ({'leavesAtOneHp': True}, None, ()),
    'Draco Meteor': ({}, [roll_status('disadvantage', 'attack_rolls'), roll_status('advantage', 'saves_against_its_moves')], ()),
    'Endeavor': ({}, [{'kind': 'hp_equalize', 'mode': 'match_user', 'when': {'type': 'save_fail', 'ability': 'WIS'}, 'ends': INSTANT},
                      {'kind': 'requires_round', 'min': 2, 'message': 'Endeavor cannot be used in the first round of combat'}], ()),
    'Pain Split': ({}, [{'kind': 'hp_equalize', 'mode': 'average', 'when': {'type': 'save_fail', 'ability': 'CON'}, 'ends': INSTANT}], ()),
    'Rapid Spin': ({}, [{'kind': 'stat_transfer', 'mode': 'cure_named', 'names': ['grappled', 'restrained', 'seeded'],
                         'when': ALWAYS, 'target': 'self', 'ends': INSTANT}], ()),
    'Sparkling Aria': ({}, [{'kind': 'stat_transfer', 'mode': 'cure_named', 'names': ['burned'], 'when': ALWAYS, 'ends': INSTANT}], ()),
    'Uproar': ({'zoneOnly': True}, [
        {'kind': 'set_terrain', 'name': 'Uproar', 'description': 'Everyone here is awake and cannot fall asleep; creatures take normal damage (CON save) at the start of their turns.',
         'rounds': 3, 'concentration': True, 'radiusFt': 30, 'center': 'caster', 'rule': 'uproar',
         'hazard': {'damageType': 'Normal', 'ability': 'CON', 'diceTiers': [[1, '2d8'], [5, '3d8'], [10, '4d8'], [17, '6d8']],
                    'addMove': True, 'only': 'start', 'excludeSource': True},
         'when': ALWAYS, 'ends': INSTANT},
        {'kind': 'condition', 'apply': 'move_locked_to', 'value': 'Uproar', 'when': ALWAYS, 'target': 'self',
         'ends': [{'type': 'rounds', 'n': 3}, {'type': 'concentration'}],
         'note': 'During the uproar you cannot use any other move.'}],
        ('damage', 'trigger_saving_throw', 'multi_hit_aoe')),
    'Embargo': ({}, [{'kind': 'condition', 'apply': 'embargo', 'when': {'type': 'save_fail', 'ability': 'WIS'}, 'ends': [{'type': 'rounds', 'n': 10}],
                      'note': 'Held items have no effect on this creature (trainer items are the table\'s call).'}], ()),
    'Fling': ({}, [{'kind': 'consume_item', 'when': ALWAYS, 'target': 'self', 'ends': INSTANT}], ()),
    'Quash': ({}, [{'kind': 'quash', 'when': {'type': 'save_fail', 'ability': 'WIS'}, 'ends': INSTANT}], ()),
    'Foul Play': ({}, [{'kind': 'damage_note', 'condition': {'type': 'target_present'}, 'moveModifierFromTarget': True,
                        'note': "Damage uses the TARGET's MOVE modifier instead of yours."}], ()),
    'Spud Bomb': ({}, [{'kind': 'secondary_damage', 'damageType': 'Fire', 'when': {'type': 'save_fail', 'ability': 'CON'}, 'ends': INSTANT,
                        'note': 'An equal amount of fire damage on a failed CON save.'}], ()),
}

# Spikes was migrated (v80) with its old damage/save categories intact -- casting it would open the save flow.
SPIKES_DROP = ('damage', 'trigger_saving_throw')


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by_name = {m['name']: m for m in data['moves']}
    missing = [n for n in list(SPEC) + ['Spikes'] if n not in by_name]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)
    done = [n for n, (flags, effects, _) in SPEC.items() if (effects and by_name[n].get('effects')) or any(by_name[n].get(k) for k in flags)]
    if done:
        print('ERROR -- already migrated:', done)
        sys.exit(1)
    for name, (flags, effects, drop) in SPEC.items():
        print(f'## {name} flags={flags} drop={drop}')
        for e in effects or []:
            print('   ', json.dumps(e, ensure_ascii=False))
        if not apply_it:
            continue
        m = by_name[name]
        m.update(flags)
        if effects:
            m['effects'] = effects
        m['categories'] = [c for c in rebuild_categories(m['categories'], effects or []) if c not in drop]
    if apply_it:
        spikes = by_name['Spikes']
        spikes['zoneOnly'] = True
        spikes['categories'] = [c for c in spikes['categories'] if c not in SPIKES_DROP]
        print('Spikes ->', spikes['categories'])
        FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        print('\nwritten')


if __name__ == '__main__':
    main()
