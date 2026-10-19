// DM console -- PokeNav's Adventure Mode tab (the user's ask, 2026-10-16; its own module until 2026-10-19, see pokenav.js):
// a map on the table's battle-map screen without a battle. The DM builds the adventure's map (the same map editor as Map
// setup -- kept on the Pi as dm_state 'adventure-map') and starts it; the players join from their app (the map button on
// the trainer card) with their trainer and, if they like, any of their party Pokemon, and walk around on it -- no turns, no
// initiative, no movement limit (routes_combat.py's start_adventure). The DM decides when the players may join / place
// themselves and when they may move (the switches on the running adventure's bar). Meanwhile the DM changes the map live,
// moves anyone (the live map editor), and can turn the map into an encounter (Encounter setup) or the next battle's map.
// The capture guide shows how hard each Pokemon is to catch, before anyone meets one.
//
// Later on 2026-10-19 (the user's call): no more "Start adventure". The DM prepares the map with its Pokemon and NPCs
// (hidden or not) whenever they like -- kept with the map (map-store.js's `creatures`) -- and "Allow player placement"
// opens it to the players (it goes live then, with everything on it; ticking it off again closes joining). "Start
// encounter" takes the map as it is -- objects, Pokemon and NPCs where they stand, hidden ones too -- into a new encounter
// in Encounter setup, so several maps and encounters can be prepared ahead of time.
import { CombatAPI, DmAPI } from '../api.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import { DM, escapeHtml, typeBadges, getSpecies, toast, openDmModal } from './dm-common.js';
import { abilityList } from '../utils/battle-lists.js';
import { renderMapEditor } from './map-editor.js';
import { createMapStore } from './map-store.js';
import { setLiveSession } from './live-map-store.js';
import { updateSetup, flushSetup, loadSetup, getSetup } from './setup-store.js';
import { createEncounterWithMap } from './encounters.js';
import { captureRulesHtml, speciesDetail, openSpeciesInfo, paintSpeciesImages } from './species-info.js';
import { getClock, WEATHER } from './world-clock.js';
import { TERRAIN } from './encounter-rules.js';

let _section = null;
let _session = null;
let _shown = null; // what's drawn: 'setup' | 'battle' | 'running'
let _store = null; // the adventure map, while it's being set up

function state(s) {
  if (!s?.active) return 'setup';
  return s.battleType === 'adventure' ? 'running' : 'battle';
}

/** Drawn whenever the module is opened (dm-console.js's showModule). */
export async function renderAdventure(section, { session } = {}) {
  _section = section;
  _session = session;
  _shown = null;
  await draw();
}

/** Every battle push (dm-console.js): redrawn when the adventure starts or ends; the live map follows on its own. */
export function adventureSessionChanged(session) {
  _session = session;
  if (!_section || _section.hidden) return;
  if (state(session) !== _shown) { draw(); return; }
  if (_shown === 'running') {
    setLiveSession(session);
    renderPlayers();
    renderSwitches();
  }
}

async function draw() {
  _shown = state(_session);
  const s = _section;
  s.innerHTML = `
    <div class="dm-adv">
      <div class="dm-adv-bar" id="advBar"></div>
      <div class="dm-adv-body" id="advBody"><div class="dm-loading">Loading…</div></div>
    </div>`;
  if (_shown === 'running') return drawRunning();
  return drawSetup();
}

/** The adventure's map as a plain map (the board of the running one, or what's being set up). */
function boardAsMap(session) {
  const b = session.board || {};
  return {
    cols: b.grid?.cols, rows: b.grid?.rows, background: b.backgroundImage || '', objects: b.objects || [], marks: b.marks || {},
    traps: b.traps || [], terrain: _store?.getSetup().map.terrain || 'flat', ready: true,
  };
}

/** The DM's own creatures on the running adventure, the way the prepared map keeps them (map-store.js's creatures):
 * [{id, kind: 'pokemon' | 'npc', name, config, npcId, participant, position, z, hidden}]. The players' aren't the map's. */
function liveCreatures(session) {
  return Object.values(session?.participants || {}).filter(p => (p.owner || DM) === DM).map((p) => {
    const t = session.board?.tokens?.[p.id];
    const isMon = p.combatantType !== 'trainer';
    const slots = abilityList(p.abilities).map(a => a.slot).filter(n => n !== null && n !== undefined);
    return {
      id: p.id, kind: isMon ? 'pokemon' : 'npc', name: p.name,
      config: isMon ? { species: p.speciesName || p.name, level: p.level || 1, nature: p.nature || '', abilities: slots.length ? slots : [0] } : null,
      npcId: p.npcId || null, participant: { ...p, status: undefined }, hidden: p.status === 'spectating',
      position: t ? { col: t.col, row: t.row, facing: t.facing || 0 } : null, z: t?.z || 0,
    };
  });
}

