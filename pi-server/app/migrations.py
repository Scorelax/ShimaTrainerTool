"""The database's one-time moves, run by db.init on every start -- each does its work once, and nothing after that.

  - the players' Pokemon: 62-column rows -> objects in owned_pokemon (2026-10-18)
  - the trainers: 52-column rows -> objects (2026-10-19)
  - the rule tables (natures, feats, specializations, ..., the type chart) -> the files in docs/ (gamedata.py), and the
    players' Pokedex settings out of the old upstream_cache into dm_state (2026-10-19)
  - picture addresses in Benjakronk's GitHub repo, stored before every picture moved onto the Pi -> the Pi's own
    (2026-10-19)
  - the battle's text lists (abilities "0:Name;description|...", saving throws / skills / feats "A, B") -> lists, in the
    running battle and in what the DM console keeps -- its battle setups, saved encounters and NPCs (2026-10-19)
  - expertise out of the skill names ("Stealth+") into its own `expertise` list, on the trainers, the players' Pokemon
    and everything the battle text lists cover (2026-10-19)
"""
import json
import os
import re
from datetime import datetime, timezone
from urllib.parse import unquote


def run(conn):
    _move_pokemon_rows_to_objects(conn)
    _move_trainer_rows_to_objects(conn)
    _move_pokedex_config(conn)
    _retire_rule_tables(conn)
    _localize_repo_pictures(conn)
    _battle_text_to_lists(conn)


def _has_table(conn, name):
    return bool(conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone())


def _columns(conn, table):
    return [r[1] for r in conn.execute(f'PRAGMA table_info({table})')]


def _select(conn, table, columns, extra=''):
    sql = f'SELECT {", ".join(chr(34) + c + chr(34) for c in columns)}{extra} FROM {table} ORDER BY rowid'
    return conn.execute(sql).fetchall()


# ---------------------------------------------------------------------------
# The players' Pokemon and trainers
# ---------------------------------------------------------------------------

def _move_pokemon_rows_to_objects(conn):
    """Every Pokemon in the old `pokemon` table (one column per cell of the 62-cell rows) becomes an object in
    owned_pokemon (owned.from_row), its XP with it. The old table stays as it was, renamed pokemon_rows_backup -- a
    copy to go back to, read by nothing."""
    if not _has_table(conn, 'pokemon'):
        return
    from . import db, owned
    xp = ', dm_xp' if 'dm_xp' in _columns(conn, 'pokemon') else ', NULL'
    for r in _select(conn, 'pokemon', db.LEGACY_POKEMON_COLUMNS, xp):
        row = ['' if v is None else v for v in r[:-1]]
        if not str(row[2]).strip():
            continue
        p = owned.from_row(row)
        conn.execute('INSERT INTO owned_pokemon (trainer, name, json, dm_xp) VALUES (?, ?, ?, ?)',
                     (p['trainer'], p['name'], json.dumps(p, ensure_ascii=False), r[-1]))
    conn.execute('ALTER TABLE pokemon RENAME TO pokemon_rows_backup')
    conn.commit()


def _move_trainer_rows_to_objects(conn):
    """The old `trainers` table (one column per cell of the 52-cell rows -- it has a pinCode column) becomes
    trainer_rows_backup, read by nothing, and every trainer in it an object in the new `trainers` (trainers.from_row),
    its XP with it."""
    if not _has_table(conn, 'trainers') or 'pinCode' not in _columns(conn, 'trainers'):
        return
    from . import db, trainers
    conn.execute('ALTER TABLE trainers RENAME TO trainer_rows_backup')
    conn.execute(db.TRAINERS_TABLE)
    xp = ', dm_xp' if 'dm_xp' in _columns(conn, 'trainer_rows_backup') else ', NULL'
    for r in _select(conn, 'trainer_rows_backup', db.LEGACY_TRAINER_COLUMNS, xp):
        row = ['' if v is None else v for v in r[:-1]]
        if not str(row[1]).strip():
            continue
        t = trainers.from_row(row, image=_local_picture_address(row[0]))
        conn.execute('INSERT INTO trainers (name, json, dm_xp) VALUES (?, ?, ?)',
                     (t['name'], json.dumps(t, ensure_ascii=False), r[-1]))
    conn.commit()


