// DM console -- the Admin module (the user's call, 2026-10-19): the game's data the DM adds to or changes himself, with
// their pictures -- the items, the Pokedex entries (species, and the abilities they name) and the loading-screen splashes.
// Everything is saved on the Pi (pi-server/app/admin.py): items and Pokedex entries in the data folder, laid over the files
// the code comes with (so a `git pull` on the Pi never clashes with them); the pictures where the app already looks for
// them -- an item's named after the item ("Frost Ball.png"), a Pokemon's still picture with the other Pokemon pictures,
// its animated sprite with the other sprites (each optionally the shiny one), the splashes with the others.
import { DmAPI } from '../api.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import { POKEMON_TYPES } from '../utils/pokemon-types.js';
import { escapeHtml, toast, getSpecies, forgetSpecies, typeBadges, multiSelectHtml, bindMultiSelects, readMultiSelect, SAVING_THROWS, SKILLS } from './dm-common.js';
import { prepareImage } from './display.js';

const TAB_KEY = 'dmAdminTab';
const MOVE_LEVELS = ['1', '2', '6', '10', '14', '18'];
const MOVEMENT = ['walking', 'climbing', 'flying', 'hovering', 'swimming', 'burrowing'];
const SENSES = ['sight', 'hearing', 'smell', 'tremorsense', 'echolocation', 'telepathy', 'blindsight', 'darkvision', 'truesight'];
const STATS = [['strength', 'STR'], ['dexterity', 'DEX'], ['constitution', 'CON'], ['intelligence', 'INT'], ['wisdom', 'WIS'], ['charisma', 'CHA']];
const SLOTS = [['primary', 'Primary'], ['secondary', 'Secondary'], ['hidden', 'Hidden']];
const LIST_MAX = 250; // rows drawn in a list at once -- the search narrows it down

let _root = null;
let _tab = 'items';
let _items = null;           // [{name, category, price, description, effect, image, edited}]
let _item = null;            // the item on the form ({...} -- `isNew` while it hasn't been saved)
let _speciesName = null;     // the Pokedex entry on the form (null: a new one)
let _record = null;          // its admin-species answer
let _splashes = null;

export function renderAdmin(section) {
  if (_root === section) return;
  _root = section;
  try { _tab = ['items', 'species', 'splashes'].includes(localStorage.getItem(TAB_KEY)) ? localStorage.getItem(TAB_KEY) : 'items'; } catch (e) { /* default */ }
  section.innerHTML = `
    <div class="dm-admin">
      <div class="dm-enc-tabs" id="admTabs">
        <button data-atab="items">🎒 Items</button>
        <button data-atab="species">📕 Pokédex entries</button>
        <button data-atab="splashes">🖼️ Splash screens</button>
      </div>
      <div class="dm-admin-body" id="admBody"></div>
    </div>`;
  section.querySelector('#admTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-atab]');
    if (b) showTab(b.dataset.atab);
  });
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

