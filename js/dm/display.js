// DM console -- the Display module (📺 in the top bar): what the display (display.html -- its own screen, not the
// battle map) shows. It replaces the slide show the DM used to run on it, where a background was put in for
// wherever the players are and pictures of the trainers, NPCs and Pokemon they meet were pasted on. During a battle the
// display keeps the background and shows the turn order and whoever's turn it is on top; the pictures are put away
// until it ends, unless the DM keeps them on. (It's always called "the display" on screen, never "the TV".)
//
// Left: a live preview of the display -- display.html itself in a frame, fed the battle and the scene by this page (no
// connection of its own) -- with what's on it below. Right: the workspace -- every Pokemon, NPC and player trainer to
// put on the screen with a click, and the background pictures uploaded from the DM's computer (kept on the Pi).
// Clicking the preview opens the big editor, where pictures are dragged around and resized from a corner (always
// square). Every change goes to the display straight away (display-store.js); a picture can be put on hidden first and
// shown with one click. A Pokemon goes on as its animated sprite whenever it has one.
//
// The planner (the user's call, 2026-10-19): the 📅 Planner switch at the top turns everything here onto a planned scene
// instead of the display -- built with the same tabs, preview and editor while the display carries on (a battle, the
// scene the players are in) -- saved as they change, in folders. Planned scenes wait in the queue under "On the screen":
// Show puts one on the display, and its Override (the user's call, 2026-10-20) comes along: with it on, the scene stays
// over everything during a battle -- the turn order too. The live "During a battle" row has the same switch.
import { DmAPI } from '../api.js';
import { parentOf } from '../region-map/map-version.js';
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import { renderScene, BATTLE_PICTURES, SCREEN_RATIO, battleOnDisplay, normaliseScene } from '../utils/display-scene.js';
import { escapeHtml, getSpecies, newId, toast, openDmModal } from './dm-common.js';
// getScene / updateScene here are the scene being worked on -- the display's own, or the planned one open in the planner
import {
  loadScene, onSceneChange, getScene as getLive, updateScene as updateLive, getTarget as getScene, updateTarget as updateScene,
  loadPlans, reloadPlans, getPlans, openPlan, setOpenPlan, updatePlans,
} from './display-store.js';
import { spriteSrc } from '../utils/sprite-media.js';

// (Planned scenes: the user's call, 2026-10-21 -- the planned scenes organised here, in folders, the way the backgrounds
// are; the queue and the planner only open the folders)
const SOURCES = { pokemon: '🐾 Pokémon', npcs: '👤 NPCs', trainers: '👥 Trainers', backgrounds: '🖼️ Backgrounds', scenes: '📅 Scenes' };
const KIND_LABEL = { pokemon: 'Pokémon', npc: 'NPC', trainer: 'Trainer', image: 'Picture' };
const IS_VIDEO = /\.mp4(\?|$)/i;
const MAX_RESULTS = 150;
const TV_WIDTH = 1920; // the preview frame is laid out at the TV's own size, then scaled down
const MAX_UPLOAD_SIDE = 2560; // bigger pictures are scaled down before uploading (the TV is 1920 wide)

let _root = null;
let _session = null;
let _source = 'pokemon';
const _queries = {}; // what's typed in the search, per tab
let _addHidden = false;
const _data = { pokemon: null, npcs: null, trainers: null, backgrounds: null };
// The backgrounds' folders (the user's call, 2026-10-19): [{id, name, parent}] in dm_state 'display-folders' -- a picture
// keeps its folder's id (`folder`, '' = the top). Pictures and folders are dragged onto a folder (or the path) to move.
// Folders (the user's call, 2026-10-19): the Backgrounds tab's (each picture's folder is on its record on the Pi) and the
// NPCs tab's (NPC id -> folder, kept with the folders: dm_state 'display-npc-folders'). The tab shown has its set in
// _folders / _folder / _picked; useFolderSet swaps them when the tab changes.
const FOLDERED = { backgrounds: 'display-folders', npcs: 'display-npc-folders' };
let _folderSet = 'backgrounds';
const _folderSets = {};
let _folders = [];
let _folder = ''; // the folder open
let _picked = new Set(); // pictures / NPCs picked to move together (ids)
// Every location (Admin › Locations) has a folder of its own in the backgrounds (the user's call, 2026-10-20: easier to
// keep a place's pictures together): made, renamed and removed along with the location (syncLocationFolders), so it has
// no rename or delete of its own -- it can still be dragged elsewhere. A folder keeps its location's id (`locId`) and is
// marked 📍. They sit with the other folders at the top, not inside each other (the user's call, 2026-10-21: no folder
// after folder to click through) -- the Locations folder they were in first (this id) is done away with.
const LOCATIONS_FOLDER = 'fold-locations';
// Folder mode (the user's call, 2026-10-20): ticked, the backgrounds show the folder open -- its folders and its pictures;
// unticked, just pictures: every one, the ones inside folders too. Remembered on this computer.
const FOLDER_MODE_KEY = 'dm-display-folder-mode';
let _folderMode = (() => { try { return localStorage.getItem(FOLDER_MODE_KEY) !== 'off'; } catch { return true; } })();

function useFolderSet(name) {
  if (!FOLDERED[name] || name === _folderSet) return;
  _folderSets[_folderSet] = { folders: _folders, open: _folder, picked: _picked };
  const next = _folderSets[name] || { folders: [], open: '', picked: new Set() };
  ({ folders: _folders, open: _folder, picked: _picked } = next);
  _folderSet = name;
}

/** The folder open in tab `name` (an upload goes there). */
function folderOpenIn(name) {
  if (name === 'backgrounds' && !_folderMode) return '';   // every picture shown: an upload goes to the top
  return name === _folderSet ? _folder : (_folderSets[name]?.open || '');
}

/** An entry's id and name, either tab's (a background: {id, name}; an NPC: {key, label}). */
const idOf = e => e.id ?? e.key;
const nameOf = e => e.name ?? e.label ?? '';
let _listening = false;
let _dragging = false;
let _editor = null; // the big editor while it's open: {overlay, stage, area, selectedId, observer}
let _previewObserver = null;
let _mode = 'live'; // 'live': the display itself | 'plan': the planner (a planned scene)
// Another module is open: the preview (a whole copy of the display screen) isn't sent the battle's every push meanwhile
// -- it'd draw each one, unseen -- and gets where things are when the module is back.
let _previewAway = false;

export async function renderDisplay(root, { session, firstTime } = {}) {
  _root = root;
  _session = session || _session;
  _previewAway = false;
  if (!firstTime && root.querySelector('.dm-disp')) { postToPreview({ paused: false, scene: getScene(), session: previewSession() }); drawLayers(); return; } // keeps the search, tab and preview as they were
  root.innerHTML = '<div class="dm-loading">Loading…</div>';
  await Promise.all([loadScene(), loadPlans(), loadPlanFolders()]);
  if (!_listening) {
    _listening = true;
    window.addEventListener('app:dm-state', e => stateSavedElsewhere(e.detail?.key));
    onSceneChange(() => {
      if (!_previewAway) postToPreview({ scene: getScene() });
      if (_editor) drawEditorStage();
      if (_dragging) return; // the lists catch up when the picture is let go
      drawLayers();
      drawBattlePictures();
      if (_editor) drawEditorSide();
    });
  }
  draw();
}

/** Another module was opened: the preview stops playing until the module is back. */
export function displayAway() {
  if (_editor) closeEditor();
  _previewAway = true;
  postToPreview({ paused: true });
}

/** The battle changed (dm-console.js) -- the preview shows the battle just like the TV. */
export function displaySessionChanged(session) {
  const what = (s) => (s?.active ? s.battleType || 'battle' : ''); // an adventure and a battle switch straight over too
  const was = what(_session);
  _session = session;
  if (!_previewAway) postToPreview({ session: previewSession() });
  if (was !== what(session)) drawLayers();
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

function draw() {
  _root.innerHTML = `
    <div class="dm-disp">
      <div class="dm-disp-left">
        <div class="dm-disp-head"><h2>📺 Display</h2>
          <div class="dm-seg two dm-disp-mode" id="dispMode">
            <button data-mode="live" class="${_mode === 'live' ? 'active' : ''}" title="What the display shows now">📺 Live</button>
            <button data-mode="plan" class="${_mode === 'plan' ? 'active' : ''}" title="Prepare scenes without touching the display">📅 Planner</button>
          </div></div>
        <div class="dm-disp-override" id="dispOverride" hidden></div>
        ${_mode === 'plan' ? '<div class="dm-card dm-disp-plans" id="dispPlans"></div>' : ''}
        <div class="dm-disp-preview" id="dispPreview" role="button" tabindex="0" title="Click to arrange the pictures">
          <iframe id="dispFrame" src="display.html?preview" tabindex="-1" title="The display" aria-hidden="true"></iframe>
          <span class="dm-disp-preview-hint">🔍 Click to arrange</span>
        </div>
        <div class="dm-disp-battleinfo" ${_mode === 'plan' ? 'hidden' : ''} title="During a battle the background stays, with the turn order and whoever's turn it is on top">
          <span>⚔️ During a battle</span>
          <div class="dm-seg two" id="dispBattlePictures"></div>
          <label class="dm-check dm-disp-overbattle" title="The scene stays over everything during a battle -- the turn order too. Showing a planned scene sets it to that scene's Override."><input type="checkbox" id="dispOverBattle"><span>Override battle screen</span></label>
        </div>
        <div class="dm-card dm-disp-layers">
          <div class="dm-card-title">
            <span>${_mode === 'plan' ? 'In this scene' : 'On the screen'}</span>
            <span class="dm-row dm-enc-titlebtns">
              <button class="dm-btn small" id="dispHideAll"></button>
              <button class="dm-btn small danger" id="dispClear" title="Take every picture off (the background stays)">Clear pictures</button>
            </span>
          </div>
          <div id="dispLayers"></div>
        </div>
        ${_mode === 'live' ? '<div class="dm-card dm-disp-queue" id="dispQueue"></div>' : ''}
      </div>
      <div class="dm-disp-work" id="dispWork">
        <div class="dm-enc-tabs dm-disp-tabs" id="dispTabs">
          ${Object.entries(SOURCES).map(([k, l]) => `<button data-src="${k}" class="${k === _source ? 'active' : ''}">${l}</button>`).join('')}
        </div>
        <div class="dm-disp-work-body">
          <div class="dm-row dm-disp-searchrow">
            <input class="dm-input" id="dispSearch" placeholder="Search…" autocomplete="off" value="${escapeHtml(_queries[_source] || '')}">
            <label class="dm-check dm-disp-addhidden" id="dispAddHiddenBox" title="Put new pictures on hidden -- they show on the display once you click Show"><input type="checkbox" id="dispAddHidden" ${_addHidden ? 'checked' : ''}><span>Add hidden</span></label>
          </div>
          <div id="dispUploadRow" class="dm-disp-upload" hidden>
            <button class="dm-btn primary" id="dispUpload">⬆ Upload pictures</button>
            <span class="dm-hint">From your computer (or drop them here) -- kept on the Pi for next time. Click one to put it on the display.</span>
          </div>
          <div class="dm-disp-grid" id="dispGrid"><div class="dm-loading">Loading…</div></div>
        </div>
      </div>
    </div>`;

  wirePreview();
  drawBattlePictures();
  drawLayers();
  drawSource();

  document.getElementById('dispTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-src]');
    if (!b || b.dataset.src === _source) return;
    _source = b.dataset.src;
    document.querySelectorAll('#dispTabs [data-src]').forEach(x => x.classList.toggle('active', x === b));
    drawSource();
  });
  document.getElementById('dispSearch').addEventListener('input', (e) => { _queries[_source] = e.target.value; drawGrid(); });
  document.getElementById('dispAddHidden').addEventListener('change', (e) => { _addHidden = e.target.checked; });
  document.getElementById('dispUpload').addEventListener('click', pickFiles);
  document.getElementById('dispGrid').addEventListener('click', onGridClick);
  document.getElementById('dispGrid').addEventListener('change', (e) => { if (e.target.matches('[data-folder-mode]')) setFolderMode(e.target.checked); });
  document.getElementById('dispOverBattle').addEventListener('change', (e) => updateLive((s) => { s.overBattle = e.target.checked; }));
  document.getElementById('dispBattlePictures').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bp]');
    if (b) updateLive((s) => { s.battlePictures = b.dataset.bp; });
  });
  document.getElementById('dispHideAll').addEventListener('click', () => {
    const scene = getScene();
    const anyShown = scene.items.some(i => !i.hidden);
    updateScene((s) => { s.items.forEach((i) => { i.hidden = anyShown; }); });
  });
  document.getElementById('dispClear').addEventListener('click', async () => {
    if (!getScene().items.length) return;
    if (!await showCombatConfirm('Take every picture off the display? The background stays.',{ title: 'Clear pictures', yesLabel: 'Clear', noLabel: 'Cancel' })) return;
    updateScene((s) => { s.items = []; });
  });
  document.getElementById('dispLayers').addEventListener('click', onLayerClick);
  document.getElementById('dispMode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b && b.dataset.mode !== _mode) switchMode(b.dataset.mode);
  });
  _root.querySelector('.dm-disp-left').addEventListener('click', onPlanClick);

  // Pictures dropped anywhere on the module are uploaded as backgrounds.
  const work = _root.querySelector('.dm-disp');
  work.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')) { e.preventDefault(); work.classList.add('dropping'); } });
  work.addEventListener('dragleave', (e) => { if (!work.contains(e.relatedTarget)) work.classList.remove('dropping'); });
  work.addEventListener('drop', (e) => {
    work.classList.remove('dropping');
    const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    uploadFiles(files);
  });
}

