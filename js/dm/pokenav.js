// PokeNav: the region map in 3D (js/region-map/region-map.js) as the table's board screen (battle-map.html) shows it
// whenever no battle is running. What the DM sees here is what's on that screen -- the frame has its 16:9 shape --
// and turning, zooming, moving it or flying to a town here moves it there (POST /api/dm/region-map-view, a few times a
// second while it moves, pushed live). It's stored on the Pi at most once a second, and where it comes to rest. The
// board itself can't be touched. three.js is only loaded the first time the module is opened.
//
// The module has two tabs (the user's call, 2026-10-19 -- both are about what the board screen shows outside a battle):
// Region Map (the above) and Adventure Mode (adventure.js: a map the players walk around on). "On the table screen", at
// the tabs' right, picks which one the board shows; picking the adventure map starts the adventure if it isn't running.
import { CombatAPI, DmAPI } from '../api.js';
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import { escapeHtml, toast } from './dm-common.js';
import { renderAdventure, startAdventure } from './adventure.js';

const SEND_EVERY_MS = 120;
const SAVE_EVERY_MS = 1000;
const SETTLED_MS = 600;   // no move for this long: it has come to rest, store where
const HOME_AZIMUTH = Math.PI / 2; // the default view: north to the right, the way the battle maps lie

let _section = null;
let _map = null;
let _session = null;
let _timer = null;
let _pending = null;
let _sending = false;
let _failing = false;
let _lastSaved = 0;
let _unsaved = null;      // the last view sent but not stored
let _settleTimer = null;
let _saveNext = false;
const TAB_KEY = 'dmPokenavTab'; // the tab open last (this browser only)
let _tab = 'region';

export async function renderPokenav(section, { session } = {}) {
  _session = session;
  if (_section === section) { renderStatus(); if (_tab === 'adventure') showTab('adventure'); return; }
  _section = section;
  try { _tab = localStorage.getItem(TAB_KEY) === 'adventure' ? 'adventure' : 'region'; } catch (e) { /* the default */ }
  section.innerHTML = `
    <div class="dm-navmod">
      <div class="dm-enc-tabs dm-navmod-tabs" id="navTabs">
        <button data-ntab="region"><img class="dm-tab-icon" src="assets/pokenav-icon.png" alt="">Region Map</button>
        <button data-ntab="adventure">🧭 Adventure Mode</button>
        <label class="dm-navmod-screen" title="What the table's board screen shows while no battle is running">📺 On the table screen
          <select class="dm-select" id="navOnScreen">
            <option value="region">Region map</option>
            <option value="adventure">Adventure map</option>
          </select></label>
      </div>
      <div class="dm-nav" id="navRegionView">
        <div class="dm-nav-head">
          <h2><img class="dm-tab-icon" src="assets/pokenav-icon.png" alt="">PokéNav</h2>
          <span class="dm-pill" id="navStatus"></span>
          <span class="dm-pill todo" id="navSlow" hidden></span>
        </div>
        <div class="dm-nav-frame"><div class="dm-nav-screen"><div id="navMap"></div></div></div>
      </div>
      <div class="dm-adv-module" id="navAdventureView" hidden></div>
    </div>`;
  section.querySelector('#navTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ntab]');
    if (b) showTab(b.dataset.ntab);
  });
  section.querySelector('#navOnScreen').addEventListener('change', (e) => pickOnScreen(e.target.value));
  showTab(_tab);
  renderStatus();
  try {
    const [{ mountRegionMap }, saved] = await Promise.all([
      import('../region-map/region-map.js'),
      DmAPI.getState('region-map-view').catch(() => null),
    ]);
    // Turned a quarter like the battle maps (north to the right); the compass in the corner goes back to that view.
    _map = mountRegionMap(document.getElementById('navMap'), { title: false, rememberStyle: false, onView: queue, homeAzimuth: HOME_AZIMUTH });
    // Drawn without the graphics card (hardware acceleration off in the browser): it moves slowly, and that's why.
    if (_map.graphics.software) {
      const slow = document.getElementById('navSlow');
      slow.hidden = false;
      slow.textContent = 'Slow: this browser isn\'t using the graphics card';
      slow.title = 'Turn on hardware acceleration in the browser\'s settings (System), then restart it';
    }
    if (saved) _map.setView(saved); // (for the map style it was left in)
    await _map.ready;
    // Every start opens on the default view -- the compass's: straight down, north to the right, filling the screen
    // (the user's call, 2026-10-19) -- and the board screen follows (the move is sent like any other).
    _map.home({ ms: 0, azimuth: HOME_AZIMUTH, fill: true });
  } catch (err) {
    document.getElementById('navMap').innerHTML = `<div class="dm-loading">Couldn't load the map: ${escapeHtml(err.message)}</div>`;
  }
}

