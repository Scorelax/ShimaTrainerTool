// DM console -- the NPC module: the DM's library of non-player characters, kept on the Pi (routes_dm.py's dm_npcs
// table). Each NPC is one sheet: who they are (picture, role, faction, where they're found, how they feel about the
// party, birthday -- shown in the Clock module's calendar), their story and personality, their battle numbers, their
// Pokemon team (each one's numbers worked out the way the battle setup does), features and inventory. Everything
// saves on its own a moment after a change. "Add to battle setup" puts the NPC and their team into the battle setup
// (creature-setup.js's addNpcToSetup), ready to be placed.
//
// NPC shape: { id, name, image, role, faction, attitude, location, region, species, age, firstMet, birthday: {month, day}|null,
//   level, str, dex, con, int, wis, cha, ac, maxHP, maxVP, speed, savingThrows: [names], skills: [names], trainerPath, affinity, specialization,
//   personality, ideals, bonds, flaws, mannerisms, backstory, notes,
//   features: [{name, description}], inventory: [{name, quantity, description}],
//   team: [{id, species, nickname, level, nature, abilities: [slots], item, shiny, notes, stats: {str...}}], createdAt, updatedAt }
import { DmAPI } from '../api.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import {
  escapeHtml, typeBadges, getSpecies, newId, toast, natureOptions, SAVING_THROWS, SKILLS, splitList, multiSelectHtml,
  bindMultiSelects, readMultiSelect, abilityMod, trainerHp, lazySprites } from './dm-common.js';
import { MONTHS } from './world-clock.js';
import { addNpcToSetup } from './creature-setup.js';
import { prepareImage } from './display.js';
import { openPicker } from './picker.js';

const STATS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const STAT_NAMES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
const NPC_PICTURE_SIDE = 1024; // bigger uploads are scaled down first -- a portrait is never shown bigger
const ATTITUDES = { friendly: ['Friendly', '#27ae60'], neutral: ['Neutral', '#95a5a6'], wary: ['Wary', '#f39c12'], hostile: ['Hostile', '#e74c3c'], unknown: ['Unknown', '#6c6f8a'] };
const SLOT_NAMES = ['Primary', 'Secondary', 'Hidden'];

let _root = null;
let _npcs = [];
let _selectedId = null;
let _species = [];
let _portraits = []; // [{name, file, url, own}] -- the NPC pictures on the Pi, then the players' own portraits
let _openMon = new Set(); // team members shown expanded
const _saveTimers = new Map();
const _recentSaves = new Map(); // id -> time: this tab's own saves, so their live push isn't taken as someone else's change
const _previews = new Map(); // team member config key -> built row
let _saveState = 'saved';
let _wired = false;
// Opened from an encounter (Encounter setup's ✏️ on one of its NPCs): which NPC to show, and the encounter to go back to.
let _pendingSelect = null;
let _fromEncounter = null;

/** Encounter setup's ✏️: this NPC in the NPC module -- changed here, it's changed for good, in every encounter that has it
 * -- with a way back to the encounter. */
export function openNpcFromEncounter(id, encounterName) {
  _pendingSelect = id;
  _fromEncounter = encounterName || 'the encounter';
  window.dispatchEvent(new CustomEvent('dm:show-module', { detail: { name: 'npcs' } }));
  if (_root && document.getElementById('npcList')) { select(id); _pendingSelect = null; } // already drawn
}

export async function renderNpcs(root) {
  _root = root;
  if (!_wired) {
    _wired = true;
    window.addEventListener('app:dm-npcs', onPushed);
  }
  root.innerHTML = '<div class="dm-loading">Loading the NPCs…</div>';
  try {
    const [res, species] = await Promise.all([DmAPI.npcs(), getSpecies().catch(() => []), loadPortraits()]);
    _npcs = res.data || [];
    _species = species;
  } catch (err) {
    root.innerHTML = `<div class="dm-loading">Couldn't load the NPCs: ${escapeHtml(err.message)}</div>`;
    return;
  }
  root.innerHTML = `
    <div class="dm-editor">
      <aside class="dm-editor-tools">
        <div class="dm-editor-head"><h2>NPCs</h2><span class="dm-pill ok" id="npcSave">All saved</span></div>
        <input class="dm-input" id="npcSearch" placeholder="Search name, role, faction, place…" autocomplete="off">
        <div class="dm-row">
          <button class="dm-btn primary" id="npcNew">+ New NPC</button>
          <button class="dm-btn" id="npcImport" title="Bring over the NPCs from the old DM tool's trainer backup (shima-trainers-….json)">📂 Import</button>
          <input type="file" id="npcImportFile" accept="application/json,.json" hidden>
        </div>
        <button class="dm-btn" id="npcUploadMany" title="Several pictures from your computer at once -- kept on the Pi, ready to pick for any NPC with Select image">⬆ Upload NPC pictures</button>
        <div class="dm-pdx-list" id="npcList"></div>
      </aside>
      <section class="dm-editor-canvas" id="npcSheet"></section>
    </div>`;
  document.getElementById('npcSearch').addEventListener('input', renderList);
  document.getElementById('npcNew').addEventListener('click', createNpc);
  document.getElementById('npcImport').addEventListener('click', () => document.getElementById('npcImportFile').click());
  document.getElementById('npcUploadMany').addEventListener('click', () => pickPictureFiles(true, uploadMany));
  document.getElementById('npcImportFile').addEventListener('change', (e) => { if (e.target.files?.[0]) importOldTool(e.target.files[0]); e.target.value = ''; });
  document.getElementById('npcList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-npc]');
    if (row) select(row.dataset.npc);
  });
  bindSheetFields(document.getElementById('npcSheet'));
  setSaveState(_saveState);
  if (_pendingSelect && _npcs.some(n => n.id === _pendingSelect)) _selectedId = _pendingSelect;
  _pendingSelect = null;
  renderList();
  renderSheet();
}

async function loadPortraits() {
  if (_portraits.length) return;
  _portraits = await DmAPI.mapAssets().then(r => r.data?.portraits || []).catch(() => []);
}

