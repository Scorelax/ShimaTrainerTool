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

// ---------------------------------------------------------------------------
// The planner (the user's call, 2026-10-19): scenes the DM prepares without touching the display -- during a battle, or
// for the next place the players go -- kept on the Pi (dm_state 'display-planner': [{id, name, folder, overBattle,
// scene, shownAt}]) and queued until the DM shows one. While one is open in the planner, the Display module edits it
// instead of the display (getTarget / updateTarget) and every change is saved by itself (the user's call, 2026-10-20 --
// a Save button was tried first); everything else, the battle module's checkbox too, always changes the display itself
// (getScene / updateScene).
// ---------------------------------------------------------------------------

let _plans = [];
let _plansLoaded = false;
let _planId = null;
let _planTimer = null;
let _planSaving = false;

const readPlans = saved => (Array.isArray(saved) ? saved : []).filter(p => p && p.id)
  .map(p => ({ ...p, name: String(p.name || 'Scene'), folder: String(p.folder || ''), overBattle: !!p.overBattle, scene: normaliseScene(p.scene) }));

export async function loadPlans() {
  if (_plansLoaded) return _plans;
  _plans = readPlans(await DmAPI.getState('display-planner').catch(() => null));
  _plansLoaded = true;
  return _plans;
}

/** The planner saved somewhere else -- the console open on another device too (the user's call, 2026-10-21: one
 * device's save mustn't undo the other's): loaded again. Not while a change of this one's is waiting to be saved or
 * being saved (that one goes up as it is), nor when nothing's different (this console's own save coming back). */
export async function reloadPlans() {
  if (!_plansLoaded || _planTimer || _planSaving) return;
  const saved = await DmAPI.getState('display-planner').catch(() => null);
  if (!Array.isArray(saved) || _planTimer || _planSaving) return;
  const next = readPlans(saved);
  if (JSON.stringify(next) === JSON.stringify(_plans)) return;
  _plans = next;
  if (_planId && !_plans.some(p => p.id === _planId)) _planId = null;
  notify();
}

export function getPlans() {
  return _plans;
}

/** The planned scene open in the planner, or null (the Display module is on the display itself). */
export function openPlan() {
  return _planId ? _plans.find(p => p.id === _planId) || null : null;
}

export function setOpenPlan(id) {
  _planId = id || null;
  notify();
}

/** What the Display module works on: the planned scene open in the planner, or the display's own. */
export function getTarget() {
  return openPlan()?.scene || _scene;
}

export function updateTarget(fn) {
  const plan = openPlan();
  if (!plan) { updateScene(fn); return; }
  fn(plan.scene);
  notify();
  savePlansSoon();
}

/** Changes the planner's list (a scene added, renamed, moved, removed, marked shown...) and saves it. */
export function updatePlans(fn) {
  fn(_plans);
  if (_planId && !_plans.some(p => p.id === _planId)) _planId = null;
  notify();
  savePlansSoon();
}

function savePlansSoon() {
  clearTimeout(_planTimer);
  _planTimer = setTimeout(() => {
    _planTimer = null;
    _planSaving = true;
    DmAPI.saveState('display-planner', _plans).catch(err => toast(`Couldn't save the planner: ${err.message}`))
      .finally(() => { _planSaving = false; });
  }, 400);
}
