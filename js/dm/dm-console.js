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
import { loadSetup, getSetup, flushSetup, resetSetup, mapReady, battleReady } from './setup-store.js';
import { renderMapEditor, mapPreviewHtml } from './map-editor.js';
import { renderCreatureSetup } from './creature-setup.js';
import { mountLive, updateLive } from './battle-live.js';

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
    await Promise.all([loadGameData(), loadSetup()]);
  } catch (err) {
    view.innerHTML = `<div class="dm-loading">Couldn't load: ${escapeHtml(err.message)}</div>`;
    return;
  }
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
  const line = (c) => `
    <div class="dm-home-creature">
      <span class="dm-home-thumb" data-img="${escapeHtml(c.participant?.image || '')}"></span>
      <span>${escapeHtml(c.name)} <small>Lv ${c.participant?.level ?? '?'}${c.heldBack ? ' · held back' : ''}${c.kind === 'pokemon' && c.trainerId ? ` · ${escapeHtml(trainers.find(t => t.id === c.trainerId)?.name || '')}'s` : ''}</small></span>
    </div>`;

  view.innerHTML = `
    <div class="dm-home">
      <div class="dm-home-head">
        <div>
          <h2>Battle setup</h2>
          <div class="dm-hint">Set up the map and the battle, then start it -- the players can join once it has started.</div>
        </div>
        <button class="dm-btn small" id="homeReset" ${!s.creatures.length && !objects && !marks.length ? 'disabled' : ''}>New setup</button>
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
          <button class="dm-btn primary wide" id="homeMap">${okMap ? 'Change the map' : 'Set up map'}</button>
        </div>
        <div class="dm-home-card">
          <div class="dm-home-card-head">
            <h3>⚔️ Battle</h3>
            <span class="dm-pill ${okBattle ? 'ok' : 'todo'}">${okBattle ? `✓ ${s.creatures.length} ready` : 'Nobody yet'}</span>
          </div>
          <div class="dm-home-creatures">${s.creatures.length ? s.creatures.map(line).join('') : '<div class="dm-hint">No NPC trainers or Pokémon yet.</div>'}</div>
          ${unplaced.length && okMap ? `<div class="dm-hint dm-warn">${unplaced.length} not placed on the map yet -- place them in the battle setup, or from the battle once it starts.</div>` : ''}
          <button class="dm-btn primary wide" id="homeCreatures" ${okMap ? '' : 'disabled'}>${okBattle ? 'Change the battle' : 'Set up battle'}</button>
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
  document.getElementById('homeMap').addEventListener('click', () => showSetupView('map'));
  document.getElementById('homeCreatures').addEventListener('click', () => showSetupView('creatures'));
  document.getElementById('homeStart').addEventListener('click', startBattle);
  document.getElementById('homeReset').addEventListener('click', async () => {
    if (!await showCombatConfirm('Clear the map and the battle and start a new setup?', { title: 'New setup', yesLabel: 'Clear it', noLabel: 'Cancel' })) return;
    try { await resetSetup(); } catch (err) { showCombatAlert(err.message, { title: 'New setup' }); }
    renderHome(view);
  });
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
