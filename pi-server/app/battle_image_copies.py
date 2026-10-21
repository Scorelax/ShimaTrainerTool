"""WebP copies of the battle map's pictures (media.BATTLE_IMAGE_DIR: the backgrounds, battle-*.png, and the objects placed
on the map, object-*.png) -- the user's call, 2026-10-21: the DM console's improvement list. They're full-size PNGs as
uploaded, 2-3 MB each, and the forest background and a rock were most of what the console downloaded on opening; as
WebP they're a seventh of that (3 MB -> 415 KB, 1.75 MB -> 285 KB) and look the same, the objects' see-through
background kept.

Served at the pictures' own URLs (main.py's /battle-images/ route): a browser that takes WebP (every one the app runs on
does -- it says so in its Accept header) gets the copy, anything else the original, so the maps saved with those URLs
need nothing changed. Made the way sprite_previews.py makes its copies: by the Pi's ffmpeg in a background thread, one
at a time at the lowest priority, into BATTLE_IMAGE_COPY_DIR -- the originals are never touched. Every picture without
an up-to-date copy is queued at startup, a new or replaced one when it's first asked for (the original is sent until
its copy is there). No ffmpeg, or a copy that wouldn't be smaller: the original, as before."""
import os
import queue
import re
import shutil
import subprocess
import threading

from . import media

BATTLE_IMAGE_COPY_DIR = os.path.expanduser(os.environ.get('BATTLE_IMAGE_COPY_DIR', '~/pokemon-dnd/battle-image-copies'))

_NAME_RE = re.compile(r'^(?:battle|object)-[\w.-]+\.png$', re.IGNORECASE)
_queue = queue.Queue()
_queued = set()
_failed = set()   # names ffmpeg couldn't make smaller (or at all) -- not tried again until the picture changes
_lock = threading.Lock()
_worker = None


def _paths(name):
    """(picture, copy) for a picture's file name -- None when it isn't one of the battle pictures (a PNG) on the Pi."""
    if os.path.basename(name or '') != name or not _NAME_RE.match(name):
        return None
    source = os.path.join(media.BATTLE_IMAGE_DIR, name)
    if not os.path.isfile(source):
        return None
    return source, os.path.join(BATTLE_IMAGE_COPY_DIR, name[:-4] + '.webp')


def _fresh(source, copy):
    return os.path.isfile(copy) and os.path.getmtime(copy) >= os.path.getmtime(source)


def _make(name):
    paths = _paths(name)
    if not paths or _fresh(*paths):
        return
    source, copy = paths
    os.makedirs(BATTLE_IMAGE_COPY_DIR, exist_ok=True)
    tmp = f'{copy}.part.webp'
    # an object keeps its see-through background (the alpha channel), a background has none to keep
    pix = 'yuva420p' if name.lower().startswith('object-') else 'yuv420p'
    cmd = ['ffmpeg', '-y', '-v', 'error', '-i', source, '-c:v', 'libwebp', '-quality', '85', '-compression_level', '4',
           '-pix_fmt', pix, '-threads', '2', tmp]
    if os.name == 'posix' and shutil.which('nice'):
        cmd = ['nice', '-n', '19'] + cmd  # the lowest priority: the server always comes first
    try:
        subprocess.run(cmd, check=True, timeout=300, stdin=subprocess.DEVNULL, capture_output=True)
        if os.path.getsize(tmp) >= os.path.getsize(source):
            raise ValueError('the copy would not be smaller')
        os.replace(tmp, copy)
    except Exception as err:  # no ffmpeg, a broken file -- the original keeps being used
        print(f'[battle-image-copies] {name}: {err}', flush=True)
        with _lock:
            _failed.add((name, os.path.getmtime(source)))
        if os.path.exists(tmp):
            os.remove(tmp)


def _work():
    while True:
        name = _queue.get()
        try:
            _make(name)
        finally:
            with _lock:
                _queued.discard(name)


def _enqueue(name, source):
    global _worker
    if not shutil.which('ffmpeg'):
        return
    with _lock:
        if name in _queued or (name, os.path.getmtime(source)) in _failed:
            return
        _queued.add(name)
        if _worker is None:
            _worker = threading.Thread(target=_work, name='battle-image-copies', daemon=True)
            _worker.start()
    _queue.put(name)


def queue_missing():
    """Queues every battle picture whose copy is missing or older than it (at startup)."""
    if not os.path.isdir(media.BATTLE_IMAGE_DIR):
        return
    for name in sorted(os.listdir(media.BATTLE_IMAGE_DIR)):
        paths = _paths(name)
        if paths and not _fresh(*paths):
            _enqueue(name, paths[0])


def copy_for(name):
    """The WebP copy's path when it's up to date; otherwise None (after queueing it, when the picture is one)."""
    paths = _paths(name)
    if not paths:
        return None
    if _fresh(*paths):
        return paths[1]
    _enqueue(name, paths[0])
    return None