function wirePreview() {
  const box = document.getElementById('dispPreview');
  const frame = document.getElementById('dispFrame');
  const fitFrame = () => { frame.style.transform = `scale(${box.clientWidth / TV_WIDTH})`; };
  _previewObserver?.disconnect();
  _previewObserver = new ResizeObserver(fitFrame);
  _previewObserver.observe(box);
  fitFrame();
  // Once it's loaded, it gets this page's copy of the scene (which may be a moment ahead of the Pi's) and the battle.
  frame.addEventListener('load', () => postToPreview({ scene: getScene(), session: previewSession() }));
  box.addEventListener('click', openEditor);
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor(); } });
}

function postToPreview(msg) {
  const frame = document.getElementById('dispFrame');
  try { frame?.contentWindow?.postMessage({ source: 'dm-display', ...msg }, location.origin); } catch { /* not loaded yet */ }
}

function drawBattlePictures() {
  const box = document.getElementById('dispBattlePictures');
  if (!box) return;
  const current = getLive().battlePictures;
  box.innerHTML = Object.entries(BATTLE_PICTURES).map(([k, l]) => `<button data-bp="${k}" class="${k === current ? 'active' : ''}">${l}</button>`).join('');
  const over = document.getElementById('dispOverBattle');
  if (over) over.checked = !!getLive().overBattle;
}

// ---------------------------------------------------------------------------
// What's on the screen
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The planner and the queue
// ---------------------------------------------------------------------------

/** The battle as the preview shows it: none while planning (a planned scene is shown as it will look). */
function previewSession() {
  return _mode === 'plan' ? { active: false, participants: {}, turnOrder: [] } : _session;
}

/** The folders, the planner and the folder lists saved somewhere else (another device's console, or this one's own save
 * coming back -- then nothing's different and nothing's drawn): loaded again, so a save here never puts back what was
 * changed there (the user's call, 2026-10-21). */
async function stateSavedElsewhere(key) {
  if (key === 'display-planner') { reloadPlans(); return; }
  if (key === 'display-plan-folders' && _planFoldersLoaded) {
    const was = JSON.stringify(_planFolders);
    _planFoldersLoaded = false;
    await loadPlanFolders();
    if (JSON.stringify(_planFolders) !== was && _root?.querySelector('.dm-disp')) drawLayers();
    return;
  }
  const name = Object.keys(FOLDERED).find(k => FOLDERED[k] === key);
  if (!name || !_data[name] || _dragging) return;
  _data[name] = null;   // the pictures' / NPCs' folders too: loaded again with the tab
  if (_source === name && _root?.querySelector('.dm-disp')) drawSource();
}

// The planned scene last open in the planner: open again when the DM comes back to it from Live (the user's call,
// 2026-10-21 -- it went back to the folder's first scene, and pictures went into the wrong one)
let _lastPlanId = null;

async function switchMode(mode, planId = null) {
  _mode = mode;
  if (mode === 'plan') {
    await loadPlans();
    if (!getPlans().length) newPlan({ silent: true });
    const last = getPlans().some(p => p.id === _lastPlanId) ? _lastPlanId : null;
    const id = planId || openPlan()?.id || last || plansIn(_planFolder)[0]?.id || getPlans()[0].id;
    _planFolder = getPlans().find(p => p.id === id)?.folder || '';
    setOpenPlan(id);
    _lastPlanId = id;
  } else {
    _lastPlanId = openPlan()?.id || _lastPlanId;
    setOpenPlan(null);
  }
  if (_editor) closeEditor();
  draw();
}

function openPlanned(id) {
  if (id === openPlan()?.id) return;
  setOpenPlan(id);
  _lastPlanId = id;
  if (_editor) closeEditor();
  draw();
}

const copyScene = sc => JSON.parse(JSON.stringify({ background: sc.background || null, items: sc.items || [] }));

/** A new planned scene (empty, or `from` a scene: what's on the display now), in the folder open, opened in the planner. */
function newPlan({ from = null, silent = false } = {}) {
  const id = newId('plan');
  updatePlans((list) => {
    list.push({ id, name: `Scene ${list.length + 1}`, folder: _planFolder, scene: normaliseScene(from ? copyScene(from) : null),
      createdAt: new Date().toISOString(), shownAt: null });
  });
  if (!silent) setOpenPlan(id);
  return id;
}

function planThumb(plan) {
  const sc = plan.scene;
  const bg = sc.background?.url;
  const first = sc.items.find(i => i.still || i.src);
  return bg ? `<span class="dm-disp-plan-thumb" style="background-image:url('${escapeHtml(bg)}')"></span>`
    : first ? `<span class="dm-disp-plan-thumb">${thumbHtml(first.src, '', { still: first.still })}</span>` : '<span class="dm-disp-plan-thumb empty">📅</span>';
}

function planSummary(plan) {
  const sc = plan.scene;
  const n = sc.items.length;
  return [sc.background ? escapeHtml(sc.background.name || 'a background') : 'no background',
    `${n} picture${n === 1 ? '' : 's'}`, plan.shownAt ? '✓ shown' : ''].filter(Boolean).join(' · ');
}

/** The override bar: a planned scene is on the display over the battle. */
function drawOverride() {
  const el = document.getElementById('dispOverride');
  if (!el) return;
  const o = getLive().override;
  el.hidden = !o;
  el.innerHTML = o ? `<span>📺 <b>${escapeHtml(o.name || 'A planned scene')}</b> is on the display${battleOnDisplay(getLive(), _session) ? ' over the battle' : ''}.</span>
    <button class="dm-btn small danger" data-ov="stop" title="Back to what the display had">■ Stop</button>` : '';
}

// The planned scenes' folders (the user's call, 2026-10-20): [{id, name, parent}] in dm_state 'display-plan-folders'; a
// scene keeps its folder's id (`folder`, '' = the top). The planner and the queue show the same folder.
let _planFolders = [];
let _planFolder = '';
let _planFoldersLoaded = false;

async function loadPlanFolders() {
  if (_planFoldersLoaded) return;
  const saved = await DmAPI.getState('display-plan-folders').catch(() => null);
  _planFolders = (Array.isArray(saved) ? saved : []).filter(f => f && f.id).map(f => ({ id: f.id, name: String(f.name || 'Folder'), parent: f.parent || '' }));
  _planFoldersLoaded = true;
}

function savePlanFolders() {
  return DmAPI.saveState('display-plan-folders', _planFolders).catch(err => showCombatAlert(err.message, { title: 'Folders' }));
}

const plansIn = folder => getPlans().filter(p => (p.folder || '') === folder);

function planFolderPath(id) {
  const out = [];
  const seen = new Set();
  for (let f = _planFolders.find(x => x.id === id); f && !seen.has(f.id); f = _planFolders.find(x => x.id === f.parent)) {
    seen.add(f.id);
    out.unshift(f);
  }
  return out;
}

/** The path to the folder open, its folders, then its scenes -- `row(plan)` draws one. `manage`: with ＋ Folder and each
 * folder's ✎ / ✕ (only the Planned scenes tab -- the user's call, 2026-10-21: the queue and the planner just open
 * them). */
