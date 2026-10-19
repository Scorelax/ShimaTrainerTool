// DM console -- map setup: the DM builds the battle map before setting up the battle (where the creatures are placed,
// creature-setup.js). The map is shown the way the table TV shows it (map-view.js), so what the DM builds here is
// exactly what the table sees.
//
// Tools: Objects (place a picture -- tree, rock, log... any object-*.png in the battle-images folder -- sized in squares,
// turned to any angle, with a height in feet for line of sight, and optionally marking its squares difficult or
// blocked), Terrain (paint difficult / blocked squares, which the battle enforces for creatures on the ground --
// routes_combat.py's _move_cost_ft / _move_token) and Eraser.
//
// Mid-battle (live mode, the user's ask 2026-10-15) the DM edits the running battle's map the same way, whoever's turn
// it is, and the Creatures tool moves, turns and lifts any creature without using its movement.
//
// After the first playtest (2026-10-16): an object can be hidden from the players until the DM reveals it, the Traps tool
// marks squares as a trap (hidden until revealed -- the DM is told when a creature walks onto one, battle-live.js), the
// Pictures card uploads an object or a background (saved as object-<name>.png / battle-<name>.<ext>) and deletes them,
// and the Creatures tool changes a creature's size on the map.
//
// Objects (the user's ask, 2026-10-15): press a square to place one there and, still holding, move the pointer around
// it to turn it -- it's placed on release. Click a placed object to edit it (the panel shows its settings, changes apply
// at once, arrows move it); press and hold a placed object to turn it the same way.
//
// Add to the map (the user's call, 2026-10-19): Objects and Items -- and on the adventure, Pokémon and NPCs -- are picked
// in a popup like a file explorer (picker.js: search, several at once, "Add hidden"), then placed one after another, a
// click each. An item goes on as an object showing the item's picture. Uploading the pictures moved to the Admin module.
//
// Later that day: the adventure's Pokemon and NPCs go on while it's still being prepared too (kept with its map,
// map-store.js's `creatures`), sizes have − / + buttons, and a placed object is moved with a click on it and then a
// click where it should go (or dragged there) -- held still for a moment, the pointer turns it.
import { CombatAPI, DmAPI } from '../api.js';
import { mapObjectHtml, objectScreenRect, objectCells, footprintCells, footprintForSize } from '../utils/battle-map-grid.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import { escapeHtml, newId, toast, getSpecies, participantFromPokemon, participantFromTrainer, npcTrainerConfig } from './dm-common.js';
import { creatureSpotProblem } from './map-view.js';
import { openPicker } from './picker.js';
import * as setupStore from './setup-store.js';
import * as liveStore from './live-map-store.js';

const { emptySetup, TV_ASPECT } = setupStore;
// Map setup edits the setup (setup-store.js); `live` mode edits the running battle's map (live-map-store.js) -- the
// same editor, plus a Creatures tool, from the DM console's battle panel (battle-live.js's Edit map).
let _store = setupStore;
let _live = false;
const getSetup = () => _store.getSetup();
const updateSetup = (fn) => _store.updateSetup(fn);
const flushSetup = () => _store.flushSetup();
const onSetupChange = (fn) => _store.onSetupChange(fn);
import { mapStageHtml } from './map-view.js';

// Starting height (ft) for an object the DM places -- changeable before placing. Anything not listed starts at 5ft.
const DEFAULT_HEIGHTS = { tree: 30, rock: 5, bush: 5, log: 5 };

let _assets = null; // {objects: [{key, label, url}], backgrounds: [...]}
const _crops = new Map(); // object url -> Promise<[x0, y0, x1, y1]> (the picture's non-transparent part)
const _cropResolved = new Map(); // url -> crop, once worked out

const ed = {
  tool: 'objects',
  objectKey: '', objW: 1, objH: 1, objRot: 0, objMark: '', objHeight: 5, // the picture's own size, and its turn as seen on screen
  terrain: 'difficult',
  hover: null, // {col, row} under the pointer
  painting: false,
  selectedId: null, // the placed object being edited
  editCx: 0, editCy: 0, // its centre on screen, in squares -- kept while editing, so turning it back and forth doesn't creep
  gesture: null, // press-and-turn under way: {cx, cy, startRot, ref, editing, turned, pointerId}
  creatureId: null, // live mode's Creatures tool: the creature picked to move / turn / lift
  objHidden: false, // the next object placed (or the one being edited) is hidden from the players
  trapId: null, // the Traps tool's trap being drawn
  draftTrap: null, // a new trap with no squares yet -- it joins the map with its first square
  queue: [], // objects / items picked to place, the first one next: [{asset: {key, label, url}, hidden, item}]
  creatureQueue: [], // the adventure's Pokemon / NPCs picked to place: [{kind: 'pokemon' | 'npc', key, label, hidden, level, npc}]
  extraAssets: new Map(), // the items' pictures as object pictures, by key ('item:<name>')
  placingCreature: false,
};

const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gigantic'];
const HOLD_MS = 350; // a press held this long without moving turns the object; moved before that, it's dragged

/** The adventure being prepared: its Pokemon and NPCs are the map's own (the store's creatures), not a battle's. */
const prepCreatures = () => !_live && !!_opts.adventure;
const creaturesTool = () => _live || prepCreatures();
/** One of the DM's own creatures (a player's can be moved, but not hidden or taken off from here). */
const dmOwned = c => !_live || !c.owner || c.owner === 'DM';

/** A number field with − and + buttons either side (the user's call, 2026-10-19 -- the browser's arrows are tiny). */
function stepperHtml(id, value, { min = 0, max = 99, step = 1 } = {}) {
  return `<div class="dm-stepper"><button type="button" class="dm-btn" data-step="${id}" data-d="-${step}" title="Less">−</button>
    <input class="dm-input" id="${id}" type="number" min="${min}" max="${max}" step="${step}" value="${value}">
    <button type="button" class="dm-btn" data-step="${id}" data-d="${step}" title="More">+</button></div>`;
}

/** The − / + buttons: the field's number moves by a step (within its min / max) and it tells its listeners. */
function wireSteppers(scope) {
  scope.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
    const input = scope.querySelector(`#${b.dataset.step}`);
    if (!input) return;
    const next = Math.max(Number(input.min), Math.min(Number(input.max), (Number(input.value) || 0) + Number(b.dataset.d)));
    if (next === Number(input.value)) return;
    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }));
}

let _root = null;
let _onDone = null;
let _opts = {}; // renderMapEditor's options, kept for redrawing it
let _unsub = null;

/** The object / background lists read again next time (the Admin module uploaded or deleted one). */
export function forgetMapAssets() {
  _assets = null;
}

/** Loads the object / background lists once per page (they're files on the Pi). */
async function loadAssets() {
  if (!_assets) {
    const res = await DmAPI.mapAssets();
    _assets = res.data || { objects: [], backgrounds: [] };
    _assets.objects.forEach(o => cropFor(o.url));
  }
  return _assets;
}

/** The part of a picture that isn't transparent, as fractions [x0, y0, x1, y1] -- worked out once per picture. */
function cropFor(url) {
  if (!_crops.has(url)) {
    _crops.set(url, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = 160, h = Math.max(1, Math.round(160 * img.naturalHeight / img.naturalWidth));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        let x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (data[(y * w + x) * 4 + 3] > 16) {
              if (x < x0) x0 = x; if (x > x1) x1 = x;
              if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
          }
        }
        resolve(x1 < 0 ? [0, 0, 1, 1] : [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h].map(v => Math.round(v * 1000) / 1000));
      };
      img.onerror = () => resolve([0, 0, 1, 1]);
      img.src = url;
    }).then(c => { _cropResolved.set(url, c); return c; }));
  }
  return _crops.get(url);
}

function cropNow(url) {
  cropFor(url);
  return _cropResolved.get(url) || [0, 0, 1, 1];
}

/** The object the Objects tool would place with its top-left corner (as seen) on board cell (col, row), or null if
 * it doesn't fit. Screen width = board rows, screen height = board cols; the TV adds a quarter turn, so the stored
 * turn is a quarter less than what the DM sees. */
function objectAt(m, col, row, id = null) {
  const asset = currentAsset();
  if (!asset) return null;
  // Its box as seen: the picture at the nearest quarter turn (any angle beyond that turns it about the box's centre).
  const [sw, sh] = screenBox();
  const w = sh, h = sw;
  const o = {
    id: id || newId('obj'), kind: asset.key, label: asset.label, url: asset.url,
    col, row: row - h + 1, w, h, rot: ((ed.objRot - 90) % 360 + 360) % 360, crop: cropNow(asset.url),
    height: ed.objHeight, ...(ed.objMark ? { markKind: ed.objMark } : {}), ...(ed.objHidden ? { hidden: true } : {}),
  };
  return o.row >= 0 && o.col + o.w <= m.cols && o.row + o.h <= m.rows ? o : null;
}

/** The picture the Objects tool uses: the chosen kind, or -- editing an object whose picture is no longer on the Pi --
 * that object's own. */
function currentAsset() {
  return _assets?.objects.find(o => o.key === ed.objectKey) || ed.extraAssets.get(ed.objectKey)
    || (ed.selectedId ? ed.editAsset : null) || null;
}

/** A placed object's box on screen, in squares: top-left (sx, sy) and size (sw, sh). */
function screenBoxOf(m, o) {
  return { sx: m.rows - o.row - (o.h || 1), sy: o.col, sw: o.h || 1, sh: o.w || 1 };
}