/** A battle or adventure started or ended, or the adventure's settings changed. */
export function pokenavSessionChanged(session) {
  _session = session;
  renderStatus();
}

function showTab(name) {
  _tab = name;
  try { localStorage.setItem(TAB_KEY, name); } catch (e) { /* not kept */ }
  _section?.querySelectorAll('#navTabs [data-ntab]').forEach(b => b.classList.toggle('active', b.dataset.ntab === name));
  const region = document.getElementById('navRegionView'), adv = document.getElementById('navAdventureView');
  if (!region || !adv) return;
  region.hidden = name !== 'region';
  adv.hidden = name !== 'adventure';
  if (name === 'adventure') renderAdventure(adv, { session: _session });
}

/** What the board screen shows now: 'battle', 'adventure' or 'region'. */
function onScreen() {
  if (!_session?.active) return 'region';
  if (_session.battleType !== 'adventure') return 'battle';
  return _session.adventure?.onScreen === 'region' ? 'region' : 'adventure';
}

function renderStatus() {
  const shows = onScreen();
  const el = document.getElementById('navStatus');
  if (el) {
    el.className = `dm-pill ${shows === 'region' ? 'ok' : 'todo'}`;
    el.textContent = shows === 'battle' ? 'Battle running -- back on the table screen when it ends'
      : shows === 'adventure' ? 'The adventure map is on the table screen' : 'On the table screen';
  }
  const pick = document.getElementById('navOnScreen');
  if (pick) {
    const battle = shows === 'battle';
    pick.disabled = battle;
    pick.value = battle ? 'region' : shows;
    pick.title = battle ? 'A battle is on the table screen -- this applies again once it has ended' : '';
  }
}

/** The DM picked what the board shows: the adventure map (starting the adventure if it isn't running) or the region
 * map (a running adventure carries on in the players' app). */
async function pickOnScreen(value) {
  const running = !!_session?.active && _session.battleType === 'adventure';
  try {
    if (running) {
      await CombatAPI.adventureSettings({ onScreen: value });
    } else if (value === 'adventure') {
      if (!await showCombatConfirm('Start the adventure? Its map goes on the table screen, and the players can join from their app.', { title: 'Adventure map', yesLabel: 'Start it', noLabel: 'Cancel' })) {
        renderStatus();
        return;
      }
      await startAdventure();
    }
  } catch (err) {
    showCombatAlert(err.message, { title: 'On the table screen' });
    if (!running && value === 'adventure') showTab('adventure'); // most likely: no adventure map made yet
  }
  renderStatus();
}

function queue(view) {
  _pending = view;
  if (!_timer) _timer = setTimeout(send, SEND_EVERY_MS);
}

async function send() {
  _timer = null;
  if (_sending || !_pending) return; // the send in flight sends again when it's done
  const view = _pending;
  _pending = null;
  _sending = true;
  const save = _saveNext || Date.now() - _lastSaved >= SAVE_EVERY_MS;
  _saveNext = false;
  try {
    await DmAPI.saveRegionMapView(view, { save });
    _failing = false;
    if (save) { _lastSaved = Date.now(); _unsaved = null; } else _unsaved = view;
    clearTimeout(_settleTimer);
    _settleTimer = setTimeout(saveSettled, SETTLED_MS);
  } catch (err) {
    if (!_failing) toast(`Couldn't move the map on the table screen: ${err.message}`);
    _failing = true;
  } finally {
    _sending = false;
    if (_pending && !_timer) _timer = setTimeout(send, SEND_EVERY_MS);
  }
}

/** The map has come to rest on a view that wasn't stored: store it (moving again meanwhile starts the wait over). */
function saveSettled() {
  if (!_unsaved || _pending || _sending) return;
  _saveNext = true;
  queue(_unsaved);
}
