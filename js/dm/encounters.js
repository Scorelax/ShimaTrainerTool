// DM console -- the battle module's Encounter setup and Post battle tabs: Benjakronk's old encounter builder, rebuilt on
// the Pi.
//
// Library: encounters prepared ahead of a session (dm_encounters table) -- a name, the wild Pokemon (each with a nature,
// its abilities and any stat bonuses -- the ⚙ panel), NPC trainers from the NPC library, round-based events, and notes
// and note categories (under the encounter list on the left). The map, its terrain and weather are Map setup's. The old
// tool's random encounter / random trainer generators, saved-Pokemon library (Wild Pokémon's 📚 Add saved Pokémon -- a
// list of its own under the encounters until 2026-11-11) and exclusion list are here too. "Put in play" makes it the next battle: its Pokemon and NPC trainers go into the battle setup
// (setup-store.js), where Map setup places everyone and starts the battle; the encounter becomes the one in play
// ('encounter-run'), whose events and capture helper show beside the running battle (battle-live.js). Until the battle
// starts, the next battle follows the encounter in play as it's changed (syncInPlay) -- whoever keeps their entry keeps
// their spot on the map.
//
// Who's in the next battle is decided here and only here (Map setup doesn't add anyone), so the two never disagree.
//
// Since the 2026-10-16 playtest it's a builder that never starts anything by itself: it's reachable while a battle runs
// (the running battle's third tab, battle-live.js), an encounter can carry its own map (the adventure's "Start
// encounter" makes one with the adventure's map), each wild Pokemon's ℹ️ shows everything its species is known for
// (species-info.js), and an encounter's NPC opens in the NPC module to change it for good.
//
// 2026-11-13 (the user's call): Encounter setup is the battle module's first tab and only about the encounter -- who's in
// it. Its map card (make / edit a map here, copy Map setup's, a saved one) is gone: the map is made in Map setup. An
// encounter that brings its own map says so in its header (✕ takes it off). Map setup's Import is gone too -- "Use for
// the next battle" here does it. The adventure's "Start encounter" puts its new encounter in play at once
// (startEncounterFromAdventure).
//
// The encounter list has folders (the user's call, 2026-11-11 -- the way the Display module's backgrounds do): [{id, name,
// parent}] in dm_state 'encounter-folders', an encounter keeps its folder's id (`folder`, '' = the top). Drag an
// encounter (or a folder) onto a folder or a step of the path, or use 📁 Move to… on the open one. Folder mode unticked:
// every encounter in one list. The first time, "Planned encounters" and "Archived encounters" are made, and the ones
// marked finished before (the old "Finished encounters" box, 2026-10-27) go into Archived.
//
// Post battle: after a PvE battle ends (routes_combat._remember_battle keeps it as 'last-battle'), what happened -- who
// was defeated, caught or got away, each fighter's 💥 impact -- and what to hand out. ✓ Finish battle takes its encounter
// out of play and keeps it among the Previous battles (dm_battles). Unlike the old tool, which exported files or called the
// Trainer Tool's API, everything goes straight into the trainers' records here: caught Pokemon into their team, loot
// and money into their inventory, all live-pushed to their phones. XP is DM-only (xp.js -- on the records, never in what
// the players' app gets); the old tool's XP can be imported from its trainer backup.
import { DmAPI, CombatAPI } from '../api.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import { escapeHtml, typeBadges, getSpecies, newId, toast, natureOptions, openDmModal, participantFromPokemon } from './dm-common.js';
import { getSetup, updateSetup, flushSetup } from './setup-store.js';
import { buildPokemonCreature, addNpcToSetup } from './creature-setup.js';
import { getClock, updateClock, advanceMinutes, skipToPhase, rollWeather, formatDate, formatTime, phaseName, PHASES, WEATHER } from './world-clock.js';
import {
  levelFromXp, ROUND_SECONDS, ENCOUNTER_TEMPLATES, TRAINER_ARCHETYPES, STAT_METHODS,
  encounterPool, generateEncounter, generateTrainer, rangePick, evolutionStage, STAGE_LABEL,
} from './encounter-rules.js';
import { xpOrStart } from './xp.js';
import { openSpeciesInfo } from './species-info.js';
import { openNpcFromEncounter } from './npcs.js';

const SLOT_NAMES = ['Primary', 'Secondary', 'Hidden'];
const EVENT_ICONS = ['⚡', '🎯', '⚠️', '💥', '🔥', '❄️', '🌊', '🌪️', '⏰', '🚪', '👥', '🎭', '🏚️', '🌋'];
const TRIGGERS = { recurring: '♻️ Every round', countdown: '⏱️ Countdown', once: '1️⃣ Once (you trigger it)' };
const TYPES = ['Normal', 'Fire', 'Water', 'Grass', 'Electric', 'Ice', 'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy', 'Cosmic'];
const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gigantic'];

let _root = null;
let _tab = 'library'; // 'library' | 'aftermath'
let _encounters = [];
let _selectedId = null;
let _species = [];
let _npcs = [];
let _exclusions = [];
let _saved = [];
let _runId = null; // the encounter in play (the next battle)
let _runLinked = false; // put in play since the next battle follows it (older runs were a one-off copy)
const _saveTimers = new Map();
let _saveState = 'saved';
let _adding = false; // the species search under "Wild Pokémon" is open
const _customizing = new Set(); // wild Pokemon whose ⚙ panel (abilities, stat bonuses) is open
const _calc = new Map(); // wild Pokemon id -> {sig, values}: its numbers at its level and nature, before any bonus
// The stat bonuses a wild Pokemon can get on top of what its level and nature give (build-pokemon's `bonus`).
const BONUS_KEYS = [['str', 'STR'], ['dex', 'DEX'], ['con', 'CON'], ['int', 'INT'], ['wis', 'WIS'], ['cha', 'CHA'], ['ac', 'AC'], ['maxHP', 'Max HP'], ['maxVP', 'Max VP']];
// The encounter list's folders (see the top): the folders, the one open, and Folder mode (remembered on this computer).
const FOLDERS_KEY = 'encounter-folders';
const FOLDER_MODE_KEY = 'dm-enc-folder-mode';
let _folders = [];
let _folder = '';
let _folderShown = false; // the open encounter's folder opened once (when the tab is first drawn)
let _folderMode = (() => { try { return localStorage.getItem(FOLDER_MODE_KEY) !== 'off'; } catch { return true; } })();

/** One of the battle module's tabs (dm-console.js draws the tabs): `tab` 'library' (Encounter setup) or 'aftermath'
 * (Post battle). */
export async function renderEncounters(root, { tab } = {}) {
  _root = root;
  if (tab) _tab = tab;
  root.innerHTML = '<div class="dm-enc"><div class="dm-enc-body" id="encBody"><div class="dm-loading">Loading…</div></div></div>';
  renderTab();
}

export function encountersHaveUnsaved() {
  return _saveTimers.size > 0 || _saveState === 'saving';
}

