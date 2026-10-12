// The DM console's copy of what the table TV shows (js/utils/display-scene.js has the shape): loaded from the Pi once,
// changed through updateScene, and saved -- at most a few times a second while a picture is being dragged, so the TV
// follows along -- with POST /api/dm/display-scene, which pushes it to the TV straight away.
import { DmAPI } from '../api.js';
import { normaliseScene } from '../utils/display-scene.js';
import { newId, toast } from './dm-common.js';

const TAB = newId('tab'); // tells this tab's own saves apart when the live push brings them back
const SAVE_EVERY_MS = 150;

let _scene = normaliseScene(null);
let _loaded = false;
let _timer = null;
let _saving = false;
let _dirty = false;
const _listeners = new Set();

export async function loadScene() {
  if (_loaded) return _scene;
  _scene = normaliseScene(await DmAPI.getState('display-scene').catch(() => null));
  _loaded = true;
  window.addEventListener('app:display-scene', (e) => {
    const pushed = e.detail?.scene;
    if (!pushed || pushed._tab === TAB) return;
    _scene = normaliseScene(pushed);
    notify();
  });
  return _scene;
}

export function getScene() {
  return _scene;
}

export function onSceneChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function notify() {
  _listeners.forEach(fn => fn(_scene));
}

/** Runs `fn(scene)` to change it, tells everyone, and saves (to the TV) a moment later. */
export function updateScene(fn) {
  fn(_scene);
  notify();
  _dirty = true;
  if (!_timer) _timer = setTimeout(save, SAVE_EVERY_MS);
}

async function save() {
  _timer = null;
  if (_saving) return; // the save in flight saves again when it's done
  _saving = true;
  _dirty = false;
  try {
    await DmAPI.saveDisplayScene({ ..._scene, _tab: TAB });
  } catch (err) {
    toast(`Couldn't update the display: ${err.message}`);
  } finally {
    _saving = false;
    if (_dirty && !_timer) _timer = setTimeout(save, SAVE_EVERY_MS);
  }
}
