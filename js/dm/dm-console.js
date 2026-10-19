// DM console (dm-console.html) -- the landscape page the DM runs the game from, on their laptop. A separate page with
// its own URL, like display.html and battle-map.html: no trainer login, no player SPA around it.
//
// The battle module: with no battle running, three tabs. Encounter setup (encounters.js) is who the players will face --
// the encounter library; the one put in play becomes the next battle's NPC trainers and Pokemon, and keeps it up to date
// as it's changed. Map setup is the map (map-editor.js), where everyone starts on it (creature-setup.js) -- both kept on
// the Pi (setup-store.js) -- and Start battle, the moment the players can join. Post battle (encounters.js) hands out
// the last battle's rewards. While a battle runs, the module is the running battle (battle-live.js). All the DM's
// battles are PvE.
import { CombatAPI, DmAPI, GameDataAPI } from '../api.js';
import { initLiveUpdates } from '../utils/live-updates.js';
import { patchPortraitMedia, useSpritePreviews } from '../utils/sprite-media.js';

// Every sprite in the console is shown small (thumbnails, map tokens, the display preview): the Pi's small copies.
useSpritePreviews(true);
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import { enableDmMode } from '../pages/combat-wip.js';
import { injectBattleMapStyles } from '../utils/battle-map-view.js';
import { DM, escapeHtml } from './dm-common.js';
import { loadSetup, getSetup, updateSetup, flushSetup, resetSetup, resetMap, resetBattle, mapReady, battleReady, DEFAULT_BACKGROUND } from './setup-store.js';
import { renderMapEditor, mapPreviewHtml, editorShownIn } from './map-editor.js';
import { renderCreatureSetup } from './creature-setup.js';
import { mountLive, updateLive, showLiveTab, leaveLive } from './battle-live.js';
import { renderPokedex, pokedexHasUnsaved } from './pokedex.js';
import { renderParty } from './party.js';
import { renderNpcs, npcsHaveUnsaved } from './npcs.js';
import { renderClock } from './clock.js';
import { renderEncounters, encountersHaveUnsaved, importEncounterDialog } from './encounters.js';
import { adventureSessionChanged } from './adventure.js';
import { loadClock, renderTopWidget, tickTurnTimers, getClock, WEATHER } from './world-clock.js';
import { TERRAIN, WEATHER_ROLL_MOD } from './encounter-rules.js';
import { renderDisplay, displayAway, displaySessionChanged } from './display.js';
import { renderPokenav, pokenavSessionChanged } from './pokenav.js';
import { renderAdmin } from './admin.js';

enableDmMode(DM);

let session = { active: false, participants: {}, turnOrder: [] };
let battleTab = 'setup'; // with no battle running: 'setup' (Map setup) | 'library' (Encounter setup) | 'aftermath' (Post battle)
let setupView = 'home'; // the setup tab: 'home' | 'map' | 'creatures'
let liveMounted = false;
let starting = false;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function init() {
  injectBattleMapStyles(); // the map pieces (objects, difficult / blocked squares) the setup screens draw
  initLiveUpdates();
  const view = document.getElementById('dmView');
  try {
    await Promise.all([loadGameData(), loadSetup(), loadClock()]);
  } catch (err) {
    view.innerHTML = `<div class="dm-loading">Couldn't load: ${escapeHtml(err.message)}</div>`;
    return;
  }
  renderTopWidget(document.getElementById('dmTopWidgets'), () => showModule('clock'));
  const res = await CombatAPI.getState().catch(() => null);
  if (res?.status === 'success') session = res.data;
  route();

  window.addEventListener('app:combat-updated', (e) => { session = e.detail; route(); displaySessionChanged(session); pokenavSessionChanged(session); adventureSessionChanged(session); });
  window.addEventListener('app:live-resync', async () => {
    const r = await CombatAPI.getState().catch(() => null);
    if (r?.status === 'success') { session = r.data; route(); displaySessionChanged(session); pokenavSessionChanged(session); adventureSessionChanged(session); }
  });
  // Encounter setup, from elsewhere (the NPC module's "Back to the encounter"): its tab -- the running battle's, or the
  // Battle module's own.
  window.addEventListener('dm:open-encounters', () => {
    showModule('battle');
    if (battleRunning()) showLiveTab('encounters');
    else showBattleTab('library');
  });
  // The battle screen asks the player app to go back to the trainer card in a few places; there is none here.
  window.addEventListener('navigate', () => { liveMounted = false; route(); });

  document.getElementById('dmRail').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-module]:not(:disabled)');
    if (btn) showModule(btn.dataset.module);
  });
  document.getElementById('dmBattleTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-btab]');
    if (b) showBattleTab(b.dataset.btab);
  });
  window.addEventListener('beforeunload', (e) => {
    if (pokedexHasUnsaved() || npcsHaveUnsaved() || encountersHaveUnsaved()) { e.preventDefault(); e.returnValue = ''; }
  });
  // Putting an encounter in play brings the DM to the map setup to place everyone.
  window.addEventListener('dm:show-module', (e) => {
    if (e.detail?.name === 'battle') { setupView = 'home'; showBattleTab('setup'); }
    if (e.detail?.name) showModule(e.detail.name);
  });
  window.addEventListener('dm:battle-tab', (e) => { if (e.detail?.tab) showBattleTab(e.detail.tab); });
  window.addEventListener('dm:aftermath-changed', () => { if (!session?.active) renderAftermathBanner(); });

  // Back where the DM was before the reload.
  let last = null;
  try { last = localStorage.getItem(MODULE_KEY); } catch (e) { /* not kept */ }
  if (last && last !== 'battle' && MODULES[last]) showModule(last);
}

