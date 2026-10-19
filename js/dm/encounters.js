// DM console -- the battle module's Encounter setup and Post battle tabs: Benjakronk's old encounter builder, rebuilt on
// the Pi.
//
// Library: encounters prepared ahead of a session (dm_encounters table) -- a name, the wild Pokemon (each with a nature,
// its abilities and any stat bonuses -- the ⚙ panel), NPC trainers from the NPC library, round-based events, and notes
// and note categories (under the encounter list on the left). The map, its terrain and weather are Map setup's. The old
// tool's random encounter / random trainer generators, saved-Pokemon library (always shown under the encounter list)
// and exclusion list are here too. "Put in play" makes it the next battle: its Pokemon and NPC trainers go into the battle setup
// (setup-store.js), where Map setup places everyone and starts the battle; the encounter becomes the one in play
// ('encounter-run'), whose events and capture helper show beside the running battle (battle-live.js). Until the battle
// starts, the next battle follows the encounter in play as it's changed (syncInPlay) -- whoever keeps their entry keeps
// their spot on the map.
//
// Who's in the next battle is decided here and only here (Map setup doesn't add anyone), so the two never disagree.
//
// Since the 2026-10-16 playtest it's a builder that never starts anything by itself: it's reachable while a battle runs
// (the running battle's third tab, battle-live.js), an encounter can carry its own map (made here with the map editor --
// map-store.js), the Battle module imports one (importEncounterDialog: its creatures and its map become the next
// battle), each wild Pokemon's ℹ️ shows everything its species is known for (species-info.js), and an encounter's NPC
// opens in the NPC module to change it for good.
//
// Post battle: after a PvE battle ends (routes_combat._remember_battle keeps it as 'last-battle'), what happened -- who
// was defeated, caught or got away -- and what to hand out. Unlike the old tool, which exported files or called the
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
import { mapPreviewHtml, renderMapEditor } from './map-editor.js';
import { createMapStore } from './map-store.js';
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
  const [encs, species, npcs, excl, saved, run] = await Promise.all([
    DmAPI.encounters(), getSpecies(), DmAPI.npcs(), DmAPI.getState('encounter-exclusions'), DmAPI.getState('saved-pokemon'), DmAPI.getState('encounter-run'),
  ]);
  // An encounter being changed here keeps this tab's copy (its save may not be on the Pi yet).
  _encounters = (encs.data || []).map(e => (_saveTimers.has(e.id) ? _encounters.find(x => x.id === e.id) || e : e));
  _species = species;
  _npcs = npcs.data || [];
  _exclusions = Array.isArray(excl) ? excl : [];
  _saved = Array.isArray(saved) ? saved : [];
  _runId = run?.encounterId || null;
  _runLinked = !!run?.linked;
}

// The Pokedex module's "not possible to encounter randomly" box changes the same exclusion list.
window.addEventListener('dm:exclusions-changed', (e) => {
  _exclusions = Array.isArray(e.detail) ? e.detail : _exclusions;
  const b = document.getElementById('encExclusions');
  if (b) b.textContent = `🚫 Exclusions (${_exclusions.length})`;
});

