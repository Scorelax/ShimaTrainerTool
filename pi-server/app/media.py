"""The pictures, videos and sounds on the Pi, and the addresses the app shows them by: the species' pictures, the
self-uploaded animated sprites / evolution videos / cries / battle animations, the trainers' portraits, the NPC
pictures, badges, splashes, battle-map images and the DM's pictures for the table TV. Every folder is checked live (a
plain filesystem look, nothing cached that could go stale).
"""
import os
import re
from urllib.parse import quote, unquote


# The picture formats of the species / NPC pictures, best first (when a picture exists in several, the first one is used).
IMG_FORMATS = ['png', 'jpg', 'jpeg', 'jfif']

# User-uploaded animated sprites (mp4 only -- gif support was dropped, see
# local_sprite_url()). Named just <sanitized-species-name>.mp4, no dex-id
# prefix. Checked live on every request (a plain filesystem stat, not a
# network probe), so no caching layer is needed here.
SPRITE_DIR = os.path.expanduser(os.environ.get('SPRITE_DIR', '~/pokemon-dnd/pokemon-sprites'))

# Every local_sprite_url() return value starts with this -- used elsewhere to
# recognize (and refuse to persist) a sprite URL that shouldn't have reached
# permanent storage. See routes_pokemon.py's register/update/evolve guards.
# Kept as /gifs/ even after the SPRITE_DIR rename and the gif-format drop --
# it's just a legacy URL prefix name at this point, already baked into every
# Pokemon's stored image field in the live DB; changing it would 404 every
# one of them until each got re-saved.
SPRITE_URL_PREFIX = '/gifs/'

# Self-uploaded evolution transition videos, e.g. pikachu_raichu.mp4 --
# unrelated to SPRITE_DIR above (different content, different naming: two
# species joined by an underscore instead of one). Same live-filesystem-
# check, no-caching-layer reasoning as SPRITE_DIR.
EVOLUTION_VIDEO_DIR = os.path.expanduser(
    os.environ.get('EVOLUTION_VIDEO_DIR', '~/pokemon-dnd/evolution_video'))

# Self-uploaded cry sound, e.g. pikachu.mp3 -- named with the same
# _sanitize_species_name() rule as SPRITE_DIR/EVOLUTION_VIDEO_DIR, but played
# once client-side on card view rather than persisted anywhere, so unlike
# local_sprite_url()/local_evolution_video_url() there's no lookup function
# here: the frontend builds the URL itself and no-ops on a 404.
CRY_DIR = os.path.expanduser(os.environ.get('CRY_DIR', '~/pokemon-dnd/pokemon-cries'))

# Self-uploaded "use move" battle animation, e.g. pikachu.mp4 -- one clip per
# species (no per-move variants), named with the same _sanitize_species_name()
# rule as the others. Played in combat once the player confirms a move, over
# the idle sprite already shown in the confirm popup. Same live-filesystem-
# check, no-caching-layer reasoning as SPRITE_DIR/EVOLUTION_VIDEO_DIR -- and
# like those two (unlike CRY_DIR) it needs a lookup function, since the
# frontend has to know up front whether one exists at all in order to
# preload it ahead of the Yes click instead of finding out only when trying
# to play it.
BATTLE_ANIMATION_DIR = os.path.expanduser(
    os.environ.get('BATTLE_ANIMATION_DIR', '~/pokemon-dnd/battle-animations'))

# Battle-map background images, e.g. battle-forest.png -- browsed directly
# (routes_combat.py's list-backgrounds), unlike the per-species dirs above
# which are only ever looked up by an exact expected filename. Same live-
# filesystem-check, no-caching-layer reasoning as the others.
BATTLE_IMAGE_DIR = os.path.expanduser(
    os.environ.get('BATTLE_IMAGE_DIR', '~/pokemon-dnd/battle-images'))

# Self-made trainer portraits, e.g. Joey.png -- named after the trainer (case-
# insensitive), used instead of the trainer's stored image URL whenever one
# exists (local_character_image_url). Same live-filesystem-check reasoning as
# the dirs above, so dropping a new file in shows up on the next load.
CHARACTER_IMAGE_DIR = os.path.expanduser(
    os.environ.get('CHARACTER_IMAGE_DIR', '~/pokemon-dnd/images/characters'))

# Every local_character_image_url() return value starts with this -- like
# SPRITE_URL_PREFIX, used to refuse persisting one into the trainers table.
CHARACTER_IMAGE_URL_PREFIX = '/character-images/'
_CHARACTER_IMAGE_EXTS = ('.png', '.jpg', '.jpeg', '.webp', '.gif')

