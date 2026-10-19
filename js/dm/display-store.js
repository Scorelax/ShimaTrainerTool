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
// for the next place the players go -- kept on the Pi (dm_state 'display-planner': [{id, name, folder, scene, shownAt,
// savedAt}]) and queued until the DM shows one. While one is open in the planner, the Display module edits a copy of
// it (getTarget / updateTarget) that 💾 Save keeps (the user's call, 2026-10-20) -- everything else, the battle module's
// checkbox too, always changes the display itself (getScene / updateScene).
// ---------------------------------------------------------------------------

let _plans = [];
let _plansLoaded = false;
let _planId = null;
let _draft = null; // the open scene as it's being changed -- the plan keeps its saved scene until Save
let _draftDirty = false;
let _planTimer = null;
const copyOf = sc => normaliseScene(JSON.parse(JSON.stringify(sc || null)));

export async function loadPlans() {
  if (_plansLoaded) return _plans;
  const saved = await DmAPI.getState('display-planner').catch(() => null);
  _plans = (Array.isArray(saved) ? saved : []).filter(p => p && p.id)
    .map(p => ({ ...p, name: String(p.name || 'Scene'), folder: String(p.folder || ''), scene: normaliseScene(p.scene) }));
  _plansLoaded = true;
  window.addEventListener('beforeunload', (e) => { if (_draftDirty) { e.preventDefault(); e.returnValue = ''; } });
  return _plans;
}

export function getPlans() {
  return _plans;
}

/** The planned scene open in the planner, or null (the Display module is on the display itself). */
export function openPlan() {
  return _planId ? _plans.find(p => p.id === _planId) || null : null;
}

/** Opens a planned scene (null: none) -- a fresh copy of what's saved; unsaved changes to the one open are dropped. */
export function setOpenPlan(id) {
  _planId = id || null;
  const plan = openPlan();
  _draft = plan ? copyOf(plan.scene) : null;
  _draftDirty = false;
  notify();
}

/** The open scene has changes that aren't saved yet. */
export function planDirty() {
  return !!openPlan() && _draftDirty;
}

/** Keeps the open scene's changes (💾 Save). */
export async function savePlan() {
  const plan = openPlan();
  if (!plan || !_draft) return;
  plan.scene = copyOf(_draft);
  plan.savedAt = new Date().toISOString();
  _draftDirty = false;
  notify();
  await savePlansNow();
}

/** The open scene back as it was saved. */
export function discardPlanChanges() {
  setOpenPlan(_planId);
}

/** What the Display module works on: the planned scene open in the planner, or the display's own. */
export function getTarget() {
  return (openPlan() && _draft) || _scene;
}

export function updateTarget(fn) {
  if (!openPlan() || !_draft) { updateScene(fn); return; }
  fn(_draft);
  _draftDirty = true;
  notify();
}

/** Changes the planner's list (a scene added, renamed, moved, removed, marked shown...) and saves it. */
export function updatePlans(fn) {
  fn(_plans);
  if (_planId && !_plans.some(p => p.id === _planId)) { _planId = null; _draft = null; _draftDirty = false; }
  notify();
  savePlansSoon();
}

function savePlansSoon() {
  clearTimeout(_planTimer);
  _planTimer = setTimeout(() => { savePlansNow().catch(() => {}); }, 400);
}

async function savePlansNow() {
  clearTimeout(_planTimer);
  try {
    await DmAPI.saveState('display-planner', _plans);
  } catch (err) {
    toast(`Couldn't save the planner: ${err.message}`);
    throw err;
  }
}