async function renderLibrary(body) {
  body.innerHTML = '<div class="dm-loading">Loading the encounters…</div>';
  try {
    await loadLibraryData();
  } catch (err) {
    body.innerHTML = `<div class="dm-loading">Couldn't load the encounters: ${escapeHtml(err.message)}</div>`;
    return;
  }
  if (_tab !== 'library') return;
  // Opens on the encounter in play, unless another one was picked.
  if (!_encounters.some(e => e.id === _selectedId)) _selectedId = _encounters.some(e => e.id === _runId) ? _runId : null;
  body.innerHTML = `
    <div class="dm-editor">
      <aside class="dm-editor-tools">
        <div class="dm-editor-head"><h2>Encounter setup</h2><span class="dm-pill ok" id="encSave">All saved</span></div>
        <button class="dm-btn primary wide" id="encNew">+ New encounter</button>
        <input class="dm-input" id="encSearch" placeholder="Search encounters…" autocomplete="off">
        <div class="dm-enc-list" id="encList"></div>
        <div class="dm-enc-savedlib">
          <div class="dm-card-title"><span>📚 Saved Pokémon</span><span class="dm-hint" id="encSavedCount"></span></div>
          <div class="dm-enc-saved" id="encSavedList"></div>
        </div>
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
  document.getElementById('encSavedList').addEventListener('click', onSavedClick);
  document.getElementById('encList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-enc]');
    if (row) { _selectedId = row.dataset.enc; _adding = false; renderList(); renderSheet(); }
  });
  document.getElementById('encNew').addEventListener('click', () => {
    const enc = blankEncounter();
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
  const list = _encounters.filter(e => !q || e.name.toLowerCase().includes(q));
  box.innerHTML = list.length ? list.map(e => `
    <button class="dm-enc-row${e.id === _selectedId ? ' selected' : ''}" data-enc="${escapeHtml(e.id)}">
      <strong>${escapeHtml(e.name || 'Unnamed')}${e.id === _runId ? ' <span class="dm-enc-live" title="The next battle">● in play</span>' : ''}</strong>
      <small>${escapeHtml(summary(e))}</small>
    </button>`).join('') : `<div class="dm-hint">${_encounters.length ? 'No encounter matches that.' : 'No encounters yet -- make one with "+ New encounter", or save the next battle as one.'}</div>`;
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
  renderSaved(); // its ＋ adds to the open encounter
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
      <input class="dm-input dm-enc-name" id="encName" data-f="name" value="${escapeHtml(enc.name)}" placeholder="Encounter name">
      <div class="dm-enc-actions">
        <button class="dm-btn" id="encSaveBtn" title="Save it on the Pi now (it also saves on its own a moment after each change)">💾 Save encounter</button>
        ${enc.id === _runId
          ? '<span class="dm-enc-live dm-enc-inplay" title="This is the next battle -- changes here go straight into it">● In play</span><button class="dm-btn primary" id="encPlace">📍 Place on the map</button>'
          : '<button class="dm-btn primary" id="encLoad" title="Make this the next battle (its creatures and its map) -- the same as Import in the Battle module">▶ Use for the next battle</button>'}
        <button class="dm-btn" id="encDup">Duplicate</button>
        <button class="dm-btn danger" id="encDel">Delete</button>
      </div>
    </div>
    <div class="dm-enc-grid">
      <div class="dm-card dm-enc-wide dm-enc-mapcard">
        <div class="dm-card-title"><span>🗺️ Map</span>
          <span class="dm-row dm-enc-titlebtns">
            <button class="dm-btn small primary" data-act="map-edit">${enc.map ? '✏️ Edit map' : '+ Make a map'}</button>
            <button class="dm-btn small" data-act="map-from-setup" title="A copy of the map in the Battle module's Map setup">📋 Copy Map setup's</button>
            <button class="dm-btn small" data-act="map-from-saved">💾 From saved maps</button>
            ${enc.map ? '<button class="dm-btn small danger" data-act="map-del">✕ No map</button>' : ''}
          </span></div>
        ${enc.map ? `<div class="dm-enc-mapview">${mapPreviewHtml({ map: enc.map, creatures: [] })}</div>`
          : '<div class="dm-hint">No map of its own -- the battle uses whatever map is in Map setup. Make one here to bring it along when the encounter is imported.</div>'}
      </div>
      <div class="dm-card dm-enc-wide">
        <div class="dm-card-title"><span>Wild Pokémon (${enc.pokemon.length})</span>
          <span class="dm-row dm-enc-titlebtns">
            <button class="dm-btn small" data-act="mon-add">🔍 Add</button>
            <button class="dm-btn small" data-act="mon-random">🎲 Random</button>
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
          <label title="Shiny"><input type="checkbox" data-k="shiny" ${p.shiny ? 'checked' : ''}>✨</label>
          <label title="Starts hidden -- not fighting yet, and only you see it"><input type="checkbox" data-k="heldBack" ${p.heldBack ? 'checked' : ''}>Hidden</label>
        </div>
        <div class="dm-enc-mon-sum"><span data-sum="abil">✦ ${escapeHtml(abilityNames(p, sp))}</span>${bonuses.length ? `<span class="dm-enc-bonus-sum">${escapeHtml(bonuses.join(' · '))}</span>` : ''}</div>
      </div>
      <div class="dm-enc-mon-btns">
        <button class="dm-icon-btn" data-act="mon-info" title="Everything about the species -- behaviour, habitat, senses, how to catch it">ℹ️</button>
        <button class="dm-btn small${open ? ' primary' : ''}" data-act="mon-more" title="Abilities and stat bonuses">⚙ Customize</button>
        <button class="dm-icon-btn" data-act="mon-save" title="Save to the Pokémon library, for other encounters">💾</button>
        <button class="dm-icon-btn" data-act="mon-dup" title="One more of these">⧉</button>
        <button class="dm-icon-btn danger" data-act="mon-del" title="Remove">✕</button>
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
  if (act === 'map-edit') { editEncounterMap(enc); return; }
  if (act === 'map-from-setup') {
    if (enc.map && !await showCombatConfirm(`Replace "${enc.name}"'s map with a copy of Map setup's?`, { title: 'Map', yesLabel: 'Replace', noLabel: 'Cancel' })) return;
    const m = getSetup()?.map;
    if (!m) { showCombatAlert('Map setup has no map yet.', { title: 'Map' }); return; }
    enc.map = { ...JSON.parse(JSON.stringify(m)), ready: true };
    changed();
    return;
  }
  if (act === 'map-from-saved') { pickSavedMap(enc); return; }
  if (act === 'map-del') {
    if (!await showCombatConfirm(`Take the map off "${enc.name}"? The battle will use Map setup's map instead.`, { title: 'Map', yesLabel: 'Take it off', noLabel: 'Cancel' })) return;
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
  toast(`${p.name} saved to the Pokémon library.`);
  renderSaved();
}