/** The players' switches: Allow player placement (opens the map, going live if it isn't) and Players can move. */
function switchesHtml(live, busy) {
  return `<span class="dm-adv-switches" id="advSwitches">
      <label title="${busy ? 'A battle is running -- the map can be opened once it has ended' : 'The players can put themselves (and their Pokémon) on the map from their app -- the 🗺️ map button on the trainer card'}">
        <input type="checkbox" id="advCanJoin" ${busy ? 'disabled' : ''}> Allow player placement</label>
      ${live ? '<label title="The players can move and turn their trainer and Pokémon -- you move anyone either way"><input type="checkbox" id="advCanMove"> Players can move</label>' : ''}
    </span>`;
}

async function onCanJoin(e) {
  const on = e.target.checked;
  try {
    if (state(_session) === 'running') await CombatAPI.adventureSettings({ canJoin: on });
    else if (on) await startAdventure({ canJoin: true, onScreen: 'adventure' });
  } catch (err) {
    showCombatAlert(err.message, { title: 'Allow player placement' });
    e.target.checked = !on;
  }
}

// ---------------------------------------------------------------------------
// Not running: the adventure's map, and Start
// ---------------------------------------------------------------------------

async function drawSetup() {
  const saved = await DmAPI.getState('adventure-map').catch(() => null);
  _store = createMapStore(saved, (m) => DmAPI.saveState('adventure-map', m), { creatures: true });
  const busy = _shown === 'battle';
  document.getElementById('advBar').innerHTML = `
    <h2>🧭 Adventure <span class="dm-pill todo" title="Only you see it -- open it to the players with Allow player placement, or put it on the table screen">Being prepared</span></h2>
    <span class="dm-hint">${busy ? 'A battle is running -- prepare the map meanwhile; it can be opened once the battle has ended.'
      : 'Put Pokémon, NPCs, objects and items on the map ahead of time -- hidden ones only you see.'}</span>
    ${switchesHtml(false, busy)}
    <span class="dm-adv-btns">
      <button class="dm-btn small" id="advLoad" title="Replace this map with another one: a saved map, an encounter's map, or the Battle module's Map setup">📂 Load a map…</button>
      <button class="dm-btn small" id="advGuide" title="How hard each Pokémon is to catch">🔴 Capture guide</button>
      <button class="dm-btn small" id="advToBattle" title="Put a copy of this map (background, objects, terrain) into the Battle module's Map setup -- the map the next battle you start there is fought on">📋 Copy to Battle setup</button>
      <button class="dm-btn primary" id="advToEnc" title="A new encounter in Encounter setup with this map -- its objects, Pokémon and NPCs where they stand, hidden ones too">⚔️ Start encounter</button>
    </span>`;
  const body = document.getElementById('advBody');
  body.innerHTML = '<div class="dm-adv-editor" id="advEditor"></div>';
  renderMapEditor(document.getElementById('advEditor'), { store: _store, title: 'Adventure map', adventure: true });
  document.getElementById('advCanJoin').addEventListener('change', onCanJoin);
  document.getElementById('advLoad').addEventListener('click', loadOtherMap);
  document.getElementById('advToEnc').addEventListener('click', async () => {
    await _store.flushSetup().catch(() => {});
    encounterOnMap(_store.getSetup().map, _store.getSetup().creatures);
  });
  document.getElementById('advGuide').addEventListener('click', () => captureGuide(_store.getSetup().map.terrain));
  document.getElementById('advToBattle').addEventListener('click', async () => {
    await _store.flushSetup().catch(() => {});
    copyToBattleSetup(_store.getSetup().map);
  });
}

/** "Copy to Battle setup": the Battle module's Map setup (the map the next battle started there is fought on) becomes a
 * copy of this map -- its background, objects, terrain and traps; the adventure's creatures stay here. */