/** The object the tool's settings make, its box centred on screen point (cx, cy) (squares) -- null if it doesn't fit. */
function objectCentredAt(m, cx, cy, id = null) {
  const [sw, sh] = screenBox();
  const sx = Math.round(cx - sw / 2), sy = Math.round(cy - sh / 2);
  return objectAt(m, sy, m.rows - 1 - sx, id);
}

/** Puts `next` on the map -- in `old`'s place (same spot in the stacking order) when editing -- and moves the squares it
 * marks (difficult / blocked) along with it. */
function commitObject(next, old = null) {
  updateSetup(st => {
    const objs = st.map.objects || [];
    const at = old ? objs.findIndex(o => o.id === old.id) : -1;
    st.map.objects = at >= 0 ? objs.map((o, i) => (i === at ? next : o)) : [...objs, next];
    if (old) unmarkObject(st, old, next.id);
    if (next.markKind && !next.hidden) { // a hidden object's squares stay ordinary until it's revealed
      st.map.marks = st.map.marks || {};
      objectCells(next, st.map).forEach(p => { st.map.marks[`${p.col},${p.row}`] = next.markKind; });
    }
  });
}

/** Squares `gone` marked go back to normal unless another object (other than `exceptId`'s new self) still marks them. */
function unmarkObject(st, gone, exceptId = null) {
  if (!gone.markKind || gone.hidden) return;
  const kept = new Set((st.map.objects || []).filter(o => o.markKind === gone.markKind && o.id !== exceptId && !o.hidden)
    .flatMap(o => objectCells(o).map(p => `${p.col},${p.row}`)));
  objectCells(gone).forEach(p => {
    const k = `${p.col},${p.row}`;
    if (st.map.marks?.[k] === gone.markKind && !kept.has(k)) delete st.map.marks[k];
  });
}

function removeObject(hit) {
  updateSetup(st => {
    st.map.objects = (st.map.objects || []).filter(o => o.id !== hit.id);
    unmarkObject(st, hit);
  });
}

function topObjectAt(m, col, row) {
  return [...(m.objects || [])].reverse().find(o => objectCells(o).some(p => p.col === col && p.row === row)) || null;
}

/** Edit a placed object: the tool's settings become its own. */
function selectObject(o) {
  const m = getSetup().map;
  ed.selectedId = o.id;
  ed.editAsset = { key: o.kind, label: o.label, url: o.url };
  const known = _assets.objects.find(a => a.url === o.url) || _assets.objects.find(a => a.key === o.kind);
  ed.objectKey = known ? known.key : '';
  ed.objRot = (((o.rot || 0) + 90) % 360 + 360) % 360; // stored a quarter turn less than seen (objectAt)
  const sideways = Math.round(ed.objRot / 90) % 2;
  ed.objW = sideways ? (o.w || 1) : (o.h || 1);
  ed.objH = sideways ? (o.h || 1) : (o.w || 1);
  ed.objHeight = o.height ?? 0;
  ed.objMark = o.markKind || '';
  ed.objHidden = !!o.hidden;
  const b = screenBoxOf(m, o);
  ed.editCx = b.sx + b.sw / 2; ed.editCy = b.sy + b.sh / 2;
  renderToolPanel();
  renderGhost();
}

function deselectObject() {
  if (!ed.selectedId) return;
  ed.selectedId = null;
  ed.editAsset = null;
  if (!ed.objectKey && _assets.objects.length) selectObjectKind(_assets.objects[0].key);
  renderToolPanel();
  renderGhost();
}

/** The object being edited, rebuilt from the tool's settings around its centre. False (and nothing changed) when it
 * wouldn't fit there -- the settings go back to the object's own. */
