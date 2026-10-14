// DM console -- map setup: the DM builds the battle map before setting up the battle (where the creatures are placed,
// creature-setup.js). The map is shown the way the table TV shows it (map-view.js), so what the DM builds here is
// exactly what the table sees.
//
// Tools: Objects (place a picture -- tree, rock, log... any object-*.png in the battle-images folder -- sized in squares,
// turned in 90-degree steps, with a height in feet for line of sight later, and optionally marking its squares
// difficult or blocked), Terrain (paint difficult / blocked squares, which the battle enforces for creatures on the
// ground -- routes_combat.py's _move_cost_ft / _move_token) and Eraser.
import { DmAPI } from '../api.js';
import { mapObjectHtml, objectScreenRect, objectCells } from '../utils/battle-map-grid.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import { escapeHtml, newId, toast } from './dm-common.js';
import { getSetup, updateSetup, flushSetup, onSetupChange, emptySetup, TV_ASPECT } from './setup-store.js';
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
};

let _root = null;
let _onDone = null;
let _unsub = null;

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
function objectAt(m, col, row) {
  const asset = _assets?.objects.find(o => o.key === ed.objectKey);
  if (!asset) return null;
  // Its box as seen: the picture at the nearest quarter turn (any angle beyond that turns it about the box's centre).
  const [sw, sh] = screenBox();
  const w = sh, h = sw;
  const o = {
    id: newId('obj'), kind: asset.key, label: asset.label, url: asset.url,
    col, row: row - h + 1, w, h, rot: ((ed.objRot - 90) % 360 + 360) % 360, crop: cropNow(asset.url),
    height: ed.objHeight, ...(ed.objMark ? { markKind: ed.objMark } : {}),
  };
  return o.row >= 0 && o.col + o.w <= m.cols && o.row + o.h <= m.rows ? o : null;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export async function renderMapEditor(root, { onDone }) {
  _root = root;
  _onDone = onDone;
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
          <button class="dm-btn small" id="mapBack">← Map setup</button>
          <h2>Map</h2>
        </div>

        <div class="dm-card">
          <div class="dm-card-title">Size</div>
          <div class="dm-row">
            <div class="dm-field"><label for="mapAcross">Squares across</label><input class="dm-input" id="mapAcross" type="number" min="1" max="60" value="${m.rows}"></div>
            <div class="dm-field"><label for="mapDown">Squares down</label><input class="dm-input" id="mapDown" type="number" min="1" max="60" value="${m.cols}"></div>
          </div>
          <label class="dm-check"><input type="checkbox" id="mapLock" ${m.lockRatio ? 'checked' : ''}>
            <span>Keep the table TV's shape <small>Squares stay square on the TV. Untick to make any shape.</small></span></label>
          <button class="dm-btn wide" id="mapApplySize">Apply size</button>
        </div>

        <div class="dm-card">
          <div class="dm-card-title">Background</div>
          <select class="dm-select" id="mapBackground">
            <option value="">No background</option>
            ${_assets.backgrounds.map(b => `<option value="${escapeHtml(b.url)}" ${b.url === m.background ? 'selected' : ''}>${escapeHtml(b.label)}</option>`).join('')}
          </select>
        </div>

        <div class="dm-card">
          <div class="dm-card-title">Saved maps</div>
          <div class="dm-row dm-map-saverow">
            <input class="dm-input" id="mapSaveName" placeholder="Name this map…" maxlength="60" autocomplete="off">
            <button class="dm-btn" id="mapSave">💾 Save</button>
          </div>
          <div class="dm-saved-maps" id="mapSavedList"><div class="dm-hint">Loading…</div></div>
        </div>

        <div class="dm-card">
          <div class="dm-tool-tabs" id="mapTools">
            <button data-tool="objects">🌲 Objects</button>
            <button data-tool="terrain">🟫 Terrain</button>
            <button data-tool="erase">🧽 Eraser</button>
          </div>
          <div id="mapToolPanel"></div>
        </div>

        <div class="dm-editor-foot">
          <button class="dm-btn small" id="mapClearObjects">Clear objects</button>
          <button class="dm-btn small" id="mapClearMarks">Clear terrain</button>
          <button class="dm-btn primary wide" id="mapDone">✓ Done</button>
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
  renderSavedMaps();
  _unsub?.();
  _unsub = onSetupChange(() => { if (document.body.contains(_root)) renderStage(); });
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
  renderMapEditor(_root, { onDone: _onDone }); // the size and background fields show the loaded map
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
  ed.objHeight = DEFAULT_HEIGHTS[key] ?? 5;
}

function wireStatic() {
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
  document.getElementById('mapBackground').addEventListener('change', (e) => updateSetup(s => { s.map.background = e.target.value; }));
  document.getElementById('mapTools').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tool]');
    if (!b) return;
    ed.tool = b.dataset.tool;
    renderToolPanel();
    renderStage();
  });
  document.getElementById('mapBack').addEventListener('click', () => leave());
  document.getElementById('mapSave').addEventListener('click', saveCurrentMap);
  document.getElementById('mapSaveName').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveCurrentMap(); });
  document.getElementById('mapSavedList').addEventListener('click', (e) => {
    const load = e.target.closest('[data-load-map]');
    if (load) { loadSavedMap(load.dataset.loadMap); return; }
    const del = e.target.closest('[data-delete-map]');
    if (del) deleteSavedMap(del.dataset.deleteMap);
  });
  document.getElementById('mapDone').addEventListener('click', () => {
    updateSetup(s => { s.map.ready = true; });
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
    document.addEventListener('mouseup', () => { ed.painting = false; });
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
    const asset = _assets.objects.find(o => o.key === ed.objectKey);
    panel.innerHTML = _assets.objects.length ? `
      <div class="dm-field"><label for="objKind">Object</label>
        <select class="dm-select" id="objKind">${_assets.objects.map(o => `<option value="${escapeHtml(o.key)}" ${o.key === ed.objectKey ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>
      </div>
      <div class="dm-object-preview">${asset ? `<img src="${escapeHtml(asset.url)}" alt="" style="transform:rotate(${ed.objRot}deg)">` : ''}</div>
      <div class="dm-row">
        <div class="dm-field"><label for="objW">Width (squares)</label><input class="dm-input" id="objW" type="number" min="1" max="20" value="${ed.objW}"></div>
        <div class="dm-field"><label for="objH">Height (squares)</label><input class="dm-input" id="objH" type="number" min="1" max="20" value="${ed.objH}"></div>
      </div>
      <div class="dm-row">
        <div class="dm-field"><label for="objTall">How tall (ft)</label><input class="dm-input" id="objTall" type="number" min="0" max="500" step="5" value="${ed.objHeight}"></div>
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
      </div>` : '<div class="dm-hint">No object pictures found -- add object-&lt;name&gt;.png files to the battle-images folder on the Pi.</div>';
    hint.textContent = 'Click a square to place the object there (its top-left corner). The outline shows where it will go.';
    document.getElementById('objKind')?.addEventListener('change', (e) => { selectObjectKind(e.target.value); renderToolPanel(); });
    document.getElementById('objW')?.addEventListener('input', (e) => { ed.objW = clampInt(e.target.value, 1, 20); renderGhost(); });
    document.getElementById('objH')?.addEventListener('input', (e) => { ed.objH = clampInt(e.target.value, 1, 20); renderGhost(); });
    document.getElementById('objTall')?.addEventListener('input', (e) => { ed.objHeight = clampInt(e.target.value, 0, 500); });
    document.getElementById('objRotL')?.addEventListener('click', () => turnObject(-15));
    document.getElementById('objRotR')?.addEventListener('click', () => turnObject(15));
    document.getElementById('objRot')?.addEventListener('input', (e) => setObjectTurn(Number(e.target.value)));
    document.getElementById('objMark')?.addEventListener('change', (e) => { ed.objMark = e.target.value; });
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
function setObjectTurn(deg) {
  ed.objRot = ((Math.round(deg) % 360) + 360) % 360;
  const img = document.querySelector('.dm-object-preview img');
  if (img) img.style.transform = `rotate(${ed.objRot}deg)`;
  const slider = document.getElementById('objRot');
  if (slider && Number(slider.value) !== ed.objRot) slider.value = ed.objRot;
  const label = document.getElementById('objRotLabel');
  if (label) label.textContent = `${ed.objRot}°`;
  renderGhost();
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
  wrap.innerHTML = mapStageHtml(s, { interactive: true });
  const stage = wrap.querySelector('.dm-map-stage');
  stage.style.width = `min(100%, calc((100vh - 190px) * ${m.rows / m.cols}))`;
  stage.querySelectorAll('[data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); });

  const grid = stage.querySelector('.dm-map-grid');
  grid.addEventListener('mousedown', (e) => {
    const cell = e.target.closest('[data-cell]');
    if (!cell) return;
    e.preventDefault();
    const [col, row] = cell.dataset.cell.split(',').map(Number);
    if (ed.tool === 'terrain') { ed.painting = true; paint(col, row); } else onCellClick(col, row);
  });
  grid.addEventListener('mouseover', (e) => {
    const cell = e.target.closest('[data-cell]');
    if (!cell) return;
    const [col, row] = cell.dataset.cell.split(',').map(Number);
    ed.hover = { col, row };
    if (ed.painting && ed.tool === 'terrain') paint(col, row);
    renderGhost();
  });
  grid.addEventListener('mouseleave', () => { ed.hover = null; renderGhost(); });
  renderGhost();
}

/** The outline of the object a click would place here (red when it doesn't fit). */
function renderGhost() {
  const ghost = document.querySelector('#mapWrap .dm-map-ghost');
  if (!ghost) return;
  const m = getSetup().map;
  if (!ed.hover || ed.tool !== 'objects') { ghost.innerHTML = ''; return; }
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
  if (ed.tool === 'objects') {
    const o = objectAt(m, col, row);
    if (!o) {
      showCombatAlert("The object doesn't fit there -- make it smaller or move it further in.", { title: 'Place object' });
      return;
    }
    o.crop = await cropFor(o.url);
    updateSetup(st => {
      st.map.objects = [...(st.map.objects || []), o];
      if (o.markKind) {
        st.map.marks = st.map.marks || {};
        objectCells(o, m).forEach(p => { st.map.marks[`${p.col},${p.row}`] = o.markKind; });
      }
    });
  } else if (ed.tool === 'erase') {
    const hit = [...(m.objects || [])].reverse().find(o => objectCells(o).some(p => p.col === col && p.row === row));
    if (hit) {
      updateSetup(st => {
        st.map.objects = st.map.objects.filter(o => o.id !== hit.id);
        // Squares it marked go back to normal unless another object still marks them the same way.
        if (hit.markKind) {
          const kept = new Set(st.map.objects.filter(o => o.markKind === hit.markKind).flatMap(o => objectCells(o).map(p => `${p.col},${p.row}`)));
          objectCells(hit).forEach(p => {
            const k = `${p.col},${p.row}`;
            if (st.map.marks?.[k] === hit.markKind && !kept.has(k)) delete st.map.marks[k];
          });
        }
      });
      return;
    }
    if (m.marks?.[`${col},${row}`]) updateSetup(st => { delete st.map.marks[`${col},${row}`]; });
  }
}

/** A small read-only picture of the map for the setup overview. */
export function mapPreviewHtml(setup) {
  return mapStageHtml(setup, { preview: true });
}