function current() {
  return _npcs.find(n => n.id === _selectedId) || null;
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

function renderList() {
  const box = document.getElementById('npcList');
  if (!box) return;
  const q = (document.getElementById('npcSearch')?.value || '').trim().toLowerCase();
  const shown = _npcs.filter(n => !q || [n.name, n.role, n.faction, n.location, n.region].some(v => String(v || '').toLowerCase().includes(q)));
  // Grouped by faction, however it's spelled ("APEX" and "Apex" are one group, under the first spelling met).
  const groups = {};
  const labels = {};
  shown.forEach(n => {
    const key = String(n.faction || '').trim().toLowerCase();
    labels[key] = labels[key] || String(n.faction || '').trim();
    (groups[key] = groups[key] || []).push(n);
  });
  const names = Object.keys(groups).sort((a, b) => (!a) - (!b) || a.localeCompare(b));
  box.innerHTML = names.map(g => `
    <div class="dm-cs-group-title">${escapeHtml(labels[g] || 'No faction')}</div>
    ${groups[g].map(n => {
      const [label, color] = ATTITUDES[n.attitude] || ATTITUDES.unknown;
      return `
        <button class="dm-pdx-row${n.id === _selectedId ? ' selected' : ''}" data-npc="${escapeHtml(n.id)}">
          <span class="dm-pdx-thumb dm-npc-thumb" data-img="${escapeHtml(n.image || '')}"></span>
          <span class="dm-pdx-main"><strong>${escapeHtml(n.name || 'Unnamed')}</strong><small>${escapeHtml([n.role, n.location].filter(Boolean).join(' · ') || `Lv ${n.level || 1}`)}</small></span>
          <span class="dm-npc-dot" style="background:${color}" title="${label}"></span>
        </button>`;
    }).join('')}`).join('') || `<div class="dm-hint">${_npcs.length ? 'Nobody matches that.' : 'No NPCs yet. Make one, or import them from the old DM tool.'}</div>`;
  lazySprites(box, { empty: '<span class="dm-npc-emoji">👤</span>' });
}

function select(id) {
  _selectedId = id;
  renderList();
  renderSheet();
}

export function blankNpc() {
  return {
    id: newId('npc'), name: 'New NPC', image: '', role: '', faction: '', attitude: 'neutral', location: '', region: '', species: 'Human',
    age: '', firstMet: '', birthday: null, level: 5, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ac: 10, maxHP: 0, maxVP: 10,
    speed: 30, savingThrows: [], skills: [], trainerPath: '', affinity: '', specialization: '',
    personality: '', ideals: '', bonds: '', flaws: '', mannerisms: '', backstory: '', notes: '',
    features: [], inventory: [], team: [], createdAt: new Date().toISOString(),
  };
}

async function createNpc() {
  const npc = blankNpc();
  _npcs.push(npc);
  await saveNow(npc);
  select(npc.id);
  document.getElementById('npcName')?.select();
}

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

function options(list, selected, { blank = '—' } = {}) {
  const names = list.map(x => (typeof x === 'string' ? x : x.name || x.nationality)).filter(Boolean);
  const has = !selected || names.some(n => n.toLowerCase() === String(selected).toLowerCase());
  return `<option value="">${blank}</option>${!has ? `<option selected>${escapeHtml(selected)}</option>` : ''}${names.map(n => `<option ${String(selected).toLowerCase() === n.toLowerCase() ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}`;
}

function gameList(key) {
  try { return JSON.parse(sessionStorage.getItem(key) || '[]') || []; } catch { return []; }
}

function renderSheet() {
  const box = document.getElementById('npcSheet');
  if (!box) return;
  const n = current();
  if (!n) {
    box.innerHTML = `<div class="dm-cs-empty">${_npcs.length ? 'Pick an NPC on the left.' : 'Make your first NPC with "+ New NPC", or import the ones from the old DM tool.'}</div>`;
    return;
  }
  const scroll = box.scrollTop;
  const text = (f, label, ph = '') => `<div class="dm-field"><label>${label}</label><input class="dm-input" data-f="${f}" value="${escapeHtml(n[f] ?? '')}" placeholder="${escapeHtml(ph)}"></div>`;
  const area = (f, label, rows = 3, ph = '') => `<div class="dm-field"><label>${label}</label><textarea class="dm-input" data-f="${f}" rows="${rows}" placeholder="${escapeHtml(ph)}">${escapeHtml(n[f] ?? '')}</textarea></div>`;
  const known = _portraits.some(p => p.url === n.image);
  const hp = trainerHp(Number(n.level) || 1, Number(n.con) || 10); // what an empty Max HP comes out as
  const back = _fromEncounter ? `
    <div class="dm-npc-fromenc">
      <span>✏️ Changes save to the NPC library for good -- in "${escapeHtml(_fromEncounter)}" and everywhere else ${escapeHtml(n.name || 'this NPC')} is used.</span>
      <button class="dm-btn small primary" id="npcBackToEnc">← Back to the encounter</button>
    </div>` : '';
  box.innerHTML = back + `
    <div class="dm-npc-head">
      <span class="dm-npc-portrait" id="npcPortrait"></span>
      <div class="dm-npc-headmain">
        <input class="dm-input dm-npc-name" id="npcName" data-f="name" value="${escapeHtml(n.name)}" placeholder="Name">
        <div class="dm-row">
          ${text('role', 'Role', 'Ranger, shopkeeper, rival…')}${text('faction', 'Faction', 'SCS, Apex…')}
          <div class="dm-field"><label>Attitude to the party</label><select class="dm-select" data-f="attitude">${Object.entries(ATTITUDES).map(([k, [l]]) => `<option value="${k}" ${n.attitude === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        </div>
        <div class="dm-row">
          <div class="dm-field"><label>Picture</label>
            <div class="dm-npc-picrow">
              <span class="dm-npc-picname" title="${escapeHtml(n.image || '')}">${escapeHtml(!n.image ? 'None' : known ? _portraits.find(p => p.url === n.image).name : 'A picture from a link')}</span>
              <button class="dm-btn" id="npcSelectImage" title="Pick one of the pictures on the Pi -- or upload a new one">🖼 Select image</button>
            </div>
          </div>
          <div class="dm-field" ${n.image && !known ? '' : 'hidden'} id="npcImageUrlBox"><label>Link</label><input class="dm-input" id="npcImageUrl" value="${escapeHtml(n.image && !known ? n.image : '')}" placeholder="https://…"></div>
        </div>
      </div>
      <div class="dm-npc-actions">
        <button class="dm-btn primary" id="npcSaveNow" title="Keeps this NPC in the library, to use again any time (changes also save on their own)">💾 Save</button>
        <button class="dm-btn primary" id="npcToBattle">⚔ Add to the next battle</button>
        <button class="dm-btn" id="npcDuplicate">Duplicate</button>
        <button class="dm-btn danger" id="npcDelete">Delete</button>
      </div>
    </div>

    <div class="dm-npc-grid">
      <div class="dm-pdx-group">
        <div class="dm-pdx-group-head"><span>Who they are</span></div>
        <div class="dm-row">${text('species', 'Species', 'Human')}${text('age', 'Age')}</div>
        <div class="dm-row">
          <div class="dm-field"><label>From</label><select class="dm-select" data-f="region">${options(gameList('nationalities'), n.region)}</select></div>
          ${text('location', 'Where to find them', 'Town, route…')}
        </div>
        <div class="dm-row">
          ${text('firstMet', 'First met', 'Session 4')}
          <div class="dm-field"><label>Birthday</label>
            <div class="dm-row">
              <select class="dm-select" id="npcBdayMonth"><option value="">—</option>${MONTHS.map((m, i) => `<option value="${i + 1}" ${n.birthday?.month === i + 1 ? 'selected' : ''}>${m.common}</option>`).join('')}</select>
              <input class="dm-input" id="npcBdayDay" type="number" min="1" max="28" value="${n.birthday?.day ?? ''}" placeholder="Day" style="max-width:70px">
            </div>
          </div>
        </div>
        ${area('notes', 'DM notes', 3, 'Secrets, plot hooks, what they know…')}
      </div>

      <div class="dm-pdx-group">
        <div class="dm-pdx-group-head"><span>Personality and story</span></div>
        ${area('personality', 'Personality', 2)}
        <div class="dm-row">${area('ideals', 'Ideals', 2)}${area('bonds', 'Bonds', 2)}</div>
        <div class="dm-row">${area('flaws', 'Flaws', 2)}${area('mannerisms', 'Mannerisms', 2)}</div>
        ${area('backstory', 'Backstory', 4)}
      </div>

      <div class="dm-pdx-group">
        <div class="dm-pdx-group-head"><span>In battle</span></div>
        <div class="dm-row">
          <div class="dm-field"><label>Level</label><input class="dm-input" data-f="level" type="number" min="1" max="20" value="${n.level ?? 1}"></div>
          <div class="dm-field"><label>AC</label><input class="dm-input" data-f="ac" type="number" value="${n.ac ?? 10}"></div>
          <div class="dm-field"><label>Max HP</label><input class="dm-input" data-f="maxHP" id="npcMaxHp" type="number" value="${n.maxHP || ''}" placeholder="${hp}"></div>
          <div class="dm-field"><label>Max VP</label><input class="dm-input" data-f="maxVP" type="number" value="${n.maxVP ?? 0}"></div>
          <div class="dm-field"><label>Speed</label><input class="dm-input" data-f="speed" type="number" step="5" value="${n.speed ?? 30}"></div>
        </div>
        <div class="dm-hint">Empty Max HP = worked out from level and CON (<span id="npcHpCalc">${hp}</span>).</div>
        <div class="dm-stat-grid six">
          ${STATS.map(k => `<div class="dm-stat"><label>${k.toUpperCase()} <small id="npcMod-${k}">${sign(abilityMod(n[k]))}</small></label><input class="dm-input" data-f="${k}" type="number" value="${n[k] ?? 10}"></div>`).join('')}
        </div>
        <div class="dm-field"><label>Saving throws</label>${multiSelectHtml('npcSaves', SAVING_THROWS, splitList(n.savingThrows, SAVING_THROWS))}</div>
        <div class="dm-field"><label>Skills</label>${multiSelectHtml('npcSkills', SKILLS, splitList(n.skills, SKILLS))}</div>
        <div class="dm-row">
          <div class="dm-field"><label>Trainer path</label><select class="dm-select" data-f="trainerPath">${options(gameList('trainerPaths'), n.trainerPath)}</select></div>
          <div class="dm-field"><label>Affinity</label><select class="dm-select" data-f="affinity">${options(gameList('affinities'), n.affinity)}</select></div>
        </div>
        ${text('specialization', 'Specializations', 'Bird Keeper, Team Player')}
      </div>

      <div class="dm-pdx-group">
        <div class="dm-pdx-group-head"><span>Features</span><button class="dm-btn small" data-add="features">+ Add</button></div>
        ${(n.features || []).map((f, i) => `
          <div class="dm-npc-listrow">
            <input class="dm-input" data-list="features" data-i="${i}" data-k="name" value="${escapeHtml(f.name || '')}" placeholder="Name">
            <button class="dm-icon-btn" data-remove="features" data-i="${i}" title="Remove">×</button>
            <textarea class="dm-input" data-list="features" data-i="${i}" data-k="description" rows="2" placeholder="What it does, how often">${escapeHtml(f.description || '')}</textarea>
          </div>`).join('') || '<div class="dm-hint">No special features.</div>'}
        <div class="dm-pdx-group-head" style="margin-top:0.8rem"><span>Inventory</span><button class="dm-btn small" data-add="inventory">+ Add</button></div>
        ${(n.inventory || []).map((it, i) => `
          <div class="dm-npc-listrow inv">
            <input class="dm-input" data-list="inventory" data-i="${i}" data-k="name" value="${escapeHtml(it.name || '')}" placeholder="Item" list="npcItemNames">
            <input class="dm-input" data-list="inventory" data-i="${i}" data-k="quantity" type="number" min="0" value="${it.quantity ?? 1}">
            <button class="dm-icon-btn" data-remove="inventory" data-i="${i}" title="Remove">×</button>
            <input class="dm-input" data-list="inventory" data-i="${i}" data-k="description" value="${escapeHtml(it.description || '')}" placeholder="Notes">
          </div>`).join('') || '<div class="dm-hint">Nothing carried.</div>'}
        <datalist id="npcItemNames">${gameList('items').map(i => `<option value="${escapeHtml(i.name)}">`).join('')}</datalist>
      </div>

      <div class="dm-pdx-group dm-npc-team">
        <div class="dm-pdx-group-head"><span>Pokémon team</span></div>
        <div id="npcTeam">${(n.team || []).map((m, i) => teamMemberHtml(m, i)).join('') || '<div class="dm-hint">No Pokémon yet.</div>'}</div>
        <div class="dm-npc-addmon">
          <input class="dm-input" id="npcMonSearch" placeholder="+ Add a Pokémon: type a name…" autocomplete="off">
          <div class="dm-cs-species" id="npcMonResults" hidden></div>
        </div>
      </div>
    </div>`;
  box.scrollTop = scroll;
  patchPortrait(n.image);
  box.querySelectorAll('.dm-npc-team [data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); });
  bindMultiSelects(box);
  wireSheet(box, n);
  (n.team || []).forEach((m, i) => { if (_openMon.has(m.id)) refreshPreview(m, i); });
}

const sign = v => (v >= 0 ? `+${v}` : `${v}`);

function patchPortrait(url) {
  const el = document.getElementById('npcPortrait');
  if (!el) return;
  if (url) patchPortraitMedia(el, url, ''); else el.innerHTML = '<span class="dm-npc-emoji big">👤</span>';
}

function teamMemberHtml(m, i) {
  const s = _species.find(x => x.name.toLowerCase() === String(m.species).toLowerCase()) || { name: m.species, abilities: [] };
  const open = _openMon.has(m.id);
  const stats = m.stats || {};
  return `
    <div class="dm-tmon${open ? ' open' : ''}">
      <button class="dm-tmon-head" data-mon-toggle="${m.id}">
        <span class="dm-party-sprite" data-img="${escapeHtml(s.image || '')}"></span>
        <span class="dm-tmon-main" id="npcMonHead-${m.id}">${monHeaderHtml(m)}</span>
        <span class="dm-tmon-caret">${open ? '▾' : '▸'}</span>
      </button>
      ${open ? `
        <div class="dm-tmon-body">
          <div class="dm-row">
            <div class="dm-field"><label>Nickname</label><input class="dm-input" data-team="${i}" data-k="nickname" value="${escapeHtml(m.nickname || '')}" placeholder="${escapeHtml(s.name)}"></div>
            <div class="dm-field" style="max-width:80px"><label>Level</label><input class="dm-input" data-team="${i}" data-k="level" type="number" min="1" max="20" value="${m.level || 1}"></div>
            <div class="dm-field"><label>Nature</label><select class="dm-select" data-team="${i}" data-k="nature"><option value="">None</option>${natureOptions(m.nature)}</select></div>
          </div>
          <div class="dm-row">
            <div class="dm-field"><label>Held item</label><input class="dm-input" data-team="${i}" data-k="item" value="${escapeHtml(m.item || '')}" list="npcItemNames" placeholder="None"></div>
            <div class="dm-field dm-field-checks"><label class="dm-check"><input type="checkbox" data-team="${i}" data-k="shiny" ${m.shiny ? 'checked' : ''}>Shiny</label></div>
          </div>
          <div class="dm-field"><label>Abilities</label>
            ${(s.abilities || []).map(a => `<label class="dm-check"><input type="checkbox" data-team-ability="${i}" value="${a.slot}" ${(m.abilities || [0]).includes(a.slot) ? 'checked' : ''}>
              <span>${escapeHtml(a.name)} <small>${SLOT_NAMES[a.slot] || ''} -- ${escapeHtml(a.description)}</small></span></label>`).join('') || '<div class="dm-hint">No abilities listed.</div>'}
          </div>
          <div class="dm-field"><label>Stats <small class="dm-label-note">empty = worked out from level and nature</small></label>
            <div class="dm-stat-grid six">${STATS.map(k => `<div class="dm-stat"><label>${k.toUpperCase()}</label><input class="dm-input" data-team-stat="${i}" data-k="${k}" type="number" value="${stats[k] ?? ''}" placeholder="…"></div>`).join('')}</div>
          </div>
          <div class="dm-base-line" id="npcMonPreview-${m.id}">Working out its numbers…</div>
          <div class="dm-field"><label>Notes</label><textarea class="dm-input" data-team="${i}" data-k="notes" rows="2">${escapeHtml(m.notes || '')}</textarea></div>
          <div class="dm-row"><button class="dm-btn small" data-mon-up="${i}" ${i === 0 ? 'disabled' : ''}>↑ Earlier</button><button class="dm-btn small danger" data-mon-remove="${i}">Remove from the team</button></div>
        </div>` : ''}
    </div>`;
}

/** The team member as it'd be built for a battle (DmAPI.buildPokemon, numbers only) -- its HP, VP, AC, stats and moves
 * shown under its settings, and the stat boxes' placeholders. */
async function refreshPreview(m, i) {
  const key = JSON.stringify([m.species, m.level, m.nature, m.abilities, m.stats]);
  let row = _previews.get(key);
  if (!row) {
    try {
      row = (await DmAPI.buildPokemon({ species: m.species, level: m.level || 1, nature: m.nature || '', abilities: m.abilities?.length ? m.abilities : [0], stats: m.stats || null, preview: true })).data;
      _previews.set(key, row);
    } catch (err) {
      const el = document.getElementById(`npcMonPreview-${m.id}`);
      if (el) el.textContent = `Couldn't work its numbers out: ${err.message}`;
      return;
    }
  }
  const el = document.getElementById(`npcMonPreview-${m.id}`);
  if (!el) return;
  const level = Number(m.level) || 1;
  const moves = [1, 2, 6, 10, 14, 18].flatMap(req => (level >= req ? (row.moves || {})[String(req)] || [] : []));
  const score = k => row.stats?.[STAT_NAMES[STATS.indexOf(k)]];
  el.innerHTML = `<strong>HP ${row.combat.maxHP} · VP ${row.combat.maxVP} · AC ${row.combat.ac}</strong> · ${STATS.map(k => `${k.toUpperCase()} ${score(k)}`).join(' · ')} · Skills: ${escapeHtml((row.skills || []).join(', ') || '-')}
    <div class="dm-move-chips" style="margin-top:0.35rem">${moves.map(mv => `<span>${escapeHtml(mv)}</span>`).join('') || '<span class="dm-hint">No moves</span>'}</div>`;
  document.querySelectorAll(`[data-team-stat="${i}"]`).forEach(inp => { inp.placeholder = score(inp.dataset.k) ?? '…'; });
}

/** The sheet's typing and ticking, listened to once on the sheet's box (it outlives every redraw of the sheet). */
function bindSheetFields(box) {
  const changed = (n, redrawList = false) => { scheduleSave(n); if (redrawList) renderList(); };
  box.addEventListener('click', async (e) => {
    if (!e.target.closest('#npcBackToEnc')) return;
    const n = current();
    if (n) await flushSave(n);
    _fromEncounter = null;
    renderSheet();
    window.dispatchEvent(new CustomEvent('dm:open-encounters'));
  });
  box.addEventListener('input', (e) => {
    const n = current();
    const el = e.target;
    if (!n || el.closest('.dm-npc-addmon')) return;
    if (el.dataset.f) {
      n[el.dataset.f] = el.type === 'number' ? (el.value === '' ? 0 : Number(el.value)) : el.value;
      if (el.dataset.f === 'level' || el.dataset.f === 'con') {
        const calc = trainerHp(Number(n.level) || 1, Number(n.con) || 10);
        document.getElementById('npcHpCalc').textContent = calc;
        document.getElementById('npcMaxHp').placeholder = calc;
      }
      if (STATS.includes(el.dataset.f)) {
        const mod = document.getElementById(`npcMod-${el.dataset.f}`);
        if (mod) mod.textContent = sign(abilityMod(el.value));
      }
      changed(n, ['name', 'role', 'location', 'faction', 'level'].includes(el.dataset.f));
    } else if (el.dataset.list) {
      const item = n[el.dataset.list][Number(el.dataset.i)];
      item[el.dataset.k] = el.type === 'number' ? Number(el.value) || 0 : el.value;
      changed(n);
    } else if (el.dataset.team !== undefined && el.type !== 'checkbox' && el.tagName !== 'SELECT') {
      const m = n.team[Number(el.dataset.team)];
      m[el.dataset.k] = el.dataset.k === 'level' ? Math.max(1, Math.min(20, Number(el.value) || 1)) : el.value;
      changed(n);
      refreshMonHeader(m);
      if (el.dataset.k === 'level') schedulePreview(m, Number(el.dataset.team));
    } else if (el.dataset.teamStat !== undefined) {
      const m = n.team[Number(el.dataset.teamStat)];
      m.stats = { ...(m.stats || {}) };
      if (el.value === '') delete m.stats[el.dataset.k]; else m.stats[el.dataset.k] = Number(el.value);
      changed(n);
      schedulePreview(m, Number(el.dataset.teamStat));
    }
  });
  box.addEventListener('change', (e) => {
    const n = current();
    const el = e.target;
    if (!n) return;
    if (el.closest('.dm-multi')) {
      n.savingThrows = readMultiSelect('npcSaves');
      n.skills = readMultiSelect('npcSkills');
      changed(n);
    } else if (el.tagName === 'SELECT' && el.dataset.f) {
      n[el.dataset.f] = el.value;
      changed(n, el.dataset.f === 'attitude');
    } else if (el.dataset.team !== undefined && (el.type === 'checkbox' || el.tagName === 'SELECT')) {
      const m = n.team[Number(el.dataset.team)];
      m[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value;
      changed(n);
      refreshMonHeader(m);
      if (el.dataset.k === 'nature') schedulePreview(m, Number(el.dataset.team));
    } else if (el.dataset.teamAbility !== undefined) {
      const i = Number(el.dataset.teamAbility);
      n.team[i].abilities = [...box.querySelectorAll(`[data-team-ability="${i}"]:checked`)].map(cb => Number(cb.value));
      changed(n);
      schedulePreview(n.team[i], i);
    } else if (el.id === 'npcBdayMonth' || el.id === 'npcBdayDay') {
      const month = Number(document.getElementById('npcBdayMonth').value) || 0;
      const day = Math.max(1, Math.min(28, Number(document.getElementById('npcBdayDay').value) || 1));
      n.birthday = month ? { month, day } : null;
      changed(n);
    } else if (el.id === 'npcImageUrl') {
      n.image = el.value.trim();
      patchPortrait(n.image);
      changed(n, true);
    }
  });
}

/** A file dialog for pictures (`multi`: several) -> `then(files)`. */
function pickPictureFiles(multi, then) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = multi;
  input.addEventListener('change', () => { if (input.files?.length) then([...input.files]); });
  input.click();
}

/** One picture from the DM's computer into the Pi's NPC pictures folder (named `name`), added to the picture list. */
async function uploadOne(file, name) {
  const pic = await DmAPI.uploadNpcImage({ name, data: await prepareImage(file, NPC_PICTURE_SIDE) });
  _portraits = [..._portraits.filter(p => !p.own), pic].sort((a, b) => a.name.localeCompare(b.name))
    .concat(_portraits.filter(p => p.own));
  return pic;
}

/** "Upload NPC pictures" (the user's call, 2026-10-20): several at once, each named after its file -- picked later with
 * Select image. */
async function uploadMany(files) {
  const btn = document.getElementById('npcUploadMany');
  const label = btn?.textContent;
  let done = 0;
  const failed = [];
  for (const file of files) {
    if (btn) btn.textContent = `Uploading ${done + 1} / ${files.length}…`;
    try { await uploadOne(file, file.name.replace(/\.[^.]+$/, '')); done++; } catch (err) { failed.push(`${file.name}: ${err.message}`); }
  }
  if (btn) btn.textContent = label;
  if (failed.length) showCombatAlert(`${done} uploaded. These weren't: ${failed.join(' · ')}`, { title: 'Upload NPC pictures' });
  else toast(`${done} picture${done === 1 ? '' : 's'} on the Pi -- pick them with Select image.`);
}

/** "Select image": every NPC picture on the Pi (and the players' own portraits) with a search -- or None, a link, or
 * Upload image for one that isn't there yet. */
async function selectPicture(n) {
  const items = [
    { key: '__none', label: 'No picture', image: '' },
    { key: '__url', label: 'A picture from a link…', image: '' },
    ..._portraits.map(p => ({ key: p.url, label: p.name, sub: p.own ? "A player's portrait" : '', image: p.url })),
  ];
  const res = await openPicker({
    title: `🖼 A picture for ${n.name || 'the NPC'}`, items, extraAction: { label: '⬆ Upload image' }, imageFallback: 'assets/Pokeball-small.png',
    hint: 'Click one to use it. Not there yet? Upload image puts a new one on the Pi.',
  });
  if (!res) return;
  if (res.extra) {
    pickPictureFiles(false, async ([file]) => {
      try {
        const name = n.name && n.name !== 'New NPC' ? n.name : file.name.replace(/\.[^.]+$/, '');
        setPicture(n, (await uploadOne(file, name)).url);
      } catch (err) { showCombatAlert(err.message, { title: "Couldn't upload the picture" }); }
    });
    return;
  }
  const key = res.keys[0];
  if (key === '__url') {
    const box = document.getElementById('npcImageUrlBox');
    if (box) { box.hidden = false; document.getElementById('npcImageUrl').focus(); }
    return;
  }
  setPicture(n, key === '__none' ? '' : key);
}

function setPicture(n, url) {
  n.image = url;
  scheduleSave(n);
  renderList();
  if (current() === n) renderSheet();
}

/** A team member's header line, redrawn in place as its nickname / level / nature / item / shiny change. */
function monHeaderHtml(m) {
  const s = _species.find(x => x.name.toLowerCase() === String(m.species).toLowerCase()) || { name: m.species };
  return `<strong>${escapeHtml(m.nickname || s.name)}${m.nickname ? ` <small>(${escapeHtml(s.name)})</small>` : ''}${m.shiny ? ' ✨' : ''}</strong>
    <small>${typeBadges(s.type1, s.type2)} Lv ${m.level || 1}${m.nature ? ` · ${escapeHtml(m.nature)}` : ''}${m.item ? ` · holds ${escapeHtml(m.item)}` : ''}</small>`;
}

function refreshMonHeader(m) {
  const el = document.getElementById(`npcMonHead-${m.id}`);
  if (el) el.innerHTML = monHeaderHtml(m);
}

function wireSheet(box, n) {
  const changed = () => scheduleSave(n);
  box.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
    const list = b.dataset.add;
    n[list] = [...(n[list] || []), list === 'inventory' ? { name: '', quantity: 1, description: '' } : { name: '', description: '' }];
    changed();
    renderSheet();
    const rows = document.querySelectorAll(`[data-list="${list}"][data-k="name"]`);
    rows[rows.length - 1]?.focus();
  }));
  box.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => {
    n[b.dataset.remove].splice(Number(b.dataset.i), 1);
    changed();
    renderSheet();
  }));
  box.querySelectorAll('[data-mon-toggle]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.monToggle;
    if (_openMon.has(id)) _openMon.delete(id); else _openMon.add(id);
    renderSheet();
  }));
  box.querySelectorAll('[data-mon-remove]').forEach(b => b.addEventListener('click', async () => {
    const m = n.team[Number(b.dataset.monRemove)];
    if (!await showCombatConfirm(`Take ${m.nickname || m.species} out of ${n.name}'s team?`, { title: 'Remove', yesLabel: 'Remove', noLabel: 'Cancel' })) return;
    n.team.splice(Number(b.dataset.monRemove), 1);
    changed();
    renderSheet();
  }));
  box.querySelectorAll('[data-mon-up]').forEach(b => b.addEventListener('click', () => {
    const i = Number(b.dataset.monUp);
    [n.team[i - 1], n.team[i]] = [n.team[i], n.team[i - 1]];
    changed();
    renderSheet();
  }));

  const search = document.getElementById('npcMonSearch');
  const results = document.getElementById('npcMonResults');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    results.hidden = !q;
    if (!q) return;
    const matches = _species.filter(s => s.name.toLowerCase().includes(q)).slice(0, 12);
    results.innerHTML = matches.map(s => `
      <button type="button" class="dm-species-item" data-add-mon="${escapeHtml(s.name)}">
        <span class="dm-species-thumb" data-img="${escapeHtml(s.image)}"></span>
        <span><span class="dm-species-name">#${escapeHtml(s.dex)} ${escapeHtml(s.name)}</span><span class="dm-species-meta">${typeBadges(s.type1, s.type2)} base Lv ${s.level}</span></span>
      </button>`).join('') || '<div class="dm-species-empty">No Pokémon by that name.</div>';
    results.querySelectorAll('[data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); });
  });
  results.addEventListener('click', (e) => {
    const b = e.target.closest('[data-add-mon]');
    if (!b) return;
    const s = _species.find(x => x.name === b.dataset.addMon);
    const m = { id: newId('mon'), species: s.name, nickname: '', level: Math.max(Number(n.level) || 1, s.level || 1), nature: '', abilities: [0], item: '', shiny: false, notes: '', stats: {} };
    n.team = [...(n.team || []), m];
    _openMon.add(m.id);
    changed();
    renderSheet();
  });

  document.getElementById('npcSaveNow').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    await saveNow(n); // at once, not waiting for the automatic save; says so itself if it fails
    btn.disabled = false;
    if (_saveState === 'saved') toast(`${n.name || 'The NPC'} is saved in the NPC library.`);
  });
  document.getElementById('npcToBattle').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Adding…';
    try {
      await flushSave(n);
      const { pokemon } = await addNpcToSetup(n);
      toast(`${n.name}${pokemon.length ? ` and ${pokemon.length} Pokémon` : ''} added to the next battle -- place them in Map setup.`);
    } catch (err) {
      showCombatAlert(err.message, { title: `Couldn't add ${n.name}` });
    }
    btn.disabled = false;
    btn.textContent = '⚔ Add to the next battle';
  });
  document.getElementById('npcSelectImage').addEventListener('click', () => selectPicture(n));
  document.getElementById('npcDuplicate').addEventListener('click', async () => {
    const copy = { ...JSON.parse(JSON.stringify(n)), id: newId('npc'), name: `${n.name} (copy)`, createdAt: new Date().toISOString() };
    copy.team = (copy.team || []).map(m => ({ ...m, id: newId('mon') }));
    _npcs.push(copy);
    await saveNow(copy);
    select(copy.id);
  });
  document.getElementById('npcDelete').addEventListener('click', async () => {
    if (!await showCombatConfirm(`Delete ${n.name} from the NPC library? This can't be undone.`, { title: 'Delete NPC', yesLabel: 'Delete', noLabel: 'Cancel' })) return;
    clearTimeout(_saveTimers.get(n.id));
    _saveTimers.delete(n.id);
    try {
      _recentSaves.set(n.id, Date.now());
      await DmAPI.deleteNpc(n.id);
      _npcs = _npcs.filter(x => x.id !== n.id);
      _selectedId = null;
      renderList();
      renderSheet();
    } catch (err) {
      showCombatAlert(err.message, { title: "Couldn't delete" });
    }
  });
}