function applyEdit() {
  const m = getSetup().map;
  const old = (m.objects || []).find(o => o.id === ed.selectedId);
  if (!old) { deselectObject(); return false; }
  const next = objectCentredAt(m, ed.editCx, ed.editCy, old.id);
  if (!next) {
    toast("It doesn't fit there -- move it further in first.");
    selectObject(old);
    return false;
  }
  if (next.url === old.url) next.crop = old.crop;
  commitObject(next, old);
  return true;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/** `store`: another map than Map setup's (map-store.js -- an encounter's, the adventure's); `backLabel` / `title` name it. */
export async function renderMapEditor(root, { onDone, live = false, store = null, backLabel = null, title = null, adventure = false }) {
  _opts = { onDone, live, store, backLabel, title, adventure };
  // One editor at a time: it finds its parts by id, so one still drawn somewhere else (another module, a hidden tab)
  // would be the one it changes. That one is emptied -- its owner draws it again when it's shown (editorShownIn).
  if (_root && _root !== root && document.body.contains(_root)) { _unsub?.(); _unsub = null; _root.innerHTML = ''; }
  _root = root;
  _onDone = onDone;
  _live = live;
  _store = store || (live ? liveStore : setupStore);
  if (!live && !adventure && ed.tool === 'creatures') ed.tool = 'objects';
  if (!live && !adventure) ed.creatureQueue = [];
  root.innerHTML = '<div class="dm-loading">Loading the map tools…</div>';
  try {
    await loadAssets();
  } catch (err) {
    root.innerHTML = `<div class="dm-loading">Couldn't load the map pictures: ${escapeHtml(err.message)}</div>`;
    return;
  }
  if (!ed.objectKey && _assets.objects.length) selectObjectKind(_assets.objects[0].key);
  const m = getSetup().map;

  root.innerHTML = `
    <div class="dm-editor">
      <aside class="dm-editor-tools">
        <div class="dm-editor-head">
          <button class="dm-btn small" id="mapBack">${escapeHtml(backLabel || (_live ? '← Battle' : '← Map setup'))}</button>
          <h2>${escapeHtml(title || (_live ? 'Battle map' : 'Map'))}</h2>
          <button class="dm-btn primary small" id="mapDone">✓ Done</button>
        </div>
        ${_live ? '<div class="dm-hint dm-live-note">The map being played on (the battle\'s or the adventure\'s) -- every change shows on the players\' screens and the table at once.</div>' : ''}

        ${_live ? '' : `<div class="dm-card">
          <div class="dm-card-title">Size</div>
          <div class="dm-row">
            <div class="dm-field"><label for="mapAcross">Squares across</label><input class="dm-input" id="mapAcross" type="number" min="1" max="60" value="${m.rows}"></div>
            <div class="dm-field"><label for="mapDown">Squares down</label><input class="dm-input" id="mapDown" type="number" min="1" max="60" value="${m.cols}"></div>
          </div>
          <label class="dm-check"><input type="checkbox" id="mapLock" ${m.lockRatio ? 'checked' : ''}>
            <span>Keep the table TV's shape <small>Squares stay square on the TV. Untick to make any shape.</small></span></label>
          <button class="dm-btn wide" id="mapApplySize">Apply size</button>
        </div>`}

        <div class="dm-card">
          <div class="dm-card-title">Background</div>
          <select class="dm-select" id="mapBackground">
            <option value="">No background</option>
            ${_assets.backgrounds.map(b => `<option value="${escapeHtml(b.url)}" ${b.url === m.background ? 'selected' : ''}>${escapeHtml(b.label)}</option>`).join('')}
          </select>
        </div>



        ${_live ? '' : `<div class="dm-card">
          <div class="dm-card-title">Saved maps</div>
          <div class="dm-row dm-map-saverow">
            <input class="dm-input" id="mapSaveName" placeholder="Name this map…" maxlength="60" autocomplete="off">
            <button class="dm-btn" id="mapSave">💾 Save</button>
          </div>
          <div class="dm-saved-maps" id="mapSavedList"><div class="dm-hint">Loading…</div></div>
        </div>`}

        <div class="dm-card">
          <div class="dm-card-title">Add to the map</div>
          <div class="dm-add-grid" id="mapAdd">
            ${adventure ? `<button class="dm-btn" data-add="pokemon">🐾 Pokémon</button>
            <button class="dm-btn" data-add="npc">👤 NPCs</button>` : ''}
            <button class="dm-btn" data-add="object">🌲 Objects</button>
            <button class="dm-btn" data-add="item">🎒 Items</button>
          </div>
          ${adventure && !_live ? '<div class="dm-hint" style="margin-top:0.35rem">Pokémon and NPCs wait on the map -- the players see them once the map is opened to them (hidden ones only when you show them).</div>' : ''}
        </div>

        <div class="dm-card">
          <div class="dm-tool-tabs" id="mapTools">
            ${_live || adventure ? '<button data-tool="creatures">🧍 Creatures</button>' : ''}
            <button data-tool="objects">🌲 Objects</button>
            <button data-tool="terrain">🟫 Terrain</button>
            <button data-tool="traps">🪤 Traps</button>
            <button data-tool="erase">🧽 Eraser</button>
          </div>
          <div id="mapToolPanel"></div>
        </div>

        <div class="dm-editor-foot">
          <button class="dm-btn small" id="mapClearObjects">Clear objects</button>
          <button class="dm-btn small" id="mapClearMarks">Clear terrain</button>
        </div>
      </aside>
      <section class="dm-editor-canvas">
        <div class="dm-editor-hint" id="mapHint"></div>
        <div class="dm-map-wrap" id="mapWrap"></div>
        <div class="dm-map-legend">
          <span><i class="mark-difficult"></i>Difficult terrain -- double movement on the ground</span>
          <span><i class="mark-blocked"></i>Blocked -- can't be walked through or stood on</span>
          <span>Flying and floating (Levitate) creatures aren't affected by either.</span>
        </div>
      </section>
    </div>`;

  wireStatic();
  renderToolPanel();
  renderStage();
  if (!_live) renderSavedMaps();
  _unsub?.();
  _unsub = onSetupChange(() => {
    if (!document.body.contains(_root)) return;
    renderStage();
    // The square counts on the Traps panel follow too -- unless the DM is typing in it (a redraw would lose the text).
    const typing = document.activeElement?.closest?.('#mapToolPanel');
    if ((creaturesTool() && ed.tool === 'creatures' && !typing) || (ed.tool === 'traps' && !typing)) renderToolPanel();
  });
}

// ---------------------------------------------------------------------------
// Saved maps: the map alone -- size, background, objects, difficult / blocked squares and its terrain -- kept on the Pi
// (dm_state 'saved-maps') to use again later. Never the creatures (or the weather, which is the day's, not the map's).
// Shape: [{ id, name, savedAt, map: {cols, rows, lockRatio, background, objects, marks, terrain} }], newest first.
// ---------------------------------------------------------------------------

const SAVED_KEYS = ['cols', 'rows', 'lockRatio', 'background', 'objects', 'marks', 'terrain'];
let _savedMaps = null;

async function loadSavedMaps() {
  if (!_savedMaps) _savedMaps = (await DmAPI.getState('saved-maps').catch(() => null)) || [];
  return _savedMaps;
}

async function renderSavedMaps() {
  const box = document.getElementById('mapSavedList');
  if (!box) return;
  const list = await loadSavedMaps();
  box.innerHTML = list.length ? list.map(sm => `
    <div class="dm-saved-map" data-map="${escapeHtml(sm.id)}">
      <div class="dm-saved-map-preview">${mapStageHtml({ map: sm.map, creatures: [] }, { preview: true })}</div>
      <div class="dm-saved-map-main">
        <strong title="${escapeHtml(sm.name)}">${escapeHtml(sm.name)}</strong>
        <small>${sm.map.rows} × ${sm.map.cols} · ${(sm.map.objects || []).length} object${(sm.map.objects || []).length === 1 ? '' : 's'}</small>
        <span class="dm-saved-map-btns">
          <button class="dm-btn small" data-load-map="${escapeHtml(sm.id)}">Load</button>
          <button class="dm-btn small danger" data-delete-map="${escapeHtml(sm.id)}" title="Delete this saved map">🗑</button>
        </span>
      </div>
    </div>`).join('') : '<div class="dm-hint">No saved maps yet.</div>';
}

async function saveCurrentMap() {
  const input = document.getElementById('mapSaveName');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  const list = await loadSavedMaps();
  const same = list.find(sm => sm.name.toLowerCase() === name.toLowerCase());
  if (same && !await showCombatConfirm(`There's already a saved map called "${same.name}". Replace it with this one?`, { title: 'Save map', yesLabel: 'Replace', noLabel: 'Cancel' })) return;
  const m = getSetup().map;
  const entry = {
    id: same?.id || newId('map'), name, savedAt: new Date().toISOString(),
    map: JSON.parse(JSON.stringify(Object.fromEntries(SAVED_KEYS.map(k => [k, m[k]])))),
  };
  const next = [entry, ...list.filter(sm => sm !== same)];
  try {
    await DmAPI.saveState('saved-maps', next);
    _savedMaps = next;
    input.value = '';
    toast(`Saved "${name}"`);
    renderSavedMaps();
  } catch (err) {
    showCombatAlert(err.message, { title: "Couldn't save the map" });
  }
}

/** Puts a saved map in place of the current one. Creatures already placed keep their spot when it's still on the map
 * and not blocked; the others are unplaced (they stay in the battle). */
async function loadSavedMap(id) {
  const sm = (await loadSavedMaps()).find(x => x.id === id);
  if (!sm) return;
  const s = getSetup();
  const hasMap = (s.map.objects || []).length || Object.keys(s.map.marks || {}).length;
  const placed = s.creatures.filter(c => c.position).length;
  if ((hasMap || placed) && !await showCombatConfirm(`Load "${sm.name}"? It replaces the map you have now${placed ? ' -- creatures placed on it keep their spot only where that square is still there and open' : ''}.`, { title: 'Load map', yesLabel: 'Load', noLabel: 'Cancel' })) return;
  const loaded = JSON.parse(JSON.stringify(sm.map));
  updateSetup((st) => {
    st.map = { ...emptySetup().map, ...loaded, weather: st.map.weather, ready: st.map.ready };
    st.creatures.forEach((c) => {
      if (!c.position) return;
      const { col, row } = c.position;
      const fits = col >= 0 && col < st.map.cols && row >= 0 && row < st.map.rows && st.map.marks?.[`${col},${row}`] !== 'blocked';
      if (!fits) c.position = null;
    });
  });
  toast(`Loaded "${sm.name}"`);
  renderMapEditor(_root, _opts); // the size and background fields show the loaded map
}

async function deleteSavedMap(id) {
  const list = await loadSavedMaps();
  const sm = list.find(x => x.id === id);
  if (!sm || !await showCombatConfirm(`Delete the saved map "${sm.name}"? The map you're working on stays.`, { title: 'Delete saved map', yesLabel: 'Delete', noLabel: 'Cancel' })) return;
  const next = list.filter(x => x !== sm);
  try {
    await DmAPI.saveState('saved-maps', next);
    _savedMaps = next;
    renderSavedMaps();
  } catch (err) {
    showCombatAlert(err.message, { title: "Couldn't delete the map" });
  }
}

function selectObjectKind(key) {
  ed.objectKey = key;
  if (!ed.selectedId) ed.objHeight = DEFAULT_HEIGHTS[key] ?? 5; // an edited object keeps its own height
}

function wireStatic() {
  if (!_live) {
    const across = document.getElementById('mapAcross');
    const down = document.getElementById('mapDown');
    const lock = document.getElementById('mapLock');
    across.addEventListener('input', () => {
      if (lock.checked && Number(across.value) > 0) down.value = Math.max(1, Math.round(Number(across.value) / TV_ASPECT));
    });
    down.addEventListener('input', () => {
      if (lock.checked && Number(down.value) > 0) across.value = Math.max(1, Math.round(Number(down.value) * TV_ASPECT));
    });
    lock.addEventListener('change', () => updateSetup(s => { s.map.lockRatio = lock.checked; }));
    document.getElementById('mapApplySize').addEventListener('click', () => applySize(Number(across.value), Number(down.value)));
  }
  document.getElementById('mapBackground').addEventListener('change', (e) => updateSetup(s => { s.map.background = e.target.value; }));
  document.getElementById('mapAdd').addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]');
    if (b && !b.disabled) addToMap(b.dataset.add);
  });
  document.getElementById('mapTools').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tool]');
    if (!b) return;
    ed.tool = b.dataset.tool;
    if (ed.tool !== 'objects') { ed.selectedId = null; ed.editAsset = null; }
    if (ed.tool !== 'creatures') ed.creatureId = null;
    if (ed.tool !== 'traps') { ed.trapId = null; ed.draftTrap = null; }
    renderToolPanel();
    renderStage();
  });
  document.getElementById('mapBack').addEventListener('click', () => leave());
  document.getElementById('mapSave')?.addEventListener('click', saveCurrentMap);
  document.getElementById('mapSaveName')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveCurrentMap(); });
  document.getElementById('mapSavedList')?.addEventListener('click', (e) => {
    const load = e.target.closest('[data-load-map]');
    if (load) { loadSavedMap(load.dataset.loadMap); return; }
    const del = e.target.closest('[data-delete-map]');
    if (del) deleteSavedMap(del.dataset.deleteMap);
  });
  document.getElementById('mapDone').addEventListener('click', () => {
    if (!_live) updateSetup(s => { s.map.ready = true; });
    leave();
  });
  document.getElementById('mapClearObjects').addEventListener('click', async () => {
    if (!(getSetup().map.objects || []).length) return;
    if (await showCombatConfirm('Remove every object from the map?', { title: 'Clear objects', yesLabel: 'Clear', noLabel: 'Cancel' })) {
      updateSetup(s => { s.map.objects = []; });
    }
  });
  document.getElementById('mapClearMarks').addEventListener('click', async () => {
    if (!Object.keys(getSetup().map.marks || {}).length) return;
    if (await showCombatConfirm('Remove every difficult / blocked square?', { title: 'Clear terrain', yesLabel: 'Clear', noLabel: 'Cancel' })) {
      updateSetup(s => { s.map.marks = {}; });
    }
  });
  if (!wireStatic.mouseUpBound) {
    document.addEventListener('pointerup', () => { ed.painting = false; });
    document.addEventListener('pointercancel', () => { ed.painting = false; });
    wireStatic.mouseUpBound = true;
  }
}

async function leave() {
  _unsub?.();
  _unsub = null;
  try { await flushSetup(); } catch (err) { showCombatAlert(err.message, { title: "Couldn't save the map" }); }
  _onDone?.();
}

/** New size. Things keep their place as seen from the top-left corner -- growing the map adds squares at the right
 * and bottom (the board's rows run right-to-left on this screen, so everything shifts along with them). Anything
 * that no longer fits is dropped, after asking. */
