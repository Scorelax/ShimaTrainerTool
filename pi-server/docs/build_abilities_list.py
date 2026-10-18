#!/usr/bin/env python3
"""Refreshes the `pokemon` list of every ability in DnD_abilities.json -- which species have it -- from
DnD_species.json (each species names its primary, secondary and hidden ability). The species file is where that's
decided; this list is only ever worked out from it, never edited by hand.

    python build_abilities_list.py

DnD_abilities.json is the one place an ability's description (and effects, tags, notes) is written; this script
never touches those. An ability a species names that isn't in the file yet is added with an empty description, to be
filled in -- and reported. (Until 2026-10-18 this read Benjakronk's encyclopedia rows, whose cells 62-64 carried a copy
of each description.)
"""
import json
from pathlib import Path

HERE = Path(__file__).parent
SPECIES = HERE / 'DnD_species.json'
OUT = HERE / 'DnD_abilities.json'


def main():
    species = json.loads(SPECIES.read_text(encoding='utf-8'))['species']
    found = {}
    for s in species:
        for name in (s.get('abilities') or {}).values():
            if name:
                found.setdefault(name, [])
                if s['name'] not in found[name]:
                    found[name].append(s['name'])

    existing = {a['name']: a for a in json.loads(OUT.read_text(encoding='utf-8')).get('abilities', [])} if OUT.exists() else {}
    for a in existing.values():
        a['pokemon'] = found.get(a['name'], [])
    for name, pokemon in found.items():
        if name not in existing:
            existing[name] = {'name': name, 'description': '', 'pokemon': pokemon}
            print(f'new ability, needs a description: {name}')

    abilities = sorted(existing.values(), key=lambda a: a['name'].lower())
    OUT.write_text(json.dumps({'count': len(abilities), 'abilities': abilities}, indent=1, ensure_ascii=False) + '\n',
                   encoding='utf-8')
    print(f'{len(abilities)} abilities -> {OUT.name}')


if __name__ == '__main__':
    main()