// ---------------------------------------------------------------------------
// Modules (the rail on the left): Battle, Party, Pokedex, NPCs, Clock, PokeNav (the region map and the adventure, one tab
// each -- pokenav.js), Display, Admin (items, Pokedex entries, splashes -- admin.js). The battle
// keeps running in its own section while another module is open; Party is fetched fresh every time it's opened, the
// Clock is redrawn (the time may have moved), the Pokedex, NPCs, PokeNav and Display keep where the DM was. The module
// open last opens again after a reload.
// ---------------------------------------------------------------------------

const MODULES = { battle: 'dmModuleBattle', party: 'dmModuleParty', pokedex: 'dmModulePokedex', npcs: 'dmModuleNpcs', clock: 'dmModuleClock', pokenav: 'dmModulePokenav', display: 'dmModuleDisplay', admin: 'dmModuleAdmin' };
const _moduleOpened = new Set(['battle']);
const MODULE_KEY = 'dmConsoleModule'; // the module open last, opened again after a reload (this browser only)

function showModule(name) {
  try { localStorage.setItem(MODULE_KEY, name); } catch (e) { /* not kept */ }
  Object.entries(MODULES).forEach(([key, id]) => {
    const el = document.getElementById(id);
    el.hidden = key !== name;
    setVideosPlaying(el, key === name);
  });
  document.querySelectorAll('#dmRail [data-module]').forEach(b => b.classList.toggle('active', b.dataset.module === name));
  if (name !== 'display') displayAway();
  const section = document.getElementById(MODULES[name]);
  if (name === 'party') renderParty(section);
  else if (name === 'clock') renderClock(section);
  else if (name === 'display') renderDisplay(section, { session, firstTime: !_moduleOpened.has('display') });
  else if (name === 'pokenav') renderPokenav(section, { session });
  else if (name === 'admin') renderAdmin(section);
  else if (name === 'battle') route(); // an editor drawn elsewhere meanwhile may have taken the map editor from it
  else if (name === 'pokedex' && !_moduleOpened.has('pokedex')) renderPokedex(section);
  else if (name === 'npcs' && !_moduleOpened.has('npcs')) renderNpcs(section);
  _moduleOpened.add(name);
}

/** The sprites of a module put away stop playing (they'd keep decoding behind the one showing), and start again when
 * it's back. (The Display workspace's sprites play by their own rule -- only while scrolled into view.) */
function setVideosPlaying(section, playing) {
  section.querySelectorAll('video').forEach((v) => {
    if (!playing) v.pause();
    else if (v.paused && v.autoplay) v.play().catch(() => {});
  });
}