# ---------------------------------------------------------------------------
# Game data
# ---------------------------------------------------------------------------

def _move_pokedex_config(conn):
    """The players' Pokedex settings were a snapshot of Benjakronk's pokedex_config.json (or, once the DM console had
    saved them, the Pi's own copy) in upstream_cache. They're the DM console's own now (gamedata.pokedex_config), so
    they move into dm_state -- settings saved under the species' old misspelled names renamed on the way -- and
    upstream_cache goes, with image_cache (read by nothing for a long time)."""
    from . import gamedata, species
    if _has_table(conn, 'upstream_cache'):
        row = conn.execute("SELECT json, fetched_at FROM upstream_cache WHERE key = 'pokedexConfig'").fetchone()
        have = conn.execute('SELECT 1 FROM dm_state WHERE key = ?', (gamedata.POKEDEX_CONFIG_KEY,)).fetchone()
        if row and row[0] and not have:
            config = json.loads(row[0])
            species.fix_target_spellings(config)
            conn.execute('INSERT INTO dm_state (key, json, updated_at) VALUES (?, ?, ?)',
                         (gamedata.POKEDEX_CONFIG_KEY, json.dumps(config, ensure_ascii=False),
                          row[1] or datetime.now(timezone.utc).isoformat()))
        conn.execute('DROP TABLE upstream_cache')
    conn.execute("DELETE FROM dm_state WHERE key = 'pokedex-config-edited-here'")
    if _has_table(conn, 'image_cache'):
        conn.execute('DROP TABLE image_cache')
    conn.commit()


def _rule_tables(conn):
    """{table: what it holds, in the files' shape} for the old rule tables still in the database."""
    def rows(table, cols):
        if not _has_table(conn, table):
            return None
        return [['' if v is None else v for v in r] for r in
                conn.execute(f'SELECT {", ".join(cols)} FROM {table} ORDER BY ord').fetchall()]

    out = {}
    for table, cols in (
            ('natures', ('name', 'boostStat', 'boostAmount', 'nerfStat', 'nerfAmount')),
            ('specializations', ('name', 'shortEffect', 'effect')),
            ('trainer_paths', ('name', 'l3name', 'l3short', 'l3effect', 'l5name', 'l5short', 'l5effect',
                               'l9name', 'l9short', 'l9effect', 'l15name', 'l15short', 'l15effect')),
            ('affinities', ('name', 'shortEffect', 'effect', 'improvedShortEffect', 'improvedEffect')),
            ('trainer_skills', ('level', 'name', 'shortEffect', 'fullEffect')),
            ('nationalities', ('nationality', 'regionBuff', 'effect')),
            ('trainer_feats', ('name', 'effect')),
            ('pokemon_feats', ('name', 'effect')),
            ('conduit_features', ('name', 'stage1Effect', 'stage2Effect', 'stage3Effect')),
            ('conduit_battle_styles', ('name', 'effect')),
            ('conduit_awakening_rows', ('c1', 'c2', 'c3', 'c4')),
            ('type_chart_attack', ('type',)),
            ('type_chart_defend', ('type',))):
        r = rows(table, cols)
        if r is not None:
            out[table] = r
    if _has_table(conn, 'type_chart_matrix'):
        out['type_chart_matrix'] = [list(r) for r in conn.execute(
            'SELECT attack_ord, defend_ord, value FROM type_chart_matrix ORDER BY attack_ord, defend_ord').fetchall()]
    return out