async function copyToBattleSetup(map) {
  if (!await showCombatConfirm("Replace the Battle module's Map setup with a copy of this map (background, objects and terrain)? Creatures already placed there are taken off their squares -- they stay in the battle setup.",
    { title: 'Copy to Battle setup', yesLabel: 'Copy it', noLabel: 'Cancel' })) return;
  const { creatures: _ignored, ...plain } = map || {};
  if (!getSetup()) await loadSetup().catch(() => null); // (the battle setup may not be loaded in this tab yet)
  updateSetup((s) => { s.map = { ...s.map, ...JSON.parse(JSON.stringify(plain)), weather: s.map.weather, ready: true }; s.creatures.forEach((c) => { c.position = null; }); });
  try {
    await flushSetup();
    toast("Copied -- it's the map in Battle → Map setup now.");
  } catch (err) {
    showCombatAlert(err.message, { title: 'Copy to Battle setup' });
  }
}

/** Opens the adventure on the saved adventure map (what's being edited here first, its creatures too) -- "Allow player
 * placement", or PokeNav's "On the table screen". `settings`: {canJoin, onScreen} to start with. Throws when it can't (no
 * map yet, a battle running). */
export async function startAdventure(settings = {}) {
  if (_store) await _store.flushSetup();
  const res = await DmAPI.startAdventure(settings);
  // The reply itself, not only the live push -- whichever arrives first switches the screen.
  if (res?.data?.active) window.dispatchEvent(new CustomEvent('app:combat-updated', { detail: res.data }));
  toast(settings.canJoin ? 'The map is open -- the players place themselves from their app (the 🗺️ map button on the trainer card).'
    : 'The adventure map is on the table screen -- tick Allow player placement when the players may join.');
}

/** Another map as the adventure's: Map setup's, an encounter's, or a saved one. */
async function loadOtherMap() {
  const [maps, encs] = await Promise.all([DmAPI.getState('saved-maps').catch(() => null), DmAPI.encounters().catch(() => null)]);
  const choices = [
    ...(maps || []).map(m => ({ key: `saved:${m.id}`, label: `💾 ${m.name}`, map: m.map })),
    ...((encs?.data) || []).filter(e => e.map).map(e => ({ key: `enc:${e.id}`, label: `⚔️ ${e.name} (encounter)`, map: e.map })),
  ];
  const { getSetup } = await import('./setup-store.js');
  if (getSetup()?.map) choices.unshift({ key: 'setup', label: '🗺️ Map setup\'s map (the next battle)', map: getSetup().map });
  if (!choices.length) { showCombatAlert('No other maps yet.', { title: 'Use another map' }); return; }
  const key = await openDmModal({
    title: 'Use another map',
    html: `<div class="dm-hint" style="margin-bottom:0.5rem">Replaces the adventure map with a copy.</div>
      <div class="dm-enc-savedmaps">${choices.map(c => `<button class="dm-species-item" data-key="${escapeHtml(c.key)}"><span><span class="dm-species-name">${escapeHtml(c.label)}</span>
        <span class="dm-species-meta">${c.map?.rows} × ${c.map?.cols} squares · ${(c.map?.objects || []).length} objects</span></span></button>`).join('')}</div>`,
    buttons: [{ label: 'Cancel', value: null }],
    onOpen: (body, close) => body.addEventListener('click', (e) => { const b = e.target.closest('[data-key]'); if (b) close(b.dataset.key); }),
  });
  const pick = choices.find(c => c.key === key);
  if (!pick) return;
  await _store.replace({ ...JSON.parse(JSON.stringify(pick.map)), ready: true });
  draw();
}

// ---------------------------------------------------------------------------
// Running: who's on the map, the live map editor, and what to do with the map
// ---------------------------------------------------------------------------

