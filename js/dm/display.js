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
import { DmAPI } from '../api.js';
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import { renderScene, BATTLE_PICTURES, SCREEN_RATIO, battleOnDisplay } from '../utils/display-scene.js';
import { escapeHtml, getSpecies, newId, toast, openDmModal } from './dm-common.js';
import { loadScene, getScene, updateScene, onSceneChange } from './display-store.js';
import { spriteSrc } from '../utils/sprite-media.js';

const SOURCES = { pokemon: '🐾 Pokémon', npcs: '👤 NPCs', trainers: '👥 Trainers', backgrounds: '🖼️ Backgrounds' };
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
let _listening = false;
let _dragging = false;
let _editor = null; // the big editor while it's open: {overlay, stage, area, selectedId, observer}
let _previewObserver = null;

export async function renderDisplay(root, { session, firstTime } = {}) {
  _root = root;
  _session = session || _session;
  if (!firstTime && root.querySelector('.dm-disp')) { postToPreview({ paused: false }); drawLayers(); return; } // keeps the search, tab and preview as they were
  root.innerHTML = '<div class="dm-loading">Loading…</div>';
  await loadScene();
  if (!_listening) {
    _listening = true;
    onSceneChange((scene) => {
      postToPreview({ scene });
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
  postToPreview({ paused: true });
}

/** The battle changed (dm-console.js) -- the preview shows the battle just like the TV. */
export function displaySessionChanged(session) {
  const wasActive = !!_session?.active;
  _session = session;
  postToPreview({ session });
  if (wasActive !== !!session?.active) drawLayers();
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

function draw() {
  _root.innerHTML = `
    <div class="dm-disp">
      <div class="dm-disp-left">
        <div class="dm-disp-head"><h2>📺 Display</h2></div>
        <div class="dm-disp-preview" id="dispPreview" role="button" tabindex="0" title="Click to arrange the pictures">
          <iframe id="dispFrame" src="display.html?preview" tabindex="-1" title="The display" aria-hidden="true"></iframe>
          <span class="dm-disp-preview-hint">🔍 Click to arrange</span>
        </div>
        <div class="dm-disp-battleinfo" title="During a battle the background stays, with the turn order and whoever's turn it is on top">
          <span>⚔️ During a battle</span>
          <div class="dm-seg two" id="dispBattlePictures"></div>
        </div>
        <div class="dm-card dm-disp-layers">
          <div class="dm-card-title">
            <span>On the screen</span>
            <span class="dm-row dm-enc-titlebtns">
              <button class="dm-btn small" id="dispHideAll"></button>
              <button class="dm-btn small danger" id="dispClear" title="Take every picture off (the background stays)">Clear pictures</button>
            </span>
          </div>
          <div id="dispLayers"></div>
        </div>
      </div>
      <div class="dm-disp-work" id="dispWork">
        <div class="dm-enc-tabs dm-disp-tabs" id="dispTabs">
          ${Object.entries(SOURCES).map(([k, l]) => `<button data-src="${k}" class="${k === _source ? 'active' : ''}">${l}</button>`).join('')}
        </div>
        <div class="dm-disp-work-body">
          <div class="dm-row dm-disp-searchrow">
            <input class="dm-input" id="dispSearch" placeholder="Search…" autocomplete="off" value="${escapeHtml(_queries[_source] || '')}">
            <label class="dm-check dm-disp-addhidden" title="Put new pictures on hidden -- they show on the display once you click 👁"><input type="checkbox" id="dispAddHidden" ${_addHidden ? 'checked' : ''}><span>Add hidden</span></label>
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
  document.getElementById('dispBattlePictures').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bp]');
    if (b) updateScene((s) => { s.battlePictures = b.dataset.bp; });
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
  frame.addEventListener('load', () => postToPreview({ scene: getScene(), session: _session }));
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
  const current = getScene().battlePictures;
  box.innerHTML = Object.entries(BATTLE_PICTURES).map(([k, l]) => `<button data-bp="${k}" class="${k === current ? 'active' : ''}">${l}</button>`).join('');
}

// ---------------------------------------------------------------------------
// What's on the screen
// ---------------------------------------------------------------------------

/** A small picture. `still`: shown instead of an animated sprite -- for the little lists redrawn on every change (a video
 * there would start over, and decode, each time). Animated ones load the Pi's small sprite copy. */
function thumbHtml(src, cls = '', { lazyVideo = false, still = '' } = {}) {
  if (!src) return `<span class="dm-disp-thumb ${cls}"><img src="assets/Pokeball.png" alt="" style="opacity:.3"></span>`;
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
    hideAll.textContent = anyShown ? '🙈 Hide all' : '👁 Show all';
    hideAll.disabled = !scene.items.length;
  }
  const items = [...scene.items].reverse(); // the top one first
  const putAway = battleOnDisplay(scene, _session) && scene.battlePictures !== 'keep' && items.length;
  box.innerHTML = `
    ${putAway ? '<div class="dm-disp-away">⚔️ Put away during the battle</div>' : ''}
    ${items.map(it => `
      <div class="dm-disp-layer${it.hidden ? ' hidden-item' : ''}" data-id="${escapeHtml(it.id)}">
        ${thumbHtml(it.src, '', { still: it.still })}
        <span class="dm-disp-layer-name"><strong>${escapeHtml(it.label || 'Picture')}</strong>
          <small>${KIND_LABEL[it.kind] || 'Picture'} · ${Math.round((Number(it.size) || 0) * 100)}% high${it.hidden ? ' · <span class="dm-warn-text">hidden</span>' : ''}</small></span>
        ${it.still && it.animated ? `<button class="dm-icon-btn" data-l="anim" title="${it.src === it.animated ? 'Animated -- click for the still picture' : 'Still -- click for the animated sprite'}">${it.src === it.animated ? '▶' : '🖼'}</button>` : ''}
        <button class="dm-icon-btn${it.hidden ? ' off' : ''}" data-l="hide" title="${it.hidden ? 'Show it on the display' : 'Hide it from the display (it stays here)'}">${it.hidden ? '🙈' : '👁'}</button>
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
  else if (act === 'anim') updateScene(() => { it.src = it.src === it.animated ? it.still : it.animated; });
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
    _data.npcs = ((await DmAPI.npcs()).data || []).map(n => ({
      key: n.id, kind: 'npc', label: n.name || 'NPC', sub: n.role || n.location || '', still: n.image || '', animated: '',
      search: `${n.name} ${n.role} ${n.faction} ${n.location}`.toLowerCase(),
    }));
  } else if (name === 'trainers') {
    _data.trainers = ((await DmAPI.party()).data || []).map(({ trainer: t }) => ({
      key: t.name, kind: 'trainer', label: t.name, sub: `Lv ${t.level}`, still: t.image || '', animated: '', search: String(t.name).toLowerCase(),
    }));
  } else if (name === 'backgrounds') {
    _data.backgrounds = (await DmAPI.displayImages()).data || [];
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
  const search = document.getElementById('dispSearch');
  if (search) search.value = _queries[_source] || '';
  if (search) search.placeholder ={ pokemon: 'Search Pokémon by name, type or number…', npcs: 'Search NPCs…', trainers: 'Search trainers…', backgrounds: 'Search pictures…' }[_source];
  const grid = document.getElementById('dispGrid');
  if (!grid) return;
  grid.className = `dm-disp-grid${_source === 'backgrounds' ? ' wide' : ''}`;
  if (!_data[_source]) grid.innerHTML = '<div class="dm-loading">Loading…</div>';
  try { await loadSource(_source); } catch (err) { grid.innerHTML = `<div class="dm-hint">Couldn't load: ${escapeHtml(err.message)}</div>`; return; }
  drawGrid();
}

function drawGrid() {
  const grid = document.getElementById('dispGrid');
  const list = _data[_source];
  if (!grid || !list) return;
  const q = (_queries[_source] || '').trim().toLowerCase();
  if (_source === 'backgrounds') {
    const current = getScene().background?.url;
    const shown = list.filter(b => !q || b.name.toLowerCase().includes(q));
    grid.innerHTML = shown.length ? shown.map(b => `
      <div class="dm-disp-bg${b.url === current ? ' current' : ''}" data-bg="${escapeHtml(b.id)}" role="button" tabindex="0" title="Put it on the display as the background">
        <span class="dm-disp-bg-img"><img src="${escapeHtml(b.url)}" alt="" loading="lazy" draggable="false"></span>
        <span class="dm-disp-bg-name">${b.url === current ? '✓ ' : ''}${escapeHtml(b.name)}</span>
        <span class="dm-disp-bg-tools">
          <button class="dm-icon-btn" data-bgact="pic" title="Put it on as a picture instead (to move and resize)">＋</button>
          <button class="dm-icon-btn" data-bgact="rename" title="Rename">✎</button>
          <button class="dm-icon-btn danger" data-bgact="delete" title="Delete it from the Pi">✕</button>
        </span>
      </div>`).join('') : `<div class="dm-hint">${list.length ? 'No picture matches that.' : 'No pictures uploaded yet -- upload a few backgrounds (a route, a forest, a city…) and they stay here for next time.'}</div>`;
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
  toast(hidden ? `${label} is ready, hidden -- click 👁 to show it.` : `${label} is on the display.`);
}

async function onGridClick(e) {
  const bgTool = e.target.closest('[data-bgact]');
  const bgCard = e.target.closest('[data-bg]');
  if (bgCard) {
    const img = _data.backgrounds.find(b => b.id === bgCard.dataset.bg);
    if (!img) return;
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
      const img = await DmAPI.saveDisplayImage({ name: file.name.replace(/\.[^.]+$/, ''), data: await prepareImage(file) });
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
        <button class="dm-btn small" data-e="hide" title="${it.hidden ? 'Show it on the display' : 'Hide it from the display (it stays here)'}">${it.hidden ? '👁 Show' : '🙈 Hide'}</button>
        <button class="dm-btn small" data-e="dup">⧉ Duplicate</button>
        ${it.still && it.animated ? `<button class="dm-btn small" data-e="anim">${it.src === it.animated ? '🖼 Still picture' : '▶ Animated'}</button>` : ''}
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