function planBrowserHtml(row, { manage = false } = {}) {
  if (_planFolder && !_planFolders.some(f => f.id === _planFolder)) _planFolder = '';
  const subs = _planFolders.filter(f => (f.parent || '') === _planFolder).sort((a, b) => a.name.localeCompare(b.name));
  const plans = plansIn(_planFolder);
  const inside = f => getPlans().filter(p => p.folder === f.id).length + _planFolders.filter(x => x.parent === f.id).length;
  return `<div class="dm-disp-crumbs dm-disp-plancrumbs">
      <button class="dm-disp-crumb${_planFolder ? '' : ' here'}" data-plan-open-folder="" data-plan-drop="">📅 All scenes</button>
      ${planFolderPath(_planFolder).map(f => `<span>›</span><button class="dm-disp-crumb${f.id === _planFolder ? ' here' : ''}" data-plan-open-folder="${escapeHtml(f.id)}" data-plan-drop="${escapeHtml(f.id)}">📁 ${escapeHtml(f.name)}</button>`).join('')}
      ${manage ? '<button class="dm-btn small dm-disp-newfolder" data-plan-act="new-folder" title="A folder for scenes, in the one open">＋ Folder</button>' : ''}
    </div>
    ${subs.map(f => `
      <div class="dm-disp-plan dm-disp-planfolder" data-plan-open-folder="${escapeHtml(f.id)}" data-plan-drop="${escapeHtml(f.id)}" data-plan-folder="${escapeHtml(f.id)}" role="button" tabindex="0" title="Open it -- or drag scenes onto it">
        <span class="dm-disp-plan-thumb empty">📁</span>
        <span class="dm-disp-layer-name"><strong>${escapeHtml(f.name)}</strong><small>${inside(f)} inside</small></span>
        ${manage ? `<button class="dm-icon-btn" data-plan-act="rename-folder" title="Rename">✎</button>
        <button class="dm-icon-btn danger" data-plan-act="delete-folder" title="Delete the folder (what's in it moves up)">✕</button>` : ''}
      </div>`).join('')}
    ${plans.map(row).join('')}
    ${!plans.length && !subs.length ? `<div class="dm-hint">${_planFolder ? 'Nothing in this folder yet -- drag scenes onto it, or 📁 Move one here.' : 'No planned scenes yet.'}</div>` : ''}
    ${manage ? '' : '<div class="dm-hint dm-disp-planhint">Folders are made and scenes sorted into them in the 📅 Scenes tab.</div>'}`;
}

/** Live: the planned scenes waiting to be shown -- Show, change it in the planner, or delete it. */
function drawQueue() {
  const box = document.getElementById('dispQueue');
  if (!box) return;
  box.innerHTML = `
    <div class="dm-card-title"><span>📅 Queued scenes</span>
      <span class="dm-row dm-enc-titlebtns"><button class="dm-btn small" data-plan-act="new-live" title="Plan a new scene in the planner">＋ Plan a scene</button></span></div>
    ${getPlans().length || _planFolders.length ? planBrowserHtml(p => `
      <div class="dm-disp-plan${p.shownAt ? ' shown' : ''}" data-plan="${escapeHtml(p.id)}" draggable="true">
        ${planThumb(p)}
        <span class="dm-disp-layer-name"><strong>${escapeHtml(p.name)}${p.overBattle ? ' <span class="dm-disp-ovtag" title="Override battle screen: over everything during a battle">Override battle screen</span>' : ''}</strong><small>${planSummary(p)}</small></span>
        <button class="dm-btn small primary" data-plan-act="show" title="Put it on the display -- its background and pictures in place of the ones there now${p.overBattle ? ', over the battle too' : ''}">📺 Show</button>
        <button class="dm-icon-btn" data-plan-act="edit" title="Change it in the planner">✎</button>
        <button class="dm-icon-btn danger" data-plan-act="delete" title="Delete it">✕</button>
      </div>`) : '<div class="dm-hint">Nothing queued -- prepare scenes in the 📅 Planner (during a battle too); they wait here until you show them.</div>'}`;
  wirePlanDrag(box);
}

/** Planner: the planned scenes, the one open highlighted, with its Override switch and Show. Saved as they change. */
function drawPlans() {
  const box = document.getElementById('dispPlans');
  if (!box) return;
  const open = openPlan();
  box.innerHTML = `
    <div class="dm-card-title"><span>📅 Planned scenes</span>
      <span class="dm-row dm-enc-titlebtns">
        <button class="dm-btn small" data-plan-act="new" title="An empty scene, in the folder open">＋ New</button>
        <button class="dm-btn small" data-plan-act="copy-live" title="A new scene starting from what's on the display now">⧉ From the display</button></span></div>
    ${planBrowserHtml(p => `
      <div class="dm-disp-plan${p.id === open?.id ? ' open' : ''}" data-plan="${escapeHtml(p.id)}" draggable="true" role="button" tabindex="0" title="Work on this one">
        ${planThumb(p)}
        <span class="dm-disp-layer-name"><strong>${escapeHtml(p.name)}</strong><small>${planSummary(p)}</small></span>
        <button class="dm-btn small dm-disp-ovbtn${p.overBattle ? ' on' : ''}" data-plan-act="override" aria-pressed="${p.overBattle ? 'true' : 'false'}"
          title="${p.overBattle ? 'Override battle screen is on: during a battle this scene stays over everything, the turn order too. Click to turn it off.' : 'Override battle screen is off: during a battle the turn order shows over this scene. Click to turn it on.'}">Override battle screen</button>
        <button class="dm-icon-btn" data-plan-act="rename" title="Rename">✎</button>
        <button class="dm-icon-btn" data-plan-act="move" title="Move it to another folder">📁</button>
        <button class="dm-icon-btn danger" data-plan-act="delete" title="Delete it">✕</button>
      </div>`)}
    ${open ? `<div class="dm-hint">Everything you add here goes into "${escapeHtml(open.name)}" (saved automatically) -- the display doesn't change. It's shown from the queue in 📺 Live.</div>` : ''}`;
  wirePlanDrag(box);
}