/** The saved-Pokemon library, under the encounter list: ＋ adds one to the open encounter. */
function renderSaved() {
  const box = document.getElementById('encSavedList');
  if (!box) return;
  const count = document.getElementById('encSavedCount');
  if (count) count.textContent = _saved.length ? String(_saved.length) : '';
  const enc = current();
  box.innerHTML = _saved.length ? _saved.map(sv => `
    <div class="dm-enc-savedrow" data-saved="${escapeHtml(sv.id)}">
      <span class="dm-enc-thumb" data-img="${escapeHtml(speciesByName(sv.species)?.image || '')}"></span>
      <span><strong>${escapeHtml(sv.name)}</strong><small>${escapeHtml(sv.species)} · Lv ${sv.level}${sv.nature ? ` · ${escapeHtml(sv.nature)}` : ''}${sv.item ? ` · holds ${escapeHtml(sv.item)}` : ''}${sv.shiny ? ' · ✨' : ''}</small></span>
      <button class="dm-btn small" data-act="use" ${enc ? '' : 'disabled'} title="${enc ? `Add to ${escapeHtml(enc.name)}` : 'Pick an encounter first'}">＋ Add</button>
      <button class="dm-icon-btn danger" data-act="drop" title="Delete from the library">✕</button>
    </div>`).join('') : '<div class="dm-hint">Use 💾 on a wild Pokémon to keep it here for other encounters.</div>';
  box.querySelectorAll('[data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); });
}

async function onSavedClick(e) {
  const act = e.target.closest('[data-act]')?.dataset.act;
  const sv = _saved.find(x => x.id === e.target.closest('[data-saved]')?.dataset.saved);
  if (!act || !sv) return;
  if (act === 'use') {
    const enc = current();
    if (!enc) return;
    enc.pokemon.push({ ...JSON.parse(JSON.stringify(sv)), id: newId('mon'), heldBack: false, nature: sv.nature || randomNature() });
    relabel(enc);
    scheduleSave(enc);
    renderSheet();
    renderList();
    return;
  }
  if (!await showCombatConfirm(`Delete ${sv.name} from the saved Pokémon?`, { title: 'Saved Pokémon', yesLabel: 'Delete', noLabel: 'Cancel' })) return;
  _saved = _saved.filter(x => x !== sv);
  await DmAPI.saveState('saved-pokemon', _saved).catch(err => showCombatAlert(err.message, { title: 'Saved Pokémon' }));
  renderSaved();
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

// ---- An encounter's own map ----

/** The encounter's map in the map editor (a store of its own, map-store.js), over the page until Done / Back. */
function editEncounterMap(enc) {
  document.getElementById('encMapEditor')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'encMapEditor';
  overlay.className = 'dm-live-map-overlay';
  const root = document.createElement('div');
  root.className = 'dm-live-map-root';
  overlay.appendChild(root);
  document.body.appendChild(overlay);
  const store = createMapStore(enc.map, (m) => { enc.map = m; return saveNow(enc); });
  renderMapEditor(root, {
    store, backLabel: '← Encounter', title: `Map · ${enc.name}`,
    onDone: () => { enc.map = { ...store.getSetup().map, ready: true }; overlay.remove(); renderSheet(); renderList(); },
  });
}

async function pickSavedMap(enc) {
  const maps = await DmAPI.getState('saved-maps').catch(() => null) || [];
  if (!maps.length) { showCombatAlert('No saved maps yet -- save one from the map editor (Map setup).', { title: 'Saved maps' }); return; }
  const id = await openDmModal({
    title: `A saved map for "${enc.name}"`,
    html: `<div class="dm-enc-savedmaps">${maps.map(m => `<button class="dm-species-item" data-map="${escapeHtml(m.id)}"><span><span class="dm-species-name">${escapeHtml(m.name)}</span>
      <span class="dm-species-meta">${m.map?.rows} × ${m.map?.cols} squares · ${(m.map?.objects || []).length} objects</span></span></button>`).join('')}</div>`,
    buttons: [{ label: 'Cancel', value: null }],
    onOpen: (body, close) => body.addEventListener('click', (e) => { const b = e.target.closest('[data-map]'); if (b) close(b.dataset.map); }),
  });
  const picked = maps.find(m => m.id === id);
  if (!picked) return;
  enc.map = { ...JSON.parse(JSON.stringify(picked.map)), ready: true };
  scheduleSave(enc);
  renderSheet();
}

/** The Battle module's Import: pick an encounter, and it becomes the next battle -- its creatures, and its map if it has
 * one (loadIntoSetup). Works without this tab ever having been opened. */
export async function importEncounterDialog() {
  try { await loadLibraryData(); } catch (err) { showCombatAlert(err.message, { title: 'Import encounter' }); return; }
  if (!_encounters.length) { showCombatAlert('No encounters yet -- build one under Encounter setup.', { title: 'Import encounter' }); return; }
  const id = await openDmModal({
    title: '📥 Import an encounter',
    html: `<input class="dm-input" id="impSearch" placeholder="Search…" autocomplete="off" style="margin-bottom:0.5rem">
      <div class="dm-enc-savedmaps" id="impList">${_encounters.map(e => `<button class="dm-species-item" data-enc="${escapeHtml(e.id)}" data-search="${escapeHtml(e.name.toLowerCase())}">
        <span><span class="dm-species-name">${escapeHtml(e.name || 'Unnamed')}${e.id === _runId ? ' · ● in play' : ''}</span>
        <span class="dm-species-meta">${escapeHtml(summary(e))}${e.map ? ` · 🗺️ its own map (${e.map.rows} × ${e.map.cols})` : ''}</span></span></button>`).join('')}</div>`,
    buttons: [{ label: 'Cancel', value: null }],
    onOpen: (body, close) => {
      body.querySelector('#impSearch').addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        body.querySelectorAll('[data-enc]').forEach(b => { b.hidden = !!q && !b.dataset.search.includes(q); });
      });
      body.addEventListener('click', (e) => { const b = e.target.closest('[data-enc]'); if (b) close(b.dataset.enc); });
    },
  });
  const enc = _encounters.find(e => e.id === id);
  if (enc) await loadIntoSetup(enc);
}