function drawRunning() {
  document.getElementById('advBar').innerHTML = `
    <h2>🧭 Adventure <span class="dm-pill ok" title="The players' devices and the table have the map">Open</span></h2>
    <span class="dm-adv-players" id="advPlayers"></span>
    ${switchesHtml(true, false)}
    <span class="dm-adv-btns">
      <button class="dm-btn small" id="advGuide" title="How hard each Pokémon is to catch">🔴 Capture guide</button>
      <button class="dm-btn small" id="advToBattle" title="Put a copy of this map (background, objects, terrain) into the Battle module's Map setup -- the map the next battle you start there is fought on">📋 Copy to Battle setup</button>
      <button class="dm-btn primary" id="advToEnc" title="A new encounter in Encounter setup with this map as it is now -- its objects, your Pokémon and NPCs where they stand, hidden ones too">⚔️ Start encounter</button>
      <button class="dm-btn danger" id="advEnd" title="The players leave the map -- everything you put on it stays for next time">■ Close the map</button>
    </span>`;
  renderPlayers();
  renderSwitches();
  document.getElementById('advCanJoin').addEventListener('change', onCanJoin);
  document.getElementById('advCanMove').addEventListener('change', async (e) => {
    try {
      await CombatAPI.adventureSettings({ canMove: e.target.checked });
    } catch (err) {
      showCombatAlert(err.message, { title: 'Adventure' });
      renderSwitches();
    }
  });
  const body = document.getElementById('advBody');
  body.innerHTML = '<div class="dm-adv-editor" id="advEditor"></div>';
  setLiveSession(_session);
  renderMapEditor(document.getElementById('advEditor'), { live: true, adventure: true, title: 'The adventure, live' });
  document.getElementById('advGuide').addEventListener('click', () => captureGuide(_store?.getSetup().map.terrain));
  document.getElementById('advToEnc').addEventListener('click', () => encounterOnMap(boardAsMap(_session), liveCreatures(_session)));
  document.getElementById('advToBattle').addEventListener('click', () => copyToBattleSetup(boardAsMap(_session)));
  document.getElementById('advEnd').addEventListener('click', async () => {
    if (!await showCombatConfirm('Close the map? The players leave it. Everything on it -- your Pokémon and NPCs too -- stays as the adventure map for next time.', { title: 'Close the map', yesLabel: 'Close it', noLabel: 'Cancel' })) return;
    try {
      await DmAPI.saveState('adventure-map', { ...boardAsMap(_session), creatures: liveCreatures(_session) });
      await CombatAPI.endSession();
    } catch (err) {
      showCombatAlert(err.message, { title: 'Close the map' });
    }
  });
}

/** The players' switches as the running adventure has them (on unless the DM turned them off). */
function renderSwitches() {
  const a = _session?.adventure || {};
  const join = document.getElementById('advCanJoin'), move = document.getElementById('advCanMove');
  if (join) join.checked = a.canJoin !== false;
  if (move) move.checked = a.canMove !== false;
}

function renderPlayers() {
  const el = document.getElementById('advPlayers');
  if (!el) return;
  const byOwner = {};
  Object.values(_session?.participants || {}).forEach((p) => {
    const owner = p.owner || 'DM';
    (byOwner[owner] = byOwner[owner] || []).push(p);
  });
  const owners = Object.keys(byOwner);
  el.innerHTML = owners.length
    ? owners.map(o => `<span class="dm-adv-player" title="${escapeHtml(byOwner[o].map(p => `${p.name}${_session.board?.tokens?.[p.id] ? '' : ' (not placed yet)'}`).join(', '))}">
        ${byOwner[o].map(p => `<span class="dm-adv-thumb" data-img="${escapeHtml(p.image || '')}"></span>`).join('')}<b>${escapeHtml(o)}</b></span>`).join('')
    : '<span class="dm-hint">Nobody has joined yet -- the players join from their app (the 🗺️ map button on the trainer card).</span>';
  el.querySelectorAll('[data-img]').forEach(x => { if (x.dataset.img) patchPortraitMedia(x, x.dataset.img, ''); });
}

/** "Start encounter": a new encounter in Encounter setup with this map and everything on it -- the DM's Pokemon (each
 * where it stands; a hidden one starts hidden, on its square) and NPCs (the same) -- opened there. */