/** Drag a scene (a folder too, in the planner) onto a folder or a step of the path to move it there. */
function wirePlanDrag(box) {
  if (box._planDrag) return; // (the box stays -- only what's in it is redrawn)
  box._planDrag = true;
  const TYPE = 'application/x-dm-plan';
  box.addEventListener('dragstart', (e) => {
    const row = e.target.closest?.('[data-plan], [data-plan-folder]');
    if (!row) return;
    e.dataTransfer.setData(TYPE, JSON.stringify(row.dataset.plan ? { plan: row.dataset.plan } : { folder: row.dataset.planFolder }));
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  box.addEventListener('dragend', () => box.querySelectorAll('.dragging, .drop-here').forEach(el => el.classList.remove('dragging', 'drop-here')));
  box.addEventListener('dragover', (e) => {
    const target = e.target.closest?.('[data-plan-drop]');
    if (!target || ![...e.dataTransfer.types].includes(TYPE)) return;
    e.preventDefault();
    box.querySelectorAll('.drop-here').forEach(el => { if (el !== target) el.classList.remove('drop-here'); });
    target.classList.add('drop-here');
  });
  box.addEventListener('dragleave', (e) => {
    const target = e.target.closest?.('[data-plan-drop]');
    if (target && !target.contains(e.relatedTarget)) target.classList.remove('drop-here');
  });
  box.addEventListener('drop', (e) => {
    const target = e.target.closest?.('[data-plan-drop]');
    const raw = e.dataTransfer.getData(TYPE);
    if (!target || !raw) return;
    e.preventDefault();
    const into = target.dataset.planDrop;
    const what = JSON.parse(raw);
    if (what.plan) { movePlan(what.plan, into); return; }
    const f = _planFolders.find(x => x.id === what.folder);
    if (!f || f.id === into || planFolderPath(into).some(x => x.id === f.id)) return; // never into itself
    f.parent = into;
    savePlanFolders();
    drawLayers();
  });
}

function movePlan(id, into) {
  const plan = getPlans().find(p => p.id === id);
  if (!plan || (plan.folder || '') === into) return;
  updatePlans(() => { plan.folder = into; });
}

async function onPlanClick(e) {
  if (e.target.closest('[data-ov="stop"]')) { stopOverride(); return; }
  const btn = e.target.closest('[data-plan-act]');
  const folderRow = e.target.closest('[data-plan-folder]');
  const openFolder = e.target.closest('[data-plan-open-folder]');
  if (folderRow && btn) { planFolderAction(btn.dataset.planAct, _planFolders.find(f => f.id === folderRow.dataset.planFolder)); return; }
  if (openFolder && !btn) { _planFolder = openFolder.dataset.planOpenFolder; drawLayers(); return; }
  const row = e.target.closest('[data-plan]');
  const plan = getPlans().find(p => p.id === (btn?.dataset.id || row?.dataset.plan));
  if (!btn) {
    if (row && _mode === 'plan' && plan) openPlanned(plan.id);
    return;
  }
  const act = btn.dataset.planAct;
  if (act === 'new-folder') { newPlanFolder(); return; }
  if (act === 'new' || act === 'copy-live') {
    newPlan(act === 'copy-live' ? { from: getLive() } : {});
    draw();
    return;
  }
  if (act === 'new-live' || act === 'new-scene') { const id = newPlan({ silent: true }); switchMode('plan', id); return; }
  if (!plan) return;
  if (act === 'show') showPlan(plan);
  else if (act === 'stop') stopOverride();
  else if (act === 'override') updatePlans(() => { plan.overBattle = !plan.overBattle; });
  else if (act === 'edit') switchMode('plan', plan.id);
  else if (act === 'move') {
    const into = await pickPlanFolder(`📁 Move "${plan.name}" to…`);
    if (into !== null) movePlan(plan.id, into);
  } else if (act === 'rename') {
    const name = await askName('Rename the scene', plan.name);
    if (name) updatePlans(() => { plan.name = name; });
  } else if (act === 'delete') {
    if (!await showCombatConfirm(`Delete the planned scene "${plan.name}"?`, { title: 'Delete scene', yesLabel: 'Delete', noLabel: 'Cancel' })) return;
    const wasOpen = openPlan()?.id === plan.id;
    updatePlans((list) => { list.splice(list.indexOf(plan), 1); });
    if (_mode === 'live') return;
    if (wasOpen) {
      if (!getPlans().length) newPlan({ silent: true });
      setOpenPlan((plansIn(_planFolder)[0] || getPlans()[0]).id);
      draw();
    }
  }
}

async function newPlanFolder() {
  const name = await askName('New folder');
  if (!name) return;
  _planFolders.push({ id: newId('pfold'), name, parent: _planFolder });
  await savePlanFolders();
  drawLayers();
}

/** A folder's ✎ / ✕. Deleted, what's in it -- scenes and folders -- moves up into the folder it was in. */
async function planFolderAction(act, f) {
  if (!f) return;
  if (act === 'rename-folder') {
    const name = await askName('Rename the folder', f.name);
    if (!name || name === f.name) return;
    f.name = name;
  } else if (act === 'delete-folder') {
    const scenes = getPlans().filter(p => p.folder === f.id);
    const subs = _planFolders.filter(x => x.parent === f.id);
    const what = scenes.length || subs.length ? ` Its ${[scenes.length && `${scenes.length} scene${scenes.length === 1 ? '' : 's'}`, subs.length && `${subs.length} folder${subs.length === 1 ? '' : 's'}`].filter(Boolean).join(' and ')} move up a level -- nothing is deleted.` : '';
    if (!await showCombatConfirm(`Delete the folder "${f.name}"?${what}`, { title: 'Delete folder', yesLabel: 'Delete', noLabel: 'Cancel' })) return;
    if (scenes.length) updatePlans(() => { scenes.forEach((p) => { p.folder = f.parent || ''; }); });
    subs.forEach((x) => { x.parent = f.parent || ''; });
    _planFolders = _planFolders.filter(x => x.id !== f.id);
    if (_planFolder === f.id) _planFolder = f.parent || '';
  } else return;
  await savePlanFolders();
  drawLayers();
}

/** Every planned-scene folder as a tree -> the one picked ('' = the top), or null. */
async function pickPlanFolder(title) {
  const rows = [];
  const walk = (parent, depth) => _planFolders.filter(f => (f.parent || '') === parent).sort((a, b) => a.name.localeCompare(b.name))
    .forEach((f) => { rows.push({ f, depth }); walk(f.id, depth + 1); });
  walk('', 1);
  const into = await openDmModal({
    title,
    html: `<div class="dm-disp-movelist">
      <button class="dm-species-item" data-into=""><span class="dm-species-name">📅 All scenes</span></button>
      ${rows.map(({ f, depth }) => `<button class="dm-species-item" data-into="${escapeHtml(f.id)}" style="padding-left:${0.6 + depth}rem"><span class="dm-species-name">📁 ${escapeHtml(f.name)}</span></button>`).join('')}
    </div>${rows.length ? '' : '<div class="dm-hint">No folders yet -- make one with ＋ Folder.</div>'}`,
    buttons: [{ label: 'Cancel', value: null }],
    onOpen: (body, close) => body.addEventListener('click', (ev) => { const b = ev.target.closest('[data-into]'); if (b) close(b.dataset.into); }),
  });
  return into === null || into === undefined ? null : into;
}

/** 📺 Show: the planned scene's background and pictures take the place of the display's own (it stays in the queue), and
 * its Override comes along -- on, the scene stays over the battle too, turn order and all (the user's call, 2026-10-20). */
function showPlan(plan) {
  const sc = copyScene(plan.scene);
  updateLive((s) => { s.background = sc.background; s.items = sc.items; s.overBattle = !!plan.overBattle; s.override = null; });
  updatePlans(() => { plan.shownAt = new Date().toISOString(); });
  toast(`"${plan.name}" is on the display${battleOnDisplay(getLive(), _session) ? (plan.overBattle ? ' -- over the battle (Override)' : ' -- behind the battle') : ''}.`);
}

/** An older planned scene put over the display (scene.override, before Override was the scene's own switch) taken off. */
function stopOverride() {
  updateLive((s) => { s.override = null; });
}

/** A small picture. `still`: shown instead of an animated sprite -- for the little lists redrawn on every change (a video
 * there would start over, and decode, each time). Animated ones load the Pi's small sprite copy. */
function thumbHtml(src, cls = '', { lazyVideo = false, still = '' } = {}) {
  if (!src) return `<span class="dm-disp-thumb ${cls}"><img src="assets/Pokeball-small.png" alt="" style="opacity:.3"></span>`;
  if (IS_VIDEO.test(src) && still) src = still;
  return IS_VIDEO.test(src)
    ? `<span class="dm-disp-thumb ${cls}"><video src="${escapeHtml(spriteSrc(src))}" muted loop playsinline disablepictureinpicture ${lazyVideo ? 'data-lazy preload="none"' : 'autoplay'}></video></span>`
    : `<span class="dm-disp-thumb ${cls}"><img src="${escapeHtml(src)}" alt="" loading="lazy" draggable="false"></span>`;
}

function drawLayers() {
  const box = document.getElementById('dispLayers');
  if (!box) return;
  const scene = getScene();
  const hideAll = document.getElementById('dispHideAll');
  if (hideAll) {
    const anyShown = scene.items.some(i => !i.hidden);
    hideAll.textContent = anyShown ? 'Hide all' : 'Show all';
    hideAll.disabled = !scene.items.length;
  }
  const items = [...scene.items].reverse(); // the top one first
  drawOverride();
  if (_mode === 'plan') drawPlans(); else drawQueue();
  if (_source === 'scenes') drawScenesTab();
  const putAway = battleOnDisplay(scene, previewSession()) && scene.battlePictures !== 'keep' && items.length;
  box.innerHTML = `
    ${putAway ? '<div class="dm-disp-away">⚔️ Put away during the battle</div>' : ''}
    ${items.map(it => `
      <div class="dm-disp-layer${it.hidden ? ' hidden-item' : ''}" data-id="${escapeHtml(it.id)}">
        ${thumbHtml(it.src, '', { still: it.still })}
        <span class="dm-disp-layer-name"><strong>${escapeHtml(it.label || 'Picture')}</strong>
          <small>${KIND_LABEL[it.kind] || 'Picture'} · ${Math.round((Number(it.size) || 0) * 100)}% high${it.hidden ? ' · <span class="dm-warn-text">hidden</span>' : ''}</small></span>
        <button class="dm-btn small dm-disp-showbtn${it.hidden ? ' off' : ''}" data-l="hide" title="${it.hidden ? 'Show it on the display' : 'Hide it from the display (it stays here)'}">${it.hidden ? 'Show' : 'Hide'}</button>
        <button class="dm-icon-btn danger" data-l="remove" title="Take it off">✕</button>
      </div>`).join('')}
    ${scene.background ? `<div class="dm-disp-bgrow">
      ${thumbHtml(scene.background.url, 'wide')}<span class="dm-disp-layer-name"><strong>${escapeHtml(scene.background.name || 'Background')}</strong><small>Background</small></span>
      <button class="dm-btn small" data-l="bg-change">Change</button><button class="dm-btn small danger" data-l="bg-remove">Remove</button>
    </div>` : ''}`;
}

function itemAction(id, act) {
  const it = getScene().items.find(x => x.id === id);
  if (!it) return;
  if (act === 'hide') updateScene(() => { it.hidden = !it.hidden; });
  else if (act === 'remove') { updateScene((s) => { s.items = s.items.filter(x => x.id !== id); }); if (_editor?.selectedId === id) _editor.selectedId = null; }
  else if (act === 'flip') updateScene(() => { it.flip = !it.flip; });
  else if (act === 'dup') {
    const copy = { ...it, id: newId('pic'), x: Math.min(1, it.x + 0.04), y: Math.min(1, it.y + 0.04) };
    updateScene((s) => { s.items.splice(s.items.indexOf(it) + 1, 0, copy); });
    if (_editor) { _editor.selectedId = copy.id; drawEditorStage(); drawEditorSide(); }
  }
}

function onLayerClick(e) {
  const b = e.target.closest('[data-l]');
  if (!b) return;
  e.preventDefault();
  const act = b.dataset.l;
  if (act === 'bg-change') { switchSource('backgrounds'); return; }
  if (act === 'bg-remove') { updateScene((s) => { s.background = null; }); return; }
  itemAction(b.closest('[data-id]')?.dataset.id, act);
}

function switchSource(name) {
  _source = name;
  document.querySelectorAll('#dispTabs [data-src]').forEach(x => x.classList.toggle('active', x.dataset.src === name));
  drawSource();
}

// ---------------------------------------------------------------------------
// The workspace: Pokemon, NPCs, trainers, backgrounds
// ---------------------------------------------------------------------------

async function loadSource(name) {
  if (_data[name]) return _data[name];
  if (name === 'pokemon') {
    _data.pokemon = (await getSpecies()).map(s => ({
      key: s.name, kind: 'pokemon', label: s.name, sub: `#${s.dex}`,
      still: s.picture || '', animated: IS_VIDEO.test(s.image || '') ? s.image : '',
      search: `${s.name} ${s.type1} ${s.type2} ${s.dex}`.toLowerCase(),
    }));
    refreshSpriteUrls();
  } else if (name === 'npcs') {
    const [npcs, kept] = await Promise.all([DmAPI.npcs(), DmAPI.getState('display-npc-folders').catch(() => null)]);
    const placed = kept?.placed || {};
    _data.npcs = (npcs.data || []).map(n => ({
      key: n.id, kind: 'npc', label: n.name || 'NPC', sub: n.role || n.location || '', still: n.image || '', animated: '',
      search: `${n.name} ${n.role} ${n.faction} ${n.location}`.toLowerCase(), folder: placed[n.id] || '',
    }));
    useFolderSet('npcs');
    _folders = Array.isArray(kept?.folders) ? kept.folders : [];
    if (_folder && !_folders.some(f => f.id === _folder)) _folder = '';
  } else if (name === 'trainers') {
    _data.trainers = ((await DmAPI.party()).data || []).map(({ trainer: t }) => ({
      key: t.name, kind: 'trainer', label: t.name, sub: `Lv ${t.level}`, still: t.image || '', animated: '', search: String(t.name).toLowerCase(),
    }));
  } else if (name === 'backgrounds') {
    const [images, folders] = await Promise.all([DmAPI.displayImages(), DmAPI.getState('display-folders').catch(() => null)]);
    _data.backgrounds = images.data || [];
    useFolderSet('backgrounds');
    _folders = Array.isArray(folders) ? folders : [];
    if (_folder && !_folders.some(f => f.id === _folder)) _folder = '';
  }
  return _data[name];
}

/** A sprite file replaced on the Pi (strip_sprite_audio.sh, a new export) gets a new `?t=` in its URL, but pictures
 * already on the display still point at the old one, which browsers keep cached -- they're moved to the current one. */
function refreshSpriteUrls() {
  const base = url => String(url).split('?')[0];
  const current = new Map(_data.pokemon.filter(e => e.animated).map(e => [base(e.animated), e.animated]));
  const stale = getScene().items.filter(i => i.animated && current.has(base(i.animated)) && current.get(base(i.animated)) !== i.animated);
  if (!stale.length) return;
  updateScene(() => stale.forEach((i) => {
    const now = current.get(base(i.animated));
    if (i.src === i.animated) i.src = now;
    i.animated = now;
  }));
}

async function drawSource() {
  const upload = document.getElementById('dispUploadRow');
  if (upload) upload.hidden = _source !== 'backgrounds';
  const addHidden = document.getElementById('dispAddHiddenBox');
  if (addHidden) addHidden.hidden = _source === 'scenes';
  const search = document.getElementById('dispSearch');
  if (search) search.value = _queries[_source] || '';
  if (search) search.placeholder ={ pokemon: 'Search Pokémon by name, type or number…', npcs: 'Search NPCs…', trainers: 'Search trainers…', backgrounds: 'Search pictures…', scenes: 'Search planned scenes…' }[_source];
  const grid = document.getElementById('dispGrid');
  if (!grid) return;
  if (_source === 'scenes') { drawScenesTab(); return; }
  grid.className = `dm-disp-grid${_source === 'backgrounds' ? ' wide' : ''}`;
  if (!_data[_source]) grid.innerHTML = '<div class="dm-loading">Loading…</div>';
  useFolderSet(_source);
  try { await loadSource(_source); } catch (err) { grid.innerHTML = `<div class="dm-hint">Couldn't load: ${escapeHtml(err.message)}</div>`; return; }
  // the locations' folders, each time the backgrounds are shown (one made or renamed in Admin meanwhile)
  if (_source === 'backgrounds') {
    const locations = await DmAPI.getState('locations').catch(() => null);
    if (Array.isArray(locations)) _locIcons = new Map(locations.filter(l => l?.id && l.icon?.url).map(l => [l.id, l.icon.url]));
    if (_folderSet === 'backgrounds' && syncLocationFolders(locations)) saveFolders();   // (not if another tab is open by now)
  }
  drawGrid();
}

/** The Planned scenes tab: the scenes in folders, organised here -- ＋ New scene / ＋ Folder in the folder open, drag a
 * scene (or a folder) onto a folder or a step of the path, ✎ opens it in the planner. A search looks in every folder. */
function drawScenesTab() {
  const grid = document.getElementById('dispGrid');
  if (!grid || _source !== 'scenes') return;
  grid.className = 'dm-disp-grid dm-disp-scenes';
  const q = (_queries.scenes || '').trim().toLowerCase();
  const open = _mode === 'plan' ? openPlan()?.id : null;
  const row = p => `
      <div class="dm-disp-plan${p.id === open ? ' open' : ''}${p.shownAt ? ' shown' : ''}" data-plan="${escapeHtml(p.id)}" draggable="true">
        ${planThumb(p)}
        <span class="dm-disp-layer-name"><strong>${escapeHtml(p.name)}${p.overBattle ? ' <span class="dm-disp-ovtag" title="Over everything during a battle">Override battle screen</span>' : ''}</strong>
          <small>${planSummary(p)}${q && p.folder ? ` · 📁 ${escapeHtml(planFolderPath(p.folder).map(f => f.name).join(' › '))}` : ''}</small></span>
        <button class="dm-btn small" data-plan-act="edit" title="Work on it in the planner">✎ Edit</button>
        <button class="dm-icon-btn" data-plan-act="rename" title="Rename">Aa</button>
        <button class="dm-icon-btn" data-plan-act="move" title="Move it to another folder">📁</button>
        <button class="dm-icon-btn danger" data-plan-act="delete" title="Delete it">✕</button>
      </div>`;
  const found = q ? getPlans().filter(p => String(p.name).toLowerCase().includes(q)) : null;
  grid.innerHTML = `<div class="dm-row dm-disp-scenes-head">
      <button class="dm-btn small primary" data-plan-act="new-scene" title="An empty scene in the folder open, opened in the planner">＋ New scene</button>
      <span class="dm-hint">Drag a scene onto a folder to sort it. Scenes are shown from the queue in 📺 Live.</span></div>
    ${found ? (found.map(row).join('') || '<div class="dm-hint">No planned scene matches that.</div>') : planBrowserHtml(row, { manage: true })}`;
  wirePlanDrag(grid);
}

function drawGrid() {
  if (_source === 'scenes') { drawScenesTab(); return; }
  const grid = document.getElementById('dispGrid');
  const list = _data[_source];
  if (!grid || !list) return;
  const q = (_queries[_source] || '').trim().toLowerCase();
  if (_source === 'backgrounds') {
    const current = getScene().background?.url;
    // Searching looks in every folder, and so does Folder mode unticked; otherwise the folder open: its folders, then its
    // pictures
    const every = !!q || !_folderMode;
    const shown = list.filter(b => (q ? b.name.toLowerCase().includes(q) : every || (b.folder || '') === _folder));
    const here = every ? [] : _folders.filter(f => (f.parent || '') === _folder).sort((a, b) => a.name.localeCompare(b.name));
    const folders = here.filter(f => !f.locId);
    grid.innerHTML = `${foldersBarHtml(q)}${folders.map(folderCardHtml).join('')}${locationFoldersHtml(here.filter(f => f.locId))}` + (shown.length ? shown.map(b => `
      <div class="dm-disp-bg${b.url === current ? ' current' : ''}${_picked.has(b.id) ? ' picked' : ''}" data-bg="${escapeHtml(b.id)}" draggable="true" role="button" tabindex="0" title="Put it on the display as the background -- drag it into a folder, or tick it (Ctrl + click) to move several">
        <span class="dm-disp-bg-img"><img src="${escapeHtml(b.url)}" alt="" loading="lazy" draggable="false"></span>
        <button class="dm-disp-tick" data-pick-bg title="${_picked.has(b.id) ? 'Unpick it' : 'Pick it -- to move several at once'}">✓</button>
        <span class="dm-disp-bg-name">${b.url === current ? '✓ ' : ''}${escapeHtml(b.name)}${every && b.folder ? `<small> · 📁 ${escapeHtml(folderPath(b.folder).map(f => f.name).join(' › '))}</small>` : ''}</span>
        <span class="dm-disp-bg-tools">
          <button class="dm-icon-btn" data-bgact="pic" title="Put it on as a picture instead (to move and resize)">＋</button>
          <button class="dm-icon-btn" data-bgact="rename" title="Rename">✎</button>
          <button class="dm-icon-btn danger" data-bgact="delete" title="Delete it from the Pi">✕</button>
        </span>
      </div>`).join('') : here.length ? '' : `<div class="dm-hint dm-disp-empty">${q ? 'No picture matches that.' : _folder ? 'This folder is empty -- drag pictures here, or upload them while it\'s open.' : list.length ? 'No pictures out here -- they\'re all in folders.' : 'No pictures uploaded yet -- upload a few backgrounds (a route, a forest, a city…) and they stay here for next time.'}</div>`);
    wireFolderDrag(grid);
    drawPickedBar();
    return;
  }
  if (_source === 'npcs') {
    const shown = list.filter(e => (q ? e.search.includes(q) : (e.folder || '') === _folder));
    const folders = q ? [] : _folders.filter(f => (f.parent || '') === _folder).sort((a, b) => a.name.localeCompare(b.name));
    grid.innerHTML = `${foldersBarHtml(q)}${folders.map(folderCardHtml).join('')}` + (shown.length ? shown.map(e => `
      <div class="dm-disp-card${_picked.has(e.key) ? ' picked' : ''}${e.still ? '' : ' nopic'}" data-add="${escapeHtml(e.key)}" data-entry="${escapeHtml(e.key)}" draggable="true" role="button" tabindex="0"
        title="${e.still ? 'Put it on the display' : 'No picture'} -- drag it into a folder, or tick it (Ctrl + click) to move several">
        <button class="dm-disp-tick" data-pick-bg title="${_picked.has(e.key) ? 'Unpick it' : 'Pick it -- to move several at once'}">✓</button>
        ${thumbHtml(e.still, '')}
        <span class="dm-disp-card-name">${escapeHtml(e.label)}</span>
        ${e.sub || (q && e.folder) ? `<small>${escapeHtml(e.sub || '')}${q && e.folder ? ` · 📁 ${escapeHtml(folderPath(e.folder).map(f => f.name).join(' › '))}` : ''}</small>` : ''}
      </div>`).join('') : folders.length ? '' : `<div class="dm-hint dm-disp-empty">${q ? 'No NPC matches that.' : _folder ? 'This folder is empty -- drag NPCs here.' : list.length ? 'No NPCs out here -- they\'re all in folders.' : 'No NPCs in the NPC library yet.'}</div>`);
    wireFolderDrag(grid);
    drawPickedBar();
    return;
  }
  const shown = list.filter(e => !q || e.search.includes(q));
  grid.innerHTML = shown.length ? shown.slice(0, MAX_RESULTS).map(e => `
    <button class="dm-disp-card" data-add="${escapeHtml(e.key)}" ${e.still || e.animated ? '' : 'disabled title="No picture"'}>
      ${thumbHtml(e.animated || e.still, '', { lazyVideo: true })}
      <span class="dm-disp-card-name">${escapeHtml(e.label)}</span>
      ${e.sub ? `<small>${escapeHtml(e.sub)}</small>` : ''}
    </button>`).join('') + (shown.length > MAX_RESULTS ? `<div class="dm-hint dm-disp-more">${shown.length - MAX_RESULTS} more -- search to narrow it down.</div>` : '')
    : `<div class="dm-hint">${list.length ? 'Nothing matches that.' : { npcs: 'No NPCs in the NPC library yet.', trainers: 'No trainers yet.', pokemon: 'No species.' }[_source]}</div>`;
  playVisibleVideos(grid);
}

// The animated sprites in the workspace only play while they're scrolled into view (up to 150 of them are listed).
let _videoObserver = null;
function playVisibleVideos(grid) {
  _videoObserver?.disconnect();
  _videoObserver = new IntersectionObserver((entries) => {
    entries.forEach(({ target: v, isIntersecting }) => {
      if (isIntersecting) { v.preload = 'auto'; v.play().catch(() => {}); } else v.pause();
    });
  }, { root: grid.closest('.dm-disp-work-body') || null, rootMargin: '120px' });
  grid.querySelectorAll('video[data-lazy]').forEach(v => _videoObserver.observe(v));
}

function addPicture({ kind, label, still = '', animated = '' }) {
  const src = animated || still; // the animated sprite whenever there is one
  if (!src) return;
  const n = getScene().items.length;
  const hidden = _addHidden;
  updateScene((s) => {
    // Side by side across the lower part of the screen, so a few added in a row don't land on top of each other.
    s.items.push({ id: newId('pic'), kind, label, src, still, animated, x: 0.12 + (n % 5) * 0.19, y: 0.64, size: 0.36, flip: false, hidden });
  });
  const plan = openPlan();
  toast(plan ? `${label} is in "${plan.name}".` : hidden ? `${label} is ready, hidden -- click Show to put it on.` : `${label} is on the display.`);
}

async function onGridClick(e) {
  if (_source === 'scenes') { onPlanClick(e); return; }
  if (FOLDERED[_source] && e.target.closest('[data-picked-act]')) { onPickedBar(e.target.closest('[data-picked-act]').dataset.pickedAct); return; }
  if (FOLDERED[_source] && onFolderClick(e)) return;
  const npcCard = _source === 'npcs' && e.target.closest('[data-entry]');
  if (npcCard) {
    const entry = _data.npcs.find(x => x.key === npcCard.dataset.entry);
    if (!entry) return;
    if (e.target.closest('[data-pick-bg]') || e.ctrlKey || e.metaKey || e.shiftKey || _picked.size) {
      if (_picked.has(entry.key)) _picked.delete(entry.key); else _picked.add(entry.key);
      drawGrid();
      return;
    }
    if (entry.still) addPicture(entry);
    return;
  }
  const bgTool = e.target.closest('[data-bgact]');
  const bgCard = e.target.closest('[data-bg]');
  if (bgCard) {
    const img = _data.backgrounds.find(b => b.id === bgCard.dataset.bg);
    if (!img) return;
    // Picking: the tick, Ctrl / Cmd / Shift + click -- or any click while some are picked
    if (!bgTool && (e.target.closest('[data-pick-bg]') || e.ctrlKey || e.metaKey || e.shiftKey || _picked.size)) {
      if (_picked.has(img.id)) _picked.delete(img.id); else _picked.add(img.id);
      drawGrid();
      return;
    }
    if (!bgTool) { updateScene((s) => { s.background = { url: img.url, name: img.name }; }); drawGrid(); toast(`${img.name} is the background now.`); return; }
    const act = bgTool.dataset.bgact;
    if (act === 'pic') addPicture({ kind: 'image', label: img.name, still: img.url });
    else if (act === 'rename') renameImage(img);
    else if (act === 'delete') deleteImage(img);
    return;
  }
  const card = e.target.closest('[data-add]');
  if (!card) return;
  const entry = _data[_source]?.find(x => x.key === card.dataset.add);
  if (entry) addPicture(entry);
}

async function renameImage(img) {
  let typed = img.name;
  const answer = await openDmModal({
    title: 'Rename the picture',
    html: `<input class="dm-input" id="imgName" value="${escapeHtml(img.name)}" maxlength="80">`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save', kind: 'primary', value: 'save' }],
    onOpen: (body, close) => {
      const input = body.querySelector('#imgName');
      setTimeout(() => input.select(), 0);
      input.addEventListener('input', () => { typed = input.value.trim(); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') close('save'); });
    },
  });
  if (answer !== 'save' || !typed || typed === img.name) return;
  try {
    const saved = await DmAPI.saveDisplayImage({ id: img.id, name: typed });
    img.name = saved.name;
    if (getScene().background?.url === img.url) updateScene((s) => { s.background.name = saved.name; });
    drawGrid();
  } catch (err) { showCombatAlert(err.message, { title: 'Rename' }); }
}

async function deleteImage(img) {
  const used = getScene().background?.url === img.url || getScene().items.some(i => i.src === img.url);
  if (!await showCombatConfirm(`Delete "${img.name}" from the Pi?${used ? ' It comes off the display too.' : ''}`,{ title: 'Delete picture', yesLabel: 'Delete', noLabel: 'Cancel' })) return;
  try { await DmAPI.deleteDisplayImage(img.id); } catch (err) { showCombatAlert(err.message, { title: 'Delete picture' }); return; }
  _data.backgrounds = _data.backgrounds.filter(b => b.id !== img.id);
  if (used) {
    updateScene((s) => {
      if (s.background?.url === img.url) s.background = null;
      s.items = s.items.filter(i => i.src !== img.url);
    });
  }
  drawGrid();
}

// ---------------------------------------------------------------------------
// Uploading
// ---------------------------------------------------------------------------

function pickFiles() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.addEventListener('change', () => uploadFiles([...(input.files || [])]));
  input.click();
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error(`Couldn't read ${file.name}`));
    r.readAsDataURL(file);
  });
}

