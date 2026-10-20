// DM console -- the Admin module (the user's call, 2026-10-19): the game's data the DM adds to or changes himself, with
// their pictures -- the items, the Pokedex entries (species, and the abilities they name), the loading-screen splashes and
// the battle maps' pictures (objects and backgrounds, moved here from the map editor) -- and every battle's log.
// Everything is saved on the Pi (pi-server/app/admin.py): items and Pokedex entries in the data folder, laid over the files
// the code comes with (so a `git pull` on the Pi never clashes with them); the pictures where the app already looks for
// them -- an item's named after the item ("Frost Ball.png"), a Pokemon's still picture with the other Pokemon pictures,
// its animated sprite with the other sprites (each optionally the shiny one), the splashes with the others.
import { DmAPI } from '../api.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import { POKEMON_TYPES } from '../utils/pokemon-types.js';
import { escapeHtml, toast, openDmModal, getSpecies, forgetSpecies, typeBadges, multiSelectHtml, bindMultiSelects, readMultiSelect, attachSuggest, SAVING_THROWS, SKILLS } from './dm-common.js';
import { prepareImage } from './display.js';
import { loadMoves } from './move-picker.js';
import { openPicker } from './picker.js';
import { forgetMapAssets } from './map-editor.js';
import { drawEvents, drawLocations, drawStatuses, setWorldNav } from './admin-world.js';

const TAB_KEY = 'dmAdminTab';
const TABS = ['items', 'species', 'pictures', 'splashes', 'logs', 'events', 'locations', 'statuses'];
const MOVE_LEVELS = ['1', '2', '6', '10', '14', '18'];
const MOVEMENT = ['walking', 'climbing', 'flying', 'hovering', 'swimming', 'burrowing'];
const SENSES = ['sight', 'hearing', 'smell', 'tremorsense', 'echolocation', 'telepathy', 'blindsight', 'darkvision', 'truesight'];
const STATS = [['strength', 'STR'], ['dexterity', 'DEX'], ['constitution', 'CON'], ['intelligence', 'INT'], ['wisdom', 'WIS'], ['charisma', 'CHA']];
const SLOTS = [['primary', 'Primary'], ['secondary', 'Secondary'], ['hidden', 'Hidden']];
const SENSE_LEVELS = ['Poor', 'Average', 'Good', 'Excellent', 'Superior'];
const NEW_ABILITY = '__new';
// The Pokemon's four pictures side by side (the user's call, 2026-10-20): still, still shiny, animated, animated shiny.
const PICTURE_SLOTS = [['still', false, 'Still', 'still'], ['still', true, 'Still shiny', 'stillShiny'],
  ['animated', false, 'Animated', 'animated'], ['animated', true, 'Animated shiny', 'animatedShiny']];
const LIST_MAX = 250; // rows drawn in a list at once -- the search narrows it down

let _root = null;
let _tab = 'items';
let _items = null;           // [{name, category, price, description, effect, image, edited}]
let _item = null;            // the item on the form ({...} -- `isNew` while it hasn't been saved)
let _speciesName = null;     // the Pokedex entry on the form (null: a new one)
let _record = null;          // its admin-species answer
let _moveList = null;        // the move list (with the DM's own moves) for the moves' dropdowns -- fetched once
let _splashes = null;

export function renderAdmin(section) {
  if (_root === section) return;
  _root = section;
  try { _tab = TABS.includes(localStorage.getItem(TAB_KEY)) ? localStorage.getItem(TAB_KEY) : 'items'; } catch (e) { /* default */ }
  section.innerHTML = `
    <div class="dm-admin">
      <div class="dm-enc-tabs" id="admTabs">
        <button data-atab="items">🎒 Items</button>
        <button data-atab="species">📕 Pokédex entries</button>
        <button data-atab="pictures">🌲 Map pictures</button>
        <button data-atab="splashes">🖼️ Splash screens</button>
        <button data-atab="logs">📜 Battle logs</button>
        <button data-atab="events">📅 Events</button>
        <button data-atab="locations">📍 Locations</button>
        <button data-atab="statuses">🌀 Status conditions</button>
      </div>
      <div class="dm-admin-body" id="admBody"></div>
    </div>`;
  section.querySelector('#admTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-atab]');
    if (b) showTab(b.dataset.atab);
  });
  setWorldNav(showTab);
  showTab(_tab);
}

function showTab(name) {
  _tab = name;
  try { localStorage.setItem(TAB_KEY, name); } catch (e) { /* not kept */ }
  _root.querySelectorAll('#admTabs [data-atab]').forEach(b => b.classList.toggle('active', b.dataset.atab === name));
  const body = document.getElementById('admBody');
  body.innerHTML = '<div class="dm-loading">Loading…</div>';
  if (name === 'items') drawItems(body);
  else if (name === 'species') drawSpecies(body);
  else if (name === 'pictures') drawMapPictures(body);
  else if (name === 'logs') drawBattleLogs(body);
  else if (name === 'events') drawEvents(body);
  else if (name === 'locations') drawLocations(body);
  else if (name === 'statuses') drawStatuses(body);
  else drawSplashes(body);
}

/** A file picked from the DM's computer (`accept`), or null. */
function pickFile(accept, { multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener('change', () => resolve(multiple ? [...input.files] : input.files?.[0] || null));
    input.click();
  });
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error(`Couldn't read ${file.name}`));
    r.readAsDataURL(file);
  });
}

/** The picture as a PNG data: URL (the session splash has to be one -- the app asks for session.png). */
async function asPng(dataUrl) {
  if (dataUrl.startsWith('data:image/png')) return dataUrl;
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("That picture can't be read"));
    el.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return canvas.toDataURL('image/png');
}

/** The game data this console keeps forgotten, so every module reads what was just saved. */
function dataChanged() {
  DmAPI.forgetCachedData();
  forgetSpecies();
}

const val = (id) => document.getElementById(id)?.value ?? '';

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

async function drawItems(body) {
  try {
    _items = await DmAPI.adminItems();
  } catch (err) {
    body.innerHTML = `<div class="dm-loading">Couldn't load the items: ${escapeHtml(err.message)}</div>`;
    return;
  }
  const categories = [...new Set(_items.map(i => i.category).filter(Boolean))].sort();
  body.innerHTML = `
    <div class="dm-editor">
      <aside class="dm-editor-tools">
        <div class="dm-editor-head"><h2>🎒 Items</h2><span class="dm-pill ok">${_items.length}</span></div>
        <input class="dm-input" id="admItemSearch" placeholder="Search an item…" autocomplete="off">
        <select class="dm-select" id="admItemCat"><option value="">Every category</option>${categories.map(c => `<option>${escapeHtml(c)}</option>`).join('')}</select>
        <button class="dm-btn primary" id="admItemNew">＋ New item</button>
        <div class="dm-pdx-list" id="admItemList"></div>
      </aside>
      <section class="dm-editor-canvas" id="admItemForm"><div class="dm-cs-empty">Pick an item on the left, or make a new one.</div></section>
    </div>
    <datalist id="admCategories">${categories.map(c => `<option value="${escapeHtml(c)}">`).join('')}</datalist>`;
  const list = () => {
    const q = val('admItemSearch').trim().toLowerCase(), cat = val('admItemCat');
    const hits = _items.filter(i => (!cat || i.category === cat) && (!q || i.name.toLowerCase().includes(q)));
    document.getElementById('admItemList').innerHTML = hits.slice(0, LIST_MAX).map(i => `
      <button class="dm-pdx-row${_item && !_item.isNew && _item.name === i.name ? ' selected' : ''}" data-item="${escapeHtml(i.name)}">
        <span class="dm-pdx-thumb dm-adm-thumb">${i.image ? `<img src="${escapeHtml(i.image)}" alt="" loading="lazy">` : '🎒'}</span>
        <span class="dm-pdx-main"><strong>${escapeHtml(i.name)}</strong><small>${escapeHtml(i.category || '')}${i.price != null && i.price !== '' ? ` · ${escapeHtml(i.price)}${typeof i.price === 'number' ? ' ₽' : ''}` : ''}</small></span>
        <span>${i.edited ? '<span class="dm-pill todo" title="Added or changed here">✎</span>' : ''}</span>
      </button>`).join('')
      + (hits.length > LIST_MAX ? `<div class="dm-hint" style="padding:0.4rem">…and ${hits.length - LIST_MAX} more -- search to narrow it down.</div>` : '')
      + (hits.length ? '' : '<div class="dm-hint" style="padding:0.4rem">No item matches.</div>');
  };
  list();
  document.getElementById('admItemSearch').addEventListener('input', list);
  document.getElementById('admItemCat').addEventListener('change', list);
  document.getElementById('admItemList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-item]');
    if (!b) return;
    _item = { ..._items.find(i => i.name === b.dataset.item) };
    list();
    drawItemForm(list);
  });
  document.getElementById('admItemNew').addEventListener('click', () => {
    _item = { isNew: true, name: '', category: val('admItemCat') || '', price: '', description: '', effect: '', image: null };
    list();
    drawItemForm(list);
  });
  if (_item) drawItemForm(list);
}

