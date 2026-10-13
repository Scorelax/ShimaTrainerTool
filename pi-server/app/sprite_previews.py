"""Small copies of the animated sprites (upstream.SPRITE_DIR) for everywhere a sprite is shown small -- the DM console's
thumbnails, map tokens and the display preview. The sprites are 1080x1080 at ~12 Mbit/s, so a 72-pixel thumbnail still
decodes full 1080p frames, and a page with a few dozen of them (the Display module's workspace) stutters. The copy is
360 pixels at a fraction of the size, which looks the same at that size.

Made by the Pi's ffmpeg in a background thread, one at a time at the lowest priority (the server keeps answering), into
SPRITE_PREVIEW_DIR; the originals are never touched. Every sprite without an up-to-date copy is queued at startup, and
one asked for before its copy exists (a new or replaced sprite) is queued then -- the original is sent meanwhile, so a
sprite never fails to show. A copy older than its sprite (the sprite was replaced) is made again."""
import os
import queue
import shutil
import subprocess
import threading
from urllib.parse import quote

from . import upstream

SPRITE_PREVIEW_DIR = os.path.expanduser(os.environ.get('SPRITE_PREVIEW_DIR', '~/pokemon-dnd/sprite-previews'))
SPRITE_PREVIEW_URL_PREFIX = '/sprite-previews/'
_SIDE = 360

_queue = queue.Queue()
_queued = set()
_lock = threading.Lock()
_worker = None


def _paths(filename):
    """(sprite, copy) for a sprite file name -- None when it isn't a sprite in SPRITE_DIR."""
    name = os.path.basename(filename or '')
    if name != filename or not name.lower().endswith('.mp4'):
        return None
    source = os.path.join(upstream.SPRITE_DIR, name)
    if not os.path.isfile(source):
        return None
    return source, os.path.join(SPRITE_PREVIEW_DIR, name)


def _fresh(source, copy):
    return os.path.isfile(copy) and os.path.getmtime(copy) >= os.path.getmtime(source)


def _make(name):
    paths = _paths(name)
    if not paths or _fresh(*paths):
        return
    source, copy = paths
    os.makedirs(SPRITE_PREVIEW_DIR, exist_ok=True)
    tmp = f'{copy}.part.mp4'
    cmd = ['ffmpeg', '-y', '-v', 'error', '-i', source, '-an',
           '-vf', f"scale='min({_SIDE},iw)':-2:flags=lanczos",
           '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
           '-movflags', '+faststart', '-threads', '2', tmp]
    if os.name == 'posix' and shutil.which('nice'):
        cmd = ['nice', '-n', '19'] + cmd  # the lowest priority: the server always comes first
    try:
        subprocess.run(cmd, check=True, timeout=300, stdin=subprocess.DEVNULL, capture_output=True)
        os.replace(tmp, copy)
    except Exception as err:  # no ffmpeg, a broken file -- the original keeps being used
        print(f'[sprite-previews] {name}: {err}', flush=True)
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


def _enqueue(name):
    global _worker
    if not shutil.which('ffmpeg'):
        return
    with _lock:
        if name in _queued:
            return
        _queued.add(name)
        if _worker is None:
            _worker = threading.Thread(target=_work, name='sprite-previews', daemon=True)
            _worker.start()
    _queue.put(name)


def queue_missing():
    """Queues every sprite whose copy is missing or older than it (at startup)."""
    if not os.path.isdir(upstream.SPRITE_DIR):
        return
    for name in sorted(os.listdir(upstream.SPRITE_DIR)):
        paths = _paths(name)
        if paths and not _fresh(*paths):
            _enqueue(name)


def preview_file(filename):
    """The small copy's path when it's up to date; otherwise None (after queueing it, when the sprite exists).
    Raises FileNotFoundError when there's no such sprite at all."""
    paths = _paths(filename)
    if not paths:
        raise FileNotFoundError(filename)
    if _fresh(*paths):
        return paths[1]
    _enqueue(os.path.basename(filename))
    return None


def original_url(filename):
    source = os.path.join(upstream.SPRITE_DIR, filename)
    return f'{upstream.SPRITE_URL_PREFIX}{quote(filename)}?t={int(os.path.getmtime(source))}'