const _previewTimers = new Map();
function schedulePreview(m, i) {
  clearTimeout(_previewTimers.get(m.id));
  _previewTimers.set(m.id, setTimeout(() => refreshPreview(m, i), 350));
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

function setSaveState(state) {
  _saveState = state;
  const pill = document.getElementById('npcSave');
  if (!pill) return;
  pill.className = `dm-pill ${state === 'saved' ? 'ok' : 'todo'}`;
  pill.textContent = state === 'saved' ? 'All saved' : state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved!' : 'Unsaved changes';
}

function scheduleSave(npc) {
  setSaveState('pending');
  clearTimeout(_saveTimers.get(npc.id));
  _saveTimers.set(npc.id, setTimeout(() => saveNow(npc), 700));
}

async function flushSave(npc) {
  if (_saveTimers.has(npc.id)) await saveNow(npc);
}

async function saveNow(npc) {
  clearTimeout(_saveTimers.get(npc.id));
  _saveTimers.delete(npc.id);
  setSaveState('saving');
  try {
    _recentSaves.set(npc.id, Date.now());
    const stored = await DmAPI.saveNpc(npc);
    npc.updatedAt = stored?.updatedAt;
    if (!_saveTimers.size) setSaveState('saved');
  } catch (err) {
    setSaveState('error');
    showCombatAlert(err.message, { title: `Couldn't save ${npc.name}` });
  }
}

/** True while there are changes not yet on the Pi (dm-console.js asks before leaving the page). */
export function npcsHaveUnsaved() {
  return _saveTimers.size > 0 || _saveState === 'saving';
}

/** Another DM tab changed the library: take its copy of everything this tab isn't in the middle of changing. */
async function onPushed(e) {
  const id = e.detail?.id;
  if (id && Date.now() - (_recentSaves.get(id) || 0) < 4000) return;
  let fresh;
  try { fresh = (await DmAPI.npcs()).data || []; } catch { return; }
  _npcs = fresh.map(f => (_saveTimers.has(f.id) ? _npcs.find(x => x.id === f.id) || f : f));
  if (!_root || !document.getElementById('npcList')) return;
  renderList();
  const typing = document.activeElement && document.getElementById('npcSheet')?.contains(document.activeElement);
  if (!typing && (!id || id === _selectedId)) renderSheet();
}

// ---------------------------------------------------------------------------
// Import from the old DM tool (its trainer backup: shima-trainers-....json -- the NPCs are the ones marked isNPC)
// ---------------------------------------------------------------------------

const clean = v => (v === undefined || v === null || v === 'undefined' ? '' : String(v));
const squash = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

/** "ace_trainer" -> the game data's "Ace Trainer" (or "Ace Trainer" made up when it isn't there). */
function matchName(value, list) {
  const v = clean(value);
  if (!v) return '';
  const hit = list.map(x => x.name || x.nationality || x).find(n => squash(n) === squash(v));
  return hit || v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** The old DM tool's picture for an NPC -- a character picture's name (or its old address in Benjakronk's repo) --
 * as the same picture on the Pi ('' when the Pi doesn't have it). Any other web address is kept. */
function resolveOldPicture(key) {
  if (!key) return '';
  const fromRepo = /githubusercontent\.com\/Benjakronk\//.test(key);
  if (/^https?:/.test(key) && !fromRepo) return key;
  let stem = String(key).split(/[?#]/)[0].split('/').pop().replace(/\.[^.]+$/, '');
  try { stem = decodeURIComponent(stem); } catch (e) { /* as it is */ }
  const squashed = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ''); // "Nurse_Joy" finds nurse-joy.png
  return _portraits.find(p => !p.own && squashed(p.file || p.name) === squashed(stem))?.url || '';
}

function convertOld(t, image) {
  const natures = gameList('natures');
  const slots = { primary: 0, secondary: 1, hidden: 2 };
  const npc = {
    ...blankNpc(),
    name: clean(t.name) || 'Unnamed', image, role: clean(t.role), faction: clean(t.faction), location: clean(t.location),
    attitude: ATTITUDES[clean(t.attitude).toLowerCase()] ? clean(t.attitude).toLowerCase() : 'unknown',
    region: matchName(t.nationality, gameList('nationalities')), species: clean(t.species) || 'Human', age: clean(t.age),
    firstMet: clean(t.firstMet), birthday: t.birthday?.month ? { month: Number(t.birthday.month), day: Number(t.birthday.day) || 1 } : null,
    // 8 HP is the old tool's level-1 default, left on NPCs whose HP was never filled in (level 10s too) -- so it counts
    // as not set, and the HP is worked out from level and CON instead.
    level: Number(t.level) || 1, ac: Number(t.ac) || 10, maxHP: Number(t.hp) && Number(t.hp) !== 8 ? Number(t.hp) : 0,
    maxVP: Number(t.vp) || blankNpc().maxVP, speed: Number(t.speed) || 30,
    str: Number(t.strength) || 10, dex: Number(t.dexterity) || 10, con: Number(t.constitution) || 10,
    int: Number(t.intelligence) || 10, wis: Number(t.wisdom) || 10, cha: Number(t.charisma) || 10,
    savingThrows: splitList(clean(t.savingThrows), SAVING_THROWS), skills: splitList(clean(t.skills), SKILLS),
    trainerPath: matchName(t.trainerPath, gameList('trainerPaths')),
    affinity: [t.affinity, t.secondaryAffinity].filter(v => clean(v)).map(v => matchName(v, gameList('affinities'))).join(' / '),
    specialization: (Array.isArray(t.specializations) ? t.specializations : [t.specializations]).filter(v => clean(v)).map(v => matchName(v, gameList('specializations'))).join(', '),
    personality: clean(t.personalityTraits), ideals: clean(t.ideals), bonds: clean(t.bonds), flaws: clean(t.flaws), mannerisms: clean(t.mannerisms),
    backstory: clean(t.backstory),
    notes: [clean(t.notes), clean(t.proficiencies) && `Proficiencies: ${clean(t.proficiencies)}`, clean(t.toolsWeapons) && `Tools / weapons: ${clean(t.toolsWeapons)}`].filter(Boolean).join('\n'),
    features: (t.customFeatures || []).map(f => ({ name: clean(f.name), description: [clean(f.description), f.isResource && f.usesMod ? `(uses: ${f.usesMod} mod${f.reset ? `, back after each ${f.reset}` : ''})` : ''].filter(Boolean).join(' ') })),
    inventory: (t.inventory || []).map(i => ({ name: clean(i.name), quantity: Number(i.quantity) || 1, description: clean(i.description) })),
  };
  npc.team = (t.pokemon || []).filter(p => clean(p.name)).map((p) => {
    const statsIn = { str: p.strength, dex: p.dexterity, con: p.constitution, int: p.intelligence, wis: p.wisdom, cha: p.charisma };
    const typed = Object.values(statsIn).some(v => Number(v) && Number(v) !== 10); // all 10 / blank = never filled in there
    const disabled = new Set((p.disabledAbilities || []).map(d => slots[d]));
    const species = _species.find(s => s.name.toLowerCase() === clean(p.name).toLowerCase());
    return {
      id: newId('mon'), species: species?.name || clean(p.name), nickname: clean(p.nickname), level: Number(p.level) || 1,
      nature: natures.find(nt => nt.name.toLowerCase() === clean(p.nature).toLowerCase())?.name || '',
      abilities: (species?.abilities || [{ slot: 0 }]).map(a => a.slot).filter(sl => !disabled.has(sl)),
      item: (p.heldItems || []).map(h => clean(h.name)).filter(Boolean).join(', '), shiny: !!p.shiny,
      notes: [clean(p.notes), (p.customMoves || []).length ? `Extra moves: ${p.customMoves.map(mv => clean(mv.name)).join(', ')}` : ''].filter(Boolean).join('\n'),
      stats: typed ? Object.fromEntries(Object.entries(statsIn).filter(([, v]) => Number(v)).map(([k, v]) => [k, Number(v)])) : {},
    };
  });
  return npc;
}

async function importOldTool(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch {
    showCombatAlert("That file isn't a backup from the old DM tool.", { title: 'Import' });
    return;
  }
  const all = Array.isArray(data) ? data : (data.trainers || []);
  const npcs = all.filter(t => t && t.isNPC);
  if (!npcs.length) {
    showCombatAlert('No NPCs in that file -- pick the trainer backup the old DM tool saved (shima-trainers-….json).', { title: 'Import' });
    return;
  }
  const have = new Set(_npcs.map(n => String(n.name).toLowerCase()));
  const fresh = npcs.filter(t => !have.has(clean(t.name).toLowerCase()));
  if (!fresh.length) { toast(`All ${npcs.length} NPCs in that file are already here.`); return; }
  const skipped = npcs.length - fresh.length;
  if (!await showCombatConfirm(`Import ${fresh.length} NPC${fresh.length === 1 ? '' : 's'}: ${fresh.map(t => clean(t.name)).join(', ')}?${skipped ? ` (${skipped} already here -- left as they are.)` : ''}`,
    { title: 'Import from the old DM tool', yesLabel: 'Import', noLabel: 'Cancel' })) return;
  setSaveState('saving');
  let done = 0;
  for (const t of fresh) {
    try {
      const npc = convertOld(t, await resolveOldPicture(clean(t.image)));
      _recentSaves.set(npc.id, Date.now());
      await DmAPI.saveNpc(npc);
      _npcs.push(npc);
      done++;
    } catch (err) {
      showCombatAlert(err.message, { title: `Couldn't import ${clean(t.name)}` });
    }
  }
  setSaveState('saved');
  _npcs.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  renderList();
  toast(`Imported ${done} NPC${done === 1 ? '' : 's'}.`);
}