function drawItemForm(redrawList) {
  const it = _item;
  const box = document.getElementById('admItemForm');
  box.innerHTML = `
    <div class="dm-adm-form">
      <div class="dm-adm-head">
        <div class="dm-adm-pic" id="admItemPic">${it.image ? `<img src="${escapeHtml(it.image)}" alt="">` : '<span>🎒</span>'}</div>
        <div>
          <h3 class="dm-cs-title">${it.isNew ? 'New item' : escapeHtml(it.name)}</h3>
          <div class="dm-hint">${it.isNew ? 'Give it a name, then save -- the picture can be added once it\'s saved.'
            : `Its picture is saved as "${escapeHtml(it.name)}" in the item pictures folder.`}</div>
          <button class="dm-btn small" id="admItemUpload" ${it.isNew ? 'disabled' : ''}>⬆ ${it.image ? 'Change' : 'Upload'} picture…</button>
        </div>
      </div>
      <div class="dm-card">
        <div class="dm-row">
          <div class="dm-field"><label for="admItemName">Name</label><input class="dm-input" id="admItemName" value="${escapeHtml(it.name)}" ${it.isNew ? '' : 'disabled title="An item keeps its name -- the trainers\' bags know it by name"'} maxlength="80"></div>
          <div class="dm-field"><label for="admItemCategory">Category</label><input class="dm-input" id="admItemCategory" list="admCategories" value="${escapeHtml(it.category || '')}" maxlength="60"></div>
          <div class="dm-field"><label for="admItemPrice">Price</label><input class="dm-input" id="admItemPrice" value="${escapeHtml(it.price ?? '')}" placeholder="300, or Not sold" maxlength="40"></div>
        </div>
        <div class="dm-field"><label for="admItemDesc">Description</label><textarea class="dm-input dm-adm-text" id="admItemDesc" rows="3">${escapeHtml(it.description || '')}</textarea></div>
        <div class="dm-field"><label for="admItemEffect">Effect</label><textarea class="dm-input dm-adm-text" id="admItemEffect" rows="4">${escapeHtml(it.effect || '')}</textarea></div>
        <div class="dm-adm-actions"><button class="dm-btn primary" id="admItemSave">💾 Save item</button></div>
      </div>
    </div>`;
  document.getElementById('admItemSave').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const saved = await DmAPI.adminSaveItem({
        name: val('admItemName'), category: val('admItemCategory'), price: val('admItemPrice'),
        description: val('admItemDesc'), effect: val('admItemEffect'),
      }, !!it.isNew);
      const i = _items.findIndex(x => x.name.toLowerCase() === saved.name.toLowerCase());
      if (i >= 0) _items[i] = saved; else _items.push(saved);
      // The console's own item list (Give an item, the NPCs' bags...) has it at once
      try {
        const kept = JSON.parse(sessionStorage.getItem('items') || '[]');
        const plain = { name: saved.name, category: saved.category, price: saved.price, description: saved.description, effect: saved.effect };
        const k = kept.findIndex(x => x.name.toLowerCase() === saved.name.toLowerCase());
        if (k >= 0) kept[k] = plain; else kept.push(plain);
        sessionStorage.setItem('items', JSON.stringify(kept));
      } catch (err) { /* read again next load */ }
      dataChanged();
      _item = { ...saved };
      toast(`${saved.name} is saved.`);
      redrawList();
      drawItemForm(redrawList);
    } catch (err) {
      showCombatAlert(err.message, { title: "Couldn't save the item" });
      btn.disabled = false;
    }
  });
  document.getElementById('admItemUpload').addEventListener('click', async (e) => {
    const file = await pickFile('image/png,image/jpeg,image/webp,image/gif');
    if (!file) return;
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Uploading…';
    try {
      const { image } = await DmAPI.adminItemImage(it.name, await prepareImage(file, 512));
      it.image = image;
      const i = _items.find(x => x.name === it.name);
      if (i) i.image = image;
      redrawList();
      drawItemForm(redrawList);
    } catch (err) {
      showCombatAlert(err.message, { title: "Couldn't upload the picture" });
      btn.disabled = false;
      btn.textContent = '⬆ Upload picture…';
    }
  });
}

// ---------------------------------------------------------------------------
// Pokedex entries
// ---------------------------------------------------------------------------

async function drawSpecies(body) {
  let species;
  try {
    species = await getSpecies();
  } catch (err) {
    body.innerHTML = `<div class="dm-loading">Couldn't load the Pokémon: ${escapeHtml(err.message)}</div>`;
    return;
  }
  body.innerHTML = `
    <div class="dm-editor">
      <aside class="dm-editor-tools">
        <div class="dm-editor-head"><h2>📕 Pokédex entries</h2><span class="dm-pill ok">${species.length}</span></div>
        <input class="dm-input" id="admSpSearch" placeholder="Search name, type or #…" autocomplete="off">
        <button class="dm-btn primary" id="admSpNew">＋ New Pokémon</button>
        <div class="dm-pdx-list" id="admSpList"></div>
      </aside>
      <section class="dm-editor-canvas" id="admSpForm"><div class="dm-cs-empty">Pick a Pokémon on the left, or make a new one.</div></section>
    </div>`;
  const list = () => {
    const q = val('admSpSearch').trim().toLowerCase();
    const hits = species.filter(s => !q || s.name.toLowerCase().includes(q) || String(s.dex) === q.replace('#', '')
      || String(s.type1).toLowerCase() === q || String(s.type2).toLowerCase() === q);
    const box = document.getElementById('admSpList');
    box.innerHTML = hits.slice(0, LIST_MAX).map(s => `
      <button class="dm-pdx-row${_speciesName === s.name ? ' selected' : ''}" data-sp="${escapeHtml(s.name)}">
        <span class="dm-pdx-thumb" data-img="${escapeHtml(s.picture || s.image || '')}"></span>
        <span class="dm-pdx-main"><strong>#${escapeHtml(s.dex ?? '?')} ${escapeHtml(s.name)}</strong><small>${typeBadges(s.type1, s.type2)}</small></span><span></span>
      </button>`).join('') + (hits.length ? '' : '<div class="dm-hint" style="padding:0.4rem">No Pokémon matches.</div>');
    box.querySelectorAll('[data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); });
  };
  list();
  document.getElementById('admSpSearch').addEventListener('input', list);
  document.getElementById('admSpList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sp]');
    if (!b) return;
    _speciesName = b.dataset.sp;
    list();
    await loadSpeciesForm(species, list);
  });
  document.getElementById('admSpNew').addEventListener('click', async () => {
    _speciesName = null;
    const next = Math.max(0, ...species.map(s => Number(s.dex) || 0)) + 1;
    // the abilities to suggest come with any entry -- the first one's, when none has been opened yet
    let abilityNames = _record?.abilityNames;
    if (!abilityNames?.length && species.length) abilityNames = (await DmAPI.adminSpecies(species[0].name).catch(() => null))?.abilityNames;
    _record = { species: blankSpecies(next), edited: false, pictures: {}, abilityDescriptions: {}, abilityNames: abilityNames || [] };
    list();
    drawSpeciesForm(species, list);
  });
  if (_speciesName) loadSpeciesForm(species, list);
}