async function applySize(across, down) {
  if (!(across >= 1 && across <= 60 && down >= 1 && down <= 60)) {
    showCombatAlert('Use between 1 and 60 squares each way.', { title: 'Map size' });
    return;
  }
  const s = getSetup();
  const m = s.map;
  const shift = across - m.rows; // keeps the screen-left edge where it is
  const fitsObj = o => o.col >= 0 && o.row + shift >= 0 && o.col + o.w <= down && o.row + shift + o.h <= across;
  const markKeys = Object.keys(m.marks || {});
  const fitsCell = (c, r) => c >= 0 && c < down && r + shift >= 0 && r + shift < across;
  const lostObjects = (m.objects || []).filter(o => !fitsObj(o)).length;
  const lostMarks = markKeys.filter(k => { const [c, r] = k.split(',').map(Number); return !fitsCell(c, r); }).length;
  const lostCreatures = s.creatures.filter(c => c.position && !fitsCell(c.position.col, c.position.row)).length;
  if (lostObjects || lostMarks || lostCreatures) {
    const parts = [lostObjects && `${lostObjects} object(s)`, lostMarks && `${lostMarks} marked square(s)`, lostCreatures && `${lostCreatures} placed creature(s)`].filter(Boolean);
    if (!await showCombatConfirm(`The smaller map loses ${parts.join(', ')}. Go ahead?`, { title: 'Map size', yesLabel: 'Resize', noLabel: 'Cancel' })) return;
  }
  updateSetup(st => {
    const mm = st.map;
    mm.objects = (mm.objects || []).filter(fitsObj).map(o => ({ ...o, row: o.row + shift }));
    const marks = {};
    markKeys.forEach(k => { const [c, r] = k.split(',').map(Number); if (fitsCell(c, r)) marks[`${c},${r + shift}`] = mm.marks[k]; });
    mm.marks = marks;
    st.creatures.forEach(c => {
      if (!c.position) return;
      c.position = fitsCell(c.position.col, c.position.row) ? { ...c.position, row: c.position.row + shift } : null;
    });
    mm.rows = across;
    mm.cols = down;
  });
}

function renderToolPanel() {
  document.querySelectorAll('#mapTools [data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === ed.tool));
  const panel = document.getElementById('mapToolPanel');
  const hint = document.getElementById('mapHint');
  if (ed.tool === 'objects') {
    const asset = currentAsset();
    const editing = !!ed.selectedId;
    const missing = editing && !ed.objectKey; // its picture is no longer on the Pi
    panel.innerHTML = _assets.objects.length || editing ? `
      ${editing ? `<div class="dm-edit-head"><b>Editing: ${escapeHtml(asset?.label || 'object')}</b><small>Changes apply at once.</small></div>` : ''}
      ${!editing && ed.queue.length ? `<div class="dm-place-queue"><b>Placing ${escapeHtml(asset?.label || '')}</b>
        <small>${ed.queue.length > 1 ? `Then: ${escapeHtml(ed.queue.slice(1).map(q => q.asset.label).join(', '))}` : 'The last one picked'}${ed.objHidden ? ' · 🙈 hidden' : ''}</small>
        <span><button class="dm-btn small" id="queueSkip">Skip</button><button class="dm-btn small" id="queueStop">Stop</button></span></div>` : ''}
      <div class="dm-object-pick">
        <div class="dm-object-preview">${asset ? `<img src="${escapeHtml(asset.url)}" alt="" style="transform:rotate(${ed.objRot}deg)">` : ''}</div>
        <div><b>${escapeHtml(missing ? `${asset?.label || '?'} (no longer on the Pi)` : asset?.label || 'Nothing picked')}</b>
          <button class="dm-btn small" id="objPick">${editing ? '↺ Another picture…' : '🌲 Pick objects…'}</button></div>
      </div>
      <div class="dm-row">
        <div class="dm-field"><label for="objW">Width (squares)</label>${stepperHtml('objW', ed.objW, { min: 1, max: 20 })}</div>
        <div class="dm-field"><label for="objH">Height (squares)</label>${stepperHtml('objH', ed.objH, { min: 1, max: 20 })}</div>
      </div>
      <div class="dm-row">
        <div class="dm-field"><label for="objTall">How tall (ft)</label>${stepperHtml('objTall', ed.objHeight, { min: 0, max: 500, step: 5 })}</div>
        <div class="dm-field"><label>Turn <span id="objRotLabel">${ed.objRot}°</span></label>
          <div class="dm-row"><button class="dm-btn" id="objRotL" title="Turn left 15°">⟲</button><button class="dm-btn" id="objRotR" title="Turn right 15°">⟳</button></div>
        </div>
      </div>
      <input type="range" class="dm-obj-turn" id="objRot" min="0" max="359" step="1" value="${ed.objRot}" title="Turn it to any angle">
      <div class="dm-field"><label for="objMark">Its squares are also</label>
        <select class="dm-select" id="objMark">
          <option value="" ${!ed.objMark ? 'selected' : ''}>Just a picture</option>
          <option value="difficult" ${ed.objMark === 'difficult' ? 'selected' : ''}>Difficult terrain</option>
          <option value="blocked" ${ed.objMark === 'blocked' ? 'selected' : ''}>Blocked</option>
        </select>
      </div>
      <label class="dm-check"><input type="checkbox" id="objHidden" ${ed.objHidden ? 'checked' : ''}>
        <span>🙈 Hidden from the players <small>Only you see it (see-through) until you untick this -- its squares aren't difficult / blocked meanwhile.</small></span></label>
      ${editing ? `
      <div class="dm-field"><label>Move it a square</label>
        <div class="dm-row dm-obj-move">
          <button class="dm-btn" data-move-obj="-1,0" title="One square left">←</button><button class="dm-btn" data-move-obj="0,-1" title="One square up">↑</button>
          <button class="dm-btn" data-move-obj="0,1" title="One square down">↓</button><button class="dm-btn" data-move-obj="1,0" title="One square right">→</button>
        </div>
      </div>
      <div class="dm-row">
        <button class="dm-btn" id="objRemove">🗑 Remove</button>
        <button class="dm-btn primary" id="objDoneEdit">✓ Done</button>
      </div>` : ''}` : '<div class="dm-hint">No object pictures yet -- upload them in the Admin module (Map pictures).</div>';
    hint.textContent = editing
      ? 'Picked up: click a square to move it there (or drag it) -- hold it still a moment, then move the pointer around it to turn it. Click it again (or Done) to put it down.'
      : 'Click a square to place the object there -- or hold and move the pointer around to turn it, then let go. Click a placed object to move it, hold it to turn it.';
    wireSteppers(panel);
    // Editing: every change goes straight onto the object (applyEdit). Placing: it only changes what the next one looks like.
    const changed = () => { if (ed.selectedId) applyEdit(); else renderGhost(); };
    document.getElementById('objPick')?.addEventListener('click', () => (ed.selectedId ? changeObjectPicture() : addToMap('object')));
    document.getElementById('queueSkip')?.addEventListener('click', () => nextQueued());
    document.getElementById('queueStop')?.addEventListener('click', () => { ed.queue = []; renderToolPanel(); });
    document.getElementById('objW')?.addEventListener('change', (e) => { ed.objW = clampInt(e.target.value, 1, 20); changed(); });
    document.getElementById('objH')?.addEventListener('change', (e) => { ed.objH = clampInt(e.target.value, 1, 20); changed(); });
    if (!editing) {
      document.getElementById('objW')?.addEventListener('input', (e) => { ed.objW = clampInt(e.target.value, 1, 20); renderGhost(); });
      document.getElementById('objH')?.addEventListener('input', (e) => { ed.objH = clampInt(e.target.value, 1, 20); renderGhost(); });
    }
    document.getElementById('objTall')?.addEventListener('change', (e) => { ed.objHeight = clampInt(e.target.value, 0, 500); if (ed.selectedId) applyEdit(); });
    document.getElementById('objRotL')?.addEventListener('click', () => turnObject(-15));
    document.getElementById('objRotR')?.addEventListener('click', () => turnObject(15));
    document.getElementById('objRot')?.addEventListener('input', (e) => setObjectTurn(Number(e.target.value)));
    document.getElementById('objMark')?.addEventListener('change', (e) => { ed.objMark = e.target.value; if (ed.selectedId) applyEdit(); });
    document.getElementById('objHidden')?.addEventListener('change', (e) => { ed.objHidden = e.target.checked; if (ed.selectedId) applyEdit(); });
    panel.querySelectorAll('[data-move-obj]').forEach(b => b.addEventListener('click', () => {
      const [dx, dy] = b.dataset.moveObj.split(',').map(Number);
      ed.editCx += dx; ed.editCy += dy;
      if (!applyEdit()) { ed.editCx -= dx; ed.editCy -= dy; }
    }));
    document.getElementById('objRemove')?.addEventListener('click', () => {
      const o = (getSetup().map.objects || []).find(x => x.id === ed.selectedId);
      ed.selectedId = null; ed.editAsset = null;
      if (o) removeObject(o);
      if (!ed.objectKey && _assets.objects.length) selectObjectKind(_assets.objects[0].key);
      renderToolPanel();
    });
    document.getElementById('objDoneEdit')?.addEventListener('click', deselectObject);
  } else if (ed.tool === 'creatures' && ed.creatureQueue.length) {
    const q = ed.creatureQueue[0];
    panel.innerHTML = `
      <div class="dm-place-queue"><b>Placing ${escapeHtml(q.label)}${q.hidden ? ' 🙈' : ''}</b>
        <small>${ed.creatureQueue.length > 1 ? `Then: ${escapeHtml(ed.creatureQueue.slice(1).map(x => x.label).join(', '))}` : 'The last one picked'}</small>
        <span><button class="dm-btn small" id="queueSkip">Skip</button><button class="dm-btn small" id="queueStop">Stop</button></span></div>
      ${q.kind === 'pokemon' ? `<div class="dm-field"><label for="queueLevel">Its level</label>${stepperHtml('queueLevel', q.level, { min: 1, max: 20 })}</div>` : ''}
      <div class="dm-hint">${q.hidden ? 'Hidden: only you see it until you show it (the Creatures tool).' : prepCreatures() ? 'The players see it once the map is opened to them.' : 'The players see it as soon as it\'s on the map.'}</div>`;
    wireSteppers(panel);
    hint.textContent = ed.placingCreature ? `Putting ${q.label} on the map…` : `Click a square to put ${q.label} there.`;
    document.getElementById('queueLevel')?.addEventListener('change', (e) => { q.level = Math.max(1, Math.min(20, Number(e.target.value) || q.level)); });
    document.getElementById('queueSkip').addEventListener('click', () => { ed.creatureQueue.shift(); renderToolPanel(); });
    document.getElementById('queueStop').addEventListener('click', () => { ed.creatureQueue = []; renderToolPanel(); });
  } else if (ed.tool === 'creatures') {
    const c = getSetup().creatures.find(x => x.id === ed.creatureId);
    panel.innerHTML = c ? `
      <div class="dm-edit-head"><b>${escapeHtml(c.name)}</b><small>Facing ${c.position.facing || 0}° · ${c.z ? `${c.z}ft up` : 'on the ground'}</small></div>
      ${dmOwned(c) ? `<label class="dm-check"><input type="checkbox" id="creHidden" ${c.hidden ? 'checked' : ''}><span>Hidden from the players <small>Only you see it (see-through) until you untick this.</small></span></label>` : ''}
      <div class="dm-field"><label>Turn</label><div class="dm-row">
        <button class="dm-btn" data-cre="turn" data-v="-45" title="Turn left 45°">⟲ 45°</button><button class="dm-btn" data-cre="turn" data-v="45" title="Turn right 45°">⟳ 45°</button></div></div>
      <div class="dm-field"><label>Height</label><div class="dm-row">
        <button class="dm-btn" data-cre="z" data-v="-5" title="5ft lower">▼ 5ft</button><button class="dm-btn" data-cre="z" data-v="5" title="5ft higher">▲ 5ft</button></div></div>
      <div class="dm-field"><label for="creSize">Size on the map</label>
        <select class="dm-select" id="creSize">
          ${SIZES.map(z => `<option value="${z}" ${z.toLowerCase() === String(c.participant?.size || 'Medium').toLowerCase() ? 'selected' : ''}>${z}${{ Large: ' (2×2)', Huge: ' (3×3)', Gigantic: ' (4×4)' }[z] || ' (1 square)'}</option>`).join('')}
        </select></div>
      <div class="dm-row">${dmOwned(c) ? '<button class="dm-btn" data-cre="remove">🗑 Take it off the map</button>' : ''}
        <button class="dm-btn primary" data-cre="done">✓ Done</button></div>`
      : `<div class="dm-hint">${prepCreatures() ? 'Tap a creature on the map, then tap a square to move it there. Add more with Pokémon / NPCs above.'
        : 'Tap a creature on the map -- anyone\'s -- then tap a square to move it there. It doesn\'t use its movement, and it doesn\'t have to be its turn.'}</div>`;
    hint.textContent = c ? `Tap a square to move ${c.name} there · turn it or change its height on the left.` : 'Creatures: tap one to pick it.';
    document.getElementById('creSize')?.addEventListener('change', (e) => { if (ed.creatureId) setCreatureSize(ed.creatureId, e.target.value); });
    document.getElementById('creHidden')?.addEventListener('change', (e) => { if (ed.creatureId) setCreatureHidden(ed.creatureId, e.target.checked); });
    panel.querySelectorAll('[data-cre]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.cre === 'done') { ed.creatureId = null; renderToolPanel(); renderStage(); return; }
      const now = getSetup().creatures.find(x => x.id === ed.creatureId);
      if (!now) return;
      if (b.dataset.cre === 'remove') { removeCreature(now); return; }
      const v = Number(b.dataset.v);
      moveCreature(now.id, b.dataset.cre === 'turn' ? { facing: ((((now.position.facing || 0) + v) % 360) + 360) % 360 } : { z: Math.max(-500, (now.z || 0) + v) });
    }));
  } else if (ed.tool === 'traps') {
    renderTrapPanel(panel, hint);
  } else if (ed.tool === 'terrain') {
    panel.innerHTML = `
      ${[['difficult', 'Difficult terrain', 'Double movement for creatures on the ground.'], ['blocked', 'Blocked', "Can't be walked through or stood on."], ['clear', 'Clear', 'Back to normal ground.']]
        .map(([k, label, sub]) => `<label class="dm-check"><input type="radio" name="terrainKind" value="${k}" ${ed.terrain === k ? 'checked' : ''}><span>${label} <small>${sub}</small></span></label>`).join('')}`;
    hint.textContent = 'Click or drag across squares to paint them.';
    panel.querySelectorAll('input[name="terrainKind"]').forEach(r => r.addEventListener('change', () => { ed.terrain = r.value; }));
  } else {
    panel.innerHTML = '<div class="dm-hint">Click an object to remove it, or a marked square to clear it.</div>';
    hint.textContent = 'Eraser: click what you want to remove.';
  }
}

