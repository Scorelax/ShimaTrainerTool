#!/usr/bin/env python3
"""Move migration, sixteenth slice: pure category cleanup, no `effects` --
same "nothing to actually migrate, so retire the stale tag" reasoning
migrate_effects_v15.py already used for the ten crit_range_mod moves, this
time for two different RETIRED_V3 tags that don't correspond to anything
migratable either, once fully read (see migrate_effects_v16.py's own
module docstring for the first half of this same finding):

  - `advantage_on_attack_roll` on the "vanish, then attack next turn WITH
    ADVANTAGE" family (Aqua Phase, Dig, Dive, Feint Attack, Fly, Phantom
    Force, Shadow Force): their advantage applies to their OWN attack
    roll, resolved inline as part of using the move -- nothing to store,
    same as Close Combat/Twilight Rush's identical "rolled with advantage"
    phrasing already needed nothing. The tag itself is still narratively
    true (the attack IS at advantage), it just doesn't correspond to
    anything the effects system needs to hold onto, so -- same call as
    crit_range_mod -- it's retired rather than left to sit in
    unmigrated_moves.md's backlog forever with nothing to actually do.
  - `stat_buff_self`/`stat_debuff_self` on Roar of Time/Leaf Storm/
    Safeguard: none of the three actually have a numeric buff/debuff
    anywhere in their own text -- a stale category from the original
    auto-categorizer, not backed by anything to migrate.

    python migrate_effects_v18.py            # dry run
    python migrate_effects_v18.py --apply
"""
import json
import sys
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')

DROP_ADVANTAGE_ON_ATTACK_ROLL = {
    'Aqua Phase', 'Dig', 'Dive', 'Feint Attack', 'Fly', 'Phantom Force', 'Shadow Force',
}
DROP_STAT_BUFF_TAGS = {
    'Roar of Time': {'stat_buff_self'},
    'Leaf Storm': {'stat_debuff_self'},
    'Safeguard': {'stat_buff_self', 'stat_buff_ally'},
}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by_name = {m['name']: m for m in data['moves']}

    all_names = DROP_ADVANTAGE_ON_ATTACK_ROLL | set(DROP_STAT_BUFF_TAGS)
    missing = [n for n in all_names if n not in by_name]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)
    for n in DROP_ADVANTAGE_ON_ATTACK_ROLL:
        if 'advantage_on_attack_roll' not in by_name[n]['categories']:
            print(f'ERROR -- {n} missing advantage_on_attack_roll (already cleaned up?)')
            sys.exit(1)
    for n, tags in DROP_STAT_BUFF_TAGS.items():
        missing_tags = tags - set(by_name[n]['categories'])
        if missing_tags:
            print(f'ERROR -- {n} missing {missing_tags} (already cleaned up?)')
            sys.exit(1)

    for name in sorted(DROP_ADVANTAGE_ON_ATTACK_ROLL):
        print(f'## {name}  (drop advantage_on_attack_roll)  -- currently {by_name[name]["categories"]}')
    for name in sorted(DROP_STAT_BUFF_TAGS):
        print(f'## {name}  (drop {sorted(DROP_STAT_BUFF_TAGS[name])})  -- currently {by_name[name]["categories"]}')

    if not apply_it:
        return
    for name in DROP_ADVANTAGE_ON_ATTACK_ROLL:
        m = by_name[name]
        m['categories'] = [c for c in m['categories'] if c != 'advantage_on_attack_roll']
    for name, tags in DROP_STAT_BUFF_TAGS.items():
        m = by_name[name]
        m['categories'] = [c for c in m['categories'] if c not in tags]
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
