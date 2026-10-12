// DM console (dm-console.html) -- the landscape page the DM runs the game from, on their laptop. A separate page with
// its own URL, like display.html and battle-map.html: no trainer login, no player SPA around it.
//
// The battle module: with no battle running, the DM prepares one -- the map (map-editor.js) and the NPC trainers and
// Pokemon the players will face (creature-setup.js), both kept on the Pi (setup-store.js) -- and starts it, which is
// the moment the players can join. While a battle runs, the module is the running battle (battle-live.js). All the DM's
// battles are PvE.
import { CombatAPI, DmAPI, GameDataAPI } from '../api.js';
import { initLiveUpdates } from '../utils/live-updates.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import { enableDmMode } from '../pages/combat-wip.js';
import { injectBattleMapStyles } from '../utils/battle-map-view.js';
import { DM, escapeHtml } from './dm-common.js';
import { loadSetup, getSetup, flushSetup, resetSetup, resetMap, resetBattle, mapReady, battleReady } from './setup-store.js';
import { renderMapEditor, mapPreviewHtml } from './map-editor.js';
import { renderCreatureSetup } from './creature-setup.js';
import { mountLive, updateLive } from './battle-live.js';
import { renderPokedex, pokedexHasUnsaved } from './pokedex.js';
import { renderParty } from './party.js';
import { renderNpcs, npcsHaveUnsaved } from './npcs.js';
import { renderClock } from './clock.js';
import { renderEncounters, encountersHaveUnsaved } from './encounters.js';
import { loadClock, renderTopWidget, tickTurnTimers } from './world-clock.js';

enableDmMode(DM);

let session = { active: false, participants: {}, turnOrder: [] };
let setupView = 'home'; // with no battle running: 'home' | 'map' | 'creatures'
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

  window.addEventListener('app:combat-updated', (e) => { session = e.detail; route(); });
  window.addEventListener('app:live-resync', async () => {
    const r = await CombatAPI.getState().catch(() => null);
    if (r?.status === 'success') { session = r.data; route(); }
  });
  // The battle screen asks the player app to go back to the trainer card in a few places; there is none here.
  window.addEventListener('navigate', () => { liveMounted = false; route(); });

  document.getElementById('dmRail').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-module]:not(:disabled)');
    if (btn) showModule(btn.dataset.module);
  });
  window.addEventListener('beforeunload', (e) => {
    if (pokedexHasUnsaved() || npcsHaveUnsaved() || encountersHaveUnsaved()) { e.preventDefault(); e.returnValue = ''; }
  });
  // Loading an encounter into the battle setup brings the DM back to the battle module to place everyone.
  window.addEventListener('dm:show-module', (e) => {
    if (e.detail?.name === 'battle' && !session?.active) { setupView = 'home'; showSetupView('home'); }
    if (e.detail?.name) showModule(e.detail.name);
  });
  window.addEventListener('dm:aftermath-changed', () => { if (!session?.active && setupView === 'home') renderAftermathBanner(); });
}

// ---------------------------------------------------------------------------
// Modules (the rail on the left): Battle, Party, Pokedex, NPCs, Encounters, Clock. The battle keeps running in its own
// section while another module is open; Party and Encounters are fetched fresh every time they're opened, the Clock is
// redrawn (the time may have moved), the Pokedex and NPCs keep where the DM was.
// ---------------------------------------------------------------------------

const MODULES = { battle: 'dmModuleBattle', party: 'dmModuleParty', pokedex: 'dmModulePokedex', npcs: 'dmModuleNpcs', encounters: 'dmModuleEncounters', clock: 'dmModuleClock' };
const _moduleOpened = new Set(['battle']);