/** The file as a data: URL, scaled down first when it's bigger than `maxSide` -- by default the TV's size (an animated
 * GIF is left as it is). Also used for the NPC pictures (npcs.js). */
export async function prepareImage(file, maxSide = MAX_UPLOAD_SIDE) {
  const dataUrl = await readAsDataUrl(file);
  if (file.type === 'image/gif') return dataUrl;
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error(`${file.name} isn't a picture the browser can read`));
    el.src = dataUrl;
  });
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const type = ['image/png', 'image/webp'].includes(file.type) ? file.type : 'image/jpeg';
  if (scale === 1 && file.size < 4 * 1024 * 1024 && ['image/png', 'image/webp', 'image/jpeg'].includes(file.type)) return dataUrl;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(type, 0.9);
}

async function uploadFiles(files) {
  files = files.filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  if (_source !== 'backgrounds') switchSource('backgrounds');
  await loadSource('backgrounds').catch(() => { _data.backgrounds = []; });
  const btn = document.getElementById('dispUpload');
  const failed = [];
  for (const [i, file] of files.entries()) {
    if (btn) { btn.disabled = true; btn.textContent = `Uploading ${i + 1} of ${files.length}…`; }
    try {
      const img = await DmAPI.saveDisplayImage({ name: file.name.replace(/\.[^.]+$/, ''), data: await prepareImage(file), folder: folderOpenIn('backgrounds') });
      _data.backgrounds.unshift(img);
      drawGrid();
    } catch (err) {
      failed.push(`${file.name}: ${err.message}`);
    }
  }
  if (btn) { btn.disabled = false; btn.textContent = '⬆ Upload pictures'; }
  if (failed.length) showCombatAlert(failed.join('\n'), { title: "Couldn't upload" });
  else toast(files.length === 1 ? 'Uploaded -- click it to put it on the display.' : `Uploaded ${files.length} pictures.`);
}