function renderTab() {
  const body = document.getElementById('encBody');
  if (!body) return;
  if (_tab === 'aftermath') renderAftermath(body); else renderLibrary(body);
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

function blankEncounter() {
  return {
    id: newId('enc'), name: 'New encounter', notes: '', noteCategories: [],
    pokemon: [], npcs: [], events: [], map: null, createdAt: new Date().toISOString(),
  };
}

/** The library and everything it uses, fresh from the Pi. */
async function loadLibraryData() {
  await settleFromLibrary().catch(() => {}); // (a finished battle's encounter isn't in play -- see settleLastBattle)
  const [encs, species, npcs, excl, saved, run, folders] = await Promise.all([
    DmAPI.encounters(), getSpecies(), DmAPI.npcs(), DmAPI.getState('encounter-exclusions'), DmAPI.getState('saved-pokemon'), DmAPI.getState('encounter-run'),
    DmAPI.getState(FOLDERS_KEY).catch(() => undefined), // (undefined: couldn't read them -- null: never made)
  ]);
  // An encounter being changed here keeps this tab's copy (its save may not be on the Pi yet).
  _encounters = (encs.data || []).map(e => (_saveTimers.has(e.id) ? _encounters.find(x => x.id === e.id) || e : e));
  _species = species;
  _npcs = npcs.data || [];
  _exclusions = Array.isArray(excl) ? excl : [];
  _saved = Array.isArray(saved) ? saved : [];
  _runId = run?.encounterId || null;
  _runLinked = !!run?.linked;
  _folders = (Array.isArray(folders) ? folders : []).filter(f => f && f.id)
    .map(f => ({ id: f.id, name: String(f.name || 'Folder'), parent: f.parent || '' }));
  if (folders === null) await firstFolders();
}

/** The first time: "Planned encounters" and "Archived encounters", and the encounters marked finished before folders
 * came into Archived. */
async function firstFolders() {
  const planned = { id: newId('efold'), name: 'Planned encounters', parent: '' };
  const archived = { id: newId('efold'), name: 'Archived encounters', parent: '' };
  try { await DmAPI.saveState(FOLDERS_KEY, [planned, archived]); } catch { return; } // (tried again next time)
  _folders = [planned, archived];
  _encounters.filter(e => e.finished).forEach((e) => {
    e.folder = archived.id;
    delete e.finished;
    delete e.finishedAt;
    saveNow(e);
  });
}

function saveFolders() {
  return DmAPI.saveState(FOLDERS_KEY, _folders).catch(err => showCombatAlert(err.message, { title: 'Folders' }));
}

/** The folder `id` and the ones above it, top first. */
function folderPath(id) {
  const path = [];
  const seen = new Set();
  for (let f = _folders.find(x => x.id === id); f && !seen.has(f.id); f = _folders.find(x => x.id === f.parent)) {
    seen.add(f.id);
    path.unshift(f);
  }
  return path;
}

const folderLabel = id => folderPath(id).map(f => f.name).join(' › ');

// The Pokedex module's "not possible to encounter randomly" box changes the same exclusion list.
window.addEventListener('dm:exclusions-changed', (e) => {
  _exclusions = Array.isArray(e.detail) ? e.detail : _exclusions;
  const b = document.getElementById('encExclusions');
  if (b) b.textContent = `🚫 Exclusions (${_exclusions.length})`;
});

// ShimAI (assistant.js) saved a new encounter: the list fetched again and redrawn -- the open encounter, the search
// and changes not yet saved stay as they are (ShimAI only ever adds an encounter).
window.addEventListener('dm:encounters-changed', async () => {
  let encs;
  try { encs = await DmAPI.encounters(); } catch { return; } // (it's there the next time the tab opens)
  _encounters = (encs.data || []).map(e => (_saveTimers.has(e.id) ? _encounters.find(x => x.id === e.id) || e : e));
  if (_tab === 'library' && document.getElementById('encList')) renderList();
});

async function renderLibrary(body) {
  body.innerHTML = '<div class="dm-loading">Loading the encounters…</div>';
  try {
    await loadLibraryData();
  } catch (err) {
    body.innerHTML = `<div class="dm-loading">Couldn't load the encounters: ${escapeHtml(err.message)}</div>`;
    return;
  }
  if (_tab !== 'library' || !body.isConnected) return;   // (drawn again meanwhile: that one carries on)
  // Opens on the encounter in play, unless another one was picked.
  if (!_encounters.some(e => e.id === _selectedId)) _selectedId = _encounters.some(e => e.id === _runId) ? _runId : null;
  // The first time it's drawn, the open encounter's folder is the one open.
  if (!_folderShown) { _folderShown = true; _folder = current()?.folder || ''; }
  body.innerHTML = `
    <div class="dm-editor dm-enc-editor">
      <aside class="dm-editor-tools">
        <div class="dm-editor-head"><h2>Encounter setup</h2><span class="dm-pill ok" id="encSave">All saved</span></div>
        <button class="dm-btn primary wide" id="encNew">+ New encounter</button>
        <input class="dm-input" id="encSearch" placeholder="Search encounters…" autocomplete="off">
        <div class="dm-enc-listbar">
          <label class="dm-check" title="Ticked: the folders, and the encounters in the one open. Unticked: every encounter in one list.">
            <input type="checkbox" id="encFolderMode" ${_folderMode ? 'checked' : ''}><span>Folder mode</span></label>
          <button class="dm-btn small" id="encNewFolder" title="A new folder, in the one open" ${_folderMode ? '' : 'hidden'}>＋ Folder</button>
        </div>
        <div class="dm-enc-list" id="encList"></div>
        <div class="dm-enc-notesbox" id="encNotes"></div>
        <div class="dm-editor-foot">
          <button class="dm-btn small" id="encExclusions">🚫 Exclusions (${_exclusions.length})</button>
        </div>
      </aside>
      <section class="dm-editor-canvas" id="encSheet"></section>
    </div>`;
  renderList();
  renderSheet();
  bindSheet();
  document.getElementById('encSearch').addEventListener('input', renderList);
  const list = document.getElementById('encList');
  list.addEventListener('click', (e) => {
    const act = e.target.closest('[data-folder-act]');
    if (act) { folderAction(act.dataset.folderAct, _folders.find(f => f.id === act.closest('[data-folder]')?.dataset.folder)); return; }
    const open = e.target.closest('[data-open-folder]');
    if (open) { _folder = open.dataset.openFolder; renderList(); return; }
    const row = e.target.closest('[data-enc]');
    if (row) { _selectedId = row.dataset.enc; _adding = false; renderList(); renderSheet(); }
  });
  wireListDrag(list);
  document.getElementById('encFolderMode').addEventListener('change', (e) => {
    _folderMode = e.target.checked;
    try { localStorage.setItem(FOLDER_MODE_KEY, _folderMode ? 'on' : 'off'); } catch { /* not remembered */ }
    document.getElementById('encNewFolder').hidden = !_folderMode;
    renderList();
  });
  document.getElementById('encNewFolder').addEventListener('click', newFolder);
  document.getElementById('encNew').addEventListener('click', () => {
    const enc = blankEncounter();
    if (_folderMode) enc.folder = _folder; // (in the folder open)
    _encounters.unshift(enc);
    _selectedId = enc.id;
    saveNow(enc);
    renderList();
    renderSheet();
    document.getElementById('encName')?.select();
  });
  document.getElementById('encExclusions').addEventListener('click', editExclusions);
}

function current() {
  return _encounters.find(e => e.id === _selectedId) || null;
}

function summary(enc) {
  const parts = [];
  if (enc.pokemon.length) parts.push(`${enc.pokemon.length} Pokémon`);
  if (enc.npcs.length) parts.push(`${enc.npcs.length} NPC${enc.npcs.length === 1 ? '' : 's'}`);
  if (enc.events.length) parts.push(`${enc.events.length} event${enc.events.length === 1 ? '' : 's'}`);
  return parts.join(' · ') || 'Empty';
}

function renderList() {
  const box = document.getElementById('encList');
  if (!box) return;
  const q = (document.getElementById('encSearch')?.value || '').trim().toLowerCase();
  if (_folder && !_folders.some(f => f.id === _folder)) _folder = '';
  // Searching looks in every folder, and so does Folder mode unticked; otherwise the folder open: its folders, then its
  // encounters.
  const every = !!q || !_folderMode;
  const known = id => !!id && _folders.some(f => f.id === id); // (an encounter whose folder is gone: at the top)
  const list = _encounters.filter(e => (q ? e.name.toLowerCase().includes(q) : every || (known(e.folder) ? e.folder : '') === _folder));
  const subs = every ? [] : _folders.filter(f => f.parent === _folder).sort((a, b) => a.name.localeCompare(b.name));
  const inside = f => _encounters.filter(e => e.folder === f.id).length + _folders.filter(x => x.parent === f.id).length;
  const row = e => `
    <div class="dm-enc-row${e.id === _selectedId ? ' selected' : ''}" data-enc="${escapeHtml(e.id)}" draggable="true" role="button" tabindex="0" title="Open it -- or drag it onto a folder">
      <strong>${escapeHtml(e.name || 'Unnamed')}${e.id === _runId ? ' <span class="dm-enc-live" title="The next battle">● in play</span>' : ''}</strong>
      <small>${escapeHtml(summary(e))}${every && known(e.folder) ? ` · 📁 ${escapeHtml(folderLabel(e.folder))}` : ''}</small>
    </div>`;
  const crumbs = every
    ? (q ? '<div class="dm-enc-crumbs"><span class="dm-hint">Searching every folder</span></div>' : '')
    : `<div class="dm-enc-crumbs">
        <button class="dm-enc-crumb${_folder ? '' : ' here'}" data-open-folder="" data-drop-folder="">⚔️ All encounters</button>
        ${folderPath(_folder).map(f => `<span>›</span><button class="dm-enc-crumb${f.id === _folder ? ' here' : ''}" data-open-folder="${escapeHtml(f.id)}" data-drop-folder="${escapeHtml(f.id)}">📁 ${escapeHtml(f.name)}</button>`).join('')}
      </div>`;
  const empty = !_encounters.length ? 'No encounters yet -- make one with "+ New encounter", or save the next battle as one.'
    : q ? 'No encounter matches that.'
    : 'Nothing in this folder yet -- drag encounters onto it, or use 📁 Move to… on one.';
  box.innerHTML = crumbs
    + subs.map(f => `
      <div class="dm-enc-folder" data-folder="${escapeHtml(f.id)}" data-open-folder="${escapeHtml(f.id)}" data-drop-folder="${escapeHtml(f.id)}" draggable="true" role="button" tabindex="0" title="Open it -- or drag encounters onto it">
        <span class="dm-enc-folder-icon">📁</span>
        <span class="dm-enc-folder-name"><strong>${escapeHtml(f.name)}</strong><small>${inside(f)} inside</small></span>
        <button class="dm-icon-btn" data-folder-act="rename" title="Rename">✎</button>
        <button class="dm-icon-btn danger" data-folder-act="delete" title="Delete the folder (what's in it moves up)">✕</button>
      </div>`).join('')
    + (list.length ? list.map(row).join('') : subs.length ? '' : `<div class="dm-hint">${empty}</div>`);
}

/** Drag an encounter (or a folder) onto a folder or a step of the path to move it there. */
function wireListDrag(box) {
  const TYPE = 'application/x-dm-encounter';
  box.addEventListener('dragstart', (e) => {
    const row = e.target.closest?.('[data-enc], [data-folder]');
    if (!row) return;
    e.dataTransfer.setData(TYPE, JSON.stringify(row.dataset.enc ? { enc: row.dataset.enc } : { folder: row.dataset.folder }));
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  box.addEventListener('dragend', () => box.querySelectorAll('.dragging, .drop-here').forEach(el => el.classList.remove('dragging', 'drop-here')));
  box.addEventListener('dragover', (e) => {
    const target = e.target.closest?.('[data-drop-folder]');
    if (!target || ![...e.dataTransfer.types].includes(TYPE)) return;
    e.preventDefault();
    box.querySelectorAll('.drop-here').forEach((el) => { if (el !== target) el.classList.remove('drop-here'); });
    target.classList.add('drop-here');
  });
  box.addEventListener('dragleave', (e) => {
    const target = e.target.closest?.('[data-drop-folder]');
    if (target && !target.contains(e.relatedTarget)) target.classList.remove('drop-here');
  });
  box.addEventListener('drop', (e) => {
    const target = e.target.closest?.('[data-drop-folder]');
    const raw = e.dataTransfer.getData(TYPE);
    if (!target || !raw) return;
    e.preventDefault();
    const into = target.dataset.dropFolder;
    const what = JSON.parse(raw);
    if (what.enc) { moveEncounter(_encounters.find(x => x.id === what.enc), into); return; }
    const f = _folders.find(x => x.id === what.folder);
    if (!f || f.id === into || folderPath(into).some(x => x.id === f.id)) return; // never into itself
    f.parent = into;
    saveFolders();
    renderList();
  });
}

function moveEncounter(enc, into) {
  if (!enc || (enc.folder || '') === into) return;
  enc.folder = into;
  saveNow(enc);
  renderList();
  if (enc.id === _selectedId) renderSheet();
}

async function askName(title, start = '') {
  let typed = start;
  const answer = await openDmModal({
    title,
    html: `<input class="dm-input" id="encFolderName" value="${escapeHtml(start)}" maxlength="60" placeholder="Name">`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save', kind: 'primary', value: 'save' }],
    onOpen: (body, close) => {
      const input = body.querySelector('#encFolderName');
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
  _folders.push({ id: newId('efold'), name, parent: _folder });
  await saveFolders();
  renderList();
}

/** A folder's ✎ / ✕. Deleted, what's in it -- encounters and folders -- moves up into the folder it was in. */
async function folderAction(act, f) {
  if (!f) return;
  if (act === 'rename') {
    const name = await askName('Rename the folder', f.name);
    if (!name || name === f.name) return;
    f.name = name;
  } else if (act === 'delete') {
    const encs = _encounters.filter(e => e.folder === f.id);
    const subs = _folders.filter(x => x.parent === f.id);
    const what = encs.length || subs.length ? ` Its ${[encs.length && `${encs.length} encounter${encs.length === 1 ? '' : 's'}`, subs.length && `${subs.length} folder${subs.length === 1 ? '' : 's'}`].filter(Boolean).join(' and ')} move up a level -- nothing is deleted.` : '';
    if (!await showCombatConfirm(`Delete the folder "${f.name}"?${what}`, { title: 'Delete folder', yesLabel: 'Delete', noLabel: 'Cancel' })) return;
    encs.forEach((e) => { e.folder = f.parent || ''; saveNow(e); });
    subs.forEach((x) => { x.parent = f.parent || ''; });
    _folders = _folders.filter(x => x.id !== f.id);
    if (_folder === f.id) _folder = f.parent || '';
  } else return;
  await saveFolders();
  renderList();
  renderSheet();
}

/** Every folder as a tree -> the one picked ('' = the top), or null. */
async function pickFolder(title, here) {
  const rows = [];
  const walk = (parent, depth) => _folders.filter(f => f.parent === parent).sort((a, b) => a.name.localeCompare(b.name))
    .forEach((f) => { rows.push({ f, depth }); walk(f.id, depth + 1); });
  walk('', 1);
  const into = await openDmModal({
    title,
    html: `<div class="dm-disp-movelist">
      <button class="dm-species-item${here ? '' : ' selected'}" data-into=""><span class="dm-species-name">⚔️ All encounters <small>(no folder)</small></span></button>
      ${rows.map(({ f, depth }) => `<button class="dm-species-item${f.id === here ? ' selected' : ''}" data-into="${escapeHtml(f.id)}" style="padding-left:${0.6 + depth}rem"><span class="dm-species-name">📁 ${escapeHtml(f.name)}</span></button>`).join('')}
    </div>${rows.length ? '' : '<div class="dm-hint">No folders yet -- make one with ＋ Folder.</div>'}`,
    buttons: [{ label: 'Cancel', value: null }],
    onOpen: (body, close) => body.addEventListener('click', (ev) => { const b = ev.target.closest('[data-into]'); if (b) close(b.dataset.into); }),
  });
  return into === null || into === undefined ? null : into;
}

function npcById(id) {
  return _npcs.find(n => n.id === id) || null;
}

function speciesByName(name) {
  return _species.find(s => s.name === name) || null;
}

function renderSheet() {
  const box = document.getElementById('encSheet');
  if (!box) return;
  const enc = current();
  renderNotes(enc);
  if (!enc) {
    box.innerHTML = `<div class="dm-cs-empty">${_encounters.length ? 'Pick an encounter on the left.' : 'No encounters yet.'}</div>`;
    return;
  }
  // Every wild Pokemon has a nature -- older ones without get a random one, like new ones do.
  if (enc.pokemon.some(p => !p.nature)) {
    enc.pokemon.forEach((p) => { if (!p.nature) p.nature = randomNature(); });
    scheduleSave(enc);
  }
  box.innerHTML = `
    <div class="dm-enc-head">
      <div class="dm-enc-titlebox">
        <input class="dm-input dm-enc-name" id="encName" data-f="name" value="${escapeHtml(enc.name)}" placeholder="Encounter name">
        ${(enc.folder && _folders.some(f => f.id === enc.folder)) || enc.map ? `<div class="dm-enc-pills">
          ${enc.folder && _folders.some(f => f.id === enc.folder) ? `<span class="dm-pill ok" title="The folder it's in">📁 ${escapeHtml(folderLabel(enc.folder))}</span>` : ''}
          ${enc.map ? `<span class="dm-pill ok dm-enc-ownmap" title="Put in play, this map (${enc.map.rows} × ${enc.map.cols} squares) becomes Map setup's -- change it there">🗺️ Brings its own map
            <button class="dm-pill-x" data-act="map-del" title="Take its map off -- the battle uses whatever map is in Map setup">✕</button></span>` : ''}
        </div>` : ''}
      </div>
      <div class="dm-enc-actions">
        <button class="dm-btn" id="encMove" title="Put it in a folder (or drag it onto one on the left)">📁 Move to…</button>
        <button class="dm-btn" id="encSaveBtn" title="Save it on the Pi now (it also saves on its own a moment after each change)">💾 Save encounter</button>
        ${enc.id === _runId
          ? '<span class="dm-enc-live dm-enc-inplay" title="This is the next battle -- changes here go straight into it">● In play</span><button class="dm-btn primary" id="encPlace">📍 Place on the map</button>'
          : `<button class="dm-btn primary" id="encLoad" title="Make this the next battle${enc.map ? ' (its creatures and its own map)' : ''} -- then place everyone in Map setup">▶ Use for the next battle</button>`}
        <button class="dm-btn" id="encDup">Duplicate</button>
        <button class="dm-btn danger" id="encDel">Delete</button>
      </div>
    </div>
    <div class="dm-enc-grid">
      <div class="dm-card dm-enc-wide">
        <div class="dm-card-title"><span>Wild Pokémon (${enc.pokemon.length})</span>
          <span class="dm-row dm-enc-titlebtns">
            <button class="dm-btn small" data-act="mon-add">🔍 Add</button>
            <button class="dm-btn small" data-act="mon-random">🎲 Random</button>
            <button class="dm-btn small" data-act="mon-saved" title="Pokémon kept with 💾 Save, for any encounter">📚 Add saved Pokémon${_saved.length ? ` (${_saved.length})` : ''}</button>
          </span></div>
        ${_adding ? `<div class="dm-enc-add"><input class="dm-input" id="encMonSearch" placeholder="Search name, type or habitat…" autocomplete="off"><div class="dm-cs-species dm-enc-results" id="encMonResults"></div></div>` : ''}
        <div class="dm-enc-mons">${enc.pokemon.length ? enc.pokemon.map(monRowHtml).join('') : '<div class="dm-hint">No wild Pokémon yet.</div>'}</div>
      </div>

      <div class="dm-card">
        <div class="dm-card-title"><span>NPC trainers (${enc.npcs.length})</span>
          <span class="dm-row dm-enc-titlebtns">
            <button class="dm-btn small" data-act="npc-add">👤 From the library</button>
            <button class="dm-btn small" data-act="npc-random">🎲 Random trainer</button>
          </span></div>
        <div class="dm-enc-npcs">${enc.npcs.length ? enc.npcs.map((id) => {
          const n = npcById(id);
          return `<div class="dm-enc-npc" data-npc="${escapeHtml(id)}">
            <span class="dm-enc-thumb" data-img="${escapeHtml(n?.image || '')}"></span>
            <span><strong>${escapeHtml(n?.name || 'Deleted NPC')}</strong><small>${n ? `Lv ${n.level || 1} · ${(n.team || []).filter(t => t.species).map(t => escapeHtml(`${t.nickname || t.species} ${t.level}`)).join(', ') || 'no Pokémon'}` : 'No longer in the NPC library'}</small></span>
            ${n ? '<button class="dm-icon-btn" data-act="npc-edit" title="Change this NPC in the NPC library (for good -- everywhere it\'s used)">✏️</button>' : ''}
            <button class="dm-icon-btn danger" data-act="npc-del" title="Take out of this encounter">✕</button>
          </div>`;
        }).join('') : '<div class="dm-hint">No NPC trainers. Their Pokémon come with them.</div>'}</div>
      </div>

      <div class="dm-card">
        <div class="dm-card-title"><span>⚡ Events (${enc.events.length})</span><button class="dm-btn small" data-act="evt-add">+ Event</button></div>
        <div class="dm-hint" style="margin-bottom:0.5rem">Shown beside the running battle, with a reminder when one is due (reinforcements, a collapsing cave, a timer…).</div>
        ${enc.events.map(evtHtml).join('') || '<div class="dm-hint">No events.</div>'}
      </div>
    </div>`;
  box.querySelectorAll('[data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); else el.innerHTML = '<span class="dm-npc-emoji">👤</span>'; });
  if (_adding) { renderMonResults(); document.getElementById('encMonSearch')?.focus(); }
  enc.pokemon.filter(p => _customizing.has(p.id)).forEach(loadCalc);
  document.getElementById('encLoad')?.addEventListener('click', () => loadIntoSetup(enc));
  document.getElementById('encMove').addEventListener('click', async () => {
    const into = await pickFolder(`📁 Move "${enc.name}" to…`, enc.folder || '');
    if (into === null) return;
    moveEncounter(enc, into);
    toast(`"${enc.name}" moved to ${into ? folderLabel(into) : 'All encounters'}.`);
  });
  document.getElementById('encSaveBtn')?.addEventListener('click', async () => {
    await saveNow(enc); // says so itself if it couldn't
    if (_saveState !== 'error') toast(`"${enc.name}" saved.`);
  });
  document.getElementById('encPlace')?.addEventListener('click', async () => {
    await flushEncounter(enc);
    await _syncing;
    window.dispatchEvent(new CustomEvent('dm:show-module', { detail: { name: 'battle' } }));
  });
  document.getElementById('encDup').addEventListener('click', () => {
    const copy = { ...JSON.parse(JSON.stringify(enc)), id: newId('enc'), name: `${enc.name} (copy)`, createdAt: new Date().toISOString() };
    _encounters.unshift(copy);
    _selectedId = copy.id;
    saveNow(copy);
    renderList();
    renderSheet();
  });
  document.getElementById('encDel').addEventListener('click', async () => {
    if (!await showCombatConfirm(`Delete "${enc.name}"? This can't be undone.`, { title: 'Delete encounter', yesLabel: 'Delete', noLabel: 'Cancel' })) return;
    clearTimeout(_saveTimers.get(enc.id));
    _saveTimers.delete(enc.id);
    try { await DmAPI.deleteEncounter(enc.id); } catch (err) { showCombatAlert(err.message, { title: 'Delete encounter' }); return; }
    _encounters = _encounters.filter(e => e.id !== enc.id);
    _selectedId = null;
    renderList();
    renderSheet();
  });
}

/** The open encounter's notes, at the bottom of the left column. */
function renderNotes(enc) {
  const box = document.getElementById('encNotes');
  if (!box) return;
  box.innerHTML = !enc ? '' : `
        <div class="dm-card-title">📝 Notes</div>
        <textarea class="dm-input" data-f="notes" rows="4" placeholder="Pre-encounter notes, special rules, reminders…">${escapeHtml(enc.notes || '')}</textarea>
        <div class="dm-enc-cats">
          ${enc.noteCategories.map(c => `
            <div class="dm-enc-cat" data-cat="${escapeHtml(c.id)}">
              <div class="dm-row">
                <input class="dm-input dm-enc-icon" data-k="icon" value="${escapeHtml(c.icon || '📝')}" maxlength="4">
                <input class="dm-input" data-k="name" value="${escapeHtml(c.name)}" placeholder="Category (e.g. Loot, Tactics, Lore)">
                <button class="dm-icon-btn danger" data-act="cat-del" title="Remove">✕</button>
              </div>
              <textarea class="dm-input" data-k="content" rows="2" placeholder="Notes…">${escapeHtml(c.content || '')}</textarea>
            </div>`).join('')}
        </div>
        <button class="dm-btn small" data-act="cat-add">+ Note category</button>
`;
}

function abilityNames(p, sp) {
  const chosen = p.abilities?.length ? p.abilities : [0];
  return (sp?.abilities || []).filter(a => chosen.includes(a.slot)).map(a => a.name).join(', ') || 'No ability';
}

function monRowHtml(p) {
  const sp = speciesByName(p.species);
  const open = _customizing.has(p.id);
  const bonuses = BONUS_KEYS.filter(([k]) => Number(p.bonus?.[k])).map(([k, l]) => `${l} ${Number(p.bonus[k]) > 0 ? '+' : ''}${p.bonus[k]}`);
  return `
    <div class="dm-enc-mon${open ? ' open' : ''}" data-mon="${escapeHtml(p.id)}">
      <span class="dm-enc-thumb" data-img="${escapeHtml(sp?.image || '')}"></span>
      <div class="dm-enc-mon-main">
        <div class="dm-enc-mon-top">
          <input class="dm-input" data-k="name" value="${escapeHtml(p.name || p.species)}" title="Name in the battle">
          <span class="dm-enc-species">${escapeHtml(p.species)} ${sp ? typeBadges(sp.type1, sp.type2) : ''}</span>
        </div>
        <div class="dm-enc-mon-fields">
          <label>Lv <input class="dm-input" data-k="level" type="number" min="1" max="20" value="${p.level}"></label>
          <select class="dm-select" data-k="nature">${natureOptions(p.nature)}</select>
          <input class="dm-input" data-k="item" value="${escapeHtml(p.item || '')}" placeholder="Held item" list="encItems">
        </div>
        <div class="dm-enc-mon-sum">
          <span data-sum="abil">✦ ${escapeHtml(abilityNames(p, sp))}</span>
          <label title="Shiny"><input type="checkbox" data-k="shiny" ${p.shiny ? 'checked' : ''}>✨ Shiny</label>
          <label title="Starts hidden -- only you see it until it's shown (see-through on the map, or joining later if not placed)"><input type="checkbox" data-k="heldBack" ${p.heldBack ? 'checked' : ''}>Hidden</label>
          ${bonuses.length ? `<span class="dm-enc-bonus-sum">${escapeHtml(bonuses.join(' · '))}</span>` : ''}
        </div>
      </div>
      <div class="dm-enc-mon-btns">
        <div class="dm-enc-mon-grid">
          <button class="dm-btn small" data-act="mon-info" title="Everything about the species -- behaviour, habitat, senses, how to catch it">ℹ️ Info</button>
          <button class="dm-btn small${open ? ' primary' : ''}" data-act="mon-more" title="Abilities and stat bonuses">⚙ Customize</button>
          <button class="dm-btn small" data-act="mon-save" title="Keep it for other encounters (📚 Add saved Pokémon)">💾 Save</button>
          <button class="dm-btn small" data-act="mon-dup" title="One more of these">⧉ Duplicate</button>
        </div>
        <button class="dm-btn small danger dm-enc-mon-del" data-act="mon-del" title="Take it out of this encounter">✕ Remove</button>
      </div>
      ${open ? `
      <div class="dm-enc-more">
        <div>
          <div class="dm-enc-more-title">Abilities</div>
          ${(sp?.abilities || []).map(a => `
            <label class="dm-check"><input type="checkbox" data-abil="${a.slot}" ${(p.abilities?.length ? p.abilities : [0]).includes(a.slot) ? 'checked' : ''}>
              <span>${escapeHtml(a.name)} <small>${SLOT_NAMES[a.slot] || ''} -- ${escapeHtml(a.description)}</small></span></label>`).join('') || '<div class="dm-hint">No abilities listed.</div>'}
        </div>
        <div>
          <div class="dm-enc-more-title">Stat bonuses <small>on top of what its level and nature give</small></div>
          <div class="dm-enc-bonus">
            ${BONUS_KEYS.map(([k, l]) => `
              <label class="dm-enc-bonus-cell"><span>${l}</span>
                <input class="dm-input" type="number" data-bonus="${k}" value="${Number(p.bonus?.[k]) || ''}" placeholder="+0">
                <small data-calc="${k}">…</small></label>`).join('')}
          </div>
          <button class="dm-btn small" data-act="bonus-reset" ${bonuses.length ? '' : 'disabled'}>↺ No bonuses</button>
        </div>
      </div>` : ''}
    </div>`;
}

/** Works out the Pokemon's numbers at its level and nature (a preview build -- nothing saved) for its ⚙ panel. */
async function loadCalc(p) {
  const sig = JSON.stringify([p.species, p.level, p.nature, p.abilities, p.stats]);
  let c = _calc.get(p.id);
  if (!c || c.sig !== sig) {
    c = { sig, values: null };
    _calc.set(p.id, c);
    try {
      const res = await DmAPI.buildPokemon({ ...monConfig(p), bonus: null, species: p.species, preview: true });
      c.values = participantFromPokemon(res.data).participant;
    } catch (err) {
      c.values = {};
    }
  }
  showCalc(p);
}

function showCalc(p) {
  const row = document.querySelector(`#encSheet [data-mon="${CSS.escape(p.id)}"]`);
  const v = _calc.get(p.id)?.values;
  if (!row || !v) return;
  BONUS_KEYS.forEach(([k]) => {
    const el = row.querySelector(`[data-calc="${k}"]`);
    if (!el) return;
    const base = Number(v[k]);
    const b = Number(p.bonus?.[k]) || 0;
    el.textContent = !Number.isFinite(base) ? '?' : b ? `${base} → ${base + b}` : `${base}`;
    el.classList.toggle('changed', !!b);
  });
}

function evtHtml(ev) {
  return `
    <div class="dm-enc-evt" data-evt="${escapeHtml(ev.id)}">
      <div class="dm-row">
        <select class="dm-select dm-enc-icon" data-k="icon">${EVENT_ICONS.map(i => `<option ${i === ev.icon ? 'selected' : ''}>${i}</option>`).join('')}</select>
        <input class="dm-input" data-k="name" value="${escapeHtml(ev.name)}" placeholder="Event name (e.g. Reinforcements arrive)">
        <button class="dm-icon-btn danger" data-act="evt-del" title="Remove">✕</button>
      </div>
      <textarea class="dm-input" data-k="description" rows="2" placeholder="What happens…">${escapeHtml(ev.description || '')}</textarea>
      <div class="dm-row dm-enc-evt-opts">
        <select class="dm-select" data-k="trigger">${Object.entries(TRIGGERS).map(([k, l]) => `<option value="${k}" ${k === ev.trigger ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label ${ev.trigger === 'countdown' ? '' : 'hidden'}>after <input class="dm-input" data-k="countdown" type="number" min="1" value="${ev.countdown || 3}"> rounds</label>
        <label ${ev.trigger === 'countdown' ? '' : 'hidden'}>from round <input class="dm-input" data-k="startRound" type="number" min="1" value="${ev.startRound || 1}"></label>
        <label><input type="checkbox" data-k="notify" ${ev.notify !== false ? 'checked' : ''}> Remind me</label>
      </div>
      <div class="dm-enc-stages">
        ${(ev.stages || []).map((st, i) => `
          <div class="dm-enc-stage" data-stage="${i}">
            <span class="dm-enc-stage-n">${i + 1}</span>
            <input class="dm-input" data-sk="name" value="${escapeHtml(st.name)}" placeholder="Stage name">
            <input class="dm-input" data-sk="description" value="${escapeHtml(st.description || '')}" placeholder="What happens at this stage">
            <button class="dm-icon-btn danger" data-act="stage-del" title="Remove stage">✕</button>
          </div>`).join('')}
        <button class="dm-btn small" data-act="stage-add">+ Stage <span class="dm-label-note">(e.g. a collapsing building)</span></button>
      </div>
    </div>`;
}

/** One set of listeners on the sheet for every field (it's redrawn, they stay). */
function bindSheet() {
  const sheet = document.getElementById('encSheet');
  if (!document.getElementById('encItems')) {
    const items = JSON.parse(sessionStorage.getItem('items') || '[]');
    sheet.insertAdjacentHTML('afterend', `<datalist id="encItems">${items.map(i => `<option value="${escapeHtml(i.name)}">`).join('')}</datalist>`);
  }
  const onField = (e) => {
    const enc = current();
    const t = e.target;
    if (!enc || !t.matches('input, select, textarea')) return;
    const val = t.type === 'checkbox' ? t.checked : t.type === 'number' ? (t.value === '' ? null : Number(t.value)) : t.value;
    if (t.dataset.f) {
      enc[t.dataset.f] = val;
      if (t.dataset.f === 'name') renderList();
    } else if (t.closest('[data-mon]')) {
      const p = enc.pokemon.find(x => x.id === t.closest('[data-mon]').dataset.mon);
      if (!p) return;
      const row = t.closest('[data-mon]');
      if (t.dataset.abil !== undefined) {
        p.abilities = [...row.querySelectorAll('[data-abil]:checked')].map(x => Number(x.dataset.abil));
        const sum = row.querySelector('[data-sum="abil"]');
        if (sum) sum.textContent = `✦ ${abilityNames(p, speciesByName(p.species))}`;
      } else if (t.dataset.bonus) {
        p.bonus = { ...(p.bonus || {}), [t.dataset.bonus]: Number(val) || 0 };
        Object.keys(p.bonus).forEach((k) => { if (!p.bonus[k]) delete p.bonus[k]; });
        showCalc(p);
      } else if (t.dataset.k === 'level') p.level = Math.max(1, Math.min(20, val || 1));
      else p[t.dataset.k] = val;
      if (e.type === 'change' && _customizing.has(p.id) && ['level', 'nature'].includes(t.dataset.k)) loadCalc(p);
    } else if (t.closest('[data-evt]')) {
      const ev = enc.events.find(x => x.id === t.closest('[data-evt]').dataset.evt);
      if (!ev) return;
      const stage = t.closest('[data-stage]');
      if (stage) ev.stages[Number(stage.dataset.stage)][t.dataset.sk] = val;
      else {
        ev[t.dataset.k] = val;
        if (t.dataset.k === 'trigger' && e.type === 'change') renderSheet();
      }
    } else if (t.closest('[data-cat]')) {
      const c = enc.noteCategories.find(x => x.id === t.closest('[data-cat]').dataset.cat);
      if (c) c[t.dataset.k] = val;
    } else return;
    scheduleSave(enc);
  };
  // The notes sit under the list on the left, outside the sheet -- the same listeners.
  [sheet, document.getElementById('encNotes')].forEach((el) => {
    el.addEventListener('input', onField);
    el.addEventListener('change', onField);
    el.addEventListener('click', onAction);
  });
}

async function onAction(e) {
  const btn = e.target.closest('[data-act]');
  const enc = current();
  if (!btn || !enc) return;
  const act = btn.dataset.act;
  const monId = btn.closest('[data-mon]')?.dataset.mon;
  const evtId = btn.closest('[data-evt]')?.dataset.evt;
  const changed = () => { scheduleSave(enc); renderSheet(); renderList(); };
  if (act === 'mon-add') { _adding = !_adding; renderSheet(); return; }
  if (act === 'mon-more') { if (!_customizing.delete(monId)) _customizing.add(monId); renderSheet(); return; }
  if (act === 'bonus-reset') { enc.pokemon.find(x => x.id === monId).bonus = {}; changed(); return; }
  if (act === 'mon-random') { randomEncounterDialog(enc); return; }
  if (act === 'mon-saved') { savedPokemonDialog(enc); return; }
  if (act === 'mon-del') { enc.pokemon = enc.pokemon.filter(p => p.id !== monId); relabel(enc); changed(); return; }
  if (act === 'mon-dup') {
    const p = enc.pokemon.find(x => x.id === monId);
    enc.pokemon.splice(enc.pokemon.indexOf(p) + 1, 0, { ...JSON.parse(JSON.stringify(p)), id: newId('mon'), nature: randomNature() });
    relabel(enc);
    changed();
    return;
  }
  if (act === 'mon-save') { saveToLibrary(enc.pokemon.find(x => x.id === monId)); return; }
  if (act === 'mon-info') { openSpeciesInfo(enc.pokemon.find(x => x.id === monId).species); return; }
  if (act === 'npc-edit') {
    await flushEncounter(enc);
    openNpcFromEncounter(btn.closest('[data-npc]').dataset.npc, enc.name);
    return;
  }
  if (act === 'map-del') {
    if (!await showCombatConfirm(`Take its own map off "${enc.name}"? Put in play, it then uses whatever map is in Map setup.`, { title: 'Map', yesLabel: 'Take it off', noLabel: 'Cancel' })) return;
    enc.map = null;
    changed();
    return;
  }
  if (act === 'npc-add') { pickNpc(enc); return; }
  if (act === 'npc-random') { randomTrainerDialog(enc); return; }
  if (act === 'npc-del') { enc.npcs = enc.npcs.filter(id => id !== btn.closest('[data-npc]').dataset.npc); changed(); return; }
  if (act === 'evt-add') {
    enc.events.push({ id: newId('evt'), name: '', icon: '⚡', description: '', trigger: 'countdown', countdown: 3, startRound: 1, notify: true, stages: [] });
    changed();
    return;
  }
  if (act === 'evt-del') { enc.events = enc.events.filter(x => x.id !== evtId); changed(); return; }
  if (act === 'stage-add') { const ev = enc.events.find(x => x.id === evtId); ev.stages = ev.stages || []; ev.stages.push({ name: `Stage ${ev.stages.length + 1}`, description: '' }); changed(); return; }
  if (act === 'stage-del') { const ev = enc.events.find(x => x.id === evtId); ev.stages.splice(Number(btn.closest('[data-stage]').dataset.stage), 1); changed(); return; }
  if (act === 'cat-add') { enc.noteCategories.push({ id: newId('cat'), icon: '📝', name: '', content: '' }); changed(); return; }
  if (act === 'cat-del') { enc.noteCategories = enc.noteCategories.filter(c => c.id !== btn.closest('[data-cat]').dataset.cat); changed(); }
}

// ---- Wild Pokémon ----

function renderMonResults() {
  const box = document.getElementById('encMonResults');
  const input = document.getElementById('encMonSearch');
  if (!box || !input) return;
  if (!input.dataset.bound) {
    input.dataset.bound = '1';
    input.addEventListener('input', renderMonResults);
    box.addEventListener('click', (e) => {
      const item = e.target.closest('[data-species]');
      const enc = current();
      if (!item || !enc) return;
      const sp = speciesByName(item.dataset.species);
      enc.pokemon.push(newMon(sp.name, sp.level || 1));
      relabel(enc);
      scheduleSave(enc);
      renderSheet();
      renderList();
    });
  }
  const q = input.value.trim().toLowerCase();
  const matches = _species.filter(s => !q || s.name.toLowerCase().includes(q) || String(s.type1).toLowerCase() === q
    || String(s.type2).toLowerCase() === q || String(s.habitat).toLowerCase().includes(q)).slice(0, 40);
  box.innerHTML = matches.map(s => `
    <button type="button" class="dm-species-item" data-species="${escapeHtml(s.name)}">
      <span class="dm-species-thumb" data-img="${escapeHtml(s.image)}"></span>
      <span><span class="dm-species-name">#${escapeHtml(s.dex)} ${escapeHtml(s.name)}</span>
        <span class="dm-species-meta">${typeBadges(s.type1, s.type2)} base level ${s.level}${s.habitat ? ` · ${escapeHtml(s.habitat)}` : ''}</span></span>
    </button>`).join('') || '<div class="dm-species-empty">No Pokémon match that.</div>';
  box.querySelectorAll('[data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); });
}

function newMon(species, level, extra = {}) {
  const mon = { id: newId('mon'), species, name: species, level, abilities: [0], item: '', shiny: false, heldBack: false, ...extra };
  if (!mon.nature) mon.nature = randomNature();
  return mon;
}

/** Every wild Pokemon gets one -- the DM changes it if they want another. */
function randomNature() {
  const natures = JSON.parse(sessionStorage.getItem('natures') || '[]');
  return natures.length ? natures[Math.floor(Math.random() * natures.length)].name : '';
}

/** "Zubat A", "Zubat B" for species that appear more than once (a name the DM typed is left alone). */
function relabel(enc) {
  const counts = {};
  enc.pokemon.forEach(p => { counts[p.species] = (counts[p.species] || 0) + 1; });
  const seen = {};
  enc.pokemon.forEach((p) => {
    const auto = p.name === p.species || new RegExp(`^${p.species.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} [A-Z]$`).test(p.name);
    if (!auto) return;
    if (counts[p.species] > 1) { seen[p.species] = (seen[p.species] || 0) + 1; p.name = `${p.species} ${String.fromCharCode(64 + seen[p.species])}`; } else p.name = p.species;
  });
}

// ---- Saved Pokémon library ----

async function saveToLibrary(p) {
  if (!p) return;
  const entry = { ...JSON.parse(JSON.stringify(p)), id: newId('saved') };
  delete entry.heldBack;
  _saved.push(entry);
  try { await DmAPI.saveState('saved-pokemon', _saved); } catch (err) { showCombatAlert(err.message, { title: 'Save Pokémon' }); return; }
  toast(`${p.name} saved -- add it to any encounter with 📚 Add saved Pokémon.`);
  if (current()) renderSheet(); // (the count on the button)
}

/** Wild Pokémon's 📚 Add saved Pokémon: the saved-Pokemon library in a popup -- ＋ Add puts one in `enc` (the popup stays
 * open to add more), ✕ deletes it from the library. */
async function savedPokemonDialog(enc) {
  const draw = (box) => {
    const q = (box.querySelector('#savedSearch')?.value || '').trim().toLowerCase();
    const list = box.querySelector('#savedList');
    const shown = _saved.filter(sv => !q || `${sv.name} ${sv.species}`.toLowerCase().includes(q));
    list.innerHTML = shown.length ? shown.map(sv => `
      <div class="dm-enc-savedrow" data-saved="${escapeHtml(sv.id)}">
        <span class="dm-enc-thumb" data-img="${escapeHtml(speciesByName(sv.species)?.image || '')}"></span>
        <span><strong>${escapeHtml(sv.name)}</strong><small>${escapeHtml(sv.species)} · Lv ${sv.level}${sv.nature ? ` · ${escapeHtml(sv.nature)}` : ''}${sv.item ? ` · holds ${escapeHtml(sv.item)}` : ''}${sv.shiny ? ' · ✨' : ''}</small></span>
        <button class="dm-btn small primary" data-saved-act="use" title="Add to ${escapeHtml(enc.name)}">＋ Add</button>
        <button class="dm-icon-btn danger" data-saved-act="drop" title="Delete from the saved Pokémon">✕</button>
      </div>`).join('')
      : `<div class="dm-hint">${_saved.length ? 'None match that.' : 'Nothing saved yet -- use 💾 Save on a wild Pokémon to keep it here for other encounters.'}</div>`;
    list.querySelectorAll('[data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); });
  };
  await openDmModal({
    title: `📚 Saved Pokémon → ${enc.name}`,
    html: `<input class="dm-input" id="savedSearch" placeholder="Search…" autocomplete="off" style="margin-bottom:0.5rem">
      <div class="dm-enc-saved dm-enc-saveddlg" id="savedList"></div>`,
    buttons: [{ label: 'Done', value: null }],
    onOpen: (body) => {
      draw(body);
      body.querySelector('#savedSearch').addEventListener('input', () => draw(body));
      body.addEventListener('click', async (e) => {
        const act = e.target.closest('[data-saved-act]')?.dataset.savedAct;
        const sv = _saved.find(x => x.id === e.target.closest('[data-saved]')?.dataset.saved);
        if (!act || !sv) return;
        if (act === 'use') {
          enc.pokemon.push({ ...JSON.parse(JSON.stringify(sv)), id: newId('mon'), heldBack: false, nature: sv.nature || randomNature() });
          relabel(enc);
          scheduleSave(enc);
          if (enc === current()) renderSheet();
          renderList();
          toast(`${sv.name} added to "${enc.name}".`);
          return;
        }
        if (!await showCombatConfirm(`Delete ${sv.name} from the saved Pokémon?`, { title: 'Saved Pokémon', yesLabel: 'Delete', noLabel: 'Cancel' })) return;
        _saved = _saved.filter(x => x !== sv);
        await DmAPI.saveState('saved-pokemon', _saved).catch(err => showCombatAlert(err.message, { title: 'Saved Pokémon' }));
        draw(body);
        if (enc === current()) renderSheet();
      });
    },
  });
}

// ---- Exclusions (left out of the random generators) ----

async function editExclusions() {
  const out = new Set(_exclusions.map(n => n.toLowerCase()));
  await openDmModal({
    title: 'Left out of the random generators',
    wide: true,
    html: `<div class="dm-hint">Ticked Pokémon never come up in a random encounter or a random trainer's team (unless "include left-out ones" is ticked there) -- legendaries, story Pokémon…</div>
      <input class="dm-input" id="exclSearch" placeholder="Search…" autocomplete="off" style="margin:0.6rem 0">
      <div class="dm-enc-excl" id="exclList">${_species.map(s => `<label data-name="${escapeHtml(s.name.toLowerCase())}"><input type="checkbox" value="${escapeHtml(s.name)}" ${out.has(s.name.toLowerCase()) ? 'checked' : ''}>${escapeHtml(s.name)}</label>`).join('')}</div>`,
    buttons: [{ label: 'Cancel', value: null }, {
      label: 'Save', kind: 'primary', keepOpen: true,
      onClick: async (body) => {
        _exclusions = [...body.querySelectorAll('#exclList input:checked')].map(i => i.value);
        try { await DmAPI.saveState('encounter-exclusions', _exclusions); } catch (err) { showCombatAlert(err.message, { title: 'Exclusions' }); return false; }
        window.dispatchEvent(new CustomEvent('dm:exclusions-changed', { detail: _exclusions })); // the Pokedex module's box follows
        const b = document.getElementById('encExclusions');
        if (b) b.textContent = `🚫 Exclusions (${_exclusions.length})`;
        return true;
      },
    }],
    onOpen: (body) => {
      body.querySelector('#exclSearch').addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        body.querySelectorAll('#exclList label').forEach(l => { l.hidden = !!q && !l.dataset.name.includes(q); });
      });
    },
  });
}

// ---- Random encounter ----

function optionList(values, selected, blank) {
  return `<option value="">${blank}</option>${values.map(v => `<option ${v === selected ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('')}`;
}

function distinct(key) {
  return [...new Set(_species.map(s => s[key]).filter(Boolean))].sort();
}

async function randomEncounterDialog(enc) {
  let selected = []; // [{name, quantity}] for "Selected species"
  const read = (body) => {
    const v = id => body.querySelector(`#${id}`)?.value;
    return {
      count: Number(v('reCount')) || 3, minLevel: Number(v('reMin')) || 1, maxLevel: Number(v('reMax')) || 1,
      levelMode: v('reLevelMode'), speciesMode: v('reSpeciesMode'), selected, includeEvolutions: body.querySelector('#reEvos').checked,
      stage: v('reStage'), habitat: v('reHabitat'), rarity: v('reRarity'), behavior: v('reBehavior'), size: v('reSize'), activity: v('reActivity'),
      types: [...body.querySelectorAll('#reTypes input:checked')].map(i => i.value),
      autoLabels: body.querySelector('#reLabels').checked, includeExcluded: body.querySelector('#reExcluded').checked,
    };
  };
  await openDmModal({
    title: 'Random encounter', wide: true,
    html: `
      <div class="dm-enc-templates" id="reTemplates">${Object.entries(ENCOUNTER_TEMPLATES).map(([k, t]) => `<button class="dm-btn small${k === 'custom' ? ' active' : ''}" data-tpl="${k}" title="${escapeHtml(t.description)}">${escapeHtml(t.name)}</button>`).join('')}</div>
      <div class="dm-enc-gen">
        <div>
          <div class="dm-card-title">Encounter</div>
          <div class="dm-row">
            <div class="dm-field"><label>How many</label><input class="dm-input" id="reCount" type="number" min="1" max="12" value="3"></div>
            <div class="dm-field"><label>Min level</label><input class="dm-input" id="reMin" type="number" min="1" max="20" value="1"></div>
            <div class="dm-field"><label>Max level</label><input class="dm-input" id="reMax" type="number" min="1" max="20" value="5"></div>
          </div>
          <div class="dm-field"><label>Levels</label><select class="dm-select" id="reLevelMode">
            <option value="uniform">Random in the range</option><option value="identical">All the same level</option>
            <option value="ascending">Ascending (weak → strong)</option><option value="leader">A leader + the rest lower</option></select></div>
          <div class="dm-field"><label>Species</label><select class="dm-select" id="reSpeciesMode">
            <option value="random">Any (repeats allowed)</option><option value="unique">All different</option><option value="same">All the same (a swarm)</option>
            <option value="evolutionLine">One evolution line</option><option value="selected">The species I pick</option></select></div>
          <div id="reSelectedBox" hidden>
            <input class="dm-input" id="reSelSearch" placeholder="Search to add a species…" autocomplete="off">
            <div class="dm-enc-selresults" id="reSelResults"></div>
            <div id="reSelList"></div>
          </div>
          <label class="dm-check"><input type="checkbox" id="reEvos">Spread over their evolution lines</label>
          <label class="dm-check"><input type="checkbox" id="reLabels" checked>Letter the duplicates (A, B, C…)</label>
        </div>
        <div>
          <div class="dm-card-title">Filters</div>
          <div class="dm-field"><label>Evolution stage</label><select class="dm-select" id="reStage">
            <option value="">Any stage</option><option value="basic">Basic only</option><option value="stage1">Middle stage only</option>
            <option value="final">Final evolutions only</option><option value="evolved">Any evolved</option></select></div>
          <div class="dm-field"><label>Habitat</label><select class="dm-select" id="reHabitat">${optionList(distinct('habitat'), '', 'Any habitat')}</select></div>
          <div class="dm-field"><label>Types (any of)</label><div class="dm-enc-types" id="reTypes">${TYPES.map(t => `<label><input type="checkbox" value="${t}">${t}</label>`).join('')}</div></div>
        </div>
        <div>
          <div class="dm-card-title">More filters</div>
          <div class="dm-field"><label>Rarity</label><select class="dm-select" id="reRarity">${optionList(distinct('rarity'), '', 'Any rarity')}</select></div>
          <div class="dm-field"><label>Behaviour</label><select class="dm-select" id="reBehavior">${optionList(distinct('behavior'), '', 'Any behaviour')}</select></div>
          <div class="dm-field"><label>Size</label><select class="dm-select" id="reSize">${optionList(SIZES, '', 'Any size')}</select></div>
          <div class="dm-field"><label>Active</label><select class="dm-select" id="reActivity">${optionList(distinct('activity'), '', 'Any time')}</select></div>
          <label class="dm-check"><input type="checkbox" id="reExcluded">Include left-out ones (${_exclusions.length})</label>
        </div>
      </div>
      <div class="dm-enc-pool" id="rePool"></div>`,
    buttons: [{ label: 'Cancel', value: null }, {
      label: 'Generate and add', kind: 'primary', keepOpen: true,
      onClick: (body) => {
        const o = read(body);
        let made;
        try { made = generateEncounter(_species, o, _exclusions); } catch (err) { showCombatAlert(err.message, { title: 'Random encounter' }); return false; }
        made.forEach(m => enc.pokemon.push(newMon(m.species, m.level, { name: m.name })));
        relabel(enc);
        scheduleSave(enc);
        renderSheet();
        renderList();
        toast(`Added ${made.length} Pokémon: ${[...new Set(made.map(m => m.species))].join(', ')}`);
        return true;
      },
    }],
    onOpen: (body) => {
      const pool = () => {
        const o = read(body);
        const el = body.querySelector('#rePool');
        if (o.speciesMode === 'selected') { el.textContent = `${selected.reduce((a, s) => a + s.quantity, 0)} picked`; return; }
        const list = encounterPool(_species, o, _exclusions);
        el.className = `dm-enc-pool ${list.length ? (list.length < 5 ? 'few' : 'ok') : 'none'}`;
        el.innerHTML = `<strong>${list.length}</strong> Pokémon match the filters${list.length ? `: ${list.slice(0, 18).map(s => `${escapeHtml(s.name)} <small>(${STAGE_LABEL[evolutionStage(s)]})</small>`).join(', ')}${list.length > 18 ? ` … and ${list.length - 18} more` : ''}` : ''}`;
      };
      const renderSel = () => {
        body.querySelector('#reSelList').innerHTML = selected.map((s, i) => `
          <div class="dm-enc-selrow" data-i="${i}"><span>${escapeHtml(s.name)}</span>
            <input class="dm-input" type="number" min="1" max="12" value="${s.quantity}" data-q><button class="dm-icon-btn danger" data-rm>✕</button></div>`).join('') || '<div class="dm-hint">None picked yet.</div>';
        body.querySelector('#reCount').value = selected.reduce((a, s) => a + s.quantity, 0) || 1;
        pool();
      };
      body.addEventListener('input', pool);
      body.addEventListener('change', (e) => {
        if (e.target.id === 'reSpeciesMode') { body.querySelector('#reSelectedBox').hidden = e.target.value !== 'selected'; renderSel(); }
        if (e.target.matches('[data-q]')) { selected[Number(e.target.closest('[data-i]').dataset.i)].quantity = Math.max(1, Number(e.target.value) || 1); renderSel(); }
        pool();
      });
      body.querySelector('#reSelSearch').addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        body.querySelector('#reSelResults').innerHTML = q.length < 2 ? '' : _species.filter(s => s.name.toLowerCase().includes(q)).slice(0, 8)
          .map(s => `<button class="dm-btn small" data-add="${escapeHtml(s.name)}">${escapeHtml(s.name)}</button>`).join('');
      });
      body.addEventListener('click', (e) => {
        const tpl = e.target.closest('[data-tpl]')?.dataset.tpl;
        if (tpl) {
          body.querySelectorAll('[data-tpl]').forEach(b => b.classList.toggle('active', b.dataset.tpl === tpl));
          const t = ENCOUNTER_TEMPLATES[tpl];
          if (tpl !== 'custom') {
            if (t.count) body.querySelector('#reCount').value = rangePick(t.count);
            body.querySelector('#reSpeciesMode').value = t.speciesMode || 'random';
            body.querySelector('#reLevelMode').value = t.levelMode || 'uniform';
            body.querySelector('#reStage').value = t.stage || '';
            body.querySelector('#reBehavior').value = t.behavior && distinct('behavior').includes(t.behavior) ? t.behavior : '';
            body.querySelector('#reSelectedBox').hidden = true;
          }
          pool();
          return;
        }
        const add = e.target.closest('[data-add]')?.dataset.add;
        if (add) {
          const have = selected.find(s => s.name === add);
          if (have) have.quantity++; else selected.push({ name: add, quantity: 1 });
          body.querySelector('#reSelSearch').value = '';
          body.querySelector('#reSelResults').innerHTML = '';
          renderSel();
          return;
        }
        if (e.target.closest('[data-rm]')) { selected.splice(Number(e.target.closest('[data-i]').dataset.i), 1); renderSel(); }
      });
      pool();
    },
  });
}

// ---- NPC trainers ----

async function pickNpc(enc) {
  if (!_npcs.length) { showCombatAlert('No NPCs yet -- make them in the NPCs module (or use 🎲 Random trainer).', { title: 'NPC trainers' }); return; }
  await openDmModal({
    title: 'Add an NPC from the library',
    html: `<input class="dm-input" id="npcPickSearch" placeholder="Search…" autocomplete="off" style="margin-bottom:0.5rem">
      <div class="dm-cs-species" id="npcPickList">${_npcs.map(n => `
        <button type="button" class="dm-species-item" data-npc="${escapeHtml(n.id)}" data-search="${escapeHtml(`${n.name} ${n.faction} ${n.role}`.toLowerCase())}" ${enc.npcs.includes(n.id) ? 'disabled' : ''}>
          <span class="dm-species-thumb" data-img="${escapeHtml(n.image || '')}"></span>
          <span><span class="dm-species-name">${escapeHtml(n.name)}${enc.npcs.includes(n.id) ? ' <small>(already in it)</small>' : ''}</span>
            <span class="dm-species-meta">Lv ${n.level || 1}${n.role ? ` · ${escapeHtml(n.role)}` : ''}${n.faction ? ` · ${escapeHtml(n.faction)}` : ''} · ${(n.team || []).filter(t => t.species).length} Pokémon</span></span>
        </button>`).join('')}</div>`,
    onOpen: (body, close) => {
      body.querySelectorAll('[data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); else el.innerHTML = '<span class="dm-npc-emoji">👤</span>'; });
      body.querySelector('#npcPickSearch').addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        body.querySelectorAll('[data-npc]').forEach(b => { b.hidden = !!q && !b.dataset.search.includes(q); });
      });
      body.addEventListener('click', (e) => {
        const id = e.target.closest('[data-npc]:not(:disabled)')?.dataset.npc;
        if (!id) return;
        enc.npcs.push(id);
        scheduleSave(enc);
        renderSheet();
        renderList();
        close(null);
      });
    },
  });
}

async function randomTrainerDialog(enc) {
  const paths = JSON.parse(sessionStorage.getItem('trainerPaths') || '[]').map(p => p.name || p).filter(Boolean);
  await openDmModal({
    title: 'Random NPC trainer', wide: true,
    html: `
      <div class="dm-enc-templates" id="rtArch">${Object.entries(TRAINER_ARCHETYPES).map(([k, a]) => `<button class="dm-btn small${k === 'custom' ? ' active' : ''}" data-arch="${k}" title="${escapeHtml(a.description)}">${escapeHtml(a.name)}</button>`).join('')}</div>
      <div class="dm-enc-gen">
        <div>
          <div class="dm-card-title">Trainer</div>
          <div class="dm-field"><label>Name</label><input class="dm-input" id="rtName" placeholder="Leave empty for a random one"></div>
          <div class="dm-row">
            <div class="dm-field"><label>Level</label><input class="dm-input" id="rtLevel" type="number" min="1" max="20" value="5"></div>
            <div class="dm-field"><label>Path</label><select class="dm-select" id="rtPath">${optionList(paths, '', 'None')}</select></div>
          </div>
          <div class="dm-field"><label>Ability scores</label><select class="dm-select" id="rtStats">${Object.entries(STAT_METHODS).map(([k, l]) => `<option value="${k}">${escapeHtml(l)}</option>`).join('')}</select></div>
          <label class="dm-check"><input type="checkbox" id="rtInv" checked>Give them some items</label>
        </div>
        <div>
          <div class="dm-card-title">Team</div>
          <div class="dm-field"><label>How many Pokémon</label><input class="dm-input" id="rtCount" type="number" min="1" max="6" value="3"></div>
          <div class="dm-field"><label>Their levels</label><select class="dm-select" id="rtRel">
            <option value="custom">The range below</option><option value="match">The trainer's level</option><option value="below">1-3 below the trainer</option></select></div>
          <div class="dm-row">
            <div class="dm-field"><label>Min level</label><input class="dm-input" id="rtMin" type="number" min="1" max="20" value="3"></div>
            <div class="dm-field"><label>Max level</label><input class="dm-input" id="rtMax" type="number" min="1" max="20" value="7"></div>
          </div>
          <div class="dm-field"><label>Evolution stage</label><select class="dm-select" id="rtStage"><option value="">Any</option><option value="basic">Basic only</option><option value="evolved">Evolved only</option></select></div>
          <label class="dm-check"><input type="checkbox" id="rtAce">An ace (2-3 levels higher)</label>
        </div>
        <div>
          <div class="dm-card-title">Types</div>
          <div class="dm-row">
            <div class="dm-field"><label>Main type</label><select class="dm-select" id="rtType">${optionList(TYPES, '', 'Any')}</select></div>
            <div class="dm-field"><label>Second type</label><select class="dm-select" id="rtType2">${optionList(TYPES, '', 'None')}</select></div>
          </div>
          <div class="dm-field"><label>How strictly</label><select class="dm-select" id="rtStrength">
            <option value="0.5">Loose (half)</option><option value="0.7" selected>Moderate (70%)</option><option value="0.9">Strong (90%)</option><option value="1">Specialist (all)</option></select></div>
          <div class="dm-field"><label>Habitat</label><select class="dm-select" id="rtHabitat">${optionList(distinct('habitat'), '', 'Any')}</select></div>
          <label class="dm-check"><input type="checkbox" id="rtExcluded">Include left-out ones (${_exclusions.length})</label>
        </div>
      </div>
      <div class="dm-hint">The trainer is saved to the NPC library (with their team, ready to tweak there) and added to this encounter.</div>`,
    buttons: [{ label: 'Cancel', value: null }, {
      label: 'Generate and add', kind: 'primary', keepOpen: true,
      onClick: async (body) => {
        const v = id => body.querySelector(`#${id}`).value;
        const arch = body.querySelector('[data-arch].active')?.dataset.arch || 'custom';
        let npc;
        try {
          npc = generateTrainer(_species, {
            archetype: arch, name: v('rtName').trim(), level: Number(v('rtLevel')) || 5, path: v('rtPath'), statMethod: v('rtStats'),
            teamCount: Number(v('rtCount')) || 3, levelRelation: v('rtRel'), minLevel: Number(v('rtMin')) || 1, maxLevel: Number(v('rtMax')) || 1,
            stage: v('rtStage'), ace: body.querySelector('#rtAce').checked, type: v('rtType'), type2: v('rtType2'),
            typeStrength: Number(v('rtStrength')), habitat: v('rtHabitat'), autoInventory: body.querySelector('#rtInv').checked,
            includeExcluded: body.querySelector('#rtExcluded').checked,
          }, _exclusions, JSON.parse(sessionStorage.getItem('natures') || '[]').map(n => n.name));
          npc = await DmAPI.saveNpc(npc);
        } catch (err) { showCombatAlert(err.message, { title: 'Random trainer' }); return false; }
        _npcs.push(npc);
        enc.npcs.push(npc.id);
        scheduleSave(enc);
        renderSheet();
        renderList();
        toast(`${npc.name} (Lv ${npc.level}) with ${npc.team.map(t => `${t.species} ${t.level}`).join(', ')} -- saved to the NPC library.`);
        return true;
      },
    }],
    onOpen: (body) => {
      body.querySelector('#rtArch').addEventListener('click', (e) => {
        const key = e.target.closest('[data-arch]')?.dataset.arch;
        if (!key) return;
        body.querySelectorAll('[data-arch]').forEach(b => b.classList.toggle('active', b.dataset.arch === key));
        const a = TRAINER_ARCHETYPES[key];
        if (key === 'custom') return;
        body.querySelector('#rtStats').value = a.statMethod;
        if (a.teamSize) body.querySelector('#rtCount').value = rangePick(a.teamSize);
        body.querySelector('#rtAce').checked = !!a.ace;
        body.querySelector('#rtStage').value = a.stage || '';
        if (a.typeStrength) body.querySelector('#rtStrength').value = String(a.typeStrength);
        body.querySelector('#rtType').value = a.types ? a.types[Math.floor(Math.random() * a.types.length)] : '';
        body.querySelector('#rtType2').value = '';
        body.querySelector('#rtInv').checked = !!a.inventory;
        body.querySelector('#rtRel').value = a.levelRelation || 'custom';
      });
    },
  });
}

// ---- Putting in play (the next battle) ----

export function monConfig(p) {
  return {
    level: Math.max(1, Math.min(20, Number(p.level) || 1)), nature: p.nature || '', abilities: p.abilities?.length ? p.abilities : [0],
    item: p.item || '', shiny: !!p.shiny, initiative: null, stats: p.stats || {}, overrides: {}, extraSkills: p.extraSkills || [],
    bonus: p.bonus || {},
  };
}

/** A new encounter built around a map (the Adventure's "Start encounter") -- with `creatures` (the adventure's Pokemon
 * and NPCs, adventure.js's liveCreatures shape): each Pokemon an entry of its own, each NPC from the NPC library, both
 * remembering where they stood (position; npcPlacement) and whether they were hidden. Opened in Encounter setup, on the
 * top of the list. */
export async function createEncounterWithMap(map, name, { creatures = [] } = {}) {
  try { await loadLibraryData(); } catch { /* the new one is saved either way */ }
  const { creatures: _onIt, ...plain } = map || {};
  const enc = { ...blankEncounter(), name: name || 'New encounter', map: { ...JSON.parse(JSON.stringify(plain)), ready: true } };
  creatures.forEach((c) => {
    if (c.kind === 'pokemon' && c.config?.species) {
      enc.pokemon.push(newMon(c.config.species, Math.max(1, Math.min(20, Number(c.config.level) || 1)), {
        name: c.name || c.config.species, nature: c.config.nature || '', abilities: c.config.abilities?.length ? c.config.abilities : [0],
        heldBack: !!c.hidden, ...(c.position ? { position: { ...c.position } } : {}),
      }));
    } else if (c.kind === 'npc' && c.npcId && !enc.npcs.includes(c.npcId)) {
      enc.npcs.push(c.npcId);
      enc.npcPlacement = { ...(enc.npcPlacement || {}), [c.npcId]: { position: c.position ? { ...c.position } : null, hidden: !!c.hidden } };
    }
  });
  await saveNow(enc);
  _encounters.unshift(enc);
  _selectedId = enc.id;
  _folder = ''; // (a new one is at the top -- in view)
  return enc;
}

/** The adventure's "Start encounter" (the user's call, 2026-11-13): a new encounter with the adventure's map, its Pokemon
 * and NPCs (createEncounterWithMap), put in play at once -- Map setup gets the map with them standing where they stood,
 * and where the players' trainers and Pokemon stood (`players`, faded, for reference -- the players join from their
 * app). Resolves to {enc, inPlay}: not in play while a battle is running (made, to put in play once it's over). */
export async function startEncounterFromAdventure(map, name, { creatures = [], players = [] } = {}) {
  const enc = await createEncounterWithMap(map, name, { creatures });
  const state = await CombatAPI.getState().catch(() => null);
  if (battleOn(state?.data)) return { enc, inPlay: false };
  await putInPlay(enc, { replace: true, useMap: true, players, fromAdventure: true });
  return { enc, inPlay: true };
}

/** A battle (PvE or PvP) is running -- a running adventure isn't one: it pauses when the battle starts. */
function battleOn(session) {
  return !!session?.active && session.battleType !== 'adventure';
}

async function loadIntoSetup(enc) {
  await flushEncounter(enc);
  const state = await CombatAPI.getState().catch(() => null);
  if (battleOn(state?.data)) {
    showCombatAlert('A battle is running -- end it first, or send these in as reinforcements from the battle.', { title: 'Put in play' });
    return;
  }
  const setup = getSetup();
  const have = setup.creatures.length;
  const choice = await openDmModal({
    title: `Put "${enc.name}" in play`,
    html: `
      <div class="dm-hint">${summary(enc)} become the next battle -- place them on the map in Map setup and start it. Changes made to this encounter afterwards go into it too.</div>
      ${enc.map ? `<label class="dm-check" style="margin-top:0.6rem"><input type="checkbox" id="loadMap" checked><span>Use its map <small>Replaces Map setup's map (${enc.map.rows} × ${enc.map.cols} squares)</small></span></label>` : ''}
      ${have ? `<div class="dm-field" style="margin-top:0.7rem">
        <label class="dm-check"><input type="radio" name="loadMode" value="replace" checked><span>Replace who's in the next battle now <small>${have} creature${have === 1 ? '' : 's'} there</small></span></label>
        <label class="dm-check"><input type="radio" name="loadMode" value="add"><span>Add to them</span></label></div>` : ''}`,
    buttons: [{ label: 'Cancel', value: null }, {
      label: 'Put in play', kind: 'primary', keepOpen: true,
      onClick: (body) => {
        body.dataset.mode = body.querySelector('input[name="loadMode"]:checked')?.value || 'replace';
        body.dataset.map = body.querySelector('#loadMap')?.checked ? '1' : '';
        return true;
      },
      value: 'load',
    }],
    onOpen: (body) => { loadIntoSetup._body = body; },
  });
  if (choice !== 'load') return;
  const body = loadIntoSetup._body;
  try {
    const { missing } = await putInPlay(enc, { replace: body.dataset.mode !== 'add', useMap: !!enc.map && body.dataset.map === '1' });
    toast(`"${enc.name}" is the next battle${missing.length ? ` (${missing.length} NPC no longer in the library was left out)` : ''} -- place everyone and start it.`);
    window.dispatchEvent(new CustomEvent('dm:show-module', { detail: { name: 'battle' } }));
  } catch (err) {
    showCombatAlert(err.message, { title: `Couldn't load "${enc.name}"` });
  }
}

/** `enc` becomes the next battle (the encounter in play): its creatures into the setup -- `replace` who's there, or
 * added to them -- and, `useMap`, its own map as Map setup's, each creature where it stood when the encounter was made.
 * `players`: where the players stood on that map, `fromAdventure`: it's the adventure's (its "Start encounter";
 * setup-store.js). Resolves to
 * {missing}: the NPCs no longer in the library, left out. */
async function putInPlay(enc, { replace = true, useMap = false, players = [], fromAdventure = false } = {}) {
  const built = [];
  for (const p of enc.pokemon) built.push(await buildEncounterMon(enc, p, null));
  useMap = useMap && !!enc.map;
  // On its own map, each one starts where it stood when the encounter was made (the adventure's "Start encounter") --
  // a hidden one too: on its square, hidden from the players until it's shown
  if (useMap) built.forEach((c, i) => { if (enc.pokemon[i]?.position) c.position = { ...enc.pokemon[i].position }; });
  updateSetup((s) => {
    if (replace) s.creatures = [];
    if (useMap) {
      // The encounter's own map -- where anyone already stood belonged to the old one.
      s.map = { ...JSON.parse(JSON.stringify(enc.map)), weather: s.map.weather, ready: true, terrain: enc.map.terrain || s.map.terrain };
      s.creatures.forEach((c) => { c.position = null; });
      s.players = JSON.parse(JSON.stringify(players || []));
      // The adventure's own map: the players start placing where they stood, and when the battle ends the adventure
      // carries on from how it ended (routes_combat.py's startSpots / _battle_onto_adventure). Another map loaded over
      // it in Map setup drops this.
      if (fromAdventure) s.map.fromAdventure = true;
    }
    // Encounters made before terrain and weather moved to Map setup had their own.
    if (enc.terrain && enc.terrain !== 'flat') s.map.terrain = enc.terrain;
    if (enc.weather && enc.weather !== 'world') s.map.weather = enc.weather;
    s.creatures.push(...built);
  });
  const missing = [];
  for (const id of enc.npcs) {
    const npc = npcById(id);
    if (!npc) { missing.push(id); continue; }
    const tid = await addEncounterNpc(enc, npc);
    const placed = enc.npcPlacement?.[id];
    if (placed) {
      updateSetup((s) => {
        const c = s.creatures.find(x => x.id === tid);
        if (!c) return;
        if (useMap && placed.position) c.position = { ...placed.position };
        if (placed.hidden) c.heldBack = true;
      });
    }
  }
  await flushSetup();
  await DmAPI.saveState('encounter-run', { ...runFields(enc), eventState: {}, loadedAt: new Date().toISOString(), linked: true });
  _runId = enc.id;
  _runLinked = true;
  renderList();
  renderSheet();
  return { missing };
}

// ---- The encounter in play: the next battle follows it ----
// Each creature put in from an encounter carries encId (the encounter), encKey ('mon:<entry id>' for a wild Pokemon,
// 'npc:<NPC id>' for an NPC trainer; their team only encId) and, for a wild Pokemon, encSig (what it was built from).
// Only what changed is rebuilt, and a rebuilt Pokemon keeps its spot on the map. Creatures that came from elsewhere (the
// NPC module, a duplicate made in Map setup) are left alone.

const monSig = p => JSON.stringify([p.species, p.name || p.species, monConfig(p), !!p.heldBack]);

function runFields(enc) {
  return {
    encounterId: enc.id, name: enc.name, notes: enc.notes, noteCategories: enc.noteCategories, events: enc.events,
  };
}

function buildEncounterMon(enc, p, had) {
  // Hidden as Map setup's Participants left it, unless it's the encounter's Hidden that changed; hidden or not, it keeps
  // its square (a hidden one on the map is see-through, only the DM sees it)
  let builtHidden = null;
  try { builtHidden = JSON.parse(had?.encSig || 'null')?.[3]; } catch { /* built before encSig had it */ }
  return buildPokemonCreature(had?.id || newId(), p.species, p.name || p.species, monConfig(p), {
    encId: enc.id, encKey: `mon:${p.id}`, encSig: monSig(p), trainerId: null,
    heldBack: had && builtHidden === !!p.heldBack ? !!had.heldBack : !!p.heldBack,
    position: had?.position || null,
  });
}

async function addEncounterNpc(enc, npc) {
  const { trainer, pokemon } = await addNpcToSetup(npc);
  const ids = new Set([trainer.id, ...pokemon.map(c => c.id)]);
  updateSetup((s) => s.creatures.forEach((c) => {
    if (!ids.has(c.id)) return;
    c.encId = enc.id;
    if (c.id === trainer.id) c.encKey = `npc:${npc.id}`;
  }));
  return trainer.id;
}

let _syncing = Promise.resolve();
function syncInPlay(enc) {
  _syncing = _syncing.then(() => doSyncInPlay(enc)).catch((err) => toast(`Couldn't update the next battle: ${err.message}`));
  return _syncing;
}

async function doSyncInPlay(enc) {
  if (enc.id !== _runId || !_runLinked) return;
  const state = await CombatAPI.getState().catch(() => null);
  if (battleOn(state?.data)) return; // the battle has started -- the setup is what it started from
  const from = () => getSetup().creatures.filter(c => c.encId === enc.id);
  const monKeys = new Set(enc.pokemon.map(p => `mon:${p.id}`));
  const npcKeys = new Set(enc.npcs.map(id => `npc:${id}`));

  const rebuilt = [];
  for (const p of enc.pokemon) {
    const had = from().find(c => c.encKey === `mon:${p.id}`);
    if (!had || had.encSig !== monSig(p)) rebuilt.push(await buildEncounterMon(enc, p, had));
  }
  const goneMon = c => c.encKey?.startsWith('mon:') && !monKeys.has(c.encKey);
  const goneTrainers = new Set(from().filter(c => c.encKey?.startsWith('npc:') && !npcKeys.has(c.encKey)).map(c => c.id));
  if (rebuilt.length || goneTrainers.size || from().some(goneMon)) {
    updateSetup((s) => {
      s.creatures = s.creatures.filter(c => !(c.encId === enc.id && goneMon(c)) && !goneTrainers.has(c.id) && !goneTrainers.has(c.trainerId));
      rebuilt.forEach((c) => {
        const i = s.creatures.findIndex(x => x.id === c.id);
        if (i >= 0) s.creatures[i] = c; else s.creatures.push(c);
      });
    });
  }
  for (const id of enc.npcs) {
    const npc = npcById(id);
    if (npc && !from().some(c => c.encKey === `npc:${id}`)) await addEncounterNpc(enc, npc);
  }
  await flushSetup();
  const run = await DmAPI.getState('encounter-run').catch(() => null);
  if (run?.encounterId === enc.id) await DmAPI.saveState('encounter-run', { ...run, ...runFields(enc) });
}

// ---- Saving (each encounter a moment after its last change) ----

function setPill(state) {
  _saveState = state;
  const el = document.getElementById('encSave');
  if (!el) return;
  el.className = `dm-pill ${state === 'error' ? 'todo' : 'ok'}`;
  el.textContent = state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved!' : 'All saved';
}

function scheduleSave(enc) {
  clearTimeout(_saveTimers.get(enc.id));
  _saveTimers.set(enc.id, setTimeout(() => saveNow(enc), 700));
  setPill('saving');
}

async function saveNow(enc) {
  clearTimeout(_saveTimers.get(enc.id));
  _saveTimers.delete(enc.id);
  setPill('saving');
  try {
    const stored = await DmAPI.saveEncounter(JSON.parse(JSON.stringify(enc)));
    enc.updatedAt = stored.updatedAt;
    if (!_saveTimers.size) setPill('saved');
    if (enc.id === _runId) syncInPlay(enc);
  } catch (err) {
    setPill('error');
    toast(`Couldn't save "${enc.name}": ${err.message}`);
  }
}

async function flushEncounter(enc) {
  if (_saveTimers.has(enc.id)) await saveNow(enc);
}

// ---------------------------------------------------------------------------
// Post battle
// ---------------------------------------------------------------------------
// Two views (the user's call, 2026-11-19): the Last battle -- the PvE battle that ended last ('last-battle', kept by
// routes_combat._remember_battle) -- and Previous battles: every battle the DM finished (✓ Finish battle), kept in
// dm_battles to look back at later. One opened from there shows the same way, its changes saved on its own record.
// Who fought shows with their pictures, and each one's 💥 impact -- what it did and what was done to it, from the
// battle's whole log -- helps the DM hand out the XP.

let _after = null; // {last, run, party, list}: the last battle, the encounter in play, the party, the finished battles
let _afterMode = 'last'; // 'last' | 'previous'
let _afterOpen = null; // the finished battle opened from Previous battles (null: the list)
let _settled = false; // the last battle looked over once this visit (settleLastBattle)
const _entries = new Map(); // battle id -> its whole log (the impact popup's), once read
const _xpAdd = { trainers: {}, pokemon: {} }; // what's typed in, not saved yet
const _xpSkip = new Set(); // Pokemon left out of "Every Pokémon that fought" (their tick taken off)
const lower = s => String(s || '').toLowerCase();
const monKey = (trainer, species) => `${lower(trainer)}|${lower(species)}`;

/** A battle's id: the Pi gives one since 2026-11-19 -- an older one's is made from when it ended. */
function battleId(b) {
  if (!b.id) b.id = `bat${Date.parse(b.endedAt || '') || 0}`;
  return b.id;
}

async function renderAftermath(body) {
  body.innerHTML = '<div class="dm-loading">Loading the last battle…</div>';
  try {
    const [last, run, party, npcs, list] = await Promise.all([
      DmAPI.getState('last-battle'), DmAPI.getState('encounter-run'), DmAPI.party(), DmAPI.npcs(),
      DmAPI.battles().catch(() => null), // (null: couldn't read them -- the last battle still shows)
    ]);
    _npcs = npcs.data || [];
    _after = { last, run, party: party.data || [], list };
    if (last) {
      battleId(last);
      await resolveEncounter(_after).catch(() => {});
      await settleLastBattle(_after);
    }
  } catch (err) {
    body.innerHTML = `<div class="dm-loading">Couldn't load the post battle: ${escapeHtml(err.message)}</div>`;
    return;
  }
  if (_tab !== 'aftermath' || !body.isConnected) return;
  drawAftermath(body);
}

/** Which encounter the last battle was, for one that ended before the Pi noted it (2026-11-19): the one in play, if it
 * was put in play before the battle ended -- or after, when it's the same Pokemon (it was put in play again). */
async function resolveEncounter({ last, run }) {
  if (last.encounter || !run?.encounterId) return;
  const loaded = Date.parse(run.loadedAt || '');
  const ended = Date.parse(last.endedAt || '');
  let same = !(Number.isFinite(loaded) && Number.isFinite(ended) && loaded > ended);
  if (!same) {
    const enc = (await DmAPI.encounters()).data?.find(e => e.id === run.encounterId);
    const fought = new Set((last.participants || []).filter(p => p.owner === 'DM' || !p.owner).map(p => lower(p.speciesName || p.name)));
    same = !!enc?.pokemon?.length && enc.pokemon.every(p => fought.has(lower(p.species)));
  }
  if (same) last.encounter = { encounterId: run.encounterId, name: run.name, notes: run.notes, noteCategories: run.noteCategories };
}

/** A last battle marked done before Finish battle took its encounter out of play for sure and kept it among the
 * Previous battles (2026-11-19): both done now, once. Encounter setup looks too, so its "● in play" is right. */
async function settleLastBattle(ctx) {
  if (_settled) return;
  const { last } = ctx;
  if (last?.done && !last.doneAt) {
    battleId(last);
    await resolveEncounter(ctx).catch(() => {});
    last.doneAt = new Date().toISOString();
    try {
      await finishBattleEncounter(ctx);
      await DmAPI.saveState('last-battle', last);
      await DmAPI.saveBattle(last);
    } catch { return; } // (tried again next time)
    if (ctx.list) listBattle(ctx.list, last);
  }
  _settled = true;
}

/** Encounter setup is drawn: the last battle looked over first (settleLastBattle). */
async function settleFromLibrary() {
  if (_settled) return;
  const [last, run] = await Promise.all([DmAPI.getState('last-battle'), DmAPI.getState('encounter-run')]);
  if (last) await settleLastBattle({ last, run, list: null });
  else _settled = true;
}

/** Finish battle (the user's call, 2026-11-18/19): the battle's encounter is finished -- no longer in play, however it
 * got there, and its creatures out of the next battle (the map stays). Put in play again, it can be fought again. */
async function finishBattleEncounter(ctx) {
  const id = ctx.last?.encounter?.encounterId;
  if (!id) return;
  const run = await DmAPI.getState('encounter-run').catch(() => undefined);
  if (run === undefined || run?.encounterId !== id) return;   // (another one in play: left alone)
  await DmAPI.saveState('encounter-run', null);
  ctx.run = null;
  if (_runId === id) { _runId = null; _runLinked = false; }
  if ((getSetup()?.creatures || []).some(c => c.encId === id)) {
    updateSetup((s) => { s.creatures = s.creatures.filter(c => c.encId !== id); });
    await flushSetup();
  }
}

/** `b` in the Previous battles' list (without its log lines), the last to end first. */
function listBattle(list, b) {
  const { log: _lines, ...copy } = b;
  const i = list.findIndex(x => x.id === b.id);
  if (i >= 0) list[i] = copy; else list.push(copy);
  list.sort((x, y) => String(y.endedAt || '').localeCompare(String(x.endedAt || '')));
}

/** A battle's changes saved: the last battle on its own record (and among the Previous battles once finished), an
 * older one on its record there. */
async function saveBattleRecord(b) {
  try {
    if (b === _after.last) await DmAPI.saveState('last-battle', b);
    if (b.done || b !== _after.last) await DmAPI.saveBattle(b);
  } catch (err) { toast(`Couldn't save: ${err.message}`); return; }
  if (_after.list && b.done) listBattle(_after.list, b);
}

/** Everyone in a battle, sorted into what the post battle needs. */
function battleSummary(b) {
  const ps = b.participants || [];
  const enemies = ps.filter(p => p.owner === 'DM' || !p.owner);
  const players = ps.filter(p => p.owner && p.owner !== 'DM');
  const monsOf = {};
  const trainerOf = {};
  players.forEach((p) => {
    if (p.combatantType === 'pokemon') (monsOf[lower(p.owner)] = monsOf[lower(p.owner)] || []).push(p);
    else if (p.combatantType === 'trainer') trainerOf[lower(p.owner)] = p;
  });
  return {
    caught: enemies.filter(p => p.captured),
    defeated: enemies.filter(p => !p.captured && Number(p.currentHP) <= 0),
    away: enemies.filter(p => !p.captured && Number(p.currentHP) > 0),
    fainted: players.filter(p => p.combatantType === 'pokemon' && Number(p.currentHP) <= 0),
    trainers: [...new Set(players.map(p => p.owner))],
    monsOf, trainerOf,
  };
}

function trainerRecord(name) {
  return _after.party.find(t => lower(t.trainer?.name) === lower(name)) || null;
}

function tags(list, cls) {
  return list.map(p => `<button class="dm-enc-tag ${cls}" data-impact="${escapeHtml(p.id)}" title="Show impact">${escapeHtml(p.name)} <small>Lv ${p.level ?? '?'}</small></button>`).join('');
}

function modesHtml() {
  const n = _after.list?.length;
  return `<div class="dm-seg dm-after-modes">
    <button class="${_afterMode === 'last' ? 'active' : ''}" data-after-mode="last">Last battle</button>
    <button class="${_afterMode === 'previous' ? 'active' : ''}" data-after-mode="previous">📚 Previous battles${n ? ` (${n})` : ''}</button>
  </div>`;
}

function showPics(root) {
  root.querySelectorAll('[data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); });
}

/** The tab: the last battle, or the Previous battles' list, or one opened from it. */
function drawAftermath(body) {
  if (_afterMode === 'previous' && !_afterOpen) drawPrevious(body);
  else drawBattle(body, _afterMode === 'previous' ? _afterOpen : _after.last);
}

function wireModes(root, body) {
  root.querySelectorAll('[data-after-mode]').forEach(btn => btn.addEventListener('click', () => {
    if (_afterMode === btn.dataset.afterMode && !_afterOpen) return;
    _afterMode = btn.dataset.afterMode;
    _afterOpen = null;
    clearXpTyped();
    drawAftermath(body);
  }));
}

function clearXpTyped() {
  _xpAdd.trainers = {};
  _xpAdd.pokemon = {};
  _xpSkip.clear();
}

function drawPrevious(body) {
  const list = _after.list;
  body.innerHTML = `
    <div class="dm-after">
      <div class="dm-after-head">
        <div>
          <h2>Previous battles</h2>
          <div class="dm-hint">Every battle you've finished -- open one to look back at what happened.</div>
        </div>
        ${modesHtml()}
      </div>
      ${list === null ? '<div class="dm-cs-empty">Couldn\'t load the previous battles.</div>'
        : !list.length ? '<div class="dm-cs-empty">No finished battles yet. ✓ Finish battle on the last battle puts it here.</div>'
        : `<div class="dm-after-prev">${list.map(prevCardHtml).join('')}</div>`}
    </div>`;
  const root = body.querySelector('.dm-after');
  showPics(root);
  wireModes(root, body);
  root.addEventListener('click', async (e) => {
    const id = e.target.closest('[data-open]')?.dataset.open;
    if (!id) return;
    let b;
    try { b = _after.last && battleId(_after.last) === id ? _after.last : await DmAPI.battle(id); } catch (err) { showCombatAlert(err.message, { title: 'Previous battles' }); return; }
    if (!b) { toast("That battle isn't there any more."); return; }
    _afterOpen = b;
    clearXpTyped();
    drawAftermath(body);
  });
}

function prevCardHtml(b) {
  const s = battleSummary(b);
  const enemies = [...s.defeated, ...s.caught, ...s.away];
  return `
    <button class="dm-after-prevcard" data-open="${escapeHtml(battleId(b))}">
      <span class="dm-after-prevtop"><strong>${escapeHtml(b.encounter?.name || 'Battle')}</strong><small>${escapeHtml(new Date(b.endedAt).toLocaleString())}</small></span>
      <span class="dm-after-prevmons">${enemies.slice(0, 10).map(p => `<span class="dm-enc-thumb" data-img="${escapeHtml(p.image || '')}" title="${escapeHtml(p.name)}"></span>`).join('')}</span>
      <span class="dm-hint">${b.round || 1} round${b.round === 1 ? '' : 's'}${s.trainers.length ? ` · ${escapeHtml(s.trainers.join(', '))}` : ''} · ${s.defeated.length} defeated${s.caught.length ? ` · ${s.caught.length} caught` : ''}</span>
    </button>`;
}

function drawBattle(body, b) {
  if (!b) {
    body.innerHTML = `<div class="dm-after"><div class="dm-after-head"><div><h2>Post battle</h2></div>${modesHtml()}</div>
      <div class="dm-cs-empty">No PvE battle has ended yet. When one does, what happened and what to hand out shows up here.</div></div>`;
    wireModes(body.querySelector('.dm-after'), body);
    return;
  }
  const isLast = b === _after.last;
  const fromList = _afterMode === 'previous';
  const run = b.encounter || null;
  const s = battleSummary(b);
  const ended = new Date(b.endedAt);
  const allTrainers = _after.party.map(t => t.trainer?.name).filter(Boolean);
  const trainerOptions = (sel = '') => [...s.trainers, ...allTrainers.filter(t => !s.trainers.some(x => lower(x) === lower(t)))]
    .map(t => `<option ${lower(t) === lower(sel) ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('');
  const minutes = Math.max(1, Math.ceil(((Number(b.round) || 1) * ROUND_SECONDS) / 60));
  const clock = getClock();
  b.given = b.given || {};
  // Given to its trainer already from the catch popup (battle-live.js), during the battle
  (b.participants || []).forEach((p) => { if (p.givenTo && !b.given[p.id]) b.given[p.id] = p.givenTo; });
  b.lootGiven = b.lootGiven || {};

  // Loot: held items of the defeated wild Pokemon, and the items of defeated NPC trainers (from the NPC library).
  const setup = getSetup();
  const loot = [];
  s.defeated.forEach((p) => {
    if (p.combatantType === 'trainer') {
      const npc = npcById(setup?.creatures.find(c => c.id === p.id)?.npcId);
      (npc?.inventory || []).filter(i => i.name).forEach((it, i) => loot.push({ key: `${p.id}:${i}`, from: p.name, name: it.name, quantity: Number(it.quantity) || 1, description: it.description || '' }));
    } else if (p.item && !/^none$/i.test(p.item)) {
      loot.push({ key: `${p.id}:held`, from: p.name, name: p.item, quantity: 1, description: '' });
    }
  });

  body.innerHTML = `
    <div class="dm-after">
      <div class="dm-after-head">
        <div>
          ${fromList ? '<button class="dm-btn small" id="afBack">← Previous battles</button>' : ''}
          <h2>${escapeHtml(run?.name || 'Battle')} -- post battle</h2>
          <div class="dm-hint">Ended ${ended.toLocaleString()} · ${b.round || 1} round${b.round === 1 ? '' : 's'}${b.done ? ' · <strong>finished</strong>' : ''}</div>
        </div>
        <div class="dm-after-headbtns">
          ${modesHtml()}
          ${isLast ? `<button class="dm-btn ${b.done ? '' : 'primary'}" id="afDone" title="${b.done ? 'Finished -- click to open it again' : 'Its encounter is no longer in play, and the battle goes into Previous battles'}">${b.done ? 'Done ✓' : '✓ Finish battle'}</button>`
            : '<button class="dm-btn danger" id="afRemove" title="Take it out of Previous battles">Remove</button>'}
        </div>
      </div>

      <div class="dm-after-stats">
        <div><strong>${s.defeated.length}</strong><span>Defeated</span></div>
        <div><strong>${s.caught.length}</strong><span>Caught</span></div>
        <div><strong>${s.away.length}</strong><span>Got away / still standing</span></div>
        <div><strong>${s.fainted.length}</strong><span>Players' Pokémon fainted</span></div>
      </div>
      <div class="dm-after-tags">
        ${s.defeated.length ? `<div><span>Defeated</span>${tags(s.defeated, 'def')}</div>` : ''}
        ${s.caught.length ? `<div><span>Caught</span>${tags(s.caught, 'cau')}</div>` : ''}
        ${s.away.length ? `<div><span>Got away</span>${tags(s.away, 'awy')}</div>` : ''}
        ${s.fainted.length ? `<div><span>Fainted</span>${tags(s.fainted, 'fnt')}</div>` : ''}
      </div>

      <div class="dm-after-grid">
        ${s.caught.length ? `
        <div class="dm-card dm-after-wide">
          <div class="dm-card-title">Caught Pokémon -- into a trainer's team</div>
          ${s.caught.map(p => `
            <div class="dm-after-caught" data-caught="${escapeHtml(p.id)}">
              <span class="dm-enc-thumb" data-img="${escapeHtml(p.image || '')}"></span>
              <span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.speciesName || '')} · Lv ${p.level ?? '?'}</small></span>
              ${b.given[p.id] ? `<span class="dm-pill ok">✓ In ${escapeHtml(b.given[p.id])}'s team</span>` : `
                <select class="dm-select" data-k="trainer">${trainerOptions()}</select>
                <input class="dm-input" data-k="nickname" placeholder="Nickname (optional)">
                <button class="dm-btn primary small" data-act="give-mon">Give</button>`}
            </div>`).join('')}
          <div class="dm-hint">Built the way you set it up (level, nature, abilities, held item), with full HP -- it shows up on their phone straight away.</div>
        </div>` : ''}

        <div class="dm-card dm-after-wide">
          <div class="dm-card-title"><span>Experience <span class="dm-label-note">(only you see XP)</span></span>
            <span class="dm-row dm-enc-titlebtns"><button class="dm-btn small" id="afXpImport" title="Read the XP from the old DM tool's trainer backup (shima-trainers-....json)">📂 Import from the old DM tool</button></span></div>
          ${s.trainers.length ? `
          <div class="dm-after-quick">
            <label>Every trainer <input class="dm-input dm-inline-num" id="afQuickT" type="number" placeholder="+XP"></label>
            <button class="dm-btn small" id="afQuickTGo">Add</button>
            <label>Every Pokémon that fought <input class="dm-input dm-inline-num" id="afQuickP" type="number" placeholder="+XP"></label>
            <button class="dm-btn small" id="afQuickPGo">Add</button>
          </div>
          <div class="dm-after-xp">${s.trainers.map(t => xpCardHtml(t, s)).join('')}</div>
          <div class="dm-row" style="justify-content:flex-end;margin-top:0.6rem"><button class="dm-btn primary" id="afXpSave">Save XP</button></div>` : '<div class="dm-hint">No player trainers were in this battle.</div>'}
        </div>

        <div class="dm-card">
          <div class="dm-card-title">Loot & money</div>
          ${loot.length ? loot.map(it => `
            <div class="dm-after-loot" data-loot="${escapeHtml(it.key)}" data-name="${escapeHtml(it.name)}" data-desc="${escapeHtml(it.description)}">
              <span><strong>${escapeHtml(it.name)}</strong>${it.quantity > 1 ? ` ×${it.quantity}` : ''}<small>from ${escapeHtml(it.from)}</small></span>
              ${b.lootGiven[it.key] ? `<span class="dm-pill ok">✓ ${escapeHtml(b.lootGiven[it.key])}</span>` : `
                <input class="dm-input" type="number" min="1" value="${it.quantity}" data-k="qty">
                <select class="dm-select" data-k="trainer">${trainerOptions()}</select>
                <button class="dm-btn small primary" data-act="give-loot">Give</button>`}
            </div>`).join('') : '<div class="dm-hint">No items from the defeated (held items, NPC trainers\' bags).</div>'}
          <div class="dm-after-give">
            <div class="dm-card-title" style="margin-top:0.8rem">Give something else</div>
            <div class="dm-row">
              <input class="dm-input" id="afItem" placeholder="Item" list="afItems">
              <input class="dm-input" id="afItemQty" type="number" min="1" value="1" style="max-width:70px">
              <select class="dm-select" id="afItemTo">${trainerOptions()}</select>
              <button class="dm-btn small" id="afItemGive">Give</button>
            </div>
            <div class="dm-row" style="margin-top:0.4rem">
              <input class="dm-input" id="afMoney" type="number" placeholder="Money" style="max-width:110px">
              <select class="dm-select" id="afMoneyTo"><option value="__all">Each trainer in the battle</option>${trainerOptions()}</select>
              <button class="dm-btn small" id="afMoneyGive">Give money</button>
            </div>
          </div>
        </div>

        ${isLast ? `
        <div class="dm-card">
          <div class="dm-card-title">⏱ World clock</div>
          <div class="dm-hint">Now: <strong>${clock ? `${escapeHtml(formatDate(clock))} -- ${formatTime(clock)} (${escapeHtml(phaseName(clock))})` : '?'}</strong>. The fight took ${b.round || 1} round${b.round === 1 ? '' : 's'} (~${minutes} min).</div>
          <label class="dm-check" style="margin-top:0.5rem"><input type="radio" name="afTime" value="combat" checked><span>Move it on by the fight (${minutes} min)</span></label>
          <label class="dm-check"><input type="radio" name="afTime" value="custom"><span>By <input class="dm-input dm-inline-num" id="afMinutes" type="number" min="0" step="5" value="60"> minutes</span></label>
          <label class="dm-check"><input type="radio" name="afTime" value="phase"><span>On to <select class="dm-select dm-inline-sel" id="afPhase">${PHASES.map(p => `<option>${p.name}</option>`).join('')}</select></span></label>
          <div class="dm-row" style="margin-top:0.4rem">
            <button class="dm-btn small primary" id="afTimeGo">Move the clock</button>
            <button class="dm-btn small" id="afWeather">🎲 Roll weather</button>
            <button class="dm-btn small" id="afLog" ${b.logged ? 'disabled' : ''}>${b.logged ? 'Logged ✓' : '📌 Log as calendar event'}</button>
          </div>
        </div>` : ''}

        <div class="dm-card">
          <div class="dm-card-title">Notes</div>
          ${run ? `<div class="dm-after-notes">${escapeHtml(run.notes || '') || '<span class="dm-hint">No notes.</span>'}</div>
            ${(run.noteCategories || []).map(c => `<details class="dm-after-cat"><summary>${escapeHtml(c.icon || '📝')} ${escapeHtml(c.name || 'Notes')}</summary><div class="dm-after-notes">${escapeHtml(c.content || '')}</div></details>`).join('')}`
            : '<div class="dm-hint">No encounter was loaded for this battle.</div>'}
        </div>

        <details class="dm-card dm-collapsible">
          <summary class="dm-card-title">📜 Battle log (${(b.log || []).length})</summary>
          <div class="dm-after-log">${(b.log || []).map(l => `<div>${escapeHtml(l)}</div>`).join('')}</div>
        </details>
      </div>
    </div>`;
  if (!document.getElementById('afItems')) {
    const items = JSON.parse(sessionStorage.getItem('items') || '[]');
    document.body.insertAdjacentHTML('beforeend', `<datalist id="afItems">${items.map(i => `<option value="${escapeHtml(i.name)}">`).join('')}</datalist>`);
  }
  const root = body.querySelector('.dm-after');
  showPics(root);
  wireModes(root, body);
  wireAftermath(root, body, b, s, minutes);
}

/** The DM-only XP that came with the party (DmAPI.party): a trainer's, or one of their Pokemon's (by species name). */
function xpOf(rec, species = null) {
  if (!rec) return 0;
  if (!species) return xpOrStart(rec.xp?.trainer, rec.trainer?.level);
  const i = rec.pokemon.findIndex(m => lower(m.name) === lower(species));
  return i < 0 ? 0 : xpOrStart(rec.xp?.pokemon?.[i], rec.pokemon[i].level);
}

function xpLine(current, add) {
  const now = current + (Number(add) || 0);
  const from = levelFromXp(current);
  const to = levelFromXp(now);
  return `${now.toLocaleString()} XP${to > from ? ` <span class="dm-after-lvup">↑ level ${to}</span>` : ''}`;
}

/** A trainer in the battle and their Pokemon that fought in it (the user's call, 2026-11-19: only those can get XP --
 * a Pokemon outside the active party never fights), each with its picture and its impact. */
function xpCardHtml(name, s) {
  const rec = trainerRecord(name);
  const level = rec?.trainer?.level || 1;
  const tKey = lower(name);
  const tXp = xpOf(rec);
  const tp = s.trainerOf[tKey];
  const mons = s.monsOf[tKey] || [];
  const impactBtn = p => (p ? `<button class="dm-btn small" data-impact="${escapeHtml(p.id)}">💥 Show impact</button>` : '<span></span>');
  return `
    <div class="dm-after-xpcard" data-trainer="${escapeHtml(name)}">
      <div class="dm-after-xprow head" data-cur="${tXp}">
        <span class="dm-enc-thumb dm-after-pic" data-img="${escapeHtml(tp?.image || rec?.trainer?.image || '')}"></span>
        <strong>${escapeHtml(name)} <small>Lv ${level}</small></strong>
        <span>${tXp.toLocaleString()}</span>
        <input class="dm-input" type="number" data-xp-t value="${_xpAdd.trainers[tKey] ?? ''}" placeholder="+XP">
        <span class="dm-after-new">${xpLine(tXp, _xpAdd.trainers[tKey])}</span>
        ${impactBtn(tp)}
      </div>
      ${mons.map((p) => {
        // (by its species -- or its nickname, if it has evolved since)
        const m = rec?.pokemon.find(x => lower(x.name) === lower(p.speciesName || p.name))
          || rec?.pokemon.find(x => x.nickname && lower(x.nickname) === lower(p.name));
        const fainted = Number(p.currentHP) <= 0 ? ' · fainted' : '';
        const pic = `<span class="dm-enc-thumb dm-after-pic" data-img="${escapeHtml(p.image || m?.image || '')}"></span>`;
        if (!m) {
          return `
        <div class="dm-after-xprow gone">
          ${pic}<span>${escapeHtml(p.name)} <small>not in ${escapeHtml(name)}'s team any more</small></span><span></span><span></span><span></span>${impactBtn(p)}
        </div>`;
        }
        const key = monKey(name, m.name);
        const xp = xpOf(rec, m.name);
        const on = !_xpSkip.has(key);
        return `
        <div class="dm-after-xprow${on ? '' : ' absent'}" data-mon="${escapeHtml(m.name)}" data-cur="${xp}">
          ${pic}
          <label><input type="checkbox" data-present ${on ? 'checked' : ''} title="Gets the 'Every Pokémon that fought' XP"> ${escapeHtml(m.nickname || p.name)} <small>Lv ${m.level}${fainted}</small></label>
          <span>${xp.toLocaleString()}</span>
          <input class="dm-input" type="number" data-xp-p value="${_xpAdd.pokemon[key] ?? ''}" placeholder="+XP">
          <span class="dm-after-new">${xpLine(xp, _xpAdd.pokemon[key])}</span>
          ${impactBtn(p)}
        </div>`;
      }).join('')}
      ${mons.length ? '' : '<div class="dm-hint">None of their Pokémon fought.</div>'}
    </div>`;
}

function wireAftermath(root, body, b, s, minutes) {
  const save = () => saveBattleRecord(b);
  const redraw = () => drawAftermath(body);

  root.querySelector('#afBack')?.addEventListener('click', () => { _afterOpen = null; clearXpTyped(); redraw(); });

  root.querySelector('#afDone')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    if (!b.done) {
      b.done = true;
      b.doneAt = new Date().toISOString();
      try {
        await resolveEncounter(_after);
        await finishBattleEncounter(_after);
      } catch (err) { toast(`Couldn't take the encounter out of play: ${err.message}`); }
    } else {
      b.done = false;
      delete b.doneAt;
      try { await DmAPI.deleteBattle(battleId(b)); } catch (err) { toast(`Couldn't take it out of Previous battles: ${err.message}`); }
      if (_after.list) _after.list = _after.list.filter(x => x.id !== b.id);
    }
    await save();
    redraw();
    window.dispatchEvent(new CustomEvent('dm:aftermath-changed'));
  });

  root.querySelector('#afRemove')?.addEventListener('click', async () => {
    if (!await showCombatConfirm(`Take "${b.encounter?.name || 'Battle'}" (${new Date(b.endedAt).toLocaleString()}) out of Previous battles? It's gone for good.`, { title: 'Previous battles', yesLabel: 'Remove', noLabel: 'Cancel' })) return;
    try { await DmAPI.deleteBattle(battleId(b)); } catch (err) { showCombatAlert(err.message, { title: 'Previous battles' }); return; }
    if (_after.list) _after.list = _after.list.filter(x => x.id !== b.id);
    _afterOpen = null;
    redraw();
  });

  root.addEventListener('click', async (e) => {
    const impact = e.target.closest('[data-impact]')?.dataset.impact;
    if (impact) { openImpact(b, impact); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'give-mon') {
      const row = e.target.closest('[data-caught]');
      const p = b.participants.find(x => x.id === row.dataset.caught);
      const trainer = row.querySelector('[data-k="trainer"]').value;
      const nickname = row.querySelector('[data-k="nickname"]').value.trim();
      const c = getSetup()?.creatures.find(x => x.id === p.id);
      const cfg = c ? { species: c.config.species, ...monConfig(c.config) } : { species: p.speciesName || p.name, level: p.level, nature: p.nature || '', abilities: [0] };
      e.target.disabled = true;
      try {
        await DmAPI.givePokemon(trainer, { ...cfg, nickname: nickname || (p.name !== cfg.species && !/ [A-Z]$/.test(p.name) ? p.name : '') });
        b.given[p.id] = trainer;
        await save();
        toast(`${nickname || p.name} is now in ${trainer}'s team.`);
        redraw();
      } catch (err) { e.target.disabled = false; showCombatAlert(err.message, { title: `Give ${p.name}` }); }
    } else if (act === 'give-loot') {
      const row = e.target.closest('[data-loot]');
      const qty = Math.max(1, Number(row.querySelector('[data-k="qty"]').value) || 1);
      const trainer = row.querySelector('[data-k="trainer"]').value;
      e.target.disabled = true;
      try {
        await giveItem(trainer, row.dataset.name, qty, row.dataset.desc);
        b.lootGiven[row.dataset.loot] = `${trainer}${qty > 1 ? ` ×${qty}` : ''}`;
        await save();
        redraw();
      } catch (err) { e.target.disabled = false; showCombatAlert(err.message, { title: 'Give item' }); }
    }
  });

  root.querySelector('#afItemGive').addEventListener('click', async () => {
    const name = root.querySelector('#afItem').value.trim();
    if (!name) return;
    const qty = Math.max(1, Number(root.querySelector('#afItemQty').value) || 1);
    const trainer = root.querySelector('#afItemTo').value;
    try { await giveItem(trainer, name, qty, ''); root.querySelector('#afItem').value = ''; toast(`Gave ${trainer} ${qty} × ${name}.`); } catch (err) { showCombatAlert(err.message, { title: 'Give item' }); }
  });
  root.querySelector('#afMoneyGive').addEventListener('click', async () => {
    const amount = Number(root.querySelector('#afMoney').value) || 0;
    if (!amount) return;
    const to = root.querySelector('#afMoneyTo').value;
    const who = to === '__all' ? s.trainers : [to];
    try {
      for (const t of who) await DmAPI.giveMoney(t, amount);
      root.querySelector('#afMoney').value = '';
      toast(`Gave ${amount} to ${who.join(', ')}.`);
    } catch (err) { showCombatAlert(err.message, { title: 'Give money' }); }
  });

  // World clock (the last battle only)
  root.querySelector('#afTimeGo')?.addEventListener('click', () => {
    const mode = root.querySelector('input[name="afTime"]:checked').value;
    if (mode === 'combat') advanceMinutes(minutes);
    else if (mode === 'custom') advanceMinutes(Number(root.querySelector('#afMinutes').value) || 0);
    else skipToPhase(root.querySelector('#afPhase').value);
    const c = getClock();
    toast(`The clock is now ${formatDate(c)}, ${formatTime(c)}.`);
    redraw();
  });
  root.querySelector('#afWeather')?.addEventListener('click', () => { const w = rollWeather(); toast(`New weather: ${WEATHER[w]?.icon || ''} ${WEATHER[w]?.name || w}`); });
  root.querySelector('#afLog')?.addEventListener('click', async () => {
    const c = getClock();
    const parts = [`Rounds: ${b.round || 1}`];
    if (s.defeated.length) parts.push(`Defeated: ${s.defeated.map(p => p.name).join(', ')}`);
    if (s.caught.length) parts.push(`Caught: ${s.caught.map(p => p.name).join(', ')}`);
    if (s.trainers.length) parts.push(`Trainers: ${s.trainers.join(', ')}`);
    updateClock(cl => cl.events.push({ id: newId('evt'), year: c.year, month: c.month, day: c.day, title: b.encounter?.name || 'Battle', notes: parts.join('\n'), recurring: false }));
    b.logged = true;
    await save();
    toast(`Logged on ${formatDate(c)}.`);
    redraw();
  });

  // Experience
  const xpBox = root.querySelector('.dm-after-xp');
  if (xpBox) {
    xpBox.addEventListener('input', (e) => {
      const card = e.target.closest('[data-trainer]');
      if (!card) return;
      if (e.target.matches('[data-xp-t]')) _xpAdd.trainers[lower(card.dataset.trainer)] = e.target.value === '' ? undefined : Number(e.target.value);
      if (e.target.matches('[data-xp-p]')) _xpAdd.pokemon[monKey(card.dataset.trainer, e.target.closest('[data-mon]').dataset.mon)] = e.target.value === '' ? undefined : Number(e.target.value);
      const row = e.target.closest('.dm-after-xprow');
      row.querySelector('.dm-after-new').innerHTML = xpLine(Number(row.dataset.cur) || 0, e.target.value);
    });
    xpBox.addEventListener('change', (e) => {
      if (!e.target.matches('[data-present]')) return;
      const key = monKey(e.target.closest('[data-trainer]').dataset.trainer, e.target.closest('[data-mon]').dataset.mon);
      if (e.target.checked) _xpSkip.delete(key); else _xpSkip.add(key);
      e.target.closest('.dm-after-xprow').classList.toggle('absent', !e.target.checked);
    });
    root.querySelector('#afQuickTGo').addEventListener('click', () => {
      const v = Number(root.querySelector('#afQuickT').value) || 0;
      s.trainers.forEach(t => { _xpAdd.trainers[lower(t)] = (_xpAdd.trainers[lower(t)] || 0) + v; });
      redraw();
    });
    root.querySelector('#afQuickPGo').addEventListener('click', () => {
      const v = Number(root.querySelector('#afQuickP').value) || 0;
      xpBox.querySelectorAll('[data-present]:checked').forEach((cb) => {
        const k = monKey(cb.closest('[data-trainer]').dataset.trainer, cb.closest('[data-mon]').dataset.mon);
        _xpAdd.pokemon[k] = (_xpAdd.pokemon[k] || 0) + v;
      });
      redraw();
    });
    root.querySelector('#afXpSave').addEventListener('click', async () => {
      const changes = [];
      s.trainers.forEach((t) => {
        const rec = trainerRecord(t);
        if (!rec) return;
        const add = Number(_xpAdd.trainers[lower(t)]) || 0;
        if (add) changes.push({ trainer: rec.trainer.name, add });
        rec.pokemon.forEach((m) => {
          const addP = Number(_xpAdd.pokemon[monKey(t, m.name)]) || 0;
          if (addP) changes.push({ trainer: rec.trainer.name, pokemon: m.name, add: addP });
        });
      });
      if (!changes.length) { toast('No XP typed in yet.'); return; }
      let results;
      try { results = await DmAPI.changeXp(changes); } catch (err) { showCombatAlert(err.message, { title: 'Save XP' }); return; }
      _xpAdd.trainers = {};
      _xpAdd.pokemon = {};
      // Ready for a level it wasn't ready for before this XP.
      const ups = results.filter(r => r.xpLevel > r.level && r.xpLevel > levelFromXp(r.before)).map((r) => {
        const m = r.pokemon && trainerRecord(r.trainer)?.pokemon.find(x => lower(x.name) === lower(r.pokemon));
        return `${r.trainer}${r.pokemon ? `'s ${m?.nickname || r.pokemon}` : ''} → level ${r.xpLevel}`;
      });
      await reloadParty();
      redraw();
      if (ups.length) showCombatAlert(`Ready to level up -- tell the players to level up in their app:\n${ups.join('\n')}`, { title: 'XP saved' });
      else toast('XP saved.');
    });
  }
  root.querySelector('#afXpImport').addEventListener('click', importXp);
}

// ---- 💥 Impact: what one creature did in a battle and what was done to it (the user's call, 2026-11-19) ----

// Log lines that say nothing about a creature's part in the fight.
const QUIET_LOG = new Set(['turn-advance', 'reaction-window-open', 'reaction-window-close', 'placement', 'join', 'move',
  'reaction-start', 'reaction-end', 'session-start', 'session-end', 'refund', 'dm-turn', 'hidden', 'extra-action-end']);

/** A battle's whole log (its file on the Pi -- the post battle keeps only the last 200 lines as text). A battle that
 * ended before the Pi noted its file (2026-11-19) has its file found by when it ended. null: not on the Pi. */
async function battleEntries(b) {
  const id = battleId(b);
  if (_entries.has(id)) return _entries.get(id);
  let file = b.logFile;
  if (!file) {
    const ended = Date.parse(b.endedAt || '');
    const logs = await DmAPI.adminBattleLogs();
    file = logs.find(l => l.kind === 'pve' && l.ended && Math.abs(Date.parse(l.ended) - ended) < 120000)?.file || null;
  }
  const entries = file ? await DmAPI.adminBattleLog(file) : null;
  if (entries?.length) _entries.set(id, entries);
  return entries?.length ? entries : null;
}

/** Everything `pid` did and had done to it, added up from the log `entries`. */
function impactOf(entries, pid, b) {
  const who = id => (b.participants || []).find(p => p.id === id);
  // The hits (a hit retyped afterwards -- its own "retyped" line has the new amount -- counts as that)
  const hits = [];
  const lastHit = {};
  entries.forEach((e) => {
    if (e.type !== 'damage') return;
    if (!e.actorId && lastHit[e.targetId] && /retyped/.test(e.text || '')) { lastHit[e.targetId].amount = Number(e.amount) || 0; return; }
    const h = { ...e, amount: Number(e.amount) || 0 };
    hits.push(h);
    if (h.pool !== 'vp') lastHit[e.targetId] = h;
  });
  const fainted = id => Number(who(id)?.currentHP) <= 0 && !who(id)?.captured;
  const add = (map, key, name, h) => {
    const row = map.get(key) || { id: key, name, hp: 0, vp: 0, hits: 0, crits: 0 };
    if (h.pool === 'vp') row.vp += h.amount; else row.hp += h.amount;
    row.hits += 1;
    if (h.crit) row.crits += 1;
    map.set(key, row);
  };

  const moves = new Map();
  const move = (name) => {
    const k = name || 'Attack';
    if (!moves.has(k)) moves.set(k, { name: k, used: 0, hits: 0, misses: 0, crits: 0, damage: 0 });
    return moves.get(k);
  };
  entries.forEach((e) => {
    if (e.actorId !== pid) return;
    if (e.type === 'move-used') move(e.move).used += 1;
    else if (e.type === 'miss') move(e.move).misses += 1;
  });

  const dealt = new Map();
  const taken = new Map();
  hits.forEach((h) => {
    if (h.actorId === pid && h.targetId && h.targetId !== pid) {
      add(dealt, h.targetId, h.targetName || who(h.targetId)?.name || '?', h);
      const m = move(h.move);
      m.hits += 1;
      if (h.crit) m.crits += 1;
      if (h.pool !== 'vp') m.damage += h.amount;
    }
    if (h.targetId === pid) {
      const from = h.actorId === pid ? 'self' : h.actorId || 'other';
      add(taken, from, from === 'self' ? 'Itself' : h.actorName || 'Something else', h);
    }
  });
  dealt.forEach((row) => { row.ko = fainted(row.id) && lastHit[row.id]?.actorId === pid; });
  // Burns, poison, weather, its own ability's cost...
  const other = entries.filter(e => e.type === 'status-damage' && e.actorId === pid).map(e => ({
    text: e.text, amount: Number(e.amount ?? (String(e.text || '').match(/(?:takes |-)(\d+)/) || [])[1]) || 0, pool: e.pool,
  }));
  const heals = entries.filter(e => e.type === 'heal' && e.targetId === pid).reduce((n, e) => n + (Number(e.amount) || 0), 0);
  const healsGiven = entries.filter(e => e.type === 'heal' && e.actorId === pid && e.targetId && e.targetId !== pid)
    .reduce((n, e) => n + (Number(e.amount) || 0), 0);

  const rounds = new Map();
  entries.forEach((e) => {
    if (QUIET_LOG.has(e.type) || !e.text || (e.actorId !== pid && e.targetId !== pid)) return;
    const dir = e.actorId === pid && e.targetId && e.targetId !== pid ? 'out' : e.targetId === pid && e.actorId !== pid ? 'in' : '';
    const r = Number(e.round) || 0;
    if (!rounds.has(r)) rounds.set(r, []);
    rounds.get(r).push({ text: e.text, dir });
  });

  const sum = (map, k) => [...map.values()].reduce((n, row) => n + row[k], 0);
  return {
    moves: [...moves.values()].sort((x, y) => y.damage - x.damage || y.used - x.used),
    dealt: [...dealt.values()].sort((x, y) => y.hp - x.hp),
    taken: [...taken.values()].sort((x, y) => y.hp - x.hp),
    other,
    dealtHp: sum(dealt, 'hp'), dealtVp: sum(dealt, 'vp'),
    takenHp: sum(taken, 'hp') + other.filter(o => o.pool !== 'vp').reduce((n, o) => n + o.amount, 0),
    used: [...moves.values()].reduce((n, m) => n + m.used, 0),
    kos: [...dealt.values()].filter(row => row.ko).length,
    heals, healsGiven,
    faintedBy: fainted(pid) ? lastHit[pid]?.actorName || null : undefined,
    rounds: [...rounds.entries()].sort((x, y) => x[0] - y[0]),
  };
}

function impactHtml(im, p) {
  const owner = p.owner && p.owner !== 'DM' ? ` · ${escapeHtml(p.owner)}'s` : p.owner === 'DM' || !p.owner ? ' · the DM\'s' : '';
  const end = p.captured ? 'Caught'
    : im.faintedBy !== undefined ? `Fainted${im.faintedBy ? ` (knocked out by ${escapeHtml(im.faintedBy)})` : ''}`
      : `Ended on ${p.currentHP ?? '?'}/${p.maxHP ?? '?'} HP${p.maxVP ? `, ${p.currentVP ?? '?'}/${p.maxVP} VP` : ''}`;
  const rows = (list, label) => (list.length ? list.map(row => `
    <div class="dm-impact-row"><span>${escapeHtml(row.name)}${row.ko ? ' <span class="dm-impact-ko">KO</span>' : ''}</span>
      <span>${row.hp ? `<strong>${row.hp}</strong> HP` : ''}${row.vp ? ` ${row.hp ? '+ ' : ''}<strong>${row.vp}</strong> VP` : ''}${!row.hp && !row.vp ? '0' : ''}
      <small>${row.hits} hit${row.hits === 1 ? '' : 's'}${row.crits ? `, ${row.crits} crit${row.crits === 1 ? '' : 's'}` : ''}</small></span></div>`).join('')
    : `<div class="dm-hint">${label}</div>`);
  return `
    <div class="dm-impact">
      <div class="dm-impact-head">
        <span class="dm-enc-thumb dm-impact-pic" data-img="${escapeHtml(p.image || '')}"></span>
        <div>
          <strong>${escapeHtml(p.name)}</strong> <small>${escapeHtml(p.speciesName && p.speciesName !== p.name ? `${p.speciesName} · ` : '')}Lv ${p.level ?? '?'}${owner}</small>
          <div class="dm-hint">${end}</div>
        </div>
      </div>
      <div class="dm-after-stats dm-impact-stats">
        <div><strong>${im.dealtHp}</strong><span>Damage dealt${im.dealtVp ? ` (+${im.dealtVp} VP drained)` : ''}</span></div>
        <div><strong>${im.takenHp}</strong><span>Damage taken</span></div>
        <div><strong>${im.used}</strong><span>Moves used</span></div>
        <div><strong>${im.kos}</strong><span>Knocked out</span></div>
        <div><strong>${im.heals}</strong><span>HP healed${im.healsGiven ? ` (healed others ${im.healsGiven})` : ''}</span></div>
      </div>
      <div class="dm-impact-grid">
        <div class="dm-card">
          <div class="dm-card-title">Moves</div>
          ${im.moves.length ? im.moves.map(m => `
            <div class="dm-impact-row"><span><strong>${escapeHtml(m.name)}</strong>${m.used ? ` ×${m.used}` : ''}</span>
              <span>${m.damage ? `<strong>${m.damage}</strong> dmg ` : ''}<small>${[m.hits && `${m.hits} hit${m.hits === 1 ? '' : 's'}`, m.misses && `${m.misses} miss${m.misses === 1 ? '' : 'es'}`, m.crits && `${m.crits} crit${m.crits === 1 ? '' : 's'}`].filter(Boolean).join(', ') || 'no hits'}</small></span></div>`).join('')
            : '<div class="dm-hint">Used no moves.</div>'}
        </div>
        <div class="dm-card">
          <div class="dm-card-title">Damage dealt -- on whom</div>
          ${rows(im.dealt, 'Hit nobody.')}
        </div>
        <div class="dm-card">
          <div class="dm-card-title">Damage taken -- from whom</div>
          ${rows(im.taken, im.other.length ? '' : 'Took no hits.')}
          ${im.other.map(o => `<div class="dm-impact-row"><span>${escapeHtml(o.text)}</span><span><strong>${o.amount}</strong> ${o.pool === 'vp' ? 'VP' : 'HP'}</span></div>`).join('')}
        </div>
      </div>
      <details class="dm-impact-log">
        <summary>Round by round (${im.rounds.reduce((n, [, lines]) => n + lines.length, 0)})</summary>
        ${im.rounds.map(([r, lines]) => `<div class="dm-impact-round"><span>Round ${r}</span>
          ${lines.map(l => `<div class="${l.dir}">${escapeHtml(l.text)}</div>`).join('')}</div>`).join('')}
      </details>
    </div>`;
}

async function openImpact(b, pid) {
  const p = (b.participants || []).find(x => x.id === pid);
  if (!p) return;
  let entries;
  try { entries = await battleEntries(b); } catch (err) { showCombatAlert(err.message, { title: `${p.name} -- impact` }); return; }
  openDmModal({
    title: `💥 ${p.name} -- impact`,
    wide: true,
    html: entries ? impactHtml(impactOf(entries, pid, b), p)
      : '<div class="dm-hint">This battle\'s log isn\'t on the Pi, so there\'s nothing to add up.</div>',
    onOpen: body => showPics(body),
  });
}

async function reloadParty() {
  try { _after.party = (await DmAPI.party()).data || _after.party; } catch { /* keep what's there */ }
}

/** An item into a trainer's bag -- one from the items list, or the DM's own (kept with its description). */
function giveItem(trainer, name, qty, description) {
  const items = JSON.parse(sessionStorage.getItem('items') || '[]');
  const known = items.some(i => lower(i.name) === lower(name));
  return DmAPI.giveItem(trainer, name, qty, { custom: !known, description });
}

/** XP from the old DM tool's trainer backup (shima-trainers-....json): its player trainers and their Pokemon. */
function importXp() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { showCombatAlert("That file isn't a backup from the old DM tool.", { title: 'Import XP' }); return; }
    const players = (Array.isArray(data) ? data : data.trainers || []).filter(t => t && !t.isNPC && t.name);
    if (!players.length) { showCombatAlert('No player trainers in that file.', { title: 'Import XP' }); return; }
    // Only trainers and Pokemon that are in the app too (the old tool's copies may be out of date).
    const changes = [];
    const skipped = [];
    players.forEach((t) => {
      const rec = trainerRecord(t.name);
      if (!rec) { skipped.push(t.name); return; }
      if (Number.isFinite(Number(t.xp))) changes.push({ trainer: rec.trainer.name, set: Number(t.xp) });
      (t.pokemon || []).forEach((p) => {
        if (!p.name || !Number.isFinite(Number(p.xp))) return;
        const m = rec.pokemon.find(x => lower(x.name) === lower(p.name));
        if (m) changes.push({ trainer: rec.trainer.name, pokemon: m.name, set: Number(p.xp) });
        else skipped.push(`${t.name}'s ${p.name}`);
      });
    });
    if (!changes.length) { showCombatAlert('None of the trainers or Pokémon in that file are in the app.', { title: 'Import XP' }); return; }
    if (!await showCombatConfirm(`Set the XP of ${changes.length} trainers and Pokémon from ${file.name}? The XP they have here now is replaced.${skipped.length ? `\n\nNot in the app, left out: ${skipped.join(', ')}` : ''}`, { title: 'Import XP', yesLabel: 'Import', noLabel: 'Cancel' })) return;
    try { await DmAPI.changeXp(changes); } catch (err) { showCombatAlert(err.message, { title: 'Import XP' }); return; }
    await reloadParty();
    toast(`Imported the XP of ${changes.length} trainers and Pokémon.`);
    const body = document.getElementById('encBody');
    if (body) drawAftermath(body);
  });
  input.click();
}