function blankSpecies(dex) {
  return {
    dexNumber: dex, name: '', classification: '', description: '', types: { primary: '', secondary: null },
    size: '', rarity: '', habitat: '', behavior: '', active: '', evolvesInto: [],
    abilities: { primary: null, secondary: null, hidden: null }, encounter: { minimumLevel: 1, catchDifficulty: null },
    combat: { ac: null, hitDie: null, baseHP: null, vitalityDie: null, baseVP: null },
    baseStats: Object.fromEntries(STATS.map(([k]) => [k, 10])), savingThrows: [], skills: [],
    moves: Object.fromEntries(MOVE_LEVELS.map(l => [l, []])),
    movement: Object.fromEntries(MOVEMENT.map(k => [k, k === 'walking' ? 30 : 0])), senses: Object.fromEntries(SENSES.map(k => [k, null])),
  };
}

/** The move names for the moves' dropdowns, sorted (the console's copy when the Pi doesn't answer). */
async function moveNames() {
  if (!_moveList) _moveList = [...new Set((await loadMoves()).map(m => m.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return _moveList;
}

async function loadSpeciesForm(species, redrawList) {
  await moveNames().catch(() => []);
  const box = document.getElementById('admSpForm');
  box.innerHTML = '<div class="dm-loading">Loading…</div>';
  try {
    _record = await DmAPI.adminSpecies(_speciesName);
  } catch (err) {
    box.innerHTML = `<div class="dm-loading">${escapeHtml(err.message)}</div>`;
    return;
  }
  drawSpeciesForm(species, redrawList);
}

function drawSpeciesForm(species, redrawList) {
  const { species: sp, pictures = {}, abilityDescriptions = {}, abilityNames = [] } = _record;
  const isNew = !_speciesName;
  const box = document.getElementById('admSpForm');
  const field = (id, label, value, attrs = '') => `<div class="dm-field"><label for="${id}">${label}</label><input class="dm-input" id="${id}" value="${escapeHtml(value ?? '')}" ${attrs}></div>`;
  const num = (id, label, value) => field(id, label, value, 'type="number" inputmode="numeric"');
  const pick = (key) => [...new Set(species.map(s => s[key]).filter(Boolean))].sort();
  const typeOptions = (sel, none) => `${none ? '<option value="">— none —</option>' : '<option value="">Pick a type</option>'}${POKEMON_TYPES.map(t => `<option ${t === sel ? 'selected' : ''}>${t}</option>`).join('')}`;
  const moveList = _moveList || [];
  // A dropdown of every name in `names` (and the value it has, if that isn't one of them).
  const options = (names, value, none) => `<option value="">${none}</option>${(!value || names.includes(value) ? names : [value, ...names])
    .map(v => `<option value="${escapeHtml(v)}" ${v === value ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('')}`;
  const abilityList = [...abilityNames].sort((a, b) => a.localeCompare(b));
  box.innerHTML = `
    <div class="dm-adm-form">
      <div class="dm-adm-head">
        <div class="dm-adm-pic" id="admSpPic"></div>
        <div>
          <h3 class="dm-cs-title">${isNew ? 'New Pokémon' : `#${escapeHtml(sp.dexNumber)} ${escapeHtml(sp.name)}`}
            ${_record.edited ? '<span class="dm-pill todo" title="Saved here -- laid over the Pokédex file the app comes with">✎ Changed here</span>' : ''}</h3>
          <div class="dm-hint">${isNew ? 'Not in the players\' Pokédex until you add it there (the Pokédex module). Pictures can be added once it\'s saved.'
            : 'Changes reach the players\' Pokédex and everything built from it -- new Pokémon caught, the DM\'s enemies.'}</div>
        </div>
      </div>
      <div class="dm-adm-grid">
        <div class="dm-card">
          <div class="dm-card-title">Basics</div>
          <div class="dm-row">${field('admSpName', 'Name', sp.name, `maxlength="40" ${isNew ? '' : 'disabled title="A Pokémon keeps its name -- the players\' Pokémon know it by name"'}`)}${num('admSpDex', 'Dex #', sp.dexNumber)}</div>
          ${field('admSpClass', 'Classification', sp.classification, 'maxlength="60"')}
          <div class="dm-row">
            <div class="dm-field"><label for="admSpType1">Primary type</label><select class="dm-select" id="admSpType1">${typeOptions(sp.types?.primary, false)}</select></div>
            <div class="dm-field"><label for="admSpType2">Secondary type</label><select class="dm-select" id="admSpType2">${typeOptions(sp.types?.secondary, true)}</select></div>
          </div>
          <div class="dm-field"><label for="admSpDesc">Pokédex entry</label><textarea class="dm-input dm-adm-text" id="admSpDesc" rows="4">${escapeHtml(sp.description || '')}</textarea></div>
        </div>
        <div class="dm-card">
          <div class="dm-card-title">Characteristics</div>
          <div class="dm-row">${field('admSpSize', 'Size', sp.size, 'list="admSpSizes"')}${field('admSpRarity', 'Rarity', sp.rarity, 'list="admSpRarities"')}</div>
          <div class="dm-row">${field('admSpHabitat', 'Habitat', sp.habitat, 'list="admSpHabitats"')}${field('admSpBehavior', 'Behaviour', sp.behavior, 'list="admSpBehaviors"')}</div>
          ${field('admSpActive', 'Active', sp.active, 'list="admSpActives"')}
          <div class="dm-row">${num('admSpMinLevel', 'Lowest level met', sp.encounter?.minimumLevel)}${num('admSpCatch', 'Catch difficulty', sp.encounter?.catchDifficulty)}</div>
        </div>
        <div class="dm-card">
          <div class="dm-card-title">Combat</div>
          <div class="dm-row">${num('admSpAC', 'AC', sp.combat?.ac)}${num('admSpHD', 'Hit die (6 = d6)', sp.combat?.hitDie)}${num('admSpHP', 'Base HP', sp.combat?.baseHP)}</div>
          <div class="dm-row">${num('admSpVD', 'Vitality die', sp.combat?.vitalityDie)}${num('admSpVP', 'Base VP', sp.combat?.baseVP)}<div></div></div>
          <div class="dm-card-title" style="margin-top:0.4rem">Ability scores</div>
          <div class="dm-row dm-adm-scores">${STATS.map(([k, l]) => num(`admSpStat_${k}`, l, sp.baseStats?.[k])).join('')}</div>
          <div class="dm-field"><label>Saving throws</label>${multiSelectHtml('admSpSaves', SAVING_THROWS, sp.savingThrows || [])}</div>
          <div class="dm-field"><label>Skills</label>${multiSelectHtml('admSpSkills', SKILLS, sp.skills || [])}</div>
        </div>
        <div class="dm-card">
          <div class="dm-card-title">Abilities</div>
          ${SLOTS.map(([slot, label]) => {
            const name = sp.abilities?.[slot] || '';
            return `<div class="dm-field"><label for="admSpAb_${slot}">${label}</label>
              <select class="dm-select" id="admSpAb_${slot}">${options(abilityList, name, '— None —')}<option value="${NEW_ABILITY}">＋ A new ability…</option></select>
              <input class="dm-input" id="admSpAbNew_${slot}" placeholder="The new ability's name" maxlength="60" hidden>
              <textarea class="dm-input dm-adm-text" id="admSpAbDesc_${slot}" rows="2" placeholder="What it does (a new ability needs this)">${escapeHtml(abilityDescriptions[name] || '')}</textarea></div>`;
          }).join('')}
        </div>
        <div class="dm-card">
          <div class="dm-card-title">Moves learned</div>
          ${MOVE_LEVELS.map(l => `<div class="dm-field"><label for="admSpMoveAdd_${l}">${l === '1' ? 'Starting moves' : `Level ${l}`}</label>
            <div class="dm-adm-movechips" id="admSpMoves_${l}">${(sp.moves?.[l] || []).map(moveChipHtml).join('')}</div>
            <select class="dm-select" id="admSpMoveAdd_${l}" data-move-add="${l}">${options(moveList, '', '＋ Add a move…')}</select></div>`).join('')}
          <div class="dm-hint" id="admSpMoveWarn"></div>
        </div>
        <div class="dm-card">
          <div class="dm-card-title">Movement (feet -- 0 = can't)</div>
          <div class="dm-row dm-adm-scores">${MOVEMENT.map(k => num(`admSpMove_${k}`, k[0].toUpperCase() + k.slice(1), sp.movement?.[k])).join('')}</div>
          <div class="dm-card-title" style="margin-top:0.4rem">Senses (empty = none)</div>
          <div class="dm-adm-senses">${SENSES.map(k => `<div class="dm-field"><label for="admSpSense_${k}">${k[0].toUpperCase() + k.slice(1)}</label>
            <select class="dm-select" id="admSpSense_${k}">${options(SENSE_LEVELS, sp.senses?.[k] || '', '—')}</select></div>`).join('')}</div>
        </div>
        <div class="dm-card dm-adm-evocard">
          <div class="dm-card-title">Evolves into</div>
          <div id="admSpEvos">${(sp.evolvesInto || []).map(evoRowHtml).join('')}</div>
          <button class="dm-btn small" id="admSpEvoAdd">＋ Add an evolution</button>
          <div class="dm-hint" style="margin-top:0.3rem">Each criterion is one line in the players' Pokédex (when you show it there) -- a level, an item, a place, a time of day...</div>
        </div>
        <div class="dm-card dm-adm-piccard">
          <div class="dm-card-title">Pictures</div>
          ${isNew ? '<div class="dm-hint">Save the Pokémon first.</div>' : `
          <div class="dm-adm-pics">${PICTURE_SLOTS.map(([kind, shiny, label, key]) => pictureSlotHtml(kind, shiny, label, pictures[key])).join('')}</div>
          <div class="dm-hint">Still: PNG, JPG or WebP. Animated: an MP4. A ? is one it doesn't have yet.</div>`}
        </div>
      </div>
      <div class="dm-adm-actions"><button class="dm-btn primary" id="admSpSave">💾 Save Pokédex entry</button></div>
    </div>
    <datalist id="admSpSizes">${pick('size').map(v => `<option value="${escapeHtml(v)}">`).join('')}</datalist>
    <datalist id="admSpRarities">${pick('rarity').map(v => `<option value="${escapeHtml(v)}">`).join('')}</datalist>
    <datalist id="admSpHabitats">${pick('habitat').map(v => `<option value="${escapeHtml(v)}">`).join('')}</datalist>
    <datalist id="admSpBehaviors">${pick('behavior').map(v => `<option value="${escapeHtml(v)}">`).join('')}</datalist>
    <datalist id="admSpActives">${pick('activity').map(v => `<option value="${escapeHtml(v)}">`).join('')}</datalist>
`;
  bindMultiSelects(box);
  const pic = document.getElementById('admSpPic');
  const shown = pictures.animated || pictures.still;
  if (shown) patchPortraitMedia(pic, shown, sp.name); else pic.innerHTML = '<span>📕</span>';
  box.querySelectorAll('[data-pic-media]').forEach(el => { if (el.dataset.picMedia) patchPortraitMedia(el, el.dataset.picMedia, ''); });

  // A known ability fills in its description when it's picked (and an unknown one leaves it to be written)
  // A known ability fills in its description when it's picked; "A new ability…" asks for its name (and a description)
  SLOTS.forEach(([slot]) => document.getElementById(`admSpAb_${slot}`).addEventListener('change', async (e) => {
    const desc = document.getElementById(`admSpAbDesc_${slot}`);
    const fresh = document.getElementById(`admSpAbNew_${slot}`);
    fresh.hidden = e.target.value !== NEW_ABILITY;
    if (!fresh.hidden) { desc.value = ''; fresh.focus(); return; }
    const known = abilityDescriptions[e.target.value];
    if (known) { desc.value = known; return; }
    const other = species.flatMap(s => s.abilities || []).find(a => a.name.toLowerCase() === e.target.value.trim().toLowerCase());
    desc.value = other?.description && other.description !== 'No description available' ? other.description : '';
  }));
  // Moves: picked from the dropdown under each level, taken off with their ✕. One the move list doesn't have (kept from
  // before, or the list not loaded) is pointed out -- a typo would never show up anywhere.
  const known = new Set(moveList.map(m => m.toLowerCase()));
  const checkMoves = () => {
    const unknown = MOVE_LEVELS.flatMap(l => levelMoves(l)).filter(m => known.size && !known.has(m.toLowerCase()));
    document.getElementById('admSpMoveWarn').innerHTML = unknown.length ? `<span class="dm-warn-text">Not in the move list: ${unknown.map(escapeHtml).join(', ')}</span>` : '';
    box.querySelectorAll('.dm-adm-movechip').forEach(c => c.classList.toggle('unknown', known.size > 0 && !known.has(c.dataset.move.toLowerCase())));
  };
  box.querySelectorAll('[data-move-add]').forEach(sel => sel.addEventListener('change', () => {
    const name = sel.value;
    sel.value = '';
    const chips = document.getElementById(`admSpMoves_${sel.dataset.moveAdd}`);
    if (!name || levelMoves(sel.dataset.moveAdd).some(m => m.toLowerCase() === name.toLowerCase())) return;
    chips.insertAdjacentHTML('beforeend', moveChipHtml(name));
    checkMoves();
  }));
  // (on the form itself, drawn new each time -- the box stays, and would gather a listener per redraw)
  box.querySelector('.dm-adm-form').addEventListener('click', (e) => {
    const x = e.target.closest('[data-move-remove]');
    if (x) { x.closest('.dm-adm-movechip').remove(); checkMoves(); }
  });
  checkMoves();
  const evos = document.getElementById('admSpEvos');
  evos.querySelectorAll('.dm-adm-evo').forEach(row => wireEvoRow(row, species));
  document.getElementById('admSpEvoAdd').addEventListener('click', () => {
    evos.insertAdjacentHTML('beforeend', evoRowHtml({ species: '', criteria: [] }));
    const row = evos.lastElementChild;
    wireEvoRow(row, species);
    row.querySelector('[data-evo-species]').focus();
  });
  evos.addEventListener('click', (e) => {
    if (e.target.closest('[data-evo-remove]')) { e.target.closest('.dm-adm-evo').remove(); return; }
    if (e.target.closest('[data-crit-remove]')) { e.target.closest('.dm-adm-crit').remove(); return; }
    const add = e.target.closest('[data-crit-add]');
    if (add) { openCriteriaMenu(add); return; }
    const change = e.target.closest('[data-crit-pick]');
    if (change) pickCriterionValue(change.closest('.dm-adm-crit').dataset.type).then((v) => { if (v) setCriterionValue(change.closest('.dm-adm-crit'), v); });
  });
  box.querySelectorAll('[data-upload]').forEach(b => b.addEventListener('click', () => uploadPicture(b.dataset.upload, b.dataset.shiny === '1', species, redrawList)));
  document.getElementById('admSpSave').addEventListener('click', (e) => saveSpecies(e.currentTarget, species, redrawList));
}

// ---------------------------------------------------------------------------
// Evolutions: the Pokemon it evolves into, then its criteria one by one (the user's call, 2026-10-19) -- a level, an
// item (picked from the item list), a location, happiness, a time of day, a move (picked from the move list) or anything
// else. Saved as evolvesInto[i].criteria = [{type, value}] (pi-server/app/species.py).
// ---------------------------------------------------------------------------

const CRITERIA = [
  ['level', '📈 Level', 'The level it evolves at'], ['item', '💎 Item', 'An item, from the item list'],
  ['location', '📍 Location', 'Where it has to be'], ['happiness', '💛 Happiness', 'How happy it has to be'],
  ['time', '🌗 Day / Night', 'A time of day'], ['move', '💥 Move', 'A move it has to know'], ['other', '📝 Other', 'Anything else'],
];
const TIMES = ['morning', 'day', 'evening', 'night'];

function evoRowHtml(e) {
  return `<div class="dm-adm-evo">
    <div class="dm-adm-evo-head">
      <div class="dm-adm-evo-target"><input class="dm-input" data-evo-species value="${escapeHtml(e.species || '')}" placeholder="Evolves into… (search a Pokémon)" autocomplete="off"></div>
      <button class="dm-btn small" data-crit-add>＋ Add evolution criteria</button>
      <button class="dm-icon-btn danger" data-evo-remove title="Remove this evolution">✕</button>
    </div>
    <div class="dm-adm-crits">${(e.criteria || []).map(criterionHtml).join('')}</div>
  </div>`;
}

function criterionHtml(c) {
  const label = (CRITERIA.find(x => x[0] === c.type) || CRITERIA[CRITERIA.length - 1])[1];
  const v = c.value ?? '';
  let input;
  if (c.type === 'level') input = `<input class="dm-input dm-adm-crit-num" type="number" min="1" max="100" data-crit-value value="${escapeHtml(v)}" placeholder="Level">`;
  else if (c.type === 'time') input = `<select class="dm-select" data-crit-value>${TIMES.map(t => `<option value="${t}" ${t === String(v).toLowerCase() ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select>`;
  else if (c.type === 'item' || c.type === 'move') {
    input = `<span class="dm-adm-crit-pick"><span data-crit-shown>${escapeHtml(v)}</span><input type="hidden" data-crit-value value="${escapeHtml(v)}">
      <button class="dm-btn small" data-crit-pick>Change…</button></span>`;
  } else input = `<input class="dm-input" data-crit-value value="${escapeHtml(v)}" placeholder="${{ location: 'e.g. near a port', happiness: 'e.g. very happy -- loyalty 8+' }[c.type] || 'What it takes'}">`;
  return `<div class="dm-adm-crit" data-type="${escapeHtml(c.type)}"><span class="dm-adm-crit-type">${label}</span>${input}
    <button class="dm-icon-btn danger" data-crit-remove title="Remove this criterion">✕</button></div>`;
}

/** The evolution's Pokemon search: the console's own suggestion list, with the Pokemon's pictures. */
function wireEvoRow(row, species) {
  const input = row.querySelector('[data-evo-species]');
  attachSuggest(input, () => species.map(s => ({ value: s.name, label: s.name, sub: `#${s.dex ?? '?'} ${[s.type1, s.type2].filter(Boolean).join('/')}`, image: s.picture || s.image || '' })),
    { imageFallback: 'assets/Pokeball.png', max: 30 });
}

/** "Add evolution criteria": a small menu of the kinds, under the button. */
function openCriteriaMenu(btn) {
  document.querySelector('.dm-adm-critmenu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'dm-adm-critmenu';
  menu.innerHTML = CRITERIA.map(([type, label, sub]) => `<button type="button" data-crit-type="${type}"><b>${label}</b><small>${sub}</small></button>`).join('');
  btn.insertAdjacentElement('afterend', menu);
  const away = (e) => { if (!menu.contains(e.target) && e.target !== btn) { menu.remove(); document.removeEventListener('mousedown', away); } };
  setTimeout(() => document.addEventListener('mousedown', away), 0);
  menu.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-crit-type]');
    if (!b) return;
    menu.remove();
    document.removeEventListener('mousedown', away);
    const type = b.dataset.critType;
    let value = '';
    if (type === 'item' || type === 'move') {
      value = await pickCriterionValue(type);
      if (!value) return;
    } else if (type === 'time') value = 'night';
    const list = btn.closest('.dm-adm-evo').querySelector('.dm-adm-crits');
    list.insertAdjacentHTML('beforeend', criterionHtml({ type, value }));
    list.lastElementChild.querySelector('input:not([type="hidden"]), select')?.focus();
  });
}

/** An item or a move, picked from the whole list. */
async function pickCriterionValue(type) {
  if (type === 'item') {
    const items = await DmAPI.adminItems().catch(() => []);
    const res = await openPicker({
      title: '💎 Pick the item', imageFallback: 'assets/Bag.png',
      items: items.map(i => ({ key: i.name, label: i.name, sub: i.category, image: i.image || '' })),
    });
    return res?.keys[0] || '';
  }
  const moves = await loadMoves(); // fresh: the DM's custom moves too
  const res = await openPicker({
    title: '💥 Pick the move', compact: true, emptyText: 'No move list loaded.',
    items: moves.map(m => ({ key: m.name, label: m.name, sub: `${m.type || ''}${m.vpCost ? ` · ${m.vpCost} VP` : ''}` })),
  });
  return res?.keys[0] || '';
}

function setCriterionValue(row, value) {
  row.querySelector('[data-crit-value]').value = value;
  const shown = row.querySelector('[data-crit-shown]');
  if (shown) shown.textContent = value;
}

function pictureSlotHtml(kind, shiny, label, url) {
  return `<div class="dm-adm-picslot">
    <div class="dm-adm-picbox${url ? '' : ' missing'}" data-pic-media="${escapeHtml(url || '')}">${url ? '' : '<span>?</span>'}</div>
    <strong>${shiny ? '✨ ' : ''}${label}</strong>
    <button class="dm-btn small" data-upload="${kind}" data-shiny="${shiny ? 1 : 0}">⬆ ${url ? 'Replace' : 'Upload'}…</button>
  </div>`;
}

const moveChipHtml = name => `<span class="dm-adm-movechip" data-move="${escapeHtml(name)}">${escapeHtml(name)}<button type="button" data-move-remove title="Take it off">✕</button></span>`;
/** The moves on the form for one level. */
const levelMoves = l => [...document.querySelectorAll(`#admSpMoves_${l} .dm-adm-movechip`)].map(c => c.dataset.move);

async function uploadPicture(kind, shiny, species, redrawList) {
  const file = await pickFile(kind === 'animated' ? 'video/mp4' : 'image/png,image/jpeg,image/webp');
  if (!file) return;
  const btn = document.querySelector(`[data-upload="${kind}"][data-shiny="${shiny ? 1 : 0}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }
  try {
    const data = kind === 'animated' ? await readAsDataUrl(file) : await prepareImage(file, 1024);
    _record.pictures = await DmAPI.adminPokemonImage({ species: _speciesName, kind, shiny, data });
    dataChanged();
    toast(`${_speciesName}'s ${kind === 'animated' ? 'animated sprite' : 'picture'}${shiny ? ' (shiny)' : ''} is saved.`);
    drawSpeciesForm(species, redrawList);
  } catch (err) {
    showCombatAlert(err.message, { title: "Couldn't upload it" });
    if (btn) { btn.disabled = false; btn.textContent = '⬆ Upload…'; }
  }
}

/** The ability picked for a slot ('' for none) -- a new one's typed name. */
function abilityAt(slot) {
  const v = val(`admSpAb_${slot}`);
  return (v === NEW_ABILITY ? val(`admSpAbNew_${slot}`) : v).trim();
}

async function saveSpecies(btn, species, redrawList) {
  const isNew = !_speciesName;
  const newEmpty = SLOTS.find(([slot]) => val(`admSpAb_${slot}`) === NEW_ABILITY && !abilityAt(slot));
  if (newEmpty) { showCombatAlert(`Give the new ${newEmpty[1].toLowerCase()} ability a name (or pick one from the list).`, { title: 'Abilities' }); return; }
  const n = (id) => (val(id).trim() === '' ? null : Number(val(id)));
  const sp = {
    ..._record.species,
    name: val('admSpName').trim(), dexNumber: n('admSpDex'), classification: val('admSpClass'), description: val('admSpDesc'),
    types: { primary: val('admSpType1'), secondary: val('admSpType2') || null },
    size: val('admSpSize'), rarity: val('admSpRarity'), habitat: val('admSpHabitat'), behavior: val('admSpBehavior'), active: val('admSpActive'),
    encounter: { minimumLevel: n('admSpMinLevel'), catchDifficulty: n('admSpCatch') },
    combat: { ac: n('admSpAC'), hitDie: n('admSpHD'), baseHP: n('admSpHP'), vitalityDie: n('admSpVD'), baseVP: n('admSpVP') },
    baseStats: Object.fromEntries(STATS.map(([k]) => [k, n(`admSpStat_${k}`)])),
    savingThrows: readMultiSelect('admSpSaves'), skills: readMultiSelect('admSpSkills'),
    abilities: Object.fromEntries(SLOTS.map(([slot]) => [slot, abilityAt(slot) || null])),
    moves: Object.fromEntries(MOVE_LEVELS.map(l => [l, levelMoves(l)])),
    movement: Object.fromEntries(MOVEMENT.map(k => [k, n(`admSpMove_${k}`) || 0])),
    senses: Object.fromEntries(SENSES.map(k => [k, val(`admSpSense_${k}`).trim() || null])),
    evolvesInto: [...document.querySelectorAll('#admSpEvos .dm-adm-evo')].map(row => ({
      species: row.querySelector('[data-evo-species]').value.trim(),
      criteria: [...row.querySelectorAll('.dm-adm-crit')].map(c => ({ type: c.dataset.type, value: c.querySelector('[data-crit-value]').value.trim() }))
        .filter(c => c.value !== ''),
    })).filter(e => e.species),
  };
  // A description written for an ability -- kept for that ability (a new one needs it)
  const abilityDescriptions = Object.fromEntries(SLOTS.map(([slot]) => [abilityAt(slot), val(`admSpAbDesc_${slot}`).trim()])
    .filter(([name, desc]) => name && desc && _record.abilityDescriptions?.[name] !== desc));
  const unknownEvo = sp.evolvesInto.filter(e => !species.some(s => s.name.toLowerCase() === e.species.toLowerCase()) && e.species.toLowerCase() !== sp.name.toLowerCase());
  if (unknownEvo.length && !await showCombatConfirm(`${unknownEvo.map(e => e.species).join(', ')} isn't a Pokémon in the game yet. Save anyway?`, { title: 'Evolves into', yesLabel: 'Save', noLabel: 'Cancel' })) return;
  btn.disabled = true;
  try {
    const saved = await DmAPI.adminSaveSpecies(sp, isNew, abilityDescriptions);
    dataChanged();
    _speciesName = saved.species.name;
    _record = saved;
    window.dispatchEvent(new CustomEvent('dm:species-changed', { detail: { name: _speciesName } }));
    toast(`${_speciesName} is saved.`);
    const fresh = await getSpecies();
    species.splice(0, species.length, ...fresh);
    redrawList();
    drawSpeciesForm(species, redrawList);
  } catch (err) {
    showCombatAlert(err.message, { title: "Couldn't save the Pokédex entry" });
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Splash screens
// ---------------------------------------------------------------------------

async function drawSplashes(body) {
  try {
    _splashes = await DmAPI.adminSplashes();
  } catch (err) {
    body.innerHTML = `<div class="dm-loading">Couldn't load the splashes: ${escapeHtml(err.message)}</div>`;
    return;
  }
  body.innerHTML = `
    <div class="dm-adm-splashes">
      <div class="dm-adv-bar">
        <h2>🖼️ Splash screens</h2>
        <span class="dm-hint">The pictures the app's loading screen picks from at random. While a session splash is there, it's shown instead of them.</span>
        <span class="dm-adv-btns"><button class="dm-btn primary" id="admSplashAdd">＋ Add splash screens…</button></span>
      </div>
      <div class="dm-adm-splashgrid">
        ${_splashes.map(s => `
          <div class="dm-adm-splash${s.session ? ' session' : ''}">
            <img src="${escapeHtml(s.url)}" alt="" loading="lazy" data-view="${escapeHtml(s.url)}" title="Click to see it whole">
            <div class="dm-adm-splash-bar"><span>${s.session ? '<span class="dm-pill todo">Session splash</span>' : escapeHtml(s.file)}</span>
              <span><button class="dm-btn small" data-replace="${escapeHtml(s.file)}">Replace…</button>
              <button class="dm-btn small danger" data-delete="${escapeHtml(s.file)}">Delete</button></span></div>
          </div>`).join('') || '<div class="dm-hint" style="padding:1rem">No splash screens yet.</div>'}
      </div>
    </div>`;
  document.getElementById('admSplashAdd').addEventListener('click', async (e) => {
    const files = (await pickFile('image/png,image/jpeg,image/webp', { multiple: true })) || [];
    if (!files.length) return;
    const btn = e.target;
    btn.disabled = true;
    try {
      for (const [i, file] of files.entries()) {
        btn.textContent = `Uploading ${i + 1} of ${files.length}…`;
        await DmAPI.adminSaveSplash(await prepareImage(file, 1920));
      }
      toast(`${files.length === 1 ? 'The splash is' : `${files.length} splashes are`} saved.`);
    } catch (err) {
      showCombatAlert(err.message, { title: "Couldn't upload the splash" });
    }
    drawSplashes(body);
  });
  body.querySelectorAll('[data-view]').forEach(img => img.addEventListener('click', () => viewPicture(img.dataset.view)));
  body.querySelectorAll('[data-replace]').forEach(b => b.addEventListener('click', async () => {
    const file = await pickFile('image/png,image/jpeg,image/webp');
    if (!file) return;
    const s = _splashes.find(x => x.file === b.dataset.replace);
    b.disabled = true;
    b.textContent = 'Uploading…';
    try {
      let data = await prepareImage(file, 1920);
      if (s?.session) data = await asPng(data);
      await DmAPI.adminSaveSplash(data, b.dataset.replace);
    } catch (err) {
      showCombatAlert(err.message, { title: "Couldn't replace the splash" });
    }
    drawSplashes(body);
  }));
  body.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', async () => {
    if (!await showCombatConfirm(`Delete ${b.dataset.delete}? It's removed from the Pi.`, { title: 'Delete splash', yesLabel: 'Delete', noLabel: 'Cancel' })) return;
    try {
      await DmAPI.adminDeleteSplash(b.dataset.delete);
    } catch (err) {
      showCombatAlert(err.message, { title: "Couldn't delete the splash" });
    }
    drawSplashes(body);
  }));
}

/** A picture shown whole, over everything -- a click or Escape closes it. */
function viewPicture(url) {
  const overlay = document.createElement('div');
  overlay.className = 'dm-adm-lightbox';
  overlay.innerHTML = `<img src="${escapeHtml(url)}" alt=""><button class="dm-icon-btn" title="Close">✕</button>`;
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}

// ---------------------------------------------------------------------------
// Map pictures: the battle maps' objects (object-<name>.png, see-through PNGs) and backgrounds (battle-<name>) -- uploaded
// and deleted here (until 2026-10-19 in the map editor's Pictures card). A background is portrait, like the board: one
// uploaded landscape is turned a quarter left first, so it looks the same on the table TV (which turns the board right).
// ---------------------------------------------------------------------------

let _objGroup = '';
let _objQuery = '';
/** An object's place: the first word of its name ("Cave Rock" -> Cave); one without a second word is in "Other". */
const objGroup = o => (/\s/.test(o.label.trim()) ? o.label.trim().split(/\s+/)[0] : 'Other');

async function drawMapPictures(body) {
  let assets;
  try {
    assets = (await DmAPI.mapAssets()).data || { objects: [], backgrounds: [] };
  } catch (err) {
    body.innerHTML = `<div class="dm-loading">Couldn't load the map pictures: ${escapeHtml(err.message)}</div>`;
    return;
  }
  const groups = [...new Set(assets.objects.map(objGroup))].sort((a, b) => (a === 'Other') - (b === 'Other') || a.localeCompare(b));
  if (_objGroup && !groups.includes(_objGroup)) _objGroup = '';
  const card = (a) => `
    <div class="dm-adm-mappic">
      <span class="dm-adm-mappic-img" data-view="${escapeHtml(a.url)}" title="Click to see it whole"><img src="${escapeHtml(a.url)}" alt="" loading="lazy"></span>
      <span class="dm-adm-mappic-name">${escapeHtml(a.label)}</span>
      <button class="dm-icon-btn danger" data-del-pic="${escapeHtml(a.url)}" data-label="${escapeHtml(a.label)}" title="Delete it from the Pi">🗑</button>
    </div>`;
  body.innerHTML = `
    <div class="dm-adm-splashes">
      <div class="dm-adv-bar">
        <h2>🌲 Map pictures</h2>
        <span class="dm-hint">The pictures the battle maps are built from. Objects: a PNG with a see-through background. Backgrounds: JPG, PNG or WebP, portrait like the board (a landscape one is turned for you).</span>
        <span class="dm-adv-btns">
          <input class="dm-input" id="admPicName" placeholder="Name (else the file's)" maxlength="50" autocomplete="off" style="width:13rem">
          <button class="dm-btn primary" id="admPicObject">⬆ Upload an object</button>
          <button class="dm-btn primary" id="admPicBackground">⬆ Upload a background</button>
        </span>
      </div>
      <div class="dm-adm-mapcols">
        <section class="dm-adm-mapcol">
          <div class="dm-adm-mapcol-head">
            <div class="dm-card-title">Objects <span class="dm-pill" id="admObjCount">${assets.objects.length}</span></div>
            <div class="dm-row dm-adm-mapfilter">
              <select class="dm-input" id="admObjGroup" title="Only the objects for one place -- the first word of the name (Cave Rock, Forest Tree...)">
                <option value="">Every place</option>
                ${groups.map(g => `<option value="${escapeHtml(g)}"${g === _objGroup ? ' selected' : ''}>${escapeHtml(g)} (${assets.objects.filter(o => objGroup(o) === g).length})</option>`).join('')}
              </select>
              <input class="dm-input" id="admObjSearch" placeholder="Search the objects…" autocomplete="off" value="${escapeHtml(_objQuery)}">
            </div>
          </div>
          <div class="dm-adm-mapgrid" id="admObjGrid"></div>
        </section>
        <section class="dm-adm-mapcol">
          <div class="dm-adm-mapcol-head"><div class="dm-card-title">Backgrounds <span class="dm-pill">${assets.backgrounds.length}</span></div></div>
          <div class="dm-adm-mapgrid wide">${assets.backgrounds.map(card).join('') || '<div class="dm-hint">None yet.</div>'}</div>
        </section>
      </div>
    </div>`;
  // The objects by place (the user's call, 2026-10-20): the first word of the name is where it belongs (Cave, Plains,
  // Forest...), picked from the list -- with a search -- so a long list needn't be scrolled through.
  const drawObjects = () => {
    const q = _objQuery.trim().toLowerCase();
    const shown = assets.objects.filter(o => (!_objGroup || objGroup(o) === _objGroup) && (!q || o.label.toLowerCase().includes(q)));
    document.getElementById('admObjGrid').innerHTML = shown.map(card).join('')
      || `<div class="dm-hint">${assets.objects.length ? 'No object matches that.' : 'None yet.'}</div>`;
    document.getElementById('admObjCount').textContent = shown.length === assets.objects.length ? assets.objects.length : `${shown.length} / ${assets.objects.length}`;
  };
  drawObjects();
  document.getElementById('admObjGroup').addEventListener('change', (e) => { _objGroup = e.target.value; drawObjects(); });
  document.getElementById('admObjSearch').addEventListener('input', (e) => { _objQuery = e.target.value; drawObjects(); });
  const upload = async (kind, btn) => {
    const file = await pickFile(kind === 'object' ? 'image/png' : 'image/png,image/jpeg,image/webp');
    if (!file) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Uploading…';
    try {
      let data = await readAsDataUrl(file);
      if (kind === 'background') data = await portrait(data);
      const pic = await DmAPI.uploadBattleImage({ kind, name: val('admPicName').trim() || file.name.replace(/\.[^.]+$/, ''), data });
      forgetMapAssets();
      toast(`${kind === 'object' ? 'Object' : 'Background'} "${pic.label}" is on the Pi.`);
      drawMapPictures(body);
    } catch (err) {
      showCombatAlert(err.message, { title: kind === 'object' ? 'Upload an object' : 'Upload a background' });
      btn.disabled = false;
      btn.textContent = label;
    }
  };
  document.getElementById('admPicObject').addEventListener('click', (e) => upload('object', e.currentTarget));
  document.getElementById('admPicBackground').addEventListener('click', (e) => upload('background', e.currentTarget));
  body.querySelector('.dm-adm-mapcols').addEventListener('click', async (e) => {
    const view = e.target.closest('[data-view]');
    if (view) { viewPicture(view.dataset.view); return; }
    const b = e.target.closest('[data-del-pic]');
    if (!b) return;
    if (!await showCombatConfirm(`Delete "${b.dataset.label}" from the Pi? Maps that use it lose it.`, { title: 'Delete picture', yesLabel: 'Delete', noLabel: 'Cancel' })) return;
    try {
      await DmAPI.deleteBattleImage(b.dataset.delPic);
      forgetMapAssets();
      drawMapPictures(body);
    } catch (err) {
      showCombatAlert(err.message, { title: 'Delete picture' });
    }
  });
}

/** A landscape picture turned a quarter left (counter-clockwise) into a portrait one; a portrait one as it is. */
async function portrait(dataUrl) {
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("That picture can't be read"));
    el.src = dataUrl;
  });
  if (img.naturalWidth <= img.naturalHeight) return dataUrl;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalHeight;
  canvas.height = img.naturalWidth;
  const ctx = canvas.getContext('2d');
  ctx.translate(0, canvas.height);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(img, 0, 0);
  const type = /^data:image\/(png|webp)/.test(dataUrl) ? dataUrl.slice(5, dataUrl.indexOf(';')) : 'image/jpeg';
  return canvas.toDataURL(type, 0.92);
}

