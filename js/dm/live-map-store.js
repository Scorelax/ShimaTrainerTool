// DM console -- the running battle's map, as the map editor (map-editor.js) sees its data: the same getSetup /
// updateSetup / onSetupChange / flushSetup that setup-store.js gives Map setup, but read from the live combat session
// and written straight back to it -- objects and difficult / blocked squares (POST /api/dm/board-map), the background
// (set-board-background), and any creature moved, turned or lifted by the DM (dm-place-token). So the DM edits the map
// mid-battle with the editor they already know, whoever's turn it is.
import { CombatAPI, DmAPI } from '../api.js';
import { showCombatAlert } from '../utils/combat-alert.js';

let _session = null;
const _subs = new Set();
let _local = null;      // {objects, marks, traps}: the DM's latest edit, shown until the server's push has caught up with it
let _localUntil = 0;
let _sendTimer = null;
let _sending = null;

/** The DM console's session, every time it changes (battle-live.js). */
export function setLiveSession(session) {
  _session = session;
  _subs.forEach(fn => fn());
}

function _board() {
  const b = _session?.board || {};
  const keep = _local && Date.now() < _localUntil; // a push from before the DM's last edit mustn't undo it on screen
  return {
    grid: b.grid || { cols: 1, rows: 1 },
    background: b.backgroundImage || '',
    objects: keep ? _local.objects : (b.objects || []),
    marks: keep ? _local.marks : (b.marks || {}),
    traps: keep ? _local.traps : (b.traps || []),
    tokens: b.tokens || {},
  };
}

/** The battle map in Map setup's shape: {map: {cols, rows, background, objects, marks}, creatures: [{id, name, position,
 * z, participant: {size, image}}]} -- every creature that's on the map. */
export function getSetup() {
  const b = _board();
  const participants = _session?.participants || {};
  return {
    map: { cols: b.grid.cols, rows: b.grid.rows, background: b.background, objects: b.objects, marks: b.marks, traps: b.traps, ready: true, live: true },
    creatures: Object.entries(b.tokens).filter(([id]) => participants[id]).map(([id, t]) => ({
      id, name: participants[id].name, position: { col: t.col, row: t.row, facing: t.facing || 0 }, z: t.z || 0,
      participant: { size: participants[id].size, image: participants[id].image, speciesName: participants[id].speciesName },
    })),
  };
}

export function updateSetup(fn) {
  const before = getSetup();
  const next = JSON.parse(JSON.stringify(before));
  fn(next);
  if (['objects', 'marks', 'traps'].some(k => JSON.stringify(next.map[k]) !== JSON.stringify(before.map[k]))) {
    _local = { objects: next.map.objects || [], marks: next.map.marks || {}, traps: next.map.traps || [] };
    _localUntil = Date.now() + 4000;
    clearTimeout(_sendTimer);
    _sendTimer = setTimeout(_send, 250); // a painted stroke goes up as one change, not one per square
  }
  if ((next.map.background || '') !== (before.map.background || '')) {
    CombatAPI.setBoardBackground(next.map.background || '').catch(err => showCombatAlert(err.message, { title: 'Background' }));
  }
  _subs.forEach(f => f());
}

async function _send() {
  _sendTimer = null;
  if (!_local) return;
  const { objects, marks, traps } = _local;
  _localUntil = Date.now() + 4000;
  _sending = DmAPI.setBoardMap(objects, marks, traps)
    .catch(err => showCombatAlert(err.message, { title: "Couldn't change the map" }))
    .finally(() => { _sending = null; });
  await _sending;
}

export async function flushSetup() {
  if (_sendTimer) { clearTimeout(_sendTimer); await _send(); }
  if (_sending) await _sending;
}

export function onSetupChange(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

/** The DM's size override for a creature on the map (its footprint follows). */
export async function setTokenSize(id, size) {
  try {
    await CombatAPI.dmSetSize(id, size);
  } catch (err) {
    showCombatAlert(err.message, { title: 'Size' });
  }
}

/** The DM moves / turns / lifts a creature, any time and without using its movement. `change`: {col, row} | {facing} | {z}. */
export async function placeToken(id, change) {
  const t = _session?.board?.tokens?.[id];
  if (!t) return;
  try {
    await CombatAPI.dmPlaceToken(id, { col: t.col, row: t.row, facing: t.facing || 0, z: t.z || 0, ...change });
  } catch (err) {
    showCombatAlert(err.message, { title: 'Move' });
  }
}
