"""Small WebP copies of pictures the app shows a lot, served at the pictures' own URLs (main.py) to a browser that takes
WebP (every one the app runs on does -- it says so in its Accept header), the original to anything else, so nothing
saved with those URLs needs changing. The originals are never touched.

- The battle map's pictures (media.BATTLE_IMAGE_DIR: the backgrounds, battle-*.png, and the objects placed on the map,
  object-*.png) -- the user's call, 2026-10-21: the DM console's improvement list. They're full-size PNGs as uploaded,
  2-3 MB each, and the forest background and a rock were most of what the console downloaded on opening; as WebP
  they're a seventh of that (3 MB -> 415 KB, 1.75 MB -> 285 KB) and look the same, the objects' see-through
  background kept.
- The items' pictures (media.ITEM_IMAGE_DIR) -- the user's call later that day: they should show "basically
  instantly" all through the app. They're shown small (a card, an inventory row, an object a few squares big on the
  battle map), so the copy is also made no bigger than ITEM_MAX_SIDE across, the see-through background kept.

Made the way sprite_previews.py makes its copies: by the Pi's ffmpeg in a background thread, one at a time at the
lowest priority, into the copy folder. Every picture without an up-to-date copy is queued at startup, a new or replaced
one when it's first asked for (the original is sent until its copy is there). No ffmpeg, or a copy that wouldn't be
smaller: the original, as before."""
import os
import queue
import re
import shutil
import subprocess
import threading

from . import media

ITEM_MAX_SIDE = 384  # px: a card is ~120, an item a few squares big on the table TV's battle map ~300

_queue = queue.Queue()
_lock = threading.Lock()
_worker = None


class WebpCopies:
    def __init__(self, label, source_dir, copy_dir, name_re, max_side=None, alpha=lambda name: True):
        self.label = label
        self.source_dir = source_dir
        self.copy_dir = copy_dir
        self.name_re = name_re
        self.max_side = max_side
        self.alpha = alpha       # name -> whether to keep a see-through background
        self.queued = set()
        self.failed = set()      # (name, mtime) ffmpeg couldn't make smaller (or at all) -- not tried until it changes

    def paths(self, name):
        """(picture, copy) for a picture's file name -- None when it isn't one of these pictures on the Pi."""
        if os.path.basename(name or '') != name or not self.name_re.match(name):
            return None
        source = os.path.join(self.source_dir, name)
        if not os.path.isfile(source):
            return None
        return source, os.path.join(self.copy_dir, os.path.splitext(name)[0] + '.webp')

    @staticmethod
    def fresh(source, copy):
        return os.path.isfile(copy) and os.path.getmtime(copy) >= os.path.getmtime(source)

    def make(self, name):
        paths = self.paths(name)
        if not paths or self.fresh(*paths):
            return
        source, copy = paths
        os.makedirs(self.copy_dir, exist_ok=True)
        tmp = f'{copy}.part.webp'
        pix = 'yuva420p' if self.alpha(name) else 'yuv420p'
        scale = (['-vf', f"scale='min({self.max_side},iw)':'min({self.max_side},ih)':force_original_aspect_ratio=decrease"]
                 if self.max_side else [])
        cmd = ['ffmpeg', '-y', '-v', 'error', '-i', source, *scale, '-c:v', 'libwebp', '-quality', '85',
               '-compression_level', '4', '-pix_fmt', pix, '-threads', '2', tmp]
        if os.name == 'posix' and shutil.which('nice'):
            cmd = ['nice', '-n', '19'] + cmd  # the lowest priority: the server always comes first
        try:
            subprocess.run(cmd, check=True, timeout=300, stdin=subprocess.DEVNULL, capture_output=True)
            if os.path.getsize(tmp) >= os.path.getsize(source):
                raise ValueError('the copy would not be smaller')
            os.replace(tmp, copy)
        except Exception as err:  # no ffmpeg, a broken file -- the original keeps being used
            print(f'[image-copies] {self.label} {name}: {err}', flush=True)
            with _lock:
                self.failed.add((name, os.path.getmtime(source)))
            if os.path.exists(tmp):
                os.remove(tmp)

    def enqueue(self, name, source):
        global _worker
        if not shutil.which('ffmpeg'):
            return
        with _lock:
            if name in self.queued or (name, os.path.getmtime(source)) in self.failed:
                return
            self.queued.add(name)
            if _worker is None:
                _worker = threading.Thread(target=_work, name='image-copies', daemon=True)
                _worker.start()
        _queue.put((self, name))

    def queue_missing(self):
        """Queues every picture whose copy is missing or older than it (at startup)."""
        if not os.path.isdir(self.source_dir):
            return
        for name in sorted(os.listdir(self.source_dir)):
            paths = self.paths(name)
            if paths and not self.fresh(*paths):
                self.enqueue(name, paths[0])

    def copy_for(self, name):
        """The WebP copy's path when it's up to date; otherwise None (after queueing it, when the picture is one)."""
        paths = self.paths(name)
        if not paths:
            return None
        if self.fresh(*paths):
            return paths[1]
        self.enqueue(name, paths[0])
        return None


def _work():
    while True:
        copies, name = _queue.get()
        try:
            copies.make(name)
        finally:
            with _lock:
                copies.queued.discard(name)


battle = WebpCopies(
    'battle', media.BATTLE_IMAGE_DIR,
    os.path.expanduser(os.environ.get('BATTLE_IMAGE_COPY_DIR', '~/pokemon-dnd/battle-image-copies')),
    re.compile(r'^(?:battle|object)-[\w.-]+\.png$', re.IGNORECASE),
    # an object keeps its see-through background (the alpha channel), a background has none to keep
    alpha=lambda name: name.lower().startswith('object-'))

# (a GIF may move and a WebP is one already: those are sent as they are)
items = WebpCopies(
    'item', media.ITEM_IMAGE_DIR,
    os.path.expanduser(os.environ.get('ITEM_IMAGE_COPY_DIR', '~/pokemon-dnd/item-image-copies')),
    re.compile(r'^[^/\\]+\.(?:png|jpe?g|jfif)$', re.IGNORECASE),
    max_side=ITEM_MAX_SIDE,
    alpha=lambda name: name.lower().endswith('.png'))
