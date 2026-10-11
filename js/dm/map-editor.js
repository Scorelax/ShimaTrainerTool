// DM console -- map setup: the DM builds the battle map before starting the battle. The map is shown the way the table
// TV shows it (battle-map.js: board cols run DOWN the screen, board rows run ACROSS it, row 0 at the right edge), so
// what the DM builds here is exactly what the table sees. Everything is stored in board coordinates (setup-store.js).
//
// Tools: Objects (place a picture -- tree, rock, log... any object-*.png in the battle-images folder -- sized in squares
// and turned in 90-degree steps; optionally marking its squares difficult or blocked too), Terrain (paint difficult /
// blocked squares, which the battle enforces -- routes_combat.py's _move_cost_ft / _move_token), Creatures (stand the
// DM's prepared creatures where the battle starts them) and Eraser.
import { DmAPI } from '../api.js';
import { mapObjectsHtml, mapObjectHtml, objectScreenRect, objectCells, footprintForSize, footprintCells } from '../utils/battle-map-grid.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import { escapeHtml, newId } from './dm-common.js';
import { getSetup, updateSetup, flushSetup, onSetupChange, TV_ASPECT } from './setup-store.js';

let _assets = null; // {objects: [{key, label, url}], backgrounds: [...]}
const _crops = new Map(); // object url -> Promise<[x0, y0, x1, y1]> (the picture's non-transparent part)

const ed = {
  tool: 'objects',
  objectKey: '', objW: 1, objH: 1, objRot: 0, objMark: '', // objW/objH/objRot as seen on screen
  terrain: 'difficult',
  creatureId: null,
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
    }));
  }
  return _crops.get(url);
}

// ---------------------------------------------------------------------------
// Board <-> screen
// ---------------------------------------------------------------------------

function boardOf(setup) {
  const m = setup.map;
  return { grid: { cols: m.cols, rows: m.rows }, objects: m.objects || [], marks: m.marks || {}, cells: {}, tokens: {} };
}

/** A creature token's footprint on the sideways screen -- battle-map.js's screenCellRect. Its (col, row) anchor is the
 * footprint's bottom-left on the board, which is its top-left on this screen. */
function tokenScreenRect(m, col, row, size) {
  return { left: `${((m.rows - row - 1) / m.rows) * 100}%`, top: `${(col / m.cols) * 100}%`, width: `${(size / m.rows) * 100}%`, height: `${(size / m.cols) * 100}%` };
}

/** The object the Objects tool would place with its top-left corner (as seen) on board cell (col, row), or null if
 * it doesn't fit. Screen width = board rows, screen height = board cols; the TV adds a quarter turn, so the stored
 * turn is a quarter less than what the DM sees. */