/** The battle module's tabs, with no battle running: Map setup, Encounter setup, Post battle. */
function showBattleTab(name) {
  battleTab = name;
  document.querySelectorAll('#dmBattleTabs [data-btab]').forEach(b => b.classList.toggle('active', b.dataset.btab === name));
  if (battleRunning()) return; // the running battle fills the module; the tab shows again once it ends
  const view = document.getElementById('dmView');
  const enc = document.getElementById('dmEncView');
  view.hidden = name !== 'setup';
  enc.hidden = name === 'setup';
  if (name === 'setup') { if (setupView === 'home' || !view.dataset.view || (setupView === 'map' && !editorShownIn(view))) showSetupView(setupView); } // the map / battle editors keep where the DM was
  else renderEncounters(enc, { tab: name });
}

// Turn timers (Clock module) move by one each time the running battle passes to the next turn.
let _lastTurn = null;
function watchTurns(s) {
  if (!s?.active || !s.started) { _lastTurn = null; return; }
  const key = (Number(s.round) || 0) * 1000 + (Number(s.turnIndex) || 0);
  if (_lastTurn !== null && key > _lastTurn) tickTurnTimers(1);
  _lastTurn = key;
}

/** The game data the battle screen reads from sessionStorage -- the same keys the player app stores at login
 * (continue-journey.js's storeGameDataInSession). Moves and items are what the DM's creatures actually use. */
async function loadGameData() {
  const res = await GameDataAPI.getAll();
  const d = res?.data;
  if (!d?.moves) throw new Error('the server sent no move data');
  const put = (key, value) => { if (value !== undefined && value !== null) sessionStorage.setItem(key, JSON.stringify(value)); };
  put('moves', d.moves);
  put('items', d.itemsData?.items);
  put('natures', d.natures);
  put('pokemonFeats', d.pokemonFeatsData?.pokemonFeats);
  put('nationalities', d.nationalitiesData?.nationalities);
  put('trainerPaths', d.trainerPaths);
  put('specializations', d.specializations);
  put('affinities', d.affinities);
  put('trainerFeats', d.trainerFeatsData?.trainerFeats);
  put('skills', d.skillsData?.skills);
}

/** A battle (PvE or PvP) is running -- an adventure (PokeNav's Adventure Mode) isn't one: the Battle module stays on its setup. */
function battleRunning() {
  return !!session?.active && session.battleType !== 'adventure';
}

/** Shows whatever fits the current state: the running battle while there is one, otherwise the setup. */
function route() {
  watchTurns(session);
  renderStatus();
  const view = document.getElementById('dmView');
  const live = document.getElementById('dmLive');
  const liveTabs = document.getElementById('dmLiveTabs');
  const tabs = document.getElementById('dmBattleTabs');
  const enc = document.getElementById('dmEncView');
  if (battleRunning()) {
    view.hidden = true;
    tabs.hidden = true;
    liveTabs.hidden = false;
    showLiveTab(); // the Battle, Map or Encounter setup tab, whichever was open (it shows / hides Encounter setup too)
    if (!liveMounted) {
      liveMounted = true;
      mountLive(document.getElementById('content'), document.getElementById('dmTools'), session);
    } else {
      updateLive(session);
    }
    return;
  }
  if (liveMounted) {
    // The battle just ended -- back to the setup (still there, ready to run again or change).
    liveMounted = false;
    document.getElementById('content').innerHTML = '';
    document.getElementById('dmTools').innerHTML = '';
    setupView = 'home';
    battleTab = 'setup';
  }
  const wasLive = !liveTabs.hidden;
  leaveLive();
  live.hidden = true;
  liveTabs.hidden = true;
  document.getElementById('dmLiveMap').hidden = true;
  tabs.hidden = false;
  if (battleTab !== 'setup') {
    if (wasLive) showBattleTab(battleTab);
    return;
  }
  document.querySelectorAll('#dmBattleTabs [data-btab]').forEach(b => b.classList.toggle('active', b.dataset.btab === 'setup'));
  view.hidden = false;
  enc.hidden = true;
  if (setupView === 'home' || !view.dataset.view || view.dataset.view !== setupView || (setupView === 'map' && !editorShownIn(view))) showSetupView(setupView);
}