# The species pictures (named <3-digit dex>-<sanitized name>.<png|jpg|jpeg|jfif>; first copied from Benjakronk's
# Pokedex site) -- served at /pokemon-images/ (local_pokemon_image_url).
POKEMON_IMAGE_DIR = os.path.expanduser(
    os.environ.get('POKEMON_IMAGE_DIR', '~/pokemon-dnd/images/pokemon-images'))
POKEMON_IMAGE_URL_PREFIX = '/pokemon-images/'
_POKEMON_IMAGE_EXTS = IMG_FORMATS + ['webp']

# The NPC pictures (named <sanitized name>.<ext>, e.g. nurse-joy.png) -- the DM console's NPC portraits, where the DM's
# own uploads go too (routes_dm.save_npc_image), and a trainer's portrait when there's no self-made one of that name
# (trainer_image_url).
NPC_IMAGE_DIR = os.path.expanduser(
    os.environ.get('NPC_IMAGE_DIR') or os.environ.get('ORIGINAL_CHARACTER_DIR') or '~/pokemon-dnd/images/npc')
NPC_IMAGE_URL_PREFIX = '/npc-images/'
NPC_IMAGE_EXTS = IMG_FORMATS + ['webp', 'gif']

# The gym badges (<kebab-case name>.png) -- trainer-card.js asks for /badges/<name>.png.
BADGE_DIR = os.path.expanduser(os.environ.get('BADGE_DIR', '~/pokemon-dnd/images/badges'))
BADGE_URL_PREFIX = '/badges/'

# The loading-screen splashes (splash-<n>.png, and session.png when there is one).
SPLASH_DIR = os.path.expanduser(os.environ.get('SPLASH_DIR', '~/pokemon-dnd/images/splashes'))
SPLASH_URL_PREFIX = '/splashes/'

# Pictures the DM uploads from the DM console's Display module (backgrounds -- routes_dm.save_display_image), with the
# other pictures under images/. Each file gets a new random name, so its URL never shows different content (cached
# hard, see main.py). (Until 2026-10-13 they went to ~/pokemon-dnd/display-images.)
DISPLAY_IMAGE_DIR = os.path.expanduser(
    os.environ.get('DISPLAY_IMAGE_DIR', '~/pokemon-dnd/images/display-images'))
DISPLAY_IMAGE_URL_PREFIX = '/display-images/'

# Pictures for the Admin module's events and locations (the user's call, 2026-10-20) -- a new random name each, so a URL
# never shows different content (cached hard, see main.py). Served at /admin-images/.
ADMIN_IMAGE_DIR = os.path.expanduser(os.environ.get('ADMIN_IMAGE_DIR', '~/pokemon-dnd/images/admin'))
ADMIN_IMAGE_URL_PREFIX = '/admin-images/'

# The locations' icons on the region map (the user's call, 2026-10-20): little models of the places, named
# "<LocationType>-<LocationName>" -- "Town-Havneby.png", "Cave-Mossy Cave.png" (Town and City are both a city) -- so they
# can be copied in by hand or uploaded from the DM console's Admin module, one for a location or many at once before the
# locations are made (routes_dm.save_location_icon). A file can be replaced under the same name, so they're revalidated,
# not cached hard (main.py). Served at /location-images/.
LOCATION_IMAGE_DIR = os.path.expanduser(os.environ.get('LOCATION_IMAGE_DIR', '~/pokemon-dnd/images/locations'))
LOCATION_IMAGE_URL_PREFIX = '/location-images/'

# The item pictures (the user's call, 2026-10-19): named after the item itself, "Frost Ball.png" -- the user adds them by
# hand, and the DM console's Admin module uploads them the same way (admin.save_item_image). Served at /item-images/.
ITEM_IMAGE_DIR = os.path.expanduser(os.environ.get('ITEM_IMAGE_DIR', '~/pokemon-dnd/images/items'))
ITEM_IMAGE_URL_PREFIX = '/item-images/'
ITEM_IMAGE_EXTS = IMG_FORMATS + ['webp', 'gif']


def item_file_stem(name):
    """The item's name as a file name: as it is, minus the characters a file name can't have."""
    return re.sub(r'[\\/:*?"<>|]+', '', str(name or '')).strip().rstrip('.')


def item_image_url(name):
    """The picture of an item (ITEM_IMAGE_DIR, file named after it -- any case), or None."""
    stem = item_file_stem(name).lower()
    filename = _folder_files(ITEM_IMAGE_DIR, ITEM_IMAGE_EXTS).get(stem) if stem else None
    return _versioned_url(ITEM_IMAGE_DIR, ITEM_IMAGE_URL_PREFIX, filename)