function objectAt(m, col, row) {
  const asset = _assets?.objects.find(o => o.key === ed.objectKey);
  if (!asset) return null;
  const w = ed.objH, h = ed.objW;
  const o = {
    id: newId('obj'), kind: asset.key, label: asset.label, url: asset.url,
    col, row: row - h + 1, w, h, rot: ((ed.objRot - 90) % 360 + 360) % 360, crop: [0, 0, 1, 1],
    ...(ed.objMark ? { markKind: ed.objMark } : {}),
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
  if (!ed.objectKey && _assets.objects.length) ed.objectKey = _assets.objects[0].key;
  const m = getSetup().map;

  root.innerHTML = `
    <div class="dm-editor">
      <aside class="dm-editor-tools">
        <div class="dm-editor-head">
          <button class="dm-btn small" id="mapBack">← Setup</button>
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
          <div class="dm-tool-tabs" id="mapTools">
            <button data-tool="objects">🌲 Objects</button>
            <button data-tool="terrain">🟫 Terrain</button>
            <button data-tool="creatures">🐾 Creatures</button>
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
        <div class="dm-map-wrap" id="mapWrap"><div class="dm-map-stage" id="mapStage"></div></div>
        <div class="dm-map-legend">
          <span><i class="mark-difficult"></i>Difficult terrain -- costs double movement</span>
          <span><i class="mark-blocked"></i>Blocked -- can't be walked through or stood on</span>
        </div>
      </section>
    </div>`;

  wireStatic();
  renderToolPanel();
  renderStage();
  _unsub?.();
  _unsub = onSetupChange(() => { if (document.body.contains(_root)) renderStage(); });
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
      <div class="dm-field"><label>Turn</label>
        <div class="dm-row"><button class="dm-btn" id="objRotL">⟲ Left</button><button class="dm-btn" id="objRotR">⟳ Right</button></div>
      </div>
      <div class="dm-field"><label for="objMark">Its squares are also</label>
        <select class="dm-select" id="objMark">
          <option value="" ${!ed.objMark ? 'selected' : ''}>Just a picture</option>
          <option value="difficult" ${ed.objMark === 'difficult' ? 'selected' : ''}>Difficult terrain</option>
          <option value="blocked" ${ed.objMark === 'blocked' ? 'selected' : ''}>Blocked</option>
        </select>
      </div>` : '<div class="dm-hint">No object pictures found -- add object-&lt;name&gt;.png files to the battle-images folder on the Pi.</div>';
    hint.textContent = 'Click a square to place the object there (its top-left corner). The outline shows where it will go.';
    document.getElementById('objKind')?.addEventListener('change', (e) => { ed.objectKey = e.target.value; renderToolPanel(); });
    document.getElementById('objW')?.addEventListener('input', (e) => { ed.objW = clampInt(e.target.value, 1, 20); renderStage(); });
    document.getElementById('objH')?.addEventListener('input', (e) => { ed.objH = clampInt(e.target.value, 1, 20); renderStage(); });
    document.getElementById('objRotL')?.addEventListener('click', () => turnObject(-90));
    document.getElementById('objRotR')?.addEventListener('click', () => turnObject(90));
    document.getElementById('objMark')?.addEventListener('change', (e) => { ed.objMark = e.target.value; });
  } else if (ed.tool === 'terrain') {
    panel.innerHTML = `
      ${[['difficult', 'Difficult terrain', 'Costs double movement to walk through.'], ['blocked', 'Blocked', "Can't be walked through or stood on (flyers pass over)."], ['clear', 'Clear', 'Back to normal ground.']]
        .map(([k, label, sub]) => `<label class="dm-check"><input type="radio" name="terrainKind" value="${k}" ${ed.terrain === k ? 'checked' : ''}><span>${label} <small>${sub}</small></span></label>`).join('')}`;
    hint.textContent = 'Click or drag across squares to paint them.';
    panel.querySelectorAll('input[name="terrainKind"]').forEach(r => r.addEventListener('change', () => { ed.terrain = r.value; }));
  } else if (ed.tool === 'creatures') {
    const list = getSetup().creatures.filter(c => !c.heldBack);
    if (ed.creatureId && !list.some(c => c.id === ed.creatureId)) ed.creatureId = null;
    if (!ed.creatureId) ed.creatureId = list.find(c => !c.position)?.id || null;
    panel.innerHTML = list.length ? list.map(c => `
      <button class="dm-place-item${c.id === ed.creatureId ? ' selected' : ''}" data-creature="${c.id}">
        <span class="dm-place-thumb" data-img="${escapeHtml(c.participant?.image || '')}"></span>
        <span class="dm-place-name">${escapeHtml(c.name)}</span>
        <span class="dm-place-state">${c.position ? '✓ placed' : 'not placed'}</span>
      </button>`).join('') : '<div class="dm-hint">No creatures yet -- add them in the battle setup first. (Held-back ones join later and aren\'t placed.)</div>';
    hint.textContent = list.length ? 'Pick a creature, then click the square where it starts. Click a placed one again to move it.' : '';
    panel.querySelectorAll('[data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); });
    panel.querySelectorAll('[data-creature]').forEach(b => b.addEventListener('click', () => { ed.creatureId = b.dataset.creature; renderToolPanel(); }));
  } else {
    panel.innerHTML = '<div class="dm-hint">Click an object to remove it, a marked square to clear it, or a creature to take it off the map.</div>';
    hint.textContent = 'Eraser: click what you want to remove.';
  }
}

function turnObject(delta) {
  ed.objRot = ((ed.objRot + delta) % 360 + 360) % 360;
  [ed.objW, ed.objH] = [ed.objH, ed.objW]; // a quarter turn swaps its width and height
  renderToolPanel();
  renderStage();
}

function clampInt(v, lo, hi) {
  return Math.max(lo, Math.min(hi, parseInt(v, 10) || lo));
}

/** The whole map, the way the table TV shows it. */
function renderStage() {
  const stage = document.getElementById('mapStage');
  if (!stage) return;
  const s = getSetup();
  const m = s.map;
  const board = boardOf(s);
  // As big as fits: screen width = board rows, screen height = board cols.
  stage.style.aspectRatio = `${m.rows} / ${m.cols}`;
  stage.style.width = `min(100%, calc((100vh - 190px) * ${m.rows / m.cols}))`;

  const cells = [];
  for (let col = 0; col < m.cols; col++) {
    for (let row = m.rows - 1; row >= 0; row--) {
      const mark = m.marks?.[`${col},${row}`];
      cells.push(`<div class="dm-map-cell${mark ? ` mark-${mark}` : ''}" data-cell="${col},${row}"></div>`);
    }
  }
  const tokens = s.creatures.filter(c => c.position && !c.heldBack).map(c => {
    const size = footprintForSize(c.participant?.size);
    const r = tokenScreenRect(m, c.position.col, c.position.row, size);
    return `<div class="dm-map-token${c.id === ed.creatureId && ed.tool === 'creatures' ? ' selected' : ''}" data-token="${c.id}" title="${escapeHtml(c.name)}"
      style="left:${r.left};top:${r.top};width:${r.width};height:${r.height}"><div class="dm-map-token-art" data-img="${escapeHtml(c.participant?.image || '')}"></div></div>`;
  }).join('');

  stage.innerHTML = `
    <div class="dm-map-bg"${m.background ? ` style="background-image:url('${escapeHtml(m.background)}')"` : ''}></div>
    <div class="dm-map-grid" style="grid-template-columns:repeat(${m.rows},1fr);grid-template-rows:repeat(${m.cols},1fr)">${cells.join('')}</div>
    <div class="bmap-objects">${mapObjectsHtml(board, { tv: true })}</div>
    <div class="dm-map-tokens">${tokens}</div>
    <div class="dm-map-ghost" id="mapGhost"></div>`;
  stage.classList.toggle('has-bg', !!m.background);
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

/** The outline of what a click would do here -- the object to place (red when it doesn't fit), or the creature. */
function renderGhost() {
  const ghost = document.getElementById('mapGhost');
  if (!ghost) return;
  const m = getSetup().map;
  if (!ed.hover || (ed.tool !== 'objects' && ed.tool !== 'creatures')) { ghost.innerHTML = ''; return; }
  const { col, row } = ed.hover;
  if (ed.tool === 'objects') {
    const o = objectAt(m, col, row);
    if (o) {
      o.crop = _cropNow(o.url);
      ghost.innerHTML = mapObjectHtml(o, objectScreenRect({ grid: { cols: m.cols, rows: m.rows } }, o), 90).replace('class="bmap-object"', 'class="bmap-object dm-ghost-ok"');
    } else {
      // Where it would have gone, clipped to the map, in red.
      const sx = m.rows - 1 - row;
      const w = Math.min(ed.objW, m.rows - sx), h = Math.min(ed.objH, m.cols - col);
      ghost.innerHTML = `<div class="dm-ghost-bad" style="left:${(sx / m.rows) * 100}%;top:${(col / m.cols) * 100}%;width:${(w / m.rows) * 100}%;height:${(h / m.cols) * 100}%"></div>`;
    }
    return;
  }
  const c = getSetup().creatures.find(x => x.id === ed.creatureId);
  if (!c) { ghost.innerHTML = ''; return; }
  const size = footprintForSize(c.participant?.size);
  const r = tokenScreenRect(m, col, row, size);
  ghost.innerHTML = `<div class="${creatureSpotProblem(c, col, row) ? 'dm-ghost-bad' : 'dm-ghost-good'}" style="left:${r.left};top:${r.top};width:${r.width};height:${r.height}"></div>`;
}

const _cropResolved = new Map(); // url -> crop, once cropFor has worked it out (they're all started when the list loads)
function _cropNow(url) {
  if (!_cropResolved.has(url)) cropFor(url).then(c => _cropResolved.set(url, c));
  return _cropResolved.get(url) || [0, 0, 1, 1];
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

/** Why `c` can't start at (col, row), or '' -- off the map, on a blocked square, or on top of another creature. */
function creatureSpotProblem(c, col, row) {
  const s = getSetup();
  const m = s.map;
  const size = footprintForSize(c.participant?.size);
  const cells = footprintCells(col, row, size);
  if (cells.some(p => p.col < 0 || p.row < 0 || p.col >= m.cols || p.row >= m.rows)) return "It doesn't fit there.";
  if (cells.some(p => m.marks?.[`${p.col},${p.row}`] === 'blocked')) return 'That square is blocked.';
  const taken = new Set();
  s.creatures.forEach(o => {
    if (o.id === c.id || !o.position || o.heldBack) return;
    footprintCells(o.position.col, o.position.row, footprintForSize(o.participant?.size)).forEach(p => taken.add(`${p.col},${p.row}`));
  });
  if (cells.some(p => taken.has(`${p.col},${p.row}`))) return 'Another creature is standing there.';
  return '';
}

async function onCellClick(col, row) {
  const s = getSetup();
  const m = s.map;
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
        objectCells(o).forEach(p => { st.map.marks[`${p.col},${p.row}`] = o.markKind; });
      }
    });
  } else if (ed.tool === 'creatures') {
    const c = s.creatures.find(x => x.id === ed.creatureId);
    if (!c) return;
    const problem = creatureSpotProblem(c, col, row);
    if (problem) { showCombatAlert(problem, { title: c.name }); return; }
    updateSetup(st => { st.creatures.find(x => x.id === c.id).position = { col, row, facing: 0 }; });
    ed.creatureId = s.creatures.find(x => !x.heldBack && !x.position)?.id || ed.creatureId; // straight on to the next one
    renderToolPanel();
  } else if (ed.tool === 'erase') {
    const objects = m.objects || [];
    const hit = [...objects].reverse().find(o => objectCells(o).some(p => p.col === col && p.row === row));
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
    const creature = s.creatures.find(c => c.position && !c.heldBack
      && footprintCells(c.position.col, c.position.row, footprintForSize(c.participant?.size)).some(p => p.col === col && p.row === row));
    if (creature) {
      updateSetup(st => { st.creatures.find(x => x.id === creature.id).position = null; });
      return;
    }
    if (m.marks?.[`${col},${row}`]) updateSetup(st => { delete st.map.marks[`${col},${row}`]; });
  }
}

/** A small read-only picture of the map for the setup overview. */
export function mapPreviewHtml(setup) {
  const m = setup.map;
  const board = boardOf(setup);
  const tokens = setup.creatures.filter(c => c.position && !c.heldBack).map(c => {
    const r = tokenScreenRect(m, c.position.col, c.position.row, footprintForSize(c.participant?.size));
    return `<div class="dm-map-token" style="left:${r.left};top:${r.top};width:${r.width};height:${r.height}"><div class="dm-map-token-art" data-img="${escapeHtml(c.participant?.image || '')}"></div></div>`;
  }).join('');
  const cells = [];
  for (let col = 0; col < m.cols; col++) {
    for (let row = m.rows - 1; row >= 0; row--) {
      const mark = m.marks?.[`${col},${row}`];
      cells.push(`<div class="dm-map-cell${mark ? ` mark-${mark}` : ''}"></div>`);
    }
  }
  return `
    <div class="dm-map-stage dm-map-preview${m.background ? ' has-bg' : ''}" style="aspect-ratio:${m.rows} / ${m.cols}">
      <div class="dm-map-bg"${m.background ? ` style="background-image:url('${escapeHtml(m.background)}')"` : ''}></div>
      <div class="dm-map-grid" style="grid-template-columns:repeat(${m.rows},1fr);grid-template-rows:repeat(${m.cols},1fr)">${cells.join('')}</div>
      <div class="bmap-objects">${mapObjectsHtml(board, { tv: true })}</div>
      <div class="dm-map-tokens">${tokens}</div>
    </div>`;
}