/** A new encounter built around a map (the Adventure's "Start encounter"), opened in Encounter setup -- with `creatures`
 * (the adventure's Pokemon and NPCs, adventure.js's liveCreatures shape): each Pokemon an entry of its own, each NPC from
 * the NPC library, both remembering where they stood (position; npcPlacement) and whether they were hidden. */
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
  return enc;
}

async function loadIntoSetup(enc) {
  await flushEncounter(enc);
  const state = await CombatAPI.getState().catch(() => null);
  if (state?.data?.active) {
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
  const replace = body.dataset.mode !== 'add';
  try {
    const built = [];
    for (const p of enc.pokemon) built.push(await buildEncounterMon(enc, p, null));
    const useMap = !!enc.map && body.dataset.map === '1';
    // On its own map, each one starts where it stood when the encounter was made (the adventure's "Start encounter") --
    // a hidden one too: on its square, hidden from the players until it's shown
    if (useMap) built.forEach((c, i) => { if (enc.pokemon[i]?.position) c.position = { ...enc.pokemon[i].position }; });
    updateSetup((s) => {
      if (replace) s.creatures = [];
      if (useMap) {
        // The encounter's own map -- where anyone already stood belonged to the old one.
        s.map = { ...JSON.parse(JSON.stringify(enc.map)), weather: s.map.weather, ready: true, terrain: enc.map.terrain || s.map.terrain };
        s.creatures.forEach((c) => { c.position = null; });
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
    toast(`"${enc.name}" is the next battle${missing.length ? ` (${missing.length} NPC no longer in the library was left out)` : ''} -- place everyone and start it.`);
    window.dispatchEvent(new CustomEvent('dm:show-module', { detail: { name: 'battle' } }));
  } catch (err) {
    showCombatAlert(err.message, { title: `Couldn't load "${enc.name}"` });
  }
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
  return buildPokemonCreature(had?.id || newId(), p.species, p.name || p.species, monConfig(p), {
    encId: enc.id, encKey: `mon:${p.id}`, encSig: monSig(p), trainerId: null, heldBack: !!p.heldBack,
    position: p.heldBack && !p.position ? null : had?.position || null, // (a hidden one with a square keeps it)
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
  if (state?.data?.active) return; // the battle has started -- the setup is what it started from
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

let _after = null; // {last, run, party}
const _xpAdd = { trainers: {}, pokemon: {} }; // what's typed in, not saved yet
const lower = s => String(s || '').toLowerCase();
const monKey = (trainer, species) => `${lower(trainer)}|${lower(species)}`;

async function renderAftermath(body) {
  body.innerHTML = '<div class="dm-loading">Loading the last battle…</div>';
  try {
    const [last, run, party, npcs] = await Promise.all([
      DmAPI.getState('last-battle'), DmAPI.getState('encounter-run'), DmAPI.party(), DmAPI.npcs(),
    ]);
    _npcs = npcs.data || [];
    _after = { last, run, party: party.data || [] };
  } catch (err) {
    body.innerHTML = `<div class="dm-loading">Couldn't load the post battle: ${escapeHtml(err.message)}</div>`;
    return;
  }
  if (_tab !== 'aftermath') return;
  drawAftermath(body);
}

/** Everyone in the last battle, sorted into what the aftermath needs. */
function battleSummary(last) {
  const ps = last.participants || [];
  const enemies = ps.filter(p => p.owner === 'DM' || !p.owner);
  const players = ps.filter(p => p.owner && p.owner !== 'DM');
  return {
    caught: enemies.filter(p => p.captured),
    defeated: enemies.filter(p => !p.captured && Number(p.currentHP) <= 0),
    away: enemies.filter(p => !p.captured && Number(p.currentHP) > 0),
    fainted: players.filter(p => p.combatantType === 'pokemon' && Number(p.currentHP) <= 0),
    trainers: [...new Set(players.map(p => p.owner))],
    present: new Set(players.filter(p => p.combatantType === 'pokemon').map(p => monKey(p.owner, p.speciesName || p.name))),
  };
}

function trainerRecord(name) {
  return _after.party.find(t => lower(t.trainer?.name) === lower(name)) || null;
}

function tags(list, cls) {
  return list.map(p => `<span class="dm-enc-tag ${cls}">${escapeHtml(p.name)} <small>Lv ${p.level ?? '?'}</small></span>`).join('');
}

function drawAftermath(body) {
  const { last, run } = _after;
  if (!last) {
    body.innerHTML = '<div class="dm-cs-empty">No PvE battle has ended yet. When one does, what happened and what to hand out shows up here.</div>';
    return;
  }
  const s = battleSummary(last);
  const ended = new Date(last.endedAt);
  const allTrainers = _after.party.map(t => t.trainer?.name).filter(Boolean);
  const trainerOptions = (sel = '') => [...s.trainers, ...allTrainers.filter(t => !s.trainers.some(x => lower(x) === lower(t)))]
    .map(t => `<option ${lower(t) === lower(sel) ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('');
  const minutes = Math.max(1, Math.ceil(((Number(last.round) || 1) * ROUND_SECONDS) / 60));
  const clock = getClock();
  last.given = last.given || {};
  // Given to its trainer already from the catch popup (battle-live.js), during the battle
  (last.participants || []).forEach((p) => { if (p.givenTo && !last.given[p.id]) last.given[p.id] = p.givenTo; });
  last.lootGiven = last.lootGiven || {};

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
          <h2>${escapeHtml(run?.name || 'Battle')} -- post battle</h2>
          <div class="dm-hint">Ended ${ended.toLocaleString()} · ${last.round || 1} round${last.round === 1 ? '' : 's'}${last.done ? ' · <strong>marked done</strong>' : ''}</div>
        </div>
        <button class="dm-btn ${last.done ? '' : 'primary'}" id="afDone">${last.done ? 'Done ✓' : '✓ Done with this battle'}</button>
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
              ${last.given[p.id] ? `<span class="dm-pill ok">✓ In ${escapeHtml(last.given[p.id])}'s team</span>` : `
                <select class="dm-select" data-k="trainer">${trainerOptions()}</select>
                <input class="dm-input" data-k="nickname" placeholder="Nickname (optional)">
                <button class="dm-btn primary small" data-act="give-mon">Give</button>`}
            </div>`).join('')}
          <div class="dm-hint">Built the way you set it up (level, nature, abilities, held item), with full HP -- it shows up on their phone straight away.</div>
        </div>` : ''}

        <div class="dm-card">
          <div class="dm-card-title">Loot & money</div>
          ${loot.length ? loot.map(it => `
            <div class="dm-after-loot" data-loot="${escapeHtml(it.key)}" data-name="${escapeHtml(it.name)}" data-desc="${escapeHtml(it.description)}">
              <span><strong>${escapeHtml(it.name)}</strong>${it.quantity > 1 ? ` ×${it.quantity}` : ''}<small>from ${escapeHtml(it.from)}</small></span>
              ${last.lootGiven[it.key] ? `<span class="dm-pill ok">✓ ${escapeHtml(last.lootGiven[it.key])}</span>` : `
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

        <div class="dm-card">
          <div class="dm-card-title">⏱ World clock</div>
          <div class="dm-hint">Now: <strong>${clock ? `${escapeHtml(formatDate(clock))} -- ${formatTime(clock)} (${escapeHtml(phaseName(clock))})` : '?'}</strong>. The fight took ${last.round || 1} round${last.round === 1 ? '' : 's'} (~${minutes} min).</div>
          <label class="dm-check" style="margin-top:0.5rem"><input type="radio" name="afTime" value="combat" checked><span>Move it on by the fight (${minutes} min)</span></label>
          <label class="dm-check"><input type="radio" name="afTime" value="custom"><span>By <input class="dm-input dm-inline-num" id="afMinutes" type="number" min="0" step="5" value="60"> minutes</span></label>
          <label class="dm-check"><input type="radio" name="afTime" value="phase"><span>On to <select class="dm-select dm-inline-sel" id="afPhase">${PHASES.map(p => `<option>${p.name}</option>`).join('')}</select></span></label>
          <div class="dm-row" style="margin-top:0.4rem">
            <button class="dm-btn small primary" id="afTimeGo">Move the clock</button>
            <button class="dm-btn small" id="afWeather">🎲 Roll weather</button>
            <button class="dm-btn small" id="afLog" ${last.logged ? 'disabled' : ''}>${last.logged ? 'Logged ✓' : '📌 Log as calendar event'}</button>
          </div>
        </div>

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
          <div class="dm-card-title">Notes</div>
          ${run ? `<div class="dm-after-notes">${escapeHtml(run.notes || '') || '<span class="dm-hint">No notes.</span>'}</div>
            ${(run.noteCategories || []).map(c => `<details class="dm-after-cat"><summary>${escapeHtml(c.icon || '📝')} ${escapeHtml(c.name || 'Notes')}</summary><div class="dm-after-notes">${escapeHtml(c.content || '')}</div></details>`).join('')}`
            : '<div class="dm-hint">No encounter was loaded for this battle.</div>'}
        </div>

        <details class="dm-card dm-collapsible">
          <summary class="dm-card-title">📜 Battle log (${(last.log || []).length})</summary>
          <div class="dm-after-log">${(last.log || []).map(l => `<div>${escapeHtml(l)}</div>`).join('')}</div>
        </details>
      </div>
    </div>`;
  if (!document.getElementById('afItems')) {
    const items = JSON.parse(sessionStorage.getItem('items') || '[]');
    document.body.insertAdjacentHTML('beforeend', `<datalist id="afItems">${items.map(i => `<option value="${escapeHtml(i.name)}">`).join('')}</datalist>`);
  }
  body.querySelectorAll('[data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); });
  wireAftermath(body, s, minutes);
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

function xpCardHtml(name, s) {
  const rec = trainerRecord(name);
  const level = rec?.trainer?.level || 1;
  const tKey = lower(name);
  const tXp = xpOf(rec);
  const mons = rec?.pokemon || [];
  return `
    <div class="dm-after-xpcard" data-trainer="${escapeHtml(name)}">
      <div class="dm-after-xprow head">
        <strong>${escapeHtml(name)} <small>Lv ${level}</small></strong>
        <span>${tXp.toLocaleString()}</span>
        <input class="dm-input" type="number" data-xp-t value="${_xpAdd.trainers[tKey] ?? ''}" placeholder="+XP">
        <span class="dm-after-new">${xpLine(tXp, _xpAdd.trainers[tKey])}</span>
      </div>
      ${mons.map((m) => {
        const key = monKey(name, m.name);
        const xp = xpOf(rec, m.name);
        const fought = s.present.has(key);
        return `
        <div class="dm-after-xprow${fought ? '' : ' absent'}" data-mon="${escapeHtml(m.name)}">
          <label><input type="checkbox" data-present ${fought ? 'checked' : ''} title="Fought in this battle (gets the 'every Pokémon' XP)"> ${escapeHtml(m.nickname || m.name)} <small>Lv ${m.level}</small></label>
          <span>${xp.toLocaleString()}</span>
          <input class="dm-input" type="number" data-xp-p value="${_xpAdd.pokemon[key] ?? ''}" placeholder="+XP">
          <span class="dm-after-new">${xpLine(xp, _xpAdd.pokemon[key])}</span>
        </div>`;
      }).join('')}
    </div>`;
}

function wireAftermath(body, s, minutes) {
  const { last } = _after;
  const saveLast = () => DmAPI.saveState('last-battle', last).catch(err => toast(`Couldn't save: ${err.message}`));
  const redraw = () => drawAftermath(body);

  body.querySelector('#afDone').addEventListener('click', async () => {
    last.done = !last.done;
    await saveLast();
    redraw();
    window.dispatchEvent(new CustomEvent('dm:aftermath-changed'));
  });

  body.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'give-mon') {
      const row = e.target.closest('[data-caught]');
      const p = last.participants.find(x => x.id === row.dataset.caught);
      const trainer = row.querySelector('[data-k="trainer"]').value;
      const nickname = row.querySelector('[data-k="nickname"]').value.trim();
      const c = getSetup()?.creatures.find(x => x.id === p.id);
      const cfg = c ? { species: c.config.species, ...monConfig(c.config) } : { species: p.speciesName || p.name, level: p.level, nature: p.nature || '', abilities: [0] };
      e.target.disabled = true;
      try {
        await DmAPI.givePokemon(trainer, { ...cfg, nickname: nickname || (p.name !== cfg.species && !/ [A-Z]$/.test(p.name) ? p.name : '') });
        last.given[p.id] = trainer;
        await saveLast();
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
        last.lootGiven[row.dataset.loot] = `${trainer}${qty > 1 ? ` ×${qty}` : ''}`;
        await saveLast();
        redraw();
      } catch (err) { e.target.disabled = false; showCombatAlert(err.message, { title: 'Give item' }); }
    }
  });

  body.querySelector('#afItemGive').addEventListener('click', async () => {
    const name = body.querySelector('#afItem').value.trim();
    if (!name) return;
    const qty = Math.max(1, Number(body.querySelector('#afItemQty').value) || 1);
    const trainer = body.querySelector('#afItemTo').value;
    try { await giveItem(trainer, name, qty, ''); body.querySelector('#afItem').value = ''; toast(`Gave ${trainer} ${qty} × ${name}.`); } catch (err) { showCombatAlert(err.message, { title: 'Give item' }); }
  });
  body.querySelector('#afMoneyGive').addEventListener('click', async () => {
    const amount = Number(body.querySelector('#afMoney').value) || 0;
    if (!amount) return;
    const to = body.querySelector('#afMoneyTo').value;
    const who = to === '__all' ? s.trainers : [to];
    try {
      for (const t of who) await DmAPI.giveMoney(t, amount);
      body.querySelector('#afMoney').value = '';
      toast(`Gave ${amount} to ${who.join(', ')}.`);
    } catch (err) { showCombatAlert(err.message, { title: 'Give money' }); }
  });

  // World clock
  body.querySelector('#afTimeGo').addEventListener('click', () => {
    const mode = body.querySelector('input[name="afTime"]:checked').value;
    if (mode === 'combat') advanceMinutes(minutes);
    else if (mode === 'custom') advanceMinutes(Number(body.querySelector('#afMinutes').value) || 0);
    else skipToPhase(body.querySelector('#afPhase').value);
    const c = getClock();
    toast(`The clock is now ${formatDate(c)}, ${formatTime(c)}.`);
    redraw();
  });
  body.querySelector('#afWeather').addEventListener('click', () => { const w = rollWeather(); toast(`New weather: ${WEATHER[w]?.icon || ''} ${WEATHER[w]?.name || w}`); });
  body.querySelector('#afLog').addEventListener('click', async () => {
    const c = getClock();
    const parts = [`Rounds: ${last.round || 1}`];
    if (s.defeated.length) parts.push(`Defeated: ${s.defeated.map(p => p.name).join(', ')}`);
    if (s.caught.length) parts.push(`Caught: ${s.caught.map(p => p.name).join(', ')}`);
    if (s.trainers.length) parts.push(`Trainers: ${s.trainers.join(', ')}`);
    updateClock(cl => cl.events.push({ id: newId('evt'), year: c.year, month: c.month, day: c.day, title: _after.run?.name || 'Battle', notes: parts.join('\n'), recurring: false }));
    last.logged = true;
    await saveLast();
    toast(`Logged on ${formatDate(c)}.`);
    redraw();
  });

  // Experience
  const xpBox = body.querySelector('.dm-after-xp');
  if (xpBox) {
    xpBox.addEventListener('input', (e) => {
      const card = e.target.closest('[data-trainer]');
      if (!card) return;
      if (e.target.matches('[data-xp-t]')) _xpAdd.trainers[lower(card.dataset.trainer)] = e.target.value === '' ? undefined : Number(e.target.value);
      if (e.target.matches('[data-xp-p]')) _xpAdd.pokemon[monKey(card.dataset.trainer, e.target.closest('[data-mon]').dataset.mon)] = e.target.value === '' ? undefined : Number(e.target.value);
      const row = e.target.closest('.dm-after-xprow');
      const cur = Number(row.children[1].textContent.replace(/\D/g, '')) || 0;
      row.querySelector('.dm-after-new').innerHTML = xpLine(cur, e.target.value);
    });
    xpBox.addEventListener('change', (e) => {
      if (e.target.matches('[data-present]')) e.target.closest('.dm-after-xprow').classList.toggle('absent', !e.target.checked);
    });
    body.querySelector('#afQuickTGo').addEventListener('click', () => {
      const v = Number(body.querySelector('#afQuickT').value) || 0;
      s.trainers.forEach(t => { _xpAdd.trainers[lower(t)] = (_xpAdd.trainers[lower(t)] || 0) + v; });
      redraw();
    });
    body.querySelector('#afQuickPGo').addEventListener('click', () => {
      const v = Number(body.querySelector('#afQuickP').value) || 0;
      xpBox.querySelectorAll('[data-present]:checked').forEach((cb) => {
        const k = monKey(cb.closest('[data-trainer]').dataset.trainer, cb.closest('[data-mon]').dataset.mon);
        _xpAdd.pokemon[k] = (_xpAdd.pokemon[k] || 0) + v;
      });
      redraw();
    });
    body.querySelector('#afXpSave').addEventListener('click', async () => {
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
  body.querySelector('#afXpImport').addEventListener('click', importXp);
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