function turnObject(delta) {
  setObjectTurn(ed.objRot + delta);
}

/** Any angle, like a line move's aim. Only the preview, the ghost and the angle label change -- the panel isn't redrawn,
 * so dragging the slider keeps going. */
function setObjectTurn(deg, { apply = true } = {}) {
  ed.objRot = ((Math.round(deg) % 360) + 360) % 360;
  const img = document.querySelector('.dm-object-preview img');
  if (img) img.style.transform = `rotate(${ed.objRot}deg)`;
  const slider = document.getElementById('objRot');
  if (slider && Number(slider.value) !== ed.objRot) slider.value = ed.objRot;
  const label = document.getElementById('objRotLabel');
  if (label) label.textContent = `${ed.objRot}°`;
  if (apply && ed.selectedId && !ed.gesture) applyEdit(); // the edited object turns with it (mid-press: on release)
  else renderGhost();
}

/** The object's box on screen (width, height in squares): its own size at the nearest quarter turn. */
function screenBox() {
  return (Math.round(ed.objRot / 90) % 2) ? [ed.objH, ed.objW] : [ed.objW, ed.objH];
}

function clampInt(v, lo, hi) {
  return Math.max(lo, Math.min(hi, parseInt(v, 10) || lo));
}

/** The whole map, the way the table TV shows it. Creatures already placed in the battle setup show, for reference. */
function renderStage() {
  const wrap = document.getElementById('mapWrap');
  if (!wrap) return;
  const s = getSetup();
  const m = s.map;
  wrap.innerHTML = mapStageHtml(s, { interactive: true, selectedId: ed.tool === 'creatures' ? ed.creatureId : null });
  const stage = wrap.querySelector('.dm-map-stage');
  // Live mode sits in the DM console's Map tab, under its tab bars -- less height to fill.
  stage.style.width = `min(100%, calc((100vh - ${_live ? 300 : 190}px) * ${m.rows / m.cols}))`;
  stage.querySelectorAll('[data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); });

  stage.style.touchAction = 'none'; // a held finger turns / paints instead of scrolling the page
  stage.addEventListener('pointerdown', (e) => {
    const cell = cellAtPointer(e);
    if (!cell) return;
    e.preventDefault();
    const { col, row } = cell;
    if (ed.tool === 'terrain') { startPainting(e); paint(col, row); }
    else if (ed.tool === 'traps') startTrapStroke(e, col, row);
    else if (ed.tool === 'objects') startObjectPress(e, col, row);
    else if (ed.tool === 'creatures') (ed.creatureQueue.length ? placeQueuedCreature(col, row) : onCreaturePress(col, row));
    else onCellClick(col, row);
  });
  stage.addEventListener('pointermove', (e) => {
    if (ed.gesture) return; // the press-and-turn follows the pointer itself
    const cell = cellAtPointer(e);
    if (!cell) return;
    if (ed.hover?.col === cell.col && ed.hover?.row === cell.row) return;
    ed.hover = cell;
    renderGhost();
  });
  stage.addEventListener('pointerleave', () => { if (!ed.gesture) { ed.hover = null; renderGhost(); } });
  renderGhost();
}

/** Terrain: keeps painting under the pointer until it's let go -- followed on the window, since every painted square
 * redraws the map (and a finger's touch stays tied to the element it started on, which that replaces). */
function startPainting(e, paintFn = paint) {
  ed.painting = true;
  const id = e.pointerId;
  let last = null;
  const move = (ev) => {
    if (ev.pointerId !== id || !ed.painting) return;
    const cell = cellAtPointer(ev);
    if (!cell || (last && last.col === cell.col && last.row === cell.row)) return;
    last = cell;
    paintFn(cell.col, cell.row);
  };
  const end = (ev) => {
    if (ev.pointerId !== id) return;
    ed.painting = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

/** Live mode's Creatures tool: a press on a creature picks it (again: lets go of it); with one picked, a press on a
 * square moves it there (live-map-store.js's placeToken -- the server checks it fits). */
function onCreaturePress(col, row) {
  const s = getSetup();
  const hit = s.creatures.find(c => footprintCells(c.position.col, c.position.row, footprintForSize(c.participant?.size))
    .some(p => p.col === col && p.row === row));
  if (hit && hit.id !== ed.creatureId) { ed.creatureId = hit.id; renderToolPanel(); renderStage(); return; }
  if (hit) { ed.creatureId = null; renderToolPanel(); renderStage(); return; }
  if (!ed.creatureId) return;
  moveCreature(ed.creatureId, { col, row });
}

/** Moves / turns / lifts a creature: the running map's through the Pi (anyone's, any time), the prepared adventure's in
 * its saved map. `change`: {col, row} | {facing} | {z}. */
function moveCreature(id, change) {
  if (_live) { liveStore.placeToken(id, change); return; }
  const c = getSetup().creatures.find(x => x.id === id);
  if (!c) return;
  if ('col' in change) {
    const problem = creatureSpotProblem(getSetup(), c, change.col, change.row);
    if (problem) { toast(problem); return; }
  }
  updateSetup((st) => {
    const x = st.creatures.find(y => y.id === id);
    if (!x) return;
    if ('z' in change) x.z = change.z;
    x.position = { ...x.position, ...('col' in change ? { col: change.col, row: change.row } : {}), ...('facing' in change ? { facing: change.facing } : {}) };
  });
}

function setCreatureSize(id, size) {
  if (_live) { liveStore.setTokenSize(id, size); return; }
  updateSetup((st) => { const x = st.creatures.find(y => y.id === id); if (x) x.participant = { ...x.participant, size }; });
}

/** Hidden from the players: the running map's creature sits out ('spectating' -- on no screen but the DM's), the prepared
 * one starts that way. */
async function setCreatureHidden(id, hidden) {
  if (_live) {
    try { await CombatAPI.setStatus(id, hidden ? 'spectating' : 'participating'); } catch (err) { showCombatAlert(err.message, { title: 'Hidden' }); }
    return;
  }
  updateSetup((st) => { const x = st.creatures.find(y => y.id === id); if (x) x.hidden = hidden; });
}

async function removeCreature(c) {
  if (!await showCombatConfirm(`Take ${c.name} off the map?`, { title: 'Take it off', yesLabel: 'Take it off', noLabel: 'Cancel' })) return;
  ed.creatureId = null;
  if (_live) {
    try { await CombatAPI.removeParticipant(c.id); } catch (err) { showCombatAlert(err.message, { title: 'Take it off' }); }
  } else {
    updateSetup((st) => { st.creatures = st.creatures.filter(x => x.id !== c.id); });
  }
  renderToolPanel();
}

/** The board square under the pointer, worked out from where it is on the map (the objects sit above the grid). */
function cellAtPointer(e) {
  const grid = document.querySelector('#mapWrap .dm-map-grid');
  if (!grid) return null;
  const m = getSetup().map;
  const r = grid.getBoundingClientRect();
  const sx = Math.floor((e.clientX - r.left) / r.width * m.rows), sy = Math.floor((e.clientY - r.top) / r.height * m.cols);
  if (sx < 0 || sy < 0 || sx >= m.rows || sy >= m.cols) return null;
  return { col: sy, row: m.rows - 1 - sx };
}

/** Objects tool, pointer pressed on board square (col, row): on a placed object, edit it (and turn it while held); on an
 * empty square, finish editing -- or start placing a new object there, turned while held, placed on release. */
function startObjectPress(e, col, row) {
  const m = getSetup().map;
  const hit = topObjectAt(m, col, row);
  // An object picked up: a click on an empty square moves it there (centred on that square)
  if (!hit && ed.selectedId) {
    const sx = m.rows - 1 - row, sy = col;
    const before = [ed.editCx, ed.editCy];
    ed.editCx = sx + 0.5; ed.editCy = sy + 0.5;
    const [sw, sh] = screenBox();
    if (sw % 2 === 0) ed.editCx += 0.5; // an even width can't be centred on one square -- it starts on the clicked one
    if (sh % 2 === 0) ed.editCy += 0.5;
    if (!applyEdit()) [ed.editCx, ed.editCy] = before;
    renderGhost();
    return;
  }
  const wasPicked = !!hit && hit.id === ed.selectedId;
  if (hit && !wasPicked) selectObject(hit);
  if (!hit && !currentAsset()) return;
  let cx, cy;
  if (hit) { cx = ed.editCx; cy = ed.editCy; }
  else {
    const [sw, sh] = screenBox();
    cx = (m.rows - 1 - row) + sw / 2; cy = col + sh / 2;
  }
  // A placed object: 'press' until it's either dragged (moved before HOLD_MS) or held (then the pointer turns it).
  // A new one turns from the start, as before.
  ed.gesture = { cx, cy, cx0: cx, cy0: cy, startRot: ed.objRot, ref: null, editing: hit?.id || null, turned: false, pointerId: e.pointerId,
    mode: hit ? 'press' : 'turn', x0: e.clientX, y0: e.clientY, wasPicked };
  if (hit) {
    ed.gesture.timer = setTimeout(() => {
      if (ed.gesture?.mode !== 'press') return;
      ed.gesture.mode = 'turn';
      document.querySelector('#mapWrap .dm-map-stage')?.classList.add('dm-turning');
      const hint = document.getElementById('mapHint');
      if (hint) hint.textContent = 'Turning -- move the pointer around the object, then let go.';
    }, HOLD_MS);
  }
  ed.hover = { col, row };
  const move = (ev) => {
    const g = ed.gesture;
    if (ev.pointerId !== g?.pointerId) return;
    if (g.mode === 'press') {
      const grid = document.querySelector('#mapWrap .dm-map-grid');
      const square = grid ? grid.getBoundingClientRect().width / m.rows : 30;
      if (Math.hypot(ev.clientX - g.x0, ev.clientY - g.y0) < square * 0.35) return; // a wobble, not a drag
      clearTimeout(g.timer);
      g.mode = 'drag';
    }
    if (g.mode === 'drag') dragByPointer(ev);
    else turnByPointer(ev);
  };
  const end = (ev) => {
    if (ev.pointerId !== ed.gesture?.pointerId) return;
    clearTimeout(ed.gesture.timer);
    document.querySelector('#mapWrap .dm-map-stage')?.classList.remove('dm-turning');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    finishObjectPress(ev.type === 'pointercancel');
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  renderGhost();
}

/** Dragging a placed object: its centre follows the pointer, a whole square at a time. */
function dragByPointer(e) {
  const g = ed.gesture;
  const grid = document.querySelector('#mapWrap .dm-map-grid');
  if (!grid) return;
  const m = getSetup().map;
  const r = grid.getBoundingClientRect();
  const dx = Math.round((e.clientX - g.x0) / (r.width / m.rows)), dy = Math.round((e.clientY - g.y0) / (r.height / m.cols));
  if (g.cx === g.cx0 + dx && g.cy === g.cy0 + dy) return;
  g.cx = g.cx0 + dx; g.cy = g.cy0 + dy;
  g.turned = true; // (changed -- the ghost shows it where it's going)
  renderGhost();
}

/** While held: the angle the pointer has gone round the object's centre since it first left it turns the object by as
 * much (5-degree steps) -- a twist, so it never jumps when the turn starts. */
function turnByPointer(e) {
  const g = ed.gesture;
  const grid = document.querySelector('#mapWrap .dm-map-grid');
  if (!grid) return;
  const m = getSetup().map;
  const r = grid.getBoundingClientRect();
  const square = r.width / m.rows;
  const px = r.left + g.cx * square, py = r.top + g.cy * (r.height / m.cols);
  const dx = e.clientX - px, dy = e.clientY - py;
  if (Math.hypot(dx, dy) < square * 0.6) return; // too close to the middle to tell a direction
  const ang = Math.atan2(dy, dx) * 180 / Math.PI;
  if (g.ref === null) { g.ref = ang; return; }
  const turn = Math.round((g.startRot + ang - g.ref) / 5) * 5;
  if (turn === ed.objRot) return;
  g.turned = true;
  setObjectTurn(turn, { apply: false });
}

async function finishObjectPress(cancelled) {
  const g = ed.gesture;
  ed.gesture = null;
  const m = getSetup().map;
  if (g.editing) {
    if (cancelled) { setObjectTurn(g.startRot, { apply: false }); renderGhost(); return; }
    if (g.mode === 'drag' && g.turned) {
      const before = [ed.editCx, ed.editCy];
      ed.editCx = g.cx; ed.editCy = g.cy;
      if (!applyEdit()) [ed.editCx, ed.editCy] = before;
      return;
    }
    if (g.turned) { applyEdit(); return; }
    // A click on the object already picked up puts it down
    if (g.mode === 'press' && g.wasPicked) { deselectObject(); return; }
    renderGhost();
    return;
  }
  if (cancelled) { renderGhost(); return; }
  const o = objectCentredAt(m, g.cx, g.cy);
  if (!o) {
    renderGhost();
    showCombatAlert("The object doesn't fit there -- make it smaller or move it further in.", { title: 'Place object' });
    return;
  }
  o.crop = await cropFor(o.url);
  commitObject(o);
  if (ed.queue.length) nextQueued();
}

// ---------------------------------------------------------------------------
// Add to the map: Objects, Items -- and on a running adventure Pokemon and NPCs -- picked in the picker, then placed one
// after another with a click each (the queue; Skip / Stop on the tool panel).
// ---------------------------------------------------------------------------

async function addToMap(kind) {
  if (kind === 'object') {
    const res = await openPicker({
      title: '🌲 Objects', multi: true, hiddenOption: true, confirmLabel: 'Place', emptyText: 'No object pictures yet -- upload them in the Admin module.',
      hint: 'Pick one or several -- then click the map to place each one (hold and move the pointer to turn it).',
      items: _assets.objects.map(o => ({ key: o.key, label: o.label, image: o.url })),
    });
    if (!res?.keys.length) return;
    queueObjects(res.keys.map(k => ({ asset: _assets.objects.find(o => o.key === k), hidden: res.hidden })).filter(q => q.asset));
  } else if (kind === 'item') {
    const items = await DmAPI.adminItems().catch(() => []);
    const res = await openPicker({
      title: '🎒 Items', multi: true, hiddenOption: true, confirmLabel: 'Place', imageFallback: 'assets/Bag.png',
      hint: 'Things lying on the map -- each one shows the item\'s picture (the bag when it has none). Click the map to place each one.',
      items: items.map(i => ({ key: i.name, label: i.name, sub: i.category, image: i.image || '' })),
    });
    if (!res?.keys.length) return;
    queueObjects(res.keys.map((name) => {
      const it = items.find(i => i.name === name);
      return { asset: { key: `item:${name}`, label: name, url: (it?.image || '/assets/Bag.png').split('?')[0] }, hidden: res.hidden, item: true };
    }));
  } else if (kind === 'pokemon') {
    const species = await getSpecies().catch(() => []);
    const res = await openPicker({
      title: '🐾 Pokémon', multi: true, hiddenOption: true, confirmLabel: 'Place',
      hint: 'Wild Pokémon on the adventure, at their lowest level met (change it before placing each one).',
      items: species.map(sp => ({ key: sp.name, label: sp.name, sub: `#${sp.dex ?? '?'} ${[sp.type1, sp.type2].filter(Boolean).join('/')}`, image: sp.image || sp.picture || '', search: `${sp.habitat || ''} ${sp.dex}` })),
    });
    if (!res?.keys.length) return;
    ed.creatureQueue = res.keys.map(k => ({ kind: 'pokemon', key: k, label: k, hidden: res.hidden, level: species.find(sp => sp.name === k)?.level || 1 }));
    startCreatureQueue();
  } else if (kind === 'npc') {
    const npcs = (await DmAPI.npcs().catch(() => null))?.data || [];
    const res = await openPicker({
      title: '👤 NPCs', multi: true, hiddenOption: true, confirmLabel: 'Place', emptyText: 'No NPCs in the NPC library yet.', imageFallback: 'assets/Pokeball.png',
      items: npcs.map(n => ({ key: n.id, label: n.name || 'NPC', sub: n.role || n.location || '', image: n.image || '' })),
    });
    if (!res?.keys.length) return;
    ed.creatureQueue = res.keys.map((id) => { const n = npcs.find(x => x.id === id); return { kind: 'npc', key: id, label: n?.name || 'NPC', hidden: res.hidden, npc: n }; });
    startCreatureQueue();
  }
}

function queueObjects(list) {
  if (!list.length) return;
  ed.queue = list;
  ed.tool = 'objects';
  ed.selectedId = null; ed.editAsset = null;
  useQueued(ed.queue[0]);
  renderToolPanel();
  renderStage();
}

/** The next object of the queue is what a click places (an item: a picture one square big, flat on the ground). */
function useQueued(q) {
  if (q.item) {
    ed.extraAssets.set(q.asset.key, q.asset);
    ed.objW = 1; ed.objH = 1; ed.objMark = '';
  }
  selectObjectKind(q.asset.key);
  if (q.item) ed.objHeight = 0;
  ed.objHidden = !!q.hidden;
}

function nextQueued() {
  ed.queue.shift();
  if (ed.queue.length) useQueued(ed.queue[0]);
  renderToolPanel();
  renderGhost();
}

/** Editing a placed object: another picture for it (one of the object pictures). */
async function changeObjectPicture() {
  const res = await openPicker({ title: '🌲 Another picture', items: _assets.objects.map(o => ({ key: o.key, label: o.label, image: o.url })) });
  if (!res?.keys.length) return;
  selectObjectKind(res.keys[0]);
  applyEdit();
  renderToolPanel();
}

function startCreatureQueue() {
  ed.tool = 'creatures';
  ed.creatureId = null;
  renderToolPanel();
  renderStage();
}

/** A name nobody on the map has yet: "Pidgey", then "Pidgey B", "Pidgey C"... */
function freeName(base) {
  const taken = new Set(_live ? Object.values(liveStore.session()?.participants || {}).map(p => p.name) : getSetup().creatures.map(c => c.name));
  if (!taken.has(base)) return base;
  for (let i = 1; i < 26; i++) {
    const name = `${base} ${String.fromCharCode(65 + i)}`;
    if (!taken.has(name)) return name;
  }
  return `${base} ${newId('').slice(-3)}`;
}

/** The adventure: the queue's next Pokemon / NPC stands on the square clicked -- on the running map it joins as one of
 * the DM's creatures (hidden: on no screen but the DM's); on the map being prepared it's kept with the map, and joins
 * when the adventure opens. */
async function placeQueuedCreature(col, row) {
  const q = ed.creatureQueue[0];
  if (!q || ed.placingCreature) return;
  ed.placingCreature = true;
  renderToolPanel();
  try {
    let participant, config = null;
    if (q.kind === 'pokemon') {
      const natures = JSON.parse(sessionStorage.getItem('natures') || '[]').map(n => n.name);
      const name = freeName(q.label);
      config = { species: q.key, level: q.level, nature: natures[Math.floor(Math.random() * natures.length)] || '', abilities: [0] };
      const res = await DmAPI.buildPokemon({ ...config, nickname: name !== q.label ? name : '' });
      ({ participant } = participantFromPokemon(res.data));
    } else {
      ({ participant } = participantFromTrainer({ ...npcTrainerConfig(q.npc || {}), name: freeName(q.label) }));
      participant.npcId = q.key;
    }
    participant.id = newId('adv');
    participant.owner = participant.owner || 'DM';
    participant.initiative = 0;
    participant.status = q.hidden ? 'spectating' : 'participating';
    if (_live) {
      await CombatAPI.addParticipant(participant);
      await CombatAPI.dmPlaceToken(participant.id, { col, row, facing: 0, z: 0 });
    } else {
      const c = { id: participant.id, kind: q.kind, name: participant.name, config, npcId: q.kind === 'npc' ? q.key : null, participant, hidden: !!q.hidden };
      const problem = creatureSpotProblem(getSetup(), c, col, row);
      if (problem) { toast(problem); return; }
      updateSetup((st) => { st.creatures.push({ ...c, position: { col, row, facing: 0 }, z: 0 }); });
    }
    ed.creatureQueue.shift();
  } catch (err) {
    showCombatAlert(err.message, { title: `Couldn't put ${q.label} on the map` });
  } finally {
    ed.placingCreature = false;
    renderToolPanel();
  }
}

/** The outline of the object a click would place here (red when it doesn't fit). */
function renderGhost() {
  const ghost = document.querySelector('#mapWrap .dm-map-ghost');
  if (!ghost) return;
  const m = getSetup().map;
  document.querySelectorAll('#mapWrap .bmap-object.dm-editing-hidden').forEach(el => el.classList.remove('dm-editing-hidden'));
  if (ed.tool !== 'objects') { ghost.innerHTML = ''; return; }
  const board = { grid: { cols: m.cols, rows: m.rows } };
  const g = ed.gesture;
  if (g?.editing && g.turned) {
    // The object turning under the pointer: its new look, in place of the old one.
    document.querySelector(`#mapWrap .bmap-object[data-object-id="${g.editing}"]`)?.classList.add('dm-editing-hidden');
    const o = objectCentredAt(m, g.cx, g.cy, g.editing);
    ghost.innerHTML = o ? mapObjectHtml(o, objectScreenRect(board, o), 90).replace('class="bmap-object"', 'class="bmap-object dm-ghost-ok"')
      : '<div class="dm-ghost-bad" style="inset:0;opacity:0.4"></div>';
    return;
  }
  if (ed.selectedId) {
    const o = (m.objects || []).find(x => x.id === ed.selectedId);
    if (!o) { ghost.innerHTML = ''; return; }
    const r = objectScreenRect(board, o);
    ghost.innerHTML = `<div class="dm-ghost-good dm-edit-outline" style="left:${r.left};top:${r.top};width:${r.width};height:${r.height}"></div>`;
    return;
  }
  if (g) {
    const o = objectCentredAt(m, g.cx, g.cy);
    if (o) { ghost.innerHTML = mapObjectHtml(o, objectScreenRect(board, o), 90).replace('class="bmap-object"', 'class="bmap-object dm-ghost-ok"'); return; }
  }
  if (!ed.hover) { ghost.innerHTML = ''; return; }
  const { col, row } = ed.hover;
  const o = objectAt(m, col, row);
  if (o) {
    ghost.innerHTML = mapObjectHtml(o, objectScreenRect({ grid: { cols: m.cols, rows: m.rows } }, o), 90).replace('class="bmap-object"', 'class="bmap-object dm-ghost-ok"');
  } else {
    // Where it would have gone, clipped to the map, in red.
    const sx = m.rows - 1 - row;
    const [sw, sh] = screenBox();
    const w = Math.min(sw, m.rows - sx), h = Math.min(sh, m.cols - col);
    ghost.innerHTML = `<div class="dm-ghost-bad" style="left:${(sx / m.rows) * 100}%;top:${(col / m.cols) * 100}%;width:${(w / m.rows) * 100}%;height:${(h / m.cols) * 100}%"></div>`;
  }
}

function paint(col, row) {
  const key = `${col},${row}`;
  const current = getSetup().map.marks?.[key];
  const next = ed.terrain === 'clear' ? undefined : ed.terrain;
  if (current === next) return;
  updateSetup(s => {
    s.map.marks = s.map.marks || {};
    if (next) s.map.marks[key] = next; else delete s.map.marks[key];
  });
}

async function onCellClick(col, row) {
  const m = getSetup().map;
  if (ed.tool === 'erase') {
    const hit = topObjectAt(m, col, row);
    if (hit) { removeObject(hit); return; } // squares it marked go back to normal unless another object marks them too
    if (m.marks?.[`${col},${row}`]) updateSetup(st => { delete st.map.marks[`${col},${row}`]; });
  }
}

// ---------------------------------------------------------------------------
// Traps: squares marked as a trap -- hidden from the players (their screens and the table draw nothing there) until the
// DM reveals it. map.traps: [{id, name, note, cells: ["col,row", ...], revealed}]. Hidden objects are revealed from here too.
// ---------------------------------------------------------------------------

function trapsNow() {
  const traps = getSetup().map.traps || [];
  return ed.draftTrap && !traps.some(t => t.id === ed.draftTrap.id) ? [...traps, ed.draftTrap] : traps;
}

/** Changes one trap (`fn` gets it to change) -- a draft until it has squares, on the map from then on. A trap whose last
 * square is taken off goes back to being a draft (still picked, so squares can be added again). */
function changeTrap(id, fn) {
  if (ed.draftTrap?.id === id && !(getSetup().map.traps || []).some(t => t.id === id)) {
    fn(ed.draftTrap);
    if (!ed.draftTrap.cells.length) { renderToolPanel(); renderStage(); return; }
    const t = ed.draftTrap;
    ed.draftTrap = null;
    updateSetup(st => { st.map.traps = [...(st.map.traps || []), t]; });
    return;
  }
  updateSetup(st => {
    const t = (st.map.traps || []).find(x => x.id === id);
    if (!t) return;
    fn(t);
    if (!t.cells.length) { ed.draftTrap = { ...t }; st.map.traps = st.map.traps.filter(x => x.id !== id); }
  });
}

function newTrap(cells = []) {
  ed.draftTrap = { id: newId('trap'), name: `Trap ${trapsNow().length + 1}`, note: '', cells, revealed: false };
  ed.trapId = ed.draftTrap.id;
}

/** Traps tool, pointer pressed on (col, row): with no trap picked, a trap's square picks it and an empty square starts a
 * new one; with one picked, a stroke adds squares to it -- or takes them off, when it starts on one of its own. */
function startTrapStroke(e, col, row) {
  const key = `${col},${row}`;
  const under = trapsNow().find(t => t.cells.includes(key));
  if (!ed.trapId) {
    if (under) { ed.trapId = under.id; renderToolPanel(); renderStage(); return; }
    newTrap();
  }
  const id = ed.trapId;
  const adding = !(under && under.id === id);
  const stroke = (c, r) => {
    const k = `${c},${r}`;
    // A square belongs to one trap: added here, it leaves any other.
    if (adding) updateSetup(st => { (st.map.traps || []).forEach(t => { if (t.id !== id) t.cells = t.cells.filter(x => x !== k); }); st.map.traps = (st.map.traps || []).filter(t => t.cells.length); });
    changeTrap(id, t => { t.cells = adding ? [...new Set([...t.cells, k])] : t.cells.filter(x => x !== k); });
  };
  startPainting(e, stroke);
  stroke(col, row);
  renderToolPanel();
}

function renderTrapPanel(panel, hint) {
  const traps = trapsNow();
  const t = traps.find(x => x.id === ed.trapId);
  const hiddenObjs = (getSetup().map.objects || []).filter(o => o.hidden);
  panel.innerHTML = `
    <div class="dm-trap-list">
      ${traps.map(tr => `<div class="dm-trap-row${tr.id === ed.trapId ? ' active' : ''}">
        <button class="dm-trap-pick" data-trap="${tr.id}" data-trap-act="pick" title="${escapeHtml(tr.note || '')}">${tr.revealed ? '⚠' : '🙈'} ${escapeHtml(tr.name)} <small>${tr.cells.length} sq${tr.revealed ? ' · revealed' : ' · hidden'}</small></button>
        <button class="dm-btn small" data-trap="${tr.id}" data-trap-act="reveal" ${tr.cells.length ? '' : 'disabled'}>${tr.revealed ? 'Hide' : 'Reveal'}</button>
        <button class="dm-icon-btn danger" data-trap="${tr.id}" data-trap-act="delete" title="Remove the trap">✕</button></div>`).join('') || '<div class="dm-hint">No traps yet.</div>'}
    </div>
    <button class="dm-btn wide" id="trapNew" style="margin-top:0.4rem">+ New trap</button>
    ${t ? `
    <div class="dm-edit-head" style="margin-top:0.6rem"><b>${escapeHtml(t.name)}</b><small>${t.cells.length ? `${t.cells.length} square(s)` : 'No squares yet -- click the map'}</small></div>
    <div class="dm-field"><label for="trapName">Name</label><input class="dm-input" id="trapName" value="${escapeHtml(t.name)}" maxlength="60"></div>
    <div class="dm-field"><label for="trapNote">What it does <small>(only you see this)</small></label><textarea class="dm-input" id="trapNote" rows="2" maxlength="300">${escapeHtml(t.note || '')}</textarea></div>
    <label class="dm-check"><input type="checkbox" id="trapRevealed" ${t.revealed ? 'checked' : ''} ${t.cells.length ? '' : 'disabled'}>
      <span>Revealed <small>Shown on the players' screens and the table.</small></span></label>
    <button class="dm-btn primary wide" id="trapDone">✓ Done with this trap</button>` : ''}
    ${hiddenObjs.length ? `
    <div class="dm-card-title" style="margin-top:0.8rem">Hidden objects</div>
    ${hiddenObjs.map(o => `<div class="dm-trap-row"><span class="dm-trap-pick">🙈 ${escapeHtml(o.label || o.kind || 'Object')}</span>
      <button class="dm-btn small" data-reveal-obj="${o.id}">Reveal</button></div>`).join('')}` : ''}`;
  hint.textContent = t
    ? `${t.name}: click or drag across squares to add them -- start on one of its own squares to take squares off.`
    : 'Traps: click a square to start a new trap there (or click a trap to pick it). Hidden traps are only on your screen -- you\'re told when a creature walks onto one.';
  panel.querySelectorAll('[data-trap-act]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.trap;
    const act = b.dataset.trapAct;
    if (act === 'pick') { ed.trapId = ed.trapId === id ? null : id; renderToolPanel(); renderStage(); return; }
    if (act === 'reveal') { changeTrap(id, tr => { tr.revealed = !tr.revealed; }); renderToolPanel(); return; }
    const tr = trapsNow().find(x => x.id === id);
    if (!tr || !await showCombatConfirm(`Remove the trap "${tr.name}"?`, { title: 'Remove trap', yesLabel: 'Remove', noLabel: 'Cancel' })) return;
    if (ed.draftTrap?.id === id) ed.draftTrap = null;
    if (ed.trapId === id) ed.trapId = null;
    updateSetup(st => { st.map.traps = (st.map.traps || []).filter(x => x.id !== id); });
    renderToolPanel();
  }));
  document.getElementById('trapNew').addEventListener('click', () => { newTrap(); renderToolPanel(); });
  document.getElementById('trapName')?.addEventListener('change', (e) => { changeTrap(t.id, tr => { tr.name = e.target.value.trim() || 'Trap'; }); renderToolPanel(); });
  document.getElementById('trapNote')?.addEventListener('change', (e) => changeTrap(t.id, tr => { tr.note = e.target.value.trim(); }));
  document.getElementById('trapRevealed')?.addEventListener('change', (e) => { changeTrap(t.id, tr => { tr.revealed = e.target.checked; }); renderToolPanel(); });
  document.getElementById('trapDone')?.addEventListener('click', () => { ed.trapId = null; ed.draftTrap = null; renderToolPanel(); renderStage(); });
  panel.querySelectorAll('[data-reveal-obj]').forEach(b => b.addEventListener('click', () => revealObject(b.dataset.revealObj)));
}

/** Shows a hidden object to the players -- and its squares become difficult / blocked now, if it marks them. */
function revealObject(id) {
  const o = (getSetup().map.objects || []).find(x => x.id === id);
  if (!o) return;
  const next = { ...o };
  delete next.hidden;
  commitObject(next, o);
  renderToolPanel();
}

/** Whether the map editor is drawn in `root` right now (another one may have taken its place -- renderMapEditor). */
export function editorShownIn(root) {
  return !!root?.querySelector('.dm-editor') && root.contains(document.getElementById('mapWrap'));
}

/** A small read-only picture of the map for the setup overview. */
export function mapPreviewHtml(setup) {
  return mapStageHtml(setup, { preview: true });
}