def _sanitize_species_name(name):
    """Lowercase, non-alphanumeric runs collapsed to a single hyphen, no
    leading/trailing hyphens. The one filename rule shared by every local
    (local_pokemon_image_url, local_sprite_url, local_evolution_video_url,
    local_npc_image_url) lookup."""
    return re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', str(name).lower()))


_folder_indexes = {}  # folder -> (folder mtime it was built at, {lowercase file stem: file name})


def _folder_files(folder, exts):
    """{lowercase file stem: file name} for the pictures in `folder` (extensions in `exts`, best first -- per stem the
    best format wins). Rebuilt only when the folder changes (a file added, removed or renamed)."""
    try:
        mtime = os.path.getmtime(folder)
    except OSError:
        return {}
    cached = _folder_indexes.get(folder)
    if cached and cached[0] == mtime:
        return cached[1]
    best = {}  # stem -> (rank, file name)
    for filename in os.listdir(folder):
        stem, ext = os.path.splitext(filename)
        ext = ext.lower().lstrip('.')
        if ext not in exts:
            continue
        rank = exts.index(ext)
        stem = stem.lower()
        if stem not in best or rank < best[stem][0]:
            best[stem] = (rank, filename)
    files = {stem: name for stem, (_, name) in best.items()}
    _folder_indexes[folder] = (mtime, files)
    return files


def _versioned_url(folder, prefix, filename):
    """prefix + file name + `?t=<mtime>`, or None when the file isn't there -- same mtime-stamped-URL reasoning as
    local_sprite_url()."""
    path = os.path.join(folder, filename or '')
    if not filename or not os.path.isfile(path):
        return None
    return f'{prefix}{quote(filename)}?t={int(os.path.getmtime(path))}'


def local_sprite_url(pokemon_name, shiny=False):
    """Self-uploaded animated sprite for pokemon_name, if one exists in
    SPRITE_DIR. Same sanitization as local_pokemon_image_url() for one
    consistent filename rule across both, but otherwise unrelated -- no
    dex-id prefix.

    Checked in this order, so shiny-correctness always wins: shiny.mp4, then
    non-shiny.mp4. Shiny uses a -shiny suffix, like the shiny species
    pictures; falls back through to the non-shiny variant if no shiny file
    exists."""
    sanitized = _sanitize_species_name(pokemon_name)
    candidates = []
    if shiny:
        candidates.append(f'{sanitized}-shiny.mp4')
    candidates.append(f'{sanitized}.mp4')
    for filename in candidates:
        path = os.path.join(SPRITE_DIR, filename)
        if os.path.isfile(path):
            # `?t=<mtime>` lets main.py cache this response hard (long
            # max-age, no per-load revalidation round-trip) while still
            # invalidating automatically the moment this exact file is
            # replaced -- the URL itself changes, so there's no stale copy to
            # ever manually clear.
            return f'{SPRITE_URL_PREFIX}{filename}?t={int(os.path.getmtime(path))}'
    return None


def local_evolution_video_url(pre_evolved_name, evolved_name):
    """Self-uploaded evolution transition video for this specific
    <pre-evolved> -> <evolved> pair, if one exists in EVOLUTION_VIDEO_DIR.
    Named <sanitized-pre-evolved>_<sanitized-evolved>.mp4 -- underscore as
    the separator between the two species is unambiguous since
    _sanitize_species_name() already turns every other character into a
    hyphen, so it can never appear inside either segment itself."""
    filename = f'{_sanitize_species_name(pre_evolved_name)}_{_sanitize_species_name(evolved_name)}.mp4'
    path = os.path.join(EVOLUTION_VIDEO_DIR, filename)
    if os.path.isfile(path):
        # See the matching comment in local_sprite_url() above -- same
        # mtime-stamped-URL reasoning.
        return f'/evolution-videos/{filename}?t={int(os.path.getmtime(path))}'
    return None


def local_character_image_url(trainer_name):
    """Self-made portrait for trainer_name in CHARACTER_IMAGE_DIR (file name =
    the trainer's name, any case, any of _CHARACTER_IMAGE_EXTS), or None.
    Same mtime-stamped-URL reasoning as local_sprite_url()."""
    wanted = str(trainer_name or '').strip().lower()
    if not wanted or not os.path.isdir(CHARACTER_IMAGE_DIR):
        return None
    for filename in sorted(os.listdir(CHARACTER_IMAGE_DIR)):
        stem, ext = os.path.splitext(filename)
        if stem.lower() == wanted and ext.lower() in _CHARACTER_IMAGE_EXTS:
            path = os.path.join(CHARACTER_IMAGE_DIR, filename)
            if os.path.isfile(path):
                return f'{CHARACTER_IMAGE_URL_PREFIX}{quote(filename)}?t={int(os.path.getmtime(path))}'
    return None