// ---------------------------------------------------------------------------
// The big editor: drag to move, drag a corner to resize (square), a toolbar for the picture picked
// ---------------------------------------------------------------------------

function openEditor() {
  if (_editor) return;
  const overlay = document.createElement('div');
  overlay.className = 'dm-disp-editor';
  overlay.innerHTML = `
    <div class="dm-disp-ed-bar">
      <strong>📺 Arrange the display</strong>
      <span class="dm-hint">Drag a picture to move it · drag a corner to resize it · arrow keys nudge · Delete takes it off.</span>
      <button class="dm-btn primary" id="edDone">Done</button>
    </div>
    <div class="dm-disp-ed-main">
      <div class="dm-disp-ed-area" id="edArea"><div class="dm-disp-ed-stage" id="edStage"></div></div>
      <aside class="dm-disp-ed-side" id="edSide"></aside>
    </div>`;
  document.body.appendChild(overlay);
  const stage = overlay.querySelector('#edStage');
  const area = overlay.querySelector('#edArea');
  const top = getScene().items[getScene().items.length - 1];
  _editor = { overlay, stage, area, selectedId: top?.id || null, observer: new ResizeObserver(fitStage) };
  _editor.observer.observe(area);
  fitStage();
  drawEditorStage();
  drawEditorSide();
  overlay.querySelector('#edDone').addEventListener('click', closeEditor);
  stage.addEventListener('pointerdown', onStagePointerDown);
  area.addEventListener('pointerdown', (e) => { if (e.target === area) select(null); });
  overlay.querySelector('#edSide').addEventListener('click', onSideClick);
  overlay.querySelector('#edSide').addEventListener('input', onSideInput);
  document.addEventListener('keydown', onEditorKey);
}

function closeEditor() {
  if (!_editor) return;
  _editor.observer.disconnect();
  _editor.overlay.remove();
  document.removeEventListener('keydown', onEditorKey);
  _editor = null;
  drawLayers();
}

function fitStage() {
  if (!_editor) return;
  const r = _editor.area.getBoundingClientRect();
  const w = Math.max(200, Math.min(r.width - 32, (r.height - 32) * SCREEN_RATIO));
  _editor.stage.style.width = `${w}px`;
  _editor.stage.style.height = `${w / SCREEN_RATIO}px`;
}

function drawEditorStage() {
  if (_editor) renderScene(_editor.stage, getScene(), { editing: true, selectedId: _editor.selectedId });
}

function select(id) {
  if (!_editor || _editor.selectedId === id) return;
  _editor.selectedId = id;
  drawEditorStage();
  drawEditorSide();
}

function selectedItem() {
  return _editor && getScene().items.find(i => i.id === _editor.selectedId);
}

function drawEditorSide() {
  const side = _editor?.overlay.querySelector('#edSide');
  if (!side) return;
  const it = selectedItem();
  const scene = getScene();
  side.innerHTML = `
    ${it ? `
      <div class="dm-card-title">${escapeHtml(it.label || 'Picture')}</div>
      <div class="dm-disp-ed-size">
        <label for="edSize">Size</label>
        <input type="range" id="edSize" min="4" max="150" value="${Math.round(it.size * 100)}">
        <span id="edSizeVal">${Math.round(it.size * 100)}%</span>
      </div>
      <div class="dm-disp-ed-btns">
        <button class="dm-btn small" data-e="flip">↔ Flip</button>
        <button class="dm-btn small" data-e="hide" title="${it.hidden ? 'Show it on the display' : 'Hide it from the display (it stays here)'}">${it.hidden ? 'Show' : 'Hide'}</button>
        <button class="dm-btn small" data-e="dup">⧉ Duplicate</button>
        <button class="dm-btn small danger" data-e="remove">✕ Take it off</button>
      </div>` : '<div class="dm-hint">Click a picture to pick it.</div>'}
    <div class="dm-card-title" style="margin-top:0.8rem">Pictures (${scene.items.length})</div>
    <div class="dm-disp-ed-list">
      ${[...scene.items].reverse().map(i => `
        <button class="dm-disp-ed-pick${i.id === _editor.selectedId ? ' active' : ''}${i.hidden ? ' hidden-item' : ''}" data-pick="${escapeHtml(i.id)}">
          ${thumbHtml(i.src, '', { still: i.still })}<span>${escapeHtml(i.label || 'Picture')}${i.hidden ? ' <small>(hidden)</small>' : ''}</span>
        </button>`).join('') || '<div class="dm-hint">None yet -- put some on from the workspace.</div>'}
    </div>`;
}

function onSideClick(e) {
  const pick = e.target.closest('[data-pick]');
  if (pick) { select(pick.dataset.pick); return; }
  const b = e.target.closest('[data-e]');
  if (b && _editor?.selectedId) itemAction(_editor.selectedId, b.dataset.e);
}

function onSideInput(e) {
  if (e.target.id !== 'edSize') return;
  const it = selectedItem();
  if (!it) return;
  _dragging = true; // the side panel isn't redrawn under the slider
  updateScene(() => { it.size = Number(e.target.value) / 100; });
  _dragging = false;
  const val = document.getElementById('edSizeVal');
  if (val) val.textContent = `${e.target.value}%`;
}