def _files_as_tables():
    """The files in docs/, in the old tables' shape -- to tell whether the Pi's tables held anything else."""
    from . import gamedata as g
    awakening_rows = []
    for t, a in g.conduit()['typeAwakenings'].items():
        awakening_rows.append([t, a.get('effect', ''), '', ''])
        for aw in a.get('awakenings', []):
            awakening_rows.append([aw.get('name', '')] + (list(aw.get('levels') or []) + ['', '', ''])[:3])
        awakening_rows += [['', '', '', '']] * (3 - len(a.get('awakenings', [])))
    types = g.type_names()
    chart = g.read_file(g.TYPE_CHART_FILE).get('chart') or {}
    return {
        'natures': [[n['name'], n['boostStat'], n['boostAmount'], n['nerfStat'], n['nerfAmount']] for n in g.natures()],
        'specializations': [[s['name'], s['shortEffect'], s['effect']] for s in g.specializations()],
        'trainer_paths': [[p['name']] + [p[f'level{l}'][k] for l in (3, 5, 9, 15) for k in ('name', 'shortEffect', 'effect')]
                          for p in g.trainer_paths()],
        'affinities': [[a['name'], a['shortEffect'], a['effect'], a['improvedShortEffect'], a['improvedEffect']]
                       for a in g.affinities()],
        'trainer_skills': [[s['level'], s['name'], s['shortEffect'], s['fullEffect']] for s in g.trainer_skills()],
        'nationalities': [[n['nationality'], n['regionBuff'], n['effect']] for n in g.nationalities()],
        'trainer_feats': [[f['name'], f['effect']] for f in g.trainer_feats()],
        'pokemon_feats': [[f['name'], f['effect']] for f in g.pokemon_feats()],
        'conduit_features': [[f['name'], f['stage1Effect'], f['stage2Effect'], f['stage3Effect']]
                             for f in g.conduit()['features']],
        'conduit_battle_styles': [[s['name'], s['effect']] for s in g.conduit()['battleStyles']],
        'conduit_awakening_rows': awakening_rows,
        'type_chart_attack': [[t.upper()] for t in types],
        'type_chart_defend': [[t.upper()] for t in types],
        'type_chart_matrix': [[i, j, chart.get(a, {}).get(d, 1)] for i, a in enumerate(types) for j, d in enumerate(types)],
    }