function showModule(name, opts = {}) {
  Object.entries(MODULES).forEach(([key, id]) => { document.getElementById(id).hidden = key !== name; });
  document.querySelectorAll('#dmRail [data-module]').forEach(b => b.classList.toggle('active', b.dataset.module === name));
  const section = document.getElementById(MODULES[name]);
  if (name === 'party') renderParty(section);
  else if (name === 'encounters') renderEncounters(section, opts);
  else if (name === 'clock') renderClock(section);
  else if (name === 'pokedex' && !_moduleOpened.has('pokedex')) renderPokedex(section);
  else if (name === 'npcs' && !_moduleOpened.has('npcs')) renderNpcs(section);
  _moduleOpened.add(name);
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

/** Shows whatever fits the current state: the running battle while there is one, otherwise the setup. */
function route() {
  watchTurns(session);
  renderStatus();
  const view = document.getElementById('dmView');
  const live = document.getElementById('dmLive');
  if (session?.active) {
    view.hidden = true;
    live.hidden = false;
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
  }
  live.hidden = true;
  view.hidden = false;
  if (setupView === 'home' || !view.dataset.view || view.dataset.view !== setupView) showSetupView(setupView);
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
  const activeId = session.reactingParticipantId || session.turnOrder?.[session.turnIndex];
  const active = session.participants?.[activeId];
  const count = Object.keys(session.participants || {}).length;
  const turn = !session.started
    ? 'Not started yet'
    : active ? `<span class="dm-status-turn">▶ ${escapeHtml(active.name)}${session.reactingParticipantId ? ' (reacting)' : ''}</span>` : '';
  el.innerHTML = `<strong>${session.battleType === 'pvp' ? 'PvP' : 'PvE'} battle</strong> · Round ${session.round} · ${turn} · ${count} in the battle`;
}

// ---------------------------------------------------------------------------
// Setup overview: the map and the battle, side by side, and Start battle
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
  // Anything to reset? The map counts once it's been touched at all (marked ready, a background, objects, marks).
  const mapTouched = okMap || !!m.background || objects > 0 || marks.length > 0;
  const battleTouched = s.creatures.length > 0;
  const line = (c) => `
    <div class="dm-home-creature">
      <span class="dm-home-thumb" data-img="${escapeHtml(c.participant?.image || '')}"></span>
      <span>${escapeHtml(c.name)} <small>Lv ${c.participant?.level ?? '?'}${c.heldBack ? ' · held back' : ''}${c.kind === 'pokemon' && c.trainerId ? ` · ${escapeHtml(trainers.find(t => t.id === c.trainerId)?.name || '')}'s` : ''}</small></span>
    </div>`;

  view.innerHTML = `
    <div class="dm-home">
      <div id="dmAftermathBanner"></div>
      <div class="dm-home-head">
        <div>
          <h2>Battle setup</h2>
          <div class="dm-hint">Set up the map and the battle, then start it -- the players can join once it has started.</div>
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
          <div class="dm-home-actions">
            <button class="dm-btn primary" id="homeMap">${okMap ? 'Change the map' : 'Set up map'}</button>
            <button class="dm-btn danger" id="homeResetMap" ${mapTouched ? '' : 'disabled'}>Reset map</button>
          </div>
        </div>
        <div class="dm-home-card">
          <div class="dm-home-card-head">
            <h3>⚔️ Battle</h3>
            <span class="dm-pill ${okBattle ? 'ok' : 'todo'}">${okBattle ? `✓ ${s.creatures.length} ready` : 'Nobody yet'}</span>
          </div>
          <div class="dm-home-creatures">${s.creatures.length ? s.creatures.map(line).join('') : '<div class="dm-hint">No NPC trainers or Pokémon yet.</div>'}</div>
          ${unplaced.length && okMap ? `<div class="dm-hint dm-warn">${unplaced.length} not placed on the map yet -- place them in the battle setup, or from the battle once it starts.</div>` : ''}
          <div class="dm-home-actions">
            <button class="dm-btn primary" id="homeCreatures" ${okMap ? '' : 'disabled'}>${okBattle ? 'Change the battle' : 'Set up battle'}</button>
            <button class="dm-btn danger" id="homeResetBattle" ${battleTouched ? '' : 'disabled'}>Reset battle</button>
          </div>
          ${okMap ? '' : '<div class="dm-hint">Set up the map first -- the battle setup places everyone on it.</div>'}
        </div>
      </div>
      <div class="dm-home-start">
        <button class="dm-btn dm-start-btn" id="homeStart" ${okMap && okBattle && !starting ? '' : 'disabled'}>▶ Start battle</button>
        <div class="dm-hint">${okMap && okBattle ? 'Ready -- starting opens the battle for the players.'
          : `Still to do: ${[!okMap && 'set up the map', !okBattle && 'add someone to the battle'].filter(Boolean).join(' and ')}.`}</div>
      </div>
    </div>`;

  view.querySelectorAll('[data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); });
  renderAftermathBanner();
  document.getElementById('homeMap').addEventListener('click', () => showSetupView('map'));
  document.getElementById('homeCreatures').addEventListener('click', () => showSetupView('creatures'));
  document.getElementById('homeStart').addEventListener('click', startBattle);
  document.getElementById('homeReset').addEventListener('click', async () => {
    if (!await showCombatConfirm('Reset both the map and the battle setup? Everything set up so far is removed.', { title: 'Clear battle', yesLabel: 'Clear it', noLabel: 'Cancel' })) return;
    try { await resetSetup(); } catch (err) { showCombatAlert(err.message, { title: 'Clear battle' }); }
    renderHome(view);
  });
  document.getElementById('homeResetMap').addEventListener('click', async () => {
    if (!await showCombatConfirm('Reset the map? Its size, background, objects and terrain go back to blank, and everyone placed on it is taken off (the creatures themselves stay).', { title: 'Reset map', yesLabel: 'Reset map', noLabel: 'Cancel' })) return;
    resetMap();
    await saveNow();
    renderHome(view);
  });
  document.getElementById('homeResetBattle').addEventListener('click', async () => {
    if (!await showCombatConfirm('Reset the battle? Every NPC trainer and Pokémon is removed from the setup (the map stays).', { title: 'Reset battle', yesLabel: 'Reset battle', noLabel: 'Cancel' })) return;
    resetBattle();
    await saveNow();
    renderHome(view);
  });
}

/** A battle ended and its aftermath isn't marked done yet: a banner over the setup to go and hand out the rewards. */
async function renderAftermathBanner() {
  const last = await DmAPI.getState('last-battle').catch(() => null);
  const el = document.getElementById('dmAftermathBanner');
  if (!el) return;
  if (!last || last.done) { el.innerHTML = ''; return; }
  const caught = (last.participants || []).filter(p => p.captured).length;
  el.innerHTML = `
    <div class="dm-after-banner">
      <span>🏁 <strong>The last battle is over</strong> (${last.round || 1} round${last.round === 1 ? '' : 's'}${caught ? `, ${caught} caught` : ''}) -- XP, loot${caught ? ' and the caught Pokémon' : ''} are waiting in the aftermath.</span>
      <button class="dm-btn primary small" id="dmToAftermath">Open the aftermath</button>
    </div>`;
  document.getElementById('dmToAftermath').addEventListener('click', () => showModule('encounters', { tab: 'aftermath' }));
}

async function saveNow() {
  try { await flushSetup(); } catch (err) { showCombatAlert(err.message, { title: "Couldn't save the setup" }); }
}

async function startBattle() {
  if (starting) return;
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