function onEditorKey(e) {
  if (!_editor || document.querySelector('.dm-modal-overlay')) return;
  if (e.target.closest?.('input, textarea, select')) return;
  if (e.key === 'Escape') { closeEditor(); return; }
  const it = selectedItem();
  if (!it) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); itemAction(it.id, 'remove'); return; }
  const step = e.shiftKey ? 0.025 : 0.005;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step * SCREEN_RATIO], ArrowDown: [0, step * SCREEN_RATIO] };
  if (moves[e.key]) {
    e.preventDefault();
    updateScene(() => {
      it.x = Math.max(0, Math.min(1, it.x + moves[e.key][0]));
      it.y = Math.max(0, Math.min(1, it.y + moves[e.key][1]));
    });
  }
}

function onStagePointerDown(e) {
  const itemEl = e.target.closest('.scene-item');
  if (!itemEl) { select(null); return; }
  e.preventDefault();
  select(itemEl.dataset.id);
  const it = selectedItem();
  if (!it) return;
  const stage = _editor.stage;
  const rect = stage.getBoundingClientRect();
  const handle = e.target.closest('[data-handle]')?.dataset.handle;
  const start = { px: e.clientX, py: e.clientY, x: it.x, y: it.y };
  let apply; // what one pointer position does to the picture
  if (handle) {
    // The corner opposite the one being dragged stays put; the picture stays square, so the side follows whichever
    // way the pointer has gone further.
    const dir = { nw: [-1, -1], ne: [1, -1], sw: [-1, 1], se: [1, 1] }[handle];
    const side0 = it.size * rect.height;
    const cx = rect.left + it.x * rect.width;
    const cy = rect.top + it.y * rect.height;
    const ax = cx - (dir[0] * side0) / 2;
    const ay = cy - (dir[1] * side0) / 2;
    const minSide = 0.04 * rect.height;
    const maxSide = 1.5 * rect.height;
    apply = (ev) => {
      const side = Math.max(minSide, Math.min(maxSide, Math.max((ev.clientX - ax) * dir[0], (ev.clientY - ay) * dir[1])));
      updateScene(() => {
        it.size = side / rect.height;
        it.x = (ax + (dir[0] * side) / 2 - rect.left) / rect.width;
        it.y = (ay + (dir[1] * side) / 2 - rect.top) / rect.height;
      });
      const val = document.getElementById('edSizeVal');
      const range = document.getElementById('edSize');
      if (val) val.textContent = `${Math.round(it.size * 100)}%`;
      if (range) range.value = Math.round(it.size * 100);
    };
  } else {
    apply = (ev) => {
      updateScene(() => {
        it.x = Math.max(0, Math.min(1, start.x + (ev.clientX - start.px) / rect.width));
        it.y = Math.max(0, Math.min(1, start.y + (ev.clientY - start.py) / rect.height));
      });
    };
  }
  // The mouse can report far more often than the screen draws: only the latest position is used, once per frame.
  let pending = null;
  let frame = 0;
  const flush = () => { frame = 0; if (pending) { const ev = pending; pending = null; apply(ev); } };
  const onMove = (ev) => {
    pending = ev;
    if (!frame) frame = requestAnimationFrame(flush);
  };
  const target = e.target;
  target.setPointerCapture?.(e.pointerId);
  _dragging = true;
  const onUp = () => {
    cancelAnimationFrame(frame);
    flush();
    _dragging = false;
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onUp);
    drawEditorSide();
    drawLayers();
  };
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
}

// ---------------------------------------------------------------------------
// Folders for the backgrounds and the NPCs: the path to the folder open (each step a place to drop on), New folder, and
// the folders in the one open -- open one by clicking it, drag pictures / NPCs and folders onto it (or onto a step of the
// path) to move them. Several picked (the tick, or Ctrl + click) move together.
// ---------------------------------------------------------------------------

/** The folder `id` and the ones above it, top first. */
function folderPath(id) {
  const out = [];
  const seen = new Set();
  for (let f = _folders.find(x => x.id === id); f && !seen.has(f.id); f = _folders.find(x => x.id === f.parent)) {
    seen.add(f.id);
    out.unshift(f);
  }
  return out;
}

function foldersBarHtml(q) {
  const mode = _source === 'backgrounds' ? `<label class="dm-check dm-disp-foldermode" title="Ticked: the folders and the pictures in the one open. Unticked: every picture, the ones in folders too.">
    <input type="checkbox" data-folder-mode ${_folderMode ? 'checked' : ''}><span>Folder mode</span></label>` : '';
  if (q) return `<div class="dm-disp-crumbs"><span class="dm-hint">Searching every folder</span>${mode}</div>`;
  if (_source === 'backgrounds' && !_folderMode) {
    return `<div class="dm-disp-crumbs"><span class="dm-disp-crumb here">🖼️ All pictures</span><span class="dm-hint">every one, the ones in folders too</span>${mode}</div>`;
  }
  const all = _source === 'npcs' ? '👤 All NPCs' : '🖼️ All pictures';
  return `<div class="dm-disp-crumbs">
    <button class="dm-disp-crumb${_folder ? '' : ' here'}" data-open-folder="" data-drop-folder="">${all}</button>
    ${folderPath(_folder).map(f => `<span>›</span><button class="dm-disp-crumb${f.id === _folder ? ' here' : ''}" data-open-folder="${escapeHtml(f.id)}" data-drop-folder="${escapeHtml(f.id)}">${f.locId ? '📍' : '📁'} ${escapeHtml(f.name)}</button>`).join('')}
    ${mode}<button class="dm-btn small dm-disp-newfolder" data-new-folder>＋ New folder</button>
  </div>`;
}

/** Folder mode ticked or not (the box above the backgrounds). */
function setFolderMode(on) {
  _folderMode = on;
  try { localStorage.setItem(FOLDER_MODE_KEY, on ? 'on' : 'off'); } catch { /* not remembered: fine */ }
  drawGrid();
}

/** The backgrounds' folders brought in line with the locations (null: couldn't load them -- left as they are): a folder
 * for each one at the top, named as it is; a deleted location's folder goes when it's empty, otherwise it stays as an
 * ordinary folder. -> true when something changed (to be saved). */
function syncLocationFolders(locations) {
  if (!Array.isArray(locations)) return false;
  // No folder for a region (the user's call, 2026-10-21): it's a stretch of the map, not a place a scene is set in --
  // one it had goes like a deleted location's (empty: gone; with pictures in it: kept as an ordinary folder).
  locations = locations.filter(l => l?.type !== 'region');
  let changed = false;
  const ids = new Set(locations.map(l => l?.id).filter(Boolean));
  const has = id => _folders.some(f => f.id === id);
  // the old Locations folder, and location folders put inside each other by their places: all out at the top (anything
  // else the DM kept in Locations comes out with them)
  if (has(LOCATIONS_FOLDER)) {
    _folders.forEach((f) => { if (f.parent === LOCATIONS_FOLDER) f.parent = ''; });
    (_data.backgrounds || []).forEach((b) => { if (b.folder === LOCATIONS_FOLDER) moveInto(b, ''); });
    _folders = _folders.filter(f => f.id !== LOCATIONS_FOLDER);
    if (_folder === LOCATIONS_FOLDER) _folder = '';
    changed = true;
  }
  _folders.forEach((f) => {
    if (f.locId && f.parent && _folders.some(x => x.id === f.parent && x.locId)) { f.parent = ''; changed = true; }
  });
  locations.forEach((l) => {
    const name = String(l?.name || '').trim();
    if (!l?.id || !name) return;
    const f = _folders.find(x => x.locId === l.id);
    if (!f) { _folders.push({ id: newId('fold'), name, parent: '', locId: l.id }); changed = true; return; }
    if (f.name !== name) { f.name = name; changed = true; }
    if (f.parent && !has(f.parent)) { f.parent = ''; changed = true; }   // the folder it was in is gone
  });
  _folders.filter(f => f.locId && !ids.has(f.locId)).forEach((f) => {
    const used = (_data.backgrounds || []).some(b => b.folder === f.id) || _folders.some(x => x.parent === f.id);
    if (used) delete f.locId; else _folders = _folders.filter(x => x !== f);
    changed = true;
  });
  return changed;
}

// The locations' folders (the user's call, 2026-10-21: a big card for every location crowded the backgrounds): one
// section after the DM's own folders, small tiles with the first picture in each, folded up from its title (remembered
// on this computer). A tile is a folder like any other -- open it, drop pictures on it, drag it into another folder.
const LOC_FOLDERS_SHUT = 'dm-display-locfolders-shut';
// Each location's icon on the region map (location-icon.js), by location id -- shown on its folder (the user's call,
// 2026-10-21): standing in the corner of the folder's first picture, or in its place when the folder has none yet.
let _locIcons = new Map();
const locIconHtml = (f, cls) => (f.locId && _locIcons.has(f.locId) ? `<img class="${cls}" src="${escapeHtml(_locIcons.get(f.locId))}" alt="" draggable="false">` : '');
let _locFoldersShut = (() => { try { return localStorage.getItem(LOC_FOLDERS_SHUT) === '1'; } catch { return false; } })();

function locationFoldersHtml(list) {
  if (!list.length) return '';
  const pics = _data.backgrounds || [];
  const tile = (f) => {
    const inFolder = pics.filter(b => b.folder === f.id);
    const inside = inFolder.length + _folders.filter(x => x.parent === f.id).length;
    return `<div class="dm-disp-locfolder${inside ? '' : ' empty'}" data-open-folder="${escapeHtml(f.id)}" data-drop-folder="${escapeHtml(f.id)}" data-drag-folder="${escapeHtml(f.id)}" draggable="true" role="button" tabindex="0"
        title="${escapeHtml(f.name)}: the location's own folder -- named and removed with it in Admin › Locations. Open it, or drop pictures on it">
      <span class="dm-disp-locfolder-pic${_locIcons.has(f.locId) ? ' has-icon' : ''}">${inFolder[0] ? `<img src="${escapeHtml(inFolder[0].url)}" alt="" loading="lazy" draggable="false">` : _locIcons.has(f.locId) ? '' : '📍'}${locIconHtml(f, `dm-disp-locicon${inFolder[0] ? '' : ' alone'}`)}</span>
      <span class="dm-disp-locfolder-name">${escapeHtml(f.name)}<small>${inside ? `${inside} inside` : 'empty'}</small></span>
    </div>`;
  };
  return `<div class="dm-disp-locsec${_locFoldersShut ? ' shut' : ''}">
    <button class="dm-disp-locsec-title" data-loc-folders aria-expanded="${_locFoldersShut ? 'false' : 'true'}">${_locFoldersShut ? '▸' : '▾'} 📍 Locations <small>${list.length}</small></button>
    ${_locFoldersShut ? '' : `<div class="dm-disp-locsec-tiles">${list.map(tile).join('')}</div>`}
  </div>`;
}