async function loadSpeciesForm(species, redrawList) {
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
  const moveNames = (() => { try { return JSON.parse(sessionStorage.getItem('moves') || '[]').map(m => m.name); } catch (e) { return []; } })();
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
              <input class="dm-input" id="admSpAb_${slot}" list="admSpAbilities" value="${escapeHtml(name)}" placeholder="None" maxlength="60">
              <textarea class="dm-input dm-adm-text" id="admSpAbDesc_${slot}" rows="2" placeholder="What it does (a new ability needs this)">${escapeHtml(abilityDescriptions[name] || '')}</textarea></div>`;
          }).join('')}
        </div>
        <div class="dm-card">
          <div class="dm-card-title">Moves learned (comma between them)</div>
          ${MOVE_LEVELS.map(l => `<div class="dm-field"><label for="admSpMoves_${l}">${l === '1' ? 'Starting moves' : `Level ${l}`}</label>
            <textarea class="dm-input dm-adm-text" id="admSpMoves_${l}" rows="2">${escapeHtml((sp.moves?.[l] || []).join(', '))}</textarea></div>`).join('')}
          <div class="dm-hint" id="admSpMoveWarn"></div>
        </div>
        <div class="dm-card">
          <div class="dm-card-title">Movement (feet -- 0 = can't)</div>
          <div class="dm-row dm-adm-scores">${MOVEMENT.map(k => num(`admSpMove_${k}`, k[0].toUpperCase() + k.slice(1), sp.movement?.[k])).join('')}</div>
          <div class="dm-card-title" style="margin-top:0.4rem">Senses (empty = none)</div>
          <div class="dm-adm-senses">${SENSES.map(k => field(`admSpSense_${k}`, k[0].toUpperCase() + k.slice(1), sp.senses?.[k], 'list="admSpSenseLevels" placeholder="—"')).join('')}</div>
        </div>
        <div class="dm-card">
          <div class="dm-card-title">Evolves into</div>
          <div id="admSpEvos">${(sp.evolvesInto || []).map(evoRowHtml).join('')}</div>
          <button class="dm-btn small" id="admSpEvoAdd">＋ Add an evolution</button>
          <div class="dm-hint" style="margin-top:0.3rem">The requirement is what the players can be shown in their Pokédex ("Level 7", "Level 7 near a port").</div>
        </div>
        <div class="dm-card">
          <div class="dm-card-title">Pictures</div>
          ${isNew ? '<div class="dm-hint">Save the Pokémon first.</div>' : `
          <div class="dm-adm-pics">
            ${pictureSlotHtml('still', 'Still picture', pictures.still, pictures.stillShiny)}
            ${pictureSlotHtml('animated', 'Animated sprite (MP4)', pictures.animated, pictures.animatedShiny)}
          </div>
          <label class="dm-adm-shiny"><input type="checkbox" id="admSpShiny"> Upload as the shiny version</label>`}
        </div>
      </div>
      <div class="dm-adm-actions"><button class="dm-btn primary" id="admSpSave">💾 Save Pokédex entry</button></div>
    </div>
    <datalist id="admSpSizes">${pick('size').map(v => `<option value="${escapeHtml(v)}">`).join('')}</datalist>
    <datalist id="admSpRarities">${pick('rarity').map(v => `<option value="${escapeHtml(v)}">`).join('')}</datalist>
    <datalist id="admSpHabitats">${pick('habitat').map(v => `<option value="${escapeHtml(v)}">`).join('')}</datalist>
    <datalist id="admSpBehaviors">${pick('behavior').map(v => `<option value="${escapeHtml(v)}">`).join('')}</datalist>
    <datalist id="admSpActives">${pick('activity').map(v => `<option value="${escapeHtml(v)}">`).join('')}</datalist>
    <datalist id="admSpSenseLevels">${['Poor', 'Average', 'Good', 'Excellent'].map(v => `<option value="${v}">`).join('')}</datalist>
    <datalist id="admSpAbilities">${abilityNames.map(v => `<option value="${escapeHtml(v)}">`).join('')}</datalist>
    <datalist id="admSpNames">${species.map(s => `<option value="${escapeHtml(s.name)}">`).join('')}</datalist>`;
  bindMultiSelects(box);
  const pic = document.getElementById('admSpPic');
  const shown = pictures.animated || pictures.still;
  if (shown) patchPortraitMedia(pic, shown, sp.name); else pic.innerHTML = '<span>📕</span>';
  box.querySelectorAll('[data-pic-media]').forEach(el => { if (el.dataset.picMedia) patchPortraitMedia(el, el.dataset.picMedia, ''); });

  // A known ability fills in its description when it's picked (and an unknown one leaves it to be written)
  SLOTS.forEach(([slot]) => document.getElementById(`admSpAb_${slot}`).addEventListener('change', async (e) => {
    const desc = document.getElementById(`admSpAbDesc_${slot}`);
    const known = abilityDescriptions[e.target.value];
    if (known) { desc.value = known; return; }
    const other = species.flatMap(s => s.abilities || []).find(a => a.name.toLowerCase() === e.target.value.trim().toLowerCase());
    desc.value = other?.description && other.description !== 'No description available' ? other.description : '';
  }));
  // Moves the game doesn't know are pointed out (a typo would never show up anywhere)
  const known = new Set(moveNames.map(m => m.toLowerCase()));
  const checkMoves = () => {
    const unknown = MOVE_LEVELS.flatMap(l => splitNames(val(`admSpMoves_${l}`))).filter(m => known.size && !known.has(m.toLowerCase()));
    document.getElementById('admSpMoveWarn').innerHTML = unknown.length ? `<span class="dm-warn-text">Not in the move list: ${unknown.map(escapeHtml).join(', ')}</span>` : '';
  };
  MOVE_LEVELS.forEach(l => document.getElementById(`admSpMoves_${l}`).addEventListener('input', checkMoves));
  checkMoves();
  document.getElementById('admSpEvoAdd').addEventListener('click', () => {
    document.getElementById('admSpEvos').insertAdjacentHTML('beforeend', evoRowHtml({ species: '', requirement: '' }));
  });
  document.getElementById('admSpEvos').addEventListener('click', (e) => {
    if (e.target.closest('[data-evo-remove]')) e.target.closest('.dm-adm-evo').remove();
  });
  box.querySelectorAll('[data-upload]').forEach(b => b.addEventListener('click', () => uploadPicture(b.dataset.upload, species, redrawList)));
  document.getElementById('admSpSave').addEventListener('click', (e) => saveSpecies(e.currentTarget, species, redrawList));
}