_pokemon_by_name = (None, {})  # (the _folder_files dict it was built from, {'<name>': file name})


def _pokemon_image_files():
    """POKEMON_IMAGE_DIR's pictures keyed '<dex>-<name>' (the file names), and the same keyed by '<name>' alone."""
    global _pokemon_by_name
    files = _folder_files(POKEMON_IMAGE_DIR, _POKEMON_IMAGE_EXTS)
    if _pokemon_by_name[0] is not files:
        by_name = {}
        for stem in sorted(files):
            by_name.setdefault(re.sub(r'^\d+-', '', stem), files[stem])
        _pokemon_by_name = (files, by_name)
    return files, _pokemon_by_name[1]


def local_pokemon_image_url(pokemon_name, pokemon_id, shiny=False):
    """The original picture of a species from POKEMON_IMAGE_DIR, or None: '<dex>-<name>' first (the folder's naming),
    then the name alone (in case the number differs). A shiny one uses its '-shiny' picture when there is one."""
    files, by_name = _pokemon_image_files()
    name = _sanitize_species_name(pokemon_name)
    base = f'{str(pokemon_id).zfill(3)}-{name}'
    for suffix in (('-shiny', '') if shiny else ('',)):
        filename = files.get(base + suffix) or by_name.get(name + suffix)
        if filename:
            return _versioned_url(POKEMON_IMAGE_DIR, POKEMON_IMAGE_URL_PREFIX, filename)
    return None


def pokemon_image_url(pokemon_name, pokemon_id, shiny=False, animated=True):
    """What the app shows for a species: its self-uploaded animated sprite (unless the player turned animated sprites
    off), else its original picture, else '' (the app shows a Poke Ball)."""
    return ((animated and local_sprite_url(pokemon_name, shiny=shiny))
            or local_pokemon_image_url(pokemon_name, pokemon_id, shiny=shiny) or '')


def local_npc_image_url(name):
    """The NPC picture for this trainer / character name (NPC_IMAGE_DIR, file named <sanitized name>.<ext>), or None."""
    filename = _folder_files(NPC_IMAGE_DIR, NPC_IMAGE_EXTS).get(_sanitize_species_name(name))
    return _versioned_url(NPC_IMAGE_DIR, NPC_IMAGE_URL_PREFIX, filename)


def npc_pictures():
    """[(file stem, url)] for every picture in NPC_IMAGE_DIR, by name -- the DM console's NPC portraits."""
    files = _folder_files(NPC_IMAGE_DIR, NPC_IMAGE_EXTS)
    out = [(stem, _versioned_url(NPC_IMAGE_DIR, NPC_IMAGE_URL_PREFIX, name)) for stem, name in sorted(files.items())]
    return [(stem, url) for stem, url in out if url]


def stored_picture_url(stored):
    """A picture address stored on a record (one of the Pi's own: /npc-images/nurse-joy.png) with its file's version,
    or None when the Pi doesn't have that file (or it isn't one of the Pi's picture folders)."""
    stored = str(stored or '').strip()
    for folder, prefix in ((NPC_IMAGE_DIR, NPC_IMAGE_URL_PREFIX), (POKEMON_IMAGE_DIR, POKEMON_IMAGE_URL_PREFIX),
                           (CHARACTER_IMAGE_DIR, CHARACTER_IMAGE_URL_PREFIX), (BADGE_DIR, BADGE_URL_PREFIX),
                           (SPLASH_DIR, SPLASH_URL_PREFIX), (DISPLAY_IMAGE_DIR, DISPLAY_IMAGE_URL_PREFIX)):
        if stored.startswith(prefix):
            return _versioned_url(folder, prefix, os.path.basename(unquote(stored[len(prefix):].split('?')[0])))
    return None


def trainer_image_url(trainer_name, stored=''):
    """What the app shows for a trainer: the self-made portrait (local_character_image_url), else the NPC picture of
    that name, else the picture the trainer has stored (stored_picture_url), else the Poke Ball."""
    return (local_character_image_url(trainer_name) or local_npc_image_url(trainer_name)
            or stored_picture_url(stored) or 'assets/Pokeball-small.png')   # (512 px: the 3000 px one is 375 KB)


def local_battle_animation_url(pokemon_name):
    """Self-uploaded "use move" battle animation for pokemon_name, if one
    exists in BATTLE_ANIMATION_DIR. Same sanitization/mtime-stamped-URL
    reasoning as local_sprite_url()/local_evolution_video_url()."""
    filename = f'{_sanitize_species_name(pokemon_name)}.mp4'
    path = os.path.join(BATTLE_ANIMATION_DIR, filename)
    if os.path.isfile(path):
        return f'/battle-animations/{filename}?t={int(os.path.getmtime(path))}'
    return None
