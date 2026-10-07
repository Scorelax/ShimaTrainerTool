"""Data fix, eighty-eighth slice: casting must not run the single-target damage flow for moves whose dice aren't a cast-time attack.

Found by driving the real battle page (2026-10-07). The move popup decides "this move deals damage when cast" purely from its text: any
`NdM` near words like "melee attack" / "ranged attack" / "recovering" makes `computedData.damageDice` non-null, which opens the attack
target picker (and, with a `trigger_saving_throw` / `damage` tag, the save or damage flow) just by casting. For these moves the dice belong
to something else:

- **Spikes, Uproar** -- the zone's hazard damage, rolled later in the hazard popup. (Was `zoneOnly`; renamed.)
- **Mirror Coat** -- the reduction roll and the deflected hit, run by its `reduce_damage` handler. Its `damage` tag is dropped too.
- **Etheric Discharge** -- the 1d4 is a VP-cost multiplier, run by its `drain_attacker_vp` handler (which makes the one DEX save itself),
  so its `trigger_saving_throw` tag is dropped -- otherwise the cast ran a save flow first and treated "1d4" as damage.
- **Fire Shield, Strength Sap, Synthesis, Shore Up** -- self-only moves whose dice are a heal / a retaliation; they used to open the attack
  target picker and rely on its "No Target (self-only move)" escape hatch. (Ingrain has its own special handling and is untouched.)

The flag is `noCastDamage` (top-level, client-visible via list-move-categories): combat.js sets `computedData.damageDice = null` for it.
"""
import json
import sys
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')
FLAG = ('Spikes', 'Uproar', 'Mirror Coat', 'Etheric Discharge', 'Fire Shield', 'Strength Sap', 'Synthesis', 'Shore Up')
DROP = {'Mirror Coat': ('damage',), 'Etheric Discharge': ('trigger_saving_throw',)}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by_name = {m['name']: m for m in data['moves']}
    for n in FLAG:
        m = by_name[n]
        print(f"{n}: noCastDamage={m.get('noCastDamage')} zoneOnly={m.get('zoneOnly')}")
        if apply_it:
            m.pop('zoneOnly', None)
            m['noCastDamage'] = True
            m['categories'] = [c for c in m['categories'] if c not in DROP.get(n, ())]
    if apply_it:
        FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        print('written')


if __name__ == '__main__':
    main()