// ---------------------------------------------------------------------------
// Battle logs: every battle on the Pi (PvE, PvP and adventures), newest first, and what happened in one -- round by
// round, the DM-only lines too (pi-server/app/admin.py's battle_logs / battle_log).
// ---------------------------------------------------------------------------

const KIND_LABEL = { pve: 'PvE', pvp: 'PvP', adventure: 'Adventure' };
let _logFile = null;
const logWhen = ts => (ts ? new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** A battle's name: the DM's own (the user's call, 2026-10-20), else its players with the date and time. */
function logTitle(l) {
  if (l.name) return l.name;
  const p = l.players || [];
  const who = p.length > 1 ? `${p.slice(0, -1).join(', ')} & ${p[p.length - 1]}` : p[0] || 'No players';
  return [who, logWhen(l.started)].filter(Boolean).join(' · ');
}

async function drawBattleLogs(body) {
  let logs;
  try {
    logs = await DmAPI.adminBattleLogs();
  } catch (err) {
    body.innerHTML = `<div class="dm-loading">Couldn't load the battle logs: ${escapeHtml(err.message)}</div>`;
    return;
  }
  body.innerHTML = `
    <div class="dm-editor">
      <aside class="dm-editor-tools">
        <div class="dm-editor-head"><h2>📜 Battle logs</h2><span class="dm-pill ok">${logs.length}</span></div>
        <input class="dm-input" id="admLogFilter" placeholder="Find a battle (its name, who was in it)…" autocomplete="off">
        <div class="dm-pdx-list" id="admLogList">
          ${logs.map(l => `
            <button class="dm-pdx-row dm-adm-logrow${l.file === _logFile ? ' selected' : ''}" data-log="${escapeHtml(l.file)}" data-search="${escapeHtml(`${logTitle(l)} ${logWhen(l.started)} ${l.who.join(' ')} ${l.kind}`.toLowerCase())}">
              <span class="dm-adm-logkind ${escapeHtml(l.kind)}">${escapeHtml(KIND_LABEL[l.kind] || l.kind)}</span>
              <span class="dm-pdx-main"><strong class="dm-adm-logname">${escapeHtml(logTitle(l))}</strong><small class="dm-adm-logdate" ${l.name ? '' : 'hidden'}>${escapeHtml(logWhen(l.started))}</small>
                <small>${escapeHtml(l.who.slice(0, 6).join(', ') || 'Nobody joined')}${l.who.length > 6 ? ` +${l.who.length - 6}` : ''}</small>
                <small>${l.rounds ? `${l.rounds} round${l.rounds === 1 ? '' : 's'} · ` : ''}${l.entries} lines${l.caught ? ` · ${l.caught} caught` : ''}${l.ended ? '' : ' · not ended'}</small></span><span></span>
            </button>`).join('') || '<div class="dm-hint" style="padding:0.4rem">No battles yet.</div>'}
        </div>
      </aside>
      <section class="dm-editor-canvas" id="admLogView"><div class="dm-cs-empty">Pick a battle on the left.</div></section>
    </div>`;
  document.getElementById('admLogFilter').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    body.querySelectorAll('[data-log]').forEach(r => { r.hidden = !!q && !r.dataset.search.includes(q); });
  });
  document.getElementById('admLogList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-log]');
    if (!row) return;
    _logFile = row.dataset.log;
    body.querySelectorAll('[data-log]').forEach(r => r.classList.toggle('selected', r === row));
    showBattleLog(logs.find(l => l.file === _logFile));
  });
  if (_logFile && logs.some(l => l.file === _logFile)) showBattleLog(logs.find(l => l.file === _logFile));
}

