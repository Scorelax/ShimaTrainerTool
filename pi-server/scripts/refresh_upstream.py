"""Force-refresh the upstream snapshots (Benjakronk's pokedex, moves, items,
pokedex config) into the SQLite database. Failures keep the previous snapshot.

Usage:
    python scripts/refresh_upstream.py [--db path/to/pokedex.db]
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__), '..')))

from app import db, upstream  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', default=None)
    args = parser.parse_args()

    conn = db.init(args.db or db.DEFAULT_DB)
    print('Refreshing upstream snapshots (Apps Script upstreams can take a minute)...')
    upstream.warm_upstream(conn)
    for key, fetched in conn.execute('SELECT key, fetched_at FROM upstream_cache ORDER BY key'):
        print(f'  {key}: fetched {fetched}')
    conn.close()


if __name__ == '__main__':
    main()