def _retire_rule_tables(conn):
    """The rule tables, imported once from the old Google Sheet, are the files in docs/ now (gamedata.py; written from
    the development copy of the database). The tables are dropped -- after their contents are written to
    data/old_rule_tables.json whenever they hold anything the files don't, so nothing is lost if the Pi's copy had
    been changed (compare that file with docs/ and copy over what's missing)."""
    tables = _rule_tables(conn)
    if not tables:
        return
    files = _files_as_tables()
    if not files['natures'] or not files['type_chart_matrix']:
        return  # the files aren't there (a partial checkout?) -- keep the tables until they are

    def same(a, b):
        return json.dumps(a, ensure_ascii=False, sort_keys=True) == json.dumps(b, ensure_ascii=False, sort_keys=True)

    different = {t: rows for t, rows in tables.items() if rows and not same(rows, files.get(t))}
    if different:
        from . import db
        path = os.path.join(os.path.dirname(db.DB_PATH), 'old_rule_tables.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(different, f, ensure_ascii=False, indent=1)
        print(f'[migrations] the old rule tables {", ".join(sorted(different))} differ from docs/ -- kept in {path}')
    for t in tables:
        conn.execute(f'DROP TABLE {t}')
    conn.commit()


# ---------------------------------------------------------------------------
# Pictures in Benjakronk's repo
# ---------------------------------------------------------------------------

_REPO_IMAGE = r'https?://raw\.githubusercontent\.com/Benjakronk/shima-pokedex/[^/\s"]+/images/([a-z_]+)/([^?#\s"]+)'


def _repo_folders():
    from . import media
    return {
        'pokemon': (media.POKEMON_IMAGE_DIR, media.POKEMON_IMAGE_URL_PREFIX),
        'characters': (media.NPC_IMAGE_DIR, media.NPC_IMAGE_URL_PREFIX),
        'badges': (media.BADGE_DIR, media.BADGE_URL_PREFIX),
        'splashes': (media.SPLASH_DIR, media.SPLASH_URL_PREFIX),
    }


def _local_repo_picture(match):
    """The Pi's copy of one of the repo's pictures: its address with the file's version when the Pi has it, else the
    address it would have (a picture copied in later shows up); '' for a folder the Pi doesn't keep."""
    from . import media
    folder = _repo_folders().get(match.group(1))
    if not folder:
        return ''
    filename = os.path.basename(unquote(match.group(2)))
    return media._versioned_url(*folder, filename) or folder[1] + filename


def _local_picture_address(url):
    """A stored picture address as one of the Pi's: a repo picture becomes the Pi's copy, any other web address is
    dropped (''), and the Pi's own paths stay as they are."""
    url = str(url or '').strip()
    m = re.fullmatch(_REPO_IMAGE + r'(?:[?#].*)?', url)
    if m:
        return _local_repo_picture(m)
    if not url or re.match(r'^[a-z][a-z0-9+.-]*:', url, re.I):
        return ''
    return url


def _localize_repo_pictures(conn):
    """The repo picture addresses in what the DM console saved (scenes, NPCs, encounters) -> the Pi's copies."""
    for table, key in (('dm_state', 'key'), ('dm_npcs', 'id'), ('dm_encounters', 'id')):
        rows = conn.execute(f"SELECT {key}, json FROM {table} WHERE json LIKE '%Benjakronk/shima-pokedex%'").fetchall()
        for k, text in rows:
            conn.execute(f'UPDATE {table} SET json = ? WHERE {key} = ?', (re.sub(_REPO_IMAGE, _local_repo_picture, text), k))
    conn.commit()


# ---------------------------------------------------------------------------
# The battle's text lists
# ---------------------------------------------------------------------------

def _lists_in(value):
    """`value` with every text list in it made a list (battle_lists.py): `abilities` text, `savingThrows` / `skills` /
    `feats` text, an ability swap's (`ability_override`) "Name;description", and a "Stealth+" in `skills` (its skill
    plus an `expertise` entry, battle_lists.split_expertise). True as the second value if anything changed. Lists and
    every other value are left as they are, so it does nothing the second time."""
    from . import battle_lists
    changed = False
    if isinstance(value, list):
        out = []
        for v in value:
            v, c = _lists_in(v)
            out.append(v)
            changed = changed or c
        return out, changed
    if not isinstance(value, dict):
        return value, False
    out = {}
    for k, v in value.items():
        if k == 'abilities' and isinstance(v, str):
            out[k], changed = battle_lists.ability_list(v), True
        elif k in battle_lists.LIST_FIELDS and isinstance(v, str):
            out[k], changed = battle_lists.name_list(v), True
        elif k == 'value2' and value.get('apply') == 'ability_override' and isinstance(v, str):
            entry = battle_lists.ability_entry(v)
            out[k], changed = {'name': entry['name'], 'description': entry['description']}, True
        else:
            out[k], c = _lists_in(v)
            changed = changed or c
    if isinstance(out.get('skills'), list) and any(str(s).strip().endswith('+') for s in out['skills']):
        out['skills'], out['expertise'] = battle_lists.split_expertise(out['skills'], out.get('expertise'))
        changed = True
    return out, changed


def _battle_text_to_lists(conn):
    for table, key in (('combat_session', 'id'), ('dm_state', 'key'), ('dm_npcs', 'id'), ('dm_encounters', 'id'),
                       ('trainers', 'id'), ('owned_pokemon', 'id')):
        for k, text in conn.execute(f'SELECT {key}, json FROM {table}').fetchall():
            try:
                data = json.loads(text or 'null')
            except ValueError:
                continue
            data, changed = _lists_in(data)
            if changed:
                conn.execute(f'UPDATE {table} SET json = ? WHERE {key} = ?', (json.dumps(data, ensure_ascii=False), k))
    conn.commit()
