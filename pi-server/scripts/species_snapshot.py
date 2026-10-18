#!/usr/bin/env python3
"""Every output the server builds from the species data, for every species, written to one JSON file -- run it before
and after a change to the species data or the code that reads it, then compare the two files (--compare a b). Used for
the move of DnD_pokemon.json (Benjakronk's 80-cell rows) to DnD_species.json (one object per species, 2026-10-18), where the
outputs had to stay the same.

    python scripts/species_snapshot.py out.json            # needs POKEDEX_DB pointing at a copy (nothing is written)
    python scripts/species_snapshot.py --compare a.json b.json

Every species counts as registered in the players' Pokedex, with every switch on, so the whole of each species shows.
Text is compared with its whitespace collapsed (line breaks inside the old cells were cleaned up on the way).
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))


def _safe(fn):
    """The output, or the error it stops with (some species lack numbers -- that has to stay the same too)."""
    try:
        return fn()
    except Exception as e:  # noqa: BLE001
        return {'error': f'{type(e).__name__}: {e}'}


def snapshot(out_path):
    from app import db, upstream, pokedex, routes_dm, player_pokedex, routes_combat
    conn = db.connect()
    names = [s['name'] for s in routes_dm.species_list(conn)]

    all_on = {k: True for k, v in player_pokedex._BASE_VISIBILITY.items() if isinstance(v, bool)}
    all_on.update({'movesMaxLevel': 20, 'extraVisibleMoves': [], 'evoToTargets': {}})
    config = {'registered': names, 'visibility': {}, 'defaults': all_on}
    upstream.fetch_pokedex_config = lambda conn, force=False: config
    upstream.registered_pokemon_names = lambda conn: names

    out = {
        'species_list': routes_dm.species_list(conn),
        'registered_list': pokedex.get_registered_pokemon_list(conn)['data'],
        'complete_data': pokedex.get_complete_pokemon_data(conn),
        'evolution_options': {str(d): pokedex.get_evolution_options(conn, d, 500)['data'] for d in (0, 1, 50, 200)},
        'player_pokedex': player_pokedex.player_pokedex(conn),
        'searchable_moves': player_pokedex.searchable_move_overview(conn),
        'species': {},
    }
    for name in names:
        size = {'combatantType': 'pokemon', 'speciesName': name}
        routes_combat._fill_species_size(conn, size)
        out['species'][name] = {
            'detail': _safe(lambda: routes_dm.species_detail(conn, name)),
            'abilities': _safe(lambda: pokedex.get_pokemon_abilities(conn, name)),
            'build': {f'{lvl}/{slots}': _safe(lambda: routes_dm.build_pokemon(conn, name, lvl, ability_slots=tuple(slots)))
                      for lvl in (1, 7, 15, 20) for slots in ('0', '12')},
            'fill_size': size.get('size'),
        }
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=0, sort_keys=True)
    print(f'{len(names)} species -> {out_path}')


def _norm(v):
    """Compared loosely: whitespace collapsed, case ignored, and "None" / "-" / "" / null all meaning nothing (the
    conversion's clean-ups) -- what's left is a real difference."""
    if v is None:
        return ''
    if isinstance(v, str):
        s = re.sub(r'\s+', ' ', v.replace('\\n', ' ')).strip().lower()
        return '' if s in ('none', '-', 'no description available') else s
    if isinstance(v, list):
        return [_norm(x) for x in v]
    if isinstance(v, dict):
        return {k: _norm(x) for k, x in v.items()}
    return v


def compare(a_path, b_path, limit=60):
    a, b = (json.load(open(p, encoding='utf-8')) for p in (a_path, b_path))
    diffs = []

    def walk(x, y, path):
        if isinstance(x, dict) and isinstance(y, dict):
            for k in sorted(set(x) | set(y)):
                if k not in x or k not in y:
                    diffs.append((path + '/' + k, x.get(k, '<missing>'), y.get(k, '<missing>')))
                else:
                    walk(x[k], y[k], path + '/' + k)
        elif isinstance(x, list) and isinstance(y, list) and len(x) == len(y):
            for i, (p, q) in enumerate(zip(x, y)):
                walk(p, q, f'{path}[{i}]')
        elif _norm(x) != _norm(y):
            diffs.append((path, x, y))

    walk(a, b, '')
    print(f'{len(diffs)} difference(s)')
    for path, x, y in diffs[:limit]:
        print(f'  {path}\n    before: {json.dumps(x, ensure_ascii=False)[:160]}\n    after:  {json.dumps(y, ensure_ascii=False)[:160]}')
    return diffs


if __name__ == '__main__':
    if sys.argv[1] == '--compare':
        compare(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 60)
    else:
        snapshot(sys.argv[1])