function evoRowHtml(e) {
  return `<div class="dm-adm-evo">
    <input class="dm-input" data-evo-species list="admSpNames" value="${escapeHtml(e.species || '')}" placeholder="Pokémon">
    <input class="dm-input" data-evo-req value="${escapeHtml(e.requirement || '')}" placeholder="Requirement, e.g. Level 7">
    <button class="dm-icon-btn danger" data-evo-remove title="Remove this evolution">✕</button>
  </div>`;
}

function pictureSlotHtml(kind, label, url, shinyUrl) {
  return `<div class="dm-adm-picslot">
    <div class="dm-adm-picbox" data-pic-media="${escapeHtml(url || '')}">${url ? '' : '<span>None yet</span>'}</div>
    <div><strong>${label}</strong>${shinyUrl ? '<div class="dm-hint">✨ has a shiny one too</div>' : ''}
      <button class="dm-btn small" data-upload="${kind}">⬆ ${url ? 'Replace' : 'Upload'}…</button></div>
  </div>`;
}

const splitNames = (text) => String(text || '').split(',').map(s => s.trim()).filter(Boolean);

async function uploadPicture(kind, species, redrawList) {
  const file = await pickFile(kind === 'animated' ? 'video/mp4' : 'image/png,image/jpeg,image/webp');
  if (!file) return;
  const shiny = !!document.getElementById('admSpShiny')?.checked;
  const btn = document.querySelector(`[data-upload="${kind}"]`);
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

async function saveSpecies(btn, species, redrawList) {
  const isNew = !_speciesName;
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
    abilities: Object.fromEntries(SLOTS.map(([slot]) => [slot, val(`admSpAb_${slot}`).trim() || null])),
    moves: Object.fromEntries(MOVE_LEVELS.map(l => [l, splitNames(val(`admSpMoves_${l}`))])),
    movement: Object.fromEntries(MOVEMENT.map(k => [k, n(`admSpMove_${k}`) || 0])),
    senses: Object.fromEntries(SENSES.map(k => [k, val(`admSpSense_${k}`).trim() || null])),
    evolvesInto: [...document.querySelectorAll('#admSpEvos .dm-adm-evo')].map(row => ({
      species: row.querySelector('[data-evo-species]').value.trim(), requirement: row.querySelector('[data-evo-req]').value.trim() || null,
    })).filter(e => e.species),
  };
  // A description written for an ability -- kept for that ability (a new one needs it)
  const abilityDescriptions = Object.fromEntries(SLOTS.map(([slot]) => [val(`admSpAb_${slot}`).trim(), val(`admSpAbDesc_${slot}`).trim()])
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
            <img src="${escapeHtml(s.url)}" alt="" loading="lazy">
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