async function showBattleLog(meta) {
  const view = document.getElementById('admLogView');
  view.innerHTML = '<div class="dm-loading">Loading…</div>';
  let entries;
  try {
    entries = await DmAPI.adminBattleLog(meta.file);
  } catch (err) {
    view.innerHTML = `<div class="dm-loading">${escapeHtml(err.message)}</div>`;
    return;
  }
  const time = (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
  const rounds = new Map();
  entries.forEach((e) => {
    const r = Number(e.round) || 0;
    if (!rounds.has(r)) rounds.set(r, []);
    rounds.get(r).push(e);
  });
  const draw = (q) => {
    const show = (e) => !q || `${e.text} ${e.actorName || ''} ${e.targetName || ''} ${e.type}`.toLowerCase().includes(q);
    document.getElementById('admLogLines').innerHTML = [...rounds.entries()].map(([r, list]) => {
      const lines = list.filter(show);
      if (!lines.length) return '';
      return `<div class="dm-adm-loground"><div class="dm-card-title">${meta.kind === 'adventure' ? 'Adventure' : `Round ${r || 1}`}</div>
        ${lines.map(e => `<div class="dm-adm-logline${e.hidden ? ' hidden-line' : ''} t-${escapeHtml(String(e.type || '').replace(/[^\w-]/g, ''))}">
          <span class="dm-adm-logtime">${escapeHtml(time(e.ts))}</span>
          <span>${e.hidden ? '<span title="Kept from the players\' log">🙈</span> ' : ''}${escapeHtml(e.text || e.type || '')}</span></div>`).join('')}</div>`;
    }).join('') || '<div class="dm-hint">Nothing matches that.</div>';
  };
  view.innerHTML = `
    <div class="dm-adm-loghead">
      <h3 class="dm-cs-title"><span class="dm-adm-logkind ${escapeHtml(meta.kind)}">${escapeHtml(KIND_LABEL[meta.kind] || meta.kind)}</span>
        <span id="admLogTitle">${escapeHtml(logTitle(meta))}</span>
        <button class="dm-icon-btn" id="admLogRename" title="Name this battle">✎</button></h3>
      <div class="dm-hint">${escapeHtml(meta.started ? new Date(meta.started).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' }) : meta.file)}
        · ${escapeHtml(meta.who.join(', ') || 'Nobody joined')}</div>
      <input class="dm-input" id="admLogSearch" placeholder="Search this battle (a name, a move…)" autocomplete="off">
    </div>
    <div id="admLogLines"></div>`;
  draw('');
  document.getElementById('admLogSearch').addEventListener('input', (e) => draw(e.target.value.trim().toLowerCase()));
  document.getElementById('admLogRename').addEventListener('click', () => renameBattle(meta));
}

/** The DM names a battle -- an empty name puts the one made from its players and date back. */
async function renameBattle(meta) {
  let typed = meta.name || '';
  const answer = await openDmModal({
    title: '✎ Name this battle',
    html: `<input class="dm-input" id="admLogName" value="${escapeHtml(meta.name || '')}" maxlength="120" placeholder="${escapeHtml(logTitle({ ...meta, name: null }))}">
      <div class="dm-hint">Left empty, it's named after its players with the date and time.</div>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save', kind: 'primary', value: 'save' }],
    onOpen: (body, close) => {
      const input = body.querySelector('#admLogName');
      setTimeout(() => input.select(), 0);
      input.addEventListener('input', () => { typed = input.value.trim(); });
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') close('save'); });
    },
  });
  if (answer !== 'save') return;
  try {
    meta.name = await DmAPI.adminRenameBattleLog(meta.file, typed);
  } catch (err) { toast(err.message); return; }
  const title = document.getElementById('admLogTitle');
  if (title) title.textContent = logTitle(meta);
  const row = document.querySelector(`#admLogList [data-log="${CSS.escape(meta.file)}"]`);
  if (row) {
    row.querySelector('.dm-adm-logname').textContent = logTitle(meta);
    row.querySelector('.dm-adm-logdate').hidden = !meta.name;
    row.dataset.search = `${logTitle(meta)} ${logWhen(meta.started)} ${meta.who.join(' ')} ${meta.kind}`.toLowerCase();
  }
}
