#!/usr/bin/env python3
"""Builds DnD_abilities.json: every ability in the pokedex, with its description
and the Pokemon that have it.

Source is the pokedex rows the Pi caches in upstream_cache under 'pokemonDB'
(ability names in columns 15-17, descriptions in 62-64; see app/pokedex.py).
Dump that JSON to a file first, then:

    python build_abilities_list.py pokemonDB.json

Merge-safe: an ability already in DnD_abilities.json keeps every field it has
(effects, tags, notes added later) -- only `description` and `pokemon` are
refreshed from the dex, and new abilities are appended.
"""
import json
import re
import sys
from pathlib import Path

OUT = Path(__file__).with_name('DnD_abilities.json')
SLOTS = ((15, 62), (16, 63), (17, 64))


def clean(text):
    return re.sub(r'\s+', ' ', str(text or '')).strip()


def main(src):
    rows = json.loads(Path(src).read_text(encoding='utf-8'))
    found = {}
    for row in rows:
        if not isinstance(row, list) or len(row) <= 64 or not row[2]:
            continue
        for name_idx, desc_idx in SLOTS:
            name = clean(row[name_idx])
            if not name:
                continue
            entry = found.setdefault(name, {'name': name, 'description': clean(row[desc_idx]), 'pokemon': []})
            if row[2] not in entry['pokemon']:
                entry['pokemon'].append(row[2])

    existing = {}
    if OUT.exists():
        existing = {a['name']: a for a in json.loads(OUT.read_text(encoding='utf-8')).get('abilities', [])}
    for name, fresh in found.items():
        if name in existing:
            existing[name].update(description=fresh['description'], pokemon=fresh['pokemon'])
        else:
            existing[name] = fresh

    abilities = sorted(existing.values(), key=lambda a: a['name'].lower())
    OUT.write_text(json.dumps({'count': len(abilities), 'abilities': abilities}, indent=1, ensure_ascii=False) + '\n',
                   encoding='utf-8')
    print(f'{len(abilities)} abilities -> {OUT.name}')


if __name__ == '__main__':
    main(sys.argv[1])