async function encounterOnMap(map, creatures = []) {
  if (!map?.cols) { showCombatAlert('Make the map first.', { title: 'Start encounter' }); return; }
  const mons = creatures.filter(c => c.kind === 'pokemon' && c.config?.species);
  const npcs = creatures.filter(c => c.kind === 'npc' && c.npcId);
  const what = [mons.length && `${mons.length} Pokémon`, npcs.length && `${npcs.length} NPC${npcs.length === 1 ? '' : 's'}`,
    (map.objects || []).length && `${map.objects.length} object${map.objects.length === 1 ? '' : 's'}`].filter(Boolean);
  const name = await openDmModal({
    title: '⚔️ Start encounter',
    html: `<div class="dm-field"><label for="advEncName">What should the encounter be called?</label>
      <input class="dm-input" id="advEncName" value="Adventure encounter" maxlength="60"></div>
      <div class="dm-hint">A new encounter in Encounter setup with a copy of this map${what.length ? ` and ${what.join(', ')} on it -- where they stand, hidden ones too` : ''}. Add more there, then import it in the Battle module.</div>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Make it', kind: 'primary', keepOpen: true,
      onClick: (body) => { body.dataset.name = body.querySelector('#advEncName').value; return true; }, value: 'ok' }],
    onOpen: (body) => { encounterOnMap._body = body; body.querySelector('#advEncName').select(); },
  }) === 'ok' ? encounterOnMap._body.dataset.name : null;
  if (name === null) return;
  try {
    await createEncounterWithMap(map, String(name).trim() || 'Adventure encounter', { creatures });
  } catch (err) {
    showCombatAlert(err.message, { title: 'Start encounter' });
    return;
  }
  toast('Made -- it\'s open in Encounter setup. Import it in the Battle module to play it.');
  window.dispatchEvent(new CustomEvent('dm:open-encounters'));
}

// ---------------------------------------------------------------------------
// The capture guide: any species, how hard it is to catch (encounter-rules.js's capture rules, worked out for it)
// ---------------------------------------------------------------------------

async function captureGuide(terrainKey = 'flat') {
  const species = await getSpecies().catch(() => []);
  let terrain = TERRAIN[terrainKey] ? terrainKey : 'flat';
  const weather = getClock()?.weather || 'clear';
  await openDmModal({
    title: '🔴 Capture guide',
    wide: true,
    html: `
      <div class="dm-adv-guide">
        <div class="dm-adv-guide-list">
          <input class="dm-input" id="cgSearch" placeholder="Search a Pokémon…" autocomplete="off">
          <div class="dm-row" style="margin:0.4rem 0">
            <div class="dm-field"><label for="cgTerrain">Terrain here</label>
              <select class="dm-select" id="cgTerrain">${Object.entries(TERRAIN).map(([k, t]) => `<option value="${k}" ${k === terrain ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}</select></div>
          </div>
          <div class="dm-hint">Weather now: ${escapeHtml(WEATHER[weather]?.name || weather)} (the world clock).</div>
          <div class="dm-cs-species" id="cgResults"></div>
        </div>
        <div class="dm-adv-guide-page" id="cgPage"><div class="dm-cs-empty">Pick a Pokémon to see how it's caught.</div></div>
      </div>`,
    buttons: [{ label: 'Close', value: null }],
    onOpen: (body) => {
      let current = null;
      const list = () => {
        const q = body.querySelector('#cgSearch').value.trim().toLowerCase();
        const hits = species.filter(s => !q || s.name.toLowerCase().includes(q) || String(s.type1).toLowerCase() === q || String(s.type2).toLowerCase() === q).slice(0, 80);
        const box = body.querySelector('#cgResults');
        box.innerHTML = hits.map(s => `<button type="button" class="dm-species-item" data-sp="${escapeHtml(s.name)}"><span class="dm-species-thumb" data-img="${escapeHtml(s.image || '')}"></span>
          <span><span class="dm-species-name">${escapeHtml(s.name)}</span><span class="dm-species-meta">${typeBadges(s.type1, s.type2)} ${escapeHtml(s.rarity || '')}</span></span></button>`).join('')
          || '<div class="dm-species-empty">No Pokémon match that.</div>';
        box.querySelectorAll('[data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); });
      };
      const show = async (name) => {
        current = name;
        const page = body.querySelector('#cgPage');
        page.innerHTML = '<div class="dm-loading">Loading…</div>';
        let d;
        try { d = await speciesDetail(name); } catch (err) { page.innerHTML = `<div class="dm-hint">${escapeHtml(err.message)}</div>`; return; }
        if (current !== name) return;
        page.innerHTML = `
          <div class="dm-sp-head"><span class="dm-sp-img" data-img="${escapeHtml(d.image || '')}"></span>
            <div><div class="dm-sp-name">${escapeHtml(d.name)}</div>
              <div class="dm-species-meta">${typeBadges(d.type1, d.type2)} ${escapeHtml([d.size, d.rarity, d.behavior].filter(Boolean).join(' · '))}</div>
              <div class="dm-hint">${escapeHtml([d.habitat && `Habitat: ${d.habitat}`, d.activity && `Active: ${d.activity}`].filter(Boolean).join(' · '))}</div>
              <button class="dm-btn small" id="cgMore" style="margin-top:0.3rem">ℹ️ Everything about it</button></div></div>
          ${captureRulesHtml(d, { terrainKey: terrain, weatherKey: weather })}`;
        paintSpeciesImages(page);
        page.querySelector('#cgMore').addEventListener('click', () => openSpeciesInfo(d.name));
      };
      body.querySelector('#cgSearch').addEventListener('input', list);
      body.querySelector('#cgTerrain').addEventListener('change', (e) => { terrain = e.target.value; if (current) show(current); });
      body.querySelector('#cgResults').addEventListener('click', (e) => { const b = e.target.closest('[data-sp]'); if (b) show(b.dataset.sp); });
      list();
    },
  });
}