function showSetupView(name) {
  setupView = name;
  const view = document.getElementById('dmView');
  view.dataset.view = name;
  if (name === 'map') renderMapEditor(view, { onDone: () => showSetupView('home') });
  else if (name === 'creatures') renderCreatureSetup(view, { onDone: () => showSetupView('home') });
  else renderHome(view);
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

function renderStatus() {
  const el = document.getElementById('dmStatus');
  if (!el) return;
  if (!session?.active) {
    el.innerHTML = 'No battle running';
    return;
  }
  if (session.battleType === 'adventure') {
    const players = new Set(Object.values(session.participants || {}).map(p => p.owner).filter(Boolean));
    el.innerHTML = `<strong>🧭 Adventure</strong> · ${players.size} player${players.size === 1 ? '' : 's'} on the map`;
    return;
  }
  const activeId = session.reactingParticipantId || session.turnOrder?.[session.turnIndex];
  const active = session.participants?.[activeId];
  const count = Object.keys(session.participants || {}).length;
  const turn = !session.started
    ? 'Not started yet'
    : active ? `<span class="dm-status-turn">▶ ${escapeHtml(active.name)}${session.reactingParticipantId ? (active.extraActionFrom ? ` (${escapeHtml(active.extraActionFrom)})` : ' (reacting)') : ''}</span>` : '';
  el.innerHTML = `<strong>${session.battleType === 'pvp' ? 'PvP' : 'PvE'} battle</strong> · Round ${session.round} · ${turn} · ${count} in the battle`;
}

// ---------------------------------------------------------------------------
// Map setup: the map and who's in the battle (from Encounter setup), side by side, and Start battle
// ---------------------------------------------------------------------------

function renderHome(view) {
  const s = getSetup();
  const m = s.map;
  const okMap = mapReady(s);
  const okBattle = battleReady(s);
  const fighting = s.creatures.filter(c => !c.heldBack);
  const unplaced = fighting.filter(c => !c.position);
  const objects = (m.objects || []).length;
  const marks = Object.values(m.marks || {});
  const bgLabel = m.background ? m.background.replace(/^.*battle-|\.png$/g, '').replace(/[-_]/g, ' ') : 'no background';
  const trainers = s.creatures.filter(c => c.kind === 'trainer');
  // Anything to reset? The map counts once it's been touched at all (marked ready, another background, objects, marks,
  // terrain or weather).
  const mapTouched = okMap || m.background !== DEFAULT_BACKGROUND || objects > 0 || marks.length > 0
    || (m.terrain || 'flat') !== 'flat' || (m.weather || 'world') !== 'world';
  const weatherOpts = [['world', `The world clock's (${WEATHER[getClock()?.weather]?.name || 'clear'})`],
    ...Object.entries(WEATHER).map(([k, w]) => [k, `${w.icon} ${w.name}`])];
  const battleTouched = s.creatures.length > 0;
  const line = (c) => `
    <div class="dm-home-creature">
      <span class="dm-home-thumb" data-img="${escapeHtml(c.participant?.image || '')}"></span>
      <span>${escapeHtml(c.name)} <small>Lv ${c.participant?.level ?? '?'}${c.heldBack ? ' · 🙈 hidden' : ''}${c.kind === 'pokemon' && c.trainerId ? ` · ${escapeHtml(trainers.find(t => t.id === c.trainerId)?.name || '')}'s` : ''}</small></span>
    </div>`;

  view.innerHTML = `
    <div class="dm-home">
      <div id="dmAftermathBanner"></div>
      <div class="dm-home-head">
        <div>
          <h2>Map setup</h2>
          <div class="dm-hint">Who's in the battle comes from Encounter setup. Set up the map, place everyone and start -- the players can join once it has started.</div>
        </div>
        <button class="dm-btn danger" id="homeReset" ${mapTouched || battleTouched ? '' : 'disabled'} title="Reset both the map and the battle">🗑 Clear battle</button>
      </div>
      <div class="dm-home-cards">
        <div class="dm-home-card">
          <div class="dm-home-card-head">
            <h3>🗺️ Map</h3>
            <span class="dm-pill ${okMap ? 'ok' : 'todo'}">${okMap ? '✓ Ready' : 'Not set up yet'}</span>
          </div>
          <div class="dm-home-preview">${mapPreviewHtml(s)}</div>
          <div class="dm-hint">${m.rows} × ${m.cols} squares · ${escapeHtml(bgLabel)} · ${objects} object${objects === 1 ? '' : 's'}
            · ${marks.filter(k => k === 'difficult').length} difficult · ${marks.filter(k => k === 'blocked').length} blocked</div>
          <div class="dm-row dm-home-setting">
            <div class="dm-field"><label for="homeTerrain">Terrain <span class="dm-label-note">(added to a throw's accuracy DC)</span></label>
              <select class="dm-select" id="homeTerrain">${Object.entries(TERRAIN).map(([k, t]) => `<option value="${k}" ${k === (m.terrain || 'flat') ? 'selected' : ''}>${escapeHtml(t.name)} (+${t.mod})</option>`).join('')}</select></div>
            <div class="dm-field"><label for="homeWeather">Weather <span class="dm-label-note">(changes a throw's roll)</span></label>
              <select class="dm-select" id="homeWeather">${weatherOpts.map(([k, l]) => `<option value="${k}" ${k === (m.weather || 'world') ? 'selected' : ''}>${escapeHtml(l)}${WEATHER_ROLL_MOD[k] ? ` (${WEATHER_ROLL_MOD[k]})` : ''}</option>`).join('')}</select></div>
          </div>
          <div class="dm-home-actions">
            <button class="dm-btn primary" id="homeMap">${okMap ? 'Change the map' : 'Set up map'}</button>
            <button class="dm-btn danger" id="homeResetMap" ${mapTouched ? '' : 'disabled'}>Reset map</button>
          </div>
        </div>
        <div class="dm-home-card">
          <div class="dm-home-card-head">
            <h3><img class="dm-tab-icon" src="assets/VS.png" alt="">Who's in it</h3>
            <span class="dm-pill ${okBattle ? 'ok' : 'todo'}">${okBattle ? `✓ ${s.creatures.length} ready` : 'Nobody yet'}</span>
          </div>
          <div class="dm-hint" id="homeEncName"></div>
          <div class="dm-home-creatures">${s.creatures.length ? s.creatures.map(line).join('') : '<div class="dm-hint">Nobody yet -- import an encounter (📥), or build one under Encounter setup.</div>'}</div>
          ${unplaced.length && okMap ? `<div class="dm-hint dm-warn">${unplaced.length} not placed on the map yet -- place them here, or from the battle once it starts.</div>` : ''}
          <div class="dm-home-actions">
            <button class="dm-btn primary" id="homeCreatures" ${okMap && okBattle ? '' : 'disabled'} title="${okMap ? '' : 'Set up the map first'}">📍 Place on the map</button>
            <button class="dm-btn primary" id="homeImport" title="An encounter from Encounter setup becomes the next battle -- its creatures, and its map if it has one">📥 Import encounter</button>
            <button class="dm-btn" id="homeToEnc"><img class="dm-tab-icon" src="assets/VS.png" alt="">Encounter setup</button>
            <button class="dm-btn danger" id="homeResetBattle" ${battleTouched ? '' : 'disabled'} title="Take everyone out of the next battle">Clear</button>
          </div>
        </div>
      </div>
      <div class="dm-home-start">
        <button class="dm-btn dm-start-btn" id="homeStart" ${okMap && okBattle && !starting ? '' : 'disabled'}>▶ Start battle</button>
        <div class="dm-hint">${okMap && okBattle ? 'Ready -- starting opens the battle for the players.'
          : `Still to do: ${[!okMap && 'set up the map', !okBattle && 'put an encounter in play'].filter(Boolean).join(' and ')}.`}</div>
      </div>
    </div>`;

  view.querySelectorAll('[data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); });
  renderAftermathBanner();
  if (s.creatures.length) {
    DmAPI.getState('encounter-run').then((run) => {
      const el = document.getElementById('homeEncName');
      if (el && run?.name && s.creatures.some(c => c.encId === run.encounterId)) el.textContent = `From the encounter "${run.name}"`;
    }).catch(() => {});
  }
  document.getElementById('homeMap').addEventListener('click', () => showSetupView('map'));
  document.getElementById('homeTerrain').addEventListener('change', (e) => updateSetup((x) => { x.map.terrain = e.target.value; }));
  document.getElementById('homeWeather').addEventListener('change', (e) => updateSetup((x) => { x.map.weather = e.target.value; }));
  document.getElementById('homeCreatures').addEventListener('click', () => showSetupView('creatures'));
  document.getElementById('homeToEnc').addEventListener('click', () => showBattleTab('library'));
  document.getElementById('homeImport').addEventListener('click', async () => {
    await importEncounterDialog(); // brings the DM back here when it's in (dm:show-module)
    if (battleTab === 'setup' && setupView === 'home') renderHome(view);
  });
  document.getElementById('homeStart').addEventListener('click', startBattle);
  document.getElementById('homeReset').addEventListener('click', async () => {
    if (!await showCombatConfirm('Reset the map and take everyone out of the next battle? (The encounters themselves stay.)', { title: 'Clear battle', yesLabel: 'Clear it', noLabel: 'Cancel' })) return;
    try { await resetSetup(); } catch (err) { showCombatAlert(err.message, { title: 'Clear battle' }); }
    renderHome(view);
  });
  document.getElementById('homeResetMap').addEventListener('click', async () => {
    if (!await showCombatConfirm('Reset the map? Its size, background, objects, terrain and weather go back to the start, and everyone placed on it is taken off (the creatures themselves stay).', { title: 'Reset map', yesLabel: 'Reset map', noLabel: 'Cancel' })) return;
    resetMap();
    await saveNow();
    renderHome(view);
  });
  document.getElementById('homeResetBattle').addEventListener('click', async () => {
    if (!await showCombatConfirm('Take every NPC trainer and Pokémon out of the next battle? The map and the encounters themselves stay.', { title: 'Clear', yesLabel: 'Clear', noLabel: 'Cancel' })) return;
    resetBattle();
    await saveNow();
    renderHome(view);
  });
}

/** A battle ended and its post battle isn't marked done yet: a banner over the map setup to go and hand out the rewards. */
async function renderAftermathBanner() {
  const last = await DmAPI.getState('last-battle').catch(() => null);
  document.getElementById('dmAfterDot').hidden = !last || !!last.done;
  const el = document.getElementById('dmAftermathBanner');
  if (!el) return;
  if (!last || last.done) { el.innerHTML = ''; return; }
  const caught = (last.participants || []).filter(p => p.captured).length;
  el.innerHTML = `
    <div class="dm-after-banner">
      <span>🏁 <strong>The last battle is over</strong> (${last.round || 1} round${last.round === 1 ? '' : 's'}${caught ? `, ${caught} caught` : ''}) -- XP, loot${caught ? ' and the caught Pokémon' : ''} are waiting in Post battle.</span>
      <button class="dm-btn primary small" id="dmToAftermath">Open Post battle</button>
    </div>`;
  document.getElementById('dmToAftermath').addEventListener('click', () => showBattleTab('aftermath'));
}

async function saveNow() {
  try { await flushSetup(); } catch (err) { showCombatAlert(err.message, { title: "Couldn't save the setup" }); }
}

async function startBattle() {
  if (starting) return;
  if (session?.active && session.battleType === 'adventure') {
    // One thing at a time on the table: the adventure ends for the battle (the players join the battle as usual).
    if (!await showCombatConfirm('An adventure is running. End it and start the battle?', { title: 'Start battle', yesLabel: 'End it and start', noLabel: 'Cancel' })) return;
    try { await CombatAPI.endSession(); } catch (err) { showCombatAlert(err.message, { title: 'End the adventure' }); return; }
  }
  starting = true;
  const btn = document.getElementById('homeStart');
  if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }
  try {
    await flushSetup();
    const res = await DmAPI.startBattle();
    // Use the reply itself, not only the live push -- whichever arrives first switches to the battle.
    if (res?.data?.active) { session = res.data; route(); }
  } catch (err) {
    showCombatAlert(err.message, { title: "Couldn't start the battle" });
    if (btn) { btn.disabled = false; btn.textContent = '▶ Start battle'; }
  } finally {
    starting = false;
  }
}

init();