function folderCardHtml(f) {
  const inside = (_data[_source] || []).filter(b => b.folder === f.id).length + _folders.filter(x => x.parent === f.id).length;
  // a location's folder comes and goes with its location: no rename or delete here
  const kept = _source === 'backgrounds' && !!f.locId;
  return `<div class="dm-disp-folder${f.locId ? ' location' : ''}" data-open-folder="${escapeHtml(f.id)}" data-drop-folder="${escapeHtml(f.id)}" data-drag-folder="${escapeHtml(f.id)}" draggable="true" role="button" tabindex="0" title="${f.locId ? 'The location\'s own folder -- named and removed with it in Admin › Locations. ' : ''}Open it -- or drop ${_source === 'npcs' ? 'NPCs' : 'pictures'} on it">
    <span class="dm-disp-folder-icon">${locIconHtml(f, 'dm-disp-locicon big') || (f.locId ? '📍' : '📁')}</span>
    <span class="dm-disp-bg-name">${escapeHtml(f.name)}<small>${f.locId ? 'Location · ' : ''}${inside} inside</small></span>
    ${kept ? '' : `<span class="dm-disp-bg-tools">
      <button class="dm-icon-btn" data-folder-act="rename" title="Rename">✎</button>
      <button class="dm-icon-btn danger" data-folder-act="delete" title="Delete the folder (what's in it moves up)">✕</button>
    </span>`}
  </div>`;
}

/** The tab's folders saved -- the NPCs' with which NPC is in which (an NPC's own record is the NPC module's). */
function saveFolders() {
  const data = _folderSet === 'npcs'
    ? { folders: _folders, placed: Object.fromEntries((_data.npcs || []).filter(e => e.folder).map(e => [e.key, e.folder])) }
    : _folders;
  return DmAPI.saveState(FOLDERED[_folderSet], data).catch(err => showCombatAlert(err.message, { title: 'Folders' }));
}

/** A click on a folder, a step of the path or New folder -- true when it was one of those. */
function onFolderClick(e) {
  if (e.target.closest('.dm-disp-foldermode')) return true;   // the box's own change does it (setFolderMode)
  if (e.target.closest('[data-loc-folders]')) {
    _locFoldersShut = !_locFoldersShut;
    try { localStorage.setItem(LOC_FOLDERS_SHUT, _locFoldersShut ? '1' : '0'); } catch { /* not remembered: fine */ }
    drawGrid();
    return true;
  }
  if (e.target.closest('[data-new-folder]')) { newFolder(); return true; }
  const act = e.target.closest('[data-folder-act]');
  if (act) {
    const f = _folders.find(x => x.id === act.closest('[data-drag-folder]').dataset.dragFolder);
    if (f && act.dataset.folderAct === 'rename') renameFolder(f);
    else if (f) deleteFolder(f);
    return true;
  }
  const open = e.target.closest('[data-open-folder]');
  if (open) { _folder = open.dataset.openFolder; drawGrid(); return true; }
  return false;
}

async function askName(title, start = '') {
  let typed = start;
  const answer = await openDmModal({
    title,
    html: `<input class="dm-input" id="folderName" value="${escapeHtml(start)}" maxlength="60" placeholder="Name">`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save', kind: 'primary', value: 'save' }],
    onOpen: (body, close) => {
      const input = body.querySelector('#folderName');
      setTimeout(() => input.select(), 0);
      input.addEventListener('input', () => { typed = input.value.trim(); });
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') close('save'); });
    },
  });
  return answer === 'save' && typed ? typed : null;
}

async function newFolder() {
  const name = await askName('New folder');
  if (!name) return;
  _folders.push({ id: newId('fold'), name, parent: _folder });
  await saveFolders();
  drawGrid();
}

async function renameFolder(f) {
  const name = await askName('Rename the folder', f.name);
  if (!name || name === f.name) return;
  f.name = name;
  await saveFolders();
  drawGrid();
}

/** A folder deleted: what's in it -- pictures / NPCs and folders -- moves up into the folder it was in. */
async function deleteFolder(f) {
  const things = (_data[_source] || []).filter(b => b.folder === f.id);
  const subs = _folders.filter(x => x.parent === f.id);
  const noun = _source === 'npcs' ? 'NPC' : 'picture';
  const what = things.length || subs.length ? ` Its ${[things.length && `${things.length} ${noun}${things.length === 1 ? '' : 's'}`, subs.length && `${subs.length} folder${subs.length === 1 ? '' : 's'}`].filter(Boolean).join(' and ')} move up a level -- nothing is deleted.` : '';
  if (!await showCombatConfirm(`Delete the folder "${f.name}"?${what}`, { title: 'Delete folder', yesLabel: 'Delete', noLabel: 'Cancel' })) return;
  try {
    for (const b of things) await moveInto(b, f.parent || '');
  } catch (err) { showCombatAlert(err.message, { title: 'Delete folder' }); return; }
  subs.forEach((x) => { x.parent = f.parent || ''; });
  _folders = _folders.filter(x => x.id !== f.id);
  if (_folder === f.id) _folder = f.parent || '';
  await saveFolders();
  drawGrid();
}

/** One picture / NPC into another folder ('' = the top) -- a picture's record on the Pi; an NPC's place is saved with the
 * folders (saveFolders, after). */
async function moveInto(b, folder) {
  if ((b.folder || '') === folder) return;
  if (_folderSet === 'backgrounds') await DmAPI.saveDisplayImage({ id: b.id, folder });
  b.folder = folder;
}

/** While some are picked: how many, Move to..., Pick all here, Unpick -- above the grid. */
function drawPickedBar() {
  const grid = document.getElementById('dispGrid');
  if (!grid) return;
  const list = _data[_source] || [];
  [..._picked].forEach((id) => { if (!list.some(b => idOf(b) === id)) _picked.delete(id); });
  grid.querySelector('.dm-disp-picked')?.remove();
  if (!_picked.size) return;
  const noun = _source === 'npcs' ? 'NPC' : 'picture';
  const bar = document.createElement('div');
  bar.className = 'dm-disp-picked';
  bar.innerHTML = `<b>${_picked.size} ${noun}${_picked.size === 1 ? '' : 's'} picked</b>
    <span class="dm-hint">Drag them onto a folder, or</span>
    <button class="dm-btn small primary" data-picked-act="move">📁 Move to…</button>
    <button class="dm-btn small" data-picked-act="all">Pick all here</button>
    <button class="dm-btn small" data-picked-act="clear">Unpick</button>`;
  grid.prepend(bar);
}

async function onPickedBar(act) {
  if (act === 'clear') { _picked.clear(); drawGrid(); return; }
  if (act === 'all') {
    const q = (_queries[_source] || '').trim().toLowerCase();
    (_data[_source] || []).filter(b => (q ? (b.search || nameOf(b).toLowerCase()).includes(q) : (b.folder || '') === _folder))
      .forEach(b => _picked.add(idOf(b)));
    drawGrid();
    return;
  }
  // Move to...: every folder, as a tree
  const rows = [];
  const walk = (parent, depth) => _folders.filter(f => (f.parent || '') === parent).sort((a, b) => a.name.localeCompare(b.name))
    .forEach((f) => { rows.push({ f, depth }); walk(f.id, depth + 1); });
  walk('', 1);
  const noun = _source === 'npcs' ? 'NPC' : 'picture';
  const into = await openDmModal({
    title: `📁 Move ${_picked.size} ${noun}${_picked.size === 1 ? '' : 's'} to…`,
    html: `<div class="dm-disp-movelist">
      <button class="dm-species-item" data-into=""><span class="dm-species-name">${_source === 'npcs' ? '👤 All NPCs' : '🖼️ All pictures'}</span></button>
      ${rows.map(({ f, depth }) => `<button class="dm-species-item" data-into="${escapeHtml(f.id)}" style="padding-left:${0.6 + depth}rem"><span class="dm-species-name">📁 ${escapeHtml(f.name)}</span></button>`).join('')}
    </div>`,
    buttons: [{ label: 'Cancel', value: null }],
    onOpen: (body, close) => body.addEventListener('click', (ev) => { const b = ev.target.closest('[data-into]'); if (b) close(b.dataset.into); }),
  });
  if (into === null || into === undefined) return;
  await moveMany([..._picked], into);
}

async function moveMany(ids, into) {
  try {
    for (const id of ids) {
      const b = (_data[_source] || []).find(x => idOf(x) === id);
      if (b) await moveInto(b, into);
    }
    if (_folderSet === 'npcs') await saveFolders();
  } catch (err) {
    showCombatAlert(err.message, { title: 'Move' });
  }
  _picked.clear();
  drawGrid();
}

/** Drag pictures / NPCs or a folder onto a folder (or a step of the path) to move them there. */
function wireFolderDrag(grid) {
  if (grid._folderDrag) return;
  grid._folderDrag = true;
  const TYPE = 'application/x-dm-display';
  grid.addEventListener('dragstart', (e) => {
    const pic = e.target.closest?.('[data-bg], [data-entry]');
    const folder = e.target.closest?.('[data-drag-folder]');
    if ((!pic && !folder) || !FOLDERED[_source]) return;
    const id = pic ? (pic.dataset.bg || pic.dataset.entry) : null;
    const ids = pic && _picked.has(id) ? [..._picked] : pic ? [id] : [];
    e.dataTransfer.setData(TYPE, JSON.stringify(pic ? { kind: 'picture', ids } : { kind: 'folder', id: folder.dataset.dragFolder }));
    e.dataTransfer.effectAllowed = 'move';
    (pic || folder).classList.add('dragging');
  });
  grid.addEventListener('dragend', () => grid.querySelectorAll('.dragging, .drop-here').forEach(el => el.classList.remove('dragging', 'drop-here')));
  grid.addEventListener('dragover', (e) => {
    const target = e.target.closest?.('[data-drop-folder]');
    if (!target || ![...e.dataTransfer.types].includes(TYPE)) return;
    e.preventDefault();
    grid.querySelectorAll('.drop-here').forEach(el => { if (el !== target) el.classList.remove('drop-here'); });
    target.classList.add('drop-here');
  });
  grid.addEventListener('dragleave', (e) => {
    const target = e.target.closest?.('[data-drop-folder]');
    if (target && !target.contains(e.relatedTarget)) target.classList.remove('drop-here');
  });
  grid.addEventListener('drop', async (e) => {
    const target = e.target.closest?.('[data-drop-folder]');
    const raw = e.dataTransfer.getData(TYPE);
    if (!target || !raw) return;
    e.preventDefault();
    e.stopPropagation();
    target.classList.remove('drop-here');
    const into = target.dataset.dropFolder;
    const what = JSON.parse(raw);
    if (what.kind === 'picture') { await moveMany(what.ids || [], into); return; }
    const f = _folders.find(x => x.id === what.id);
    // never into itself or one of its own folders
    if (!f || f.id === into || folderPath(into).some(x => x.id === f.id)) return;
    f.parent = into;
    await saveFolders();
    drawGrid();
  });
}
