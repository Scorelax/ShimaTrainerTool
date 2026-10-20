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
import { showCombatAlert } from '../utils/combat-alert.js';
import { escapeHtml, toast, openDmModal } from './dm-common.js';
import { loadLocations, loadEvents, LOCATION_TYPES } from './admin-world.js';
import { shapeDistance } from '../region-map/map-features.js';
import { currentMap, kmPerPx, parentOf, isTopLocation, withInside } from '../region-map/map-version.js';
import { getClock, formatDate, formatTime } from './world-clock.js';
import { renderAdventure, startAdventure } from './adventure.js';

const SEND_EVERY_MS = 120;
const SAVE_EVERY_MS = 1000;
const SETTLED_MS = 600;   // no move for this long: it has come to rest, store where
// The default view (in this screen's terms): north up. The DM's screen is the board screen turned a quarter, the way the
// players see it from their side of the table (the user's call, 2026-10-20) -- on the board itself north is to the
// right, the way the battle maps lie (region-map.js's `turned`).
const HOME_AZIMUTH = 0;

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

// Another console tab (or this one's own save coming back) moved the party: shown again when it's this tab's news.
// The DM switched to another map (the Admin module's Locations tab, js/dm/map-upload.js, the user's call, 2026-10-20):
// the PokeNav is made again on it.
if (typeof window !== 'undefined') {
  window.addEventListener('app:dm-state', async (e) => {
    if (e.detail?.key !== 'region-map' || !_section || !_map) return;
    const map = await currentMap({ fresh: true });
    if (!_map || map.id === _map.mapId || !_section) return;
    const section = _section;
    _map.destroy();
    _map = null;
    _section = null;
    renderPokenav(section, { session: _session });
  });
  window.addEventListener('app:dm-state', async (e) => {
    if (e.detail?.key !== 'party-location' || !_section) return;
    const was = JSON.stringify(_party);
    await loadParty();
    if (JSON.stringify(_party) !== was) drawLocations();
  });
}

export async function renderPokenav(section, { session } = {}) {
  _session = session;
  if (_section === section) { renderStatus(); drawLocations(); if (_tab === 'adventure') showTab('adventure'); return; }
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
        <div class="dm-nav-body">
          <div class="dm-nav-frame"><div class="dm-nav-screen" title="The table's board screen, the way the players see it from their side"><div id="navMap"></div></div></div>
          <aside class="dm-nav-locs" id="navLocations"><div class="dm-loading">Loading…</div></aside>
        </div>
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
  drawLocations();
  try {
    const [{ mountRegionMap }, saved] = await Promise.all([
      import('../region-map/region-map.js'),
      DmAPI.getState('region-map-view').catch(() => null),
    ]);
    // Turned a quarter like the battle maps (north to the right); the compass in the corner goes back to that view.
    _map = mountRegionMap(document.getElementById('navMap'), { title: false, rememberStyle: false, onView: queue, homeAzimuth: HOME_AZIMUTH, turned: true });
    // Drawn without the graphics card (hardware acceleration off in the browser): it moves slowly, and that's why.
    if (_map.graphics.software) {
      const slow = document.getElementById('navSlow');
      slow.hidden = false;
      slow.textContent = 'Slow: this browser isn\'t using the graphics card';
      slow.title = 'Turn on hardware acceleration in the browser\'s settings (System), then restart it';
    }
    if (saved) _map.setView(saved); // (for the map style it was left in)
    Promise.all([loadLocations(), _party || loadParty()]).then(([list]) => { _map?.setLocations(list); _map?.setParty(_party?.locationId); }).catch(() => {});
    await _map.ready;
    // Every start opens on the default view -- the compass's: straight down, north to the right, filling the screen
    // (the user's call, 2026-10-19) -- and the board screen follows (the move is sent like any other).
    _map.home({ ms: 0, azimuth: HOME_AZIMUTH, fill: true });
  } catch (err) {
    document.getElementById('navMap').innerHTML = `<div class="dm-loading">Couldn't load the map: ${escapeHtml(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Locations (the user's call, 2026-10-20): the Admin module's locations, by type, and the map's names. One that's marked
// on the map, clicked: the map flies there and it's drawn onto the land in light blue (here only -- the table's map
// follows the flight); clicked again, it's let go. ⓘ shows the location's info.
//
// Where the party is (the 'party-location' state): picked at the top or with a row's marker button. The map flies there
// and puts the players' marker on it -- on the table's map too, unless the DM unticks that (a secret
// location never shows there). Under it the events planned there, and at the places within NEAR_KM (touching counts:
// a route running into the town, the town inside the forest), nearest first.
// ---------------------------------------------------------------------------

const NEAR_KM = 30;
// the players' marker (assets/MapMarker.png) as the party's icon here too (the user's call, 2026-10-20)
const PARTY_ICON = '<img class="dm-nav-partyicon" src="assets/region-map/party-marker.png" alt="">';

let _lit = null;     // the location drawn onto the map here
let _party = null;   // { locationId, onBoard, at (the world clock's date and time), recent: [ids] }

async function loadParty() {
  const saved = await DmAPI.getState('party-location').catch(() => null);
  _party = { locationId: null, onBoard: true, at: '', recent: [], ...(saved || {}) };
  return _party;
}

/** The world clock's date and time now ('' when it isn't loaded). */
function clockStamp() {
  try {
    const c = getClock();
    return c ? `${formatDate(c)}, ${formatTime(c)}` : '';
  } catch (e) { return ''; }
}

async function saveParty(next) {
  _party = next;
  try {
    await DmAPI.saveState('party-location', _party);
  } catch (err) {
    toast(`Couldn't save where the party is: ${err.message}`);
  }
}

/** The party moves to `id` (null: not set). The map flies there. */
async function setPartyAt(id) {
  const prev = _party?.locationId;
  if ((id || null) === (prev || null)) return;
  await saveParty({ ..._party, locationId: id || null, at: id ? clockStamp() : '', recent: [prev, ...(_party?.recent || [])].filter((x, i, a) => x && x !== id && a.indexOf(x) === i).slice(0, 5) });
  _map?.setParty(_party.locationId);
  if (_party.locationId) {
    _lit = null;
    _map?.highlight(null);
    _map?.flyToLocation(_party.locationId);
  }
  drawLocations();
}

/** How far the party's place is from each other marked location, nearest first, within NEAR_KM. */
function nearby(here, locations) {
  if (!here?.shape) return [];
  return locations.filter(l => l.id !== here.id && l.shape)
    .map(l => ({ l, km: shapeDistance(here.shape, l.shape) * kmPerPx() }))
    .filter(x => x.km <= NEAR_KM)
    .sort((a, b) => a.km - b.km);
}

const kmText = km => (km < 1 ? 'right by it' : `~${Math.round(km)} km`);

function eventRowHtml(e, where = '') {
  return `<button class="dm-nav-event" data-event="${escapeHtml(e.id)}">
    <strong>${e.image ? '🖼 ' : ''}${escapeHtml(e.title || 'Untitled event')}</strong>
    <small>${escapeHtml([where, e.timeframe, e.trigger && `Trigger: ${e.trigger}`].filter(Boolean).join(' · ')) || 'No trigger or time yet'}</small></button>`;
}

function partyHtml(locations, events) {
  const here = locations.find(l => l.id === _party?.locationId);
  const opts = Object.entries(LOCATION_TYPES).map(([k, label]) => {
    const list = locations.filter(l => (l.type || 'city') === k).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return list.length ? `<optgroup label="${escapeHtml(label)}">${list.map(l => `<option value="${escapeHtml(l.id)}" ${l.id === here?.id ? 'selected' : ''}>${escapeHtml(l.name || 'Unnamed')}${parentOf(l, locations) ? ` (in ${escapeHtml(parentOf(l, locations).name || 'Unnamed')})` : ''}${l.shape ? '' : ' (not on the map)'}${l.secret ? ' 🔒' : ''}</option>`).join('')}</optgroup>` : '';
  }).join('');
  const recent = (_party?.recent || []).map(id => locations.find(l => l.id === id)).filter(Boolean);
  let eventsHtml = '';
  if (here) {
    const atHere = events.filter(e => e.locationId === here.id);
    const near = nearby(here, locations).flatMap(({ l, km }) => events.filter(e => e.locationId === l.id).map(e => ({ e, l, km })));
    eventsHtml = `
      <div class="dm-cs-group-title">📅 Events here <small>${atHere.length}</small></div>
      ${atHere.map(e => eventRowHtml(e)).join('') || '<div class="dm-hint dm-nav-locnone">None planned here.</div>'}
      <div class="dm-cs-group-title">📅 Nearby <small>${near.length}</small></div>
      ${!here.shape ? '<div class="dm-hint dm-nav-locnone">Mark it on the map to see what\'s near it.</div>'
        : near.map(({ e, l, km }) => eventRowHtml(e, `${l.name || 'Unnamed'}, ${kmText(km)}`)).join('') || `<div class="dm-hint dm-nav-locnone">Nothing planned within ${NEAR_KM} km.</div>`}`;
  }
  return `<div class="dm-card-title"><span>${PARTY_ICON} The party</span></div>
    <div class="dm-nav-party">
      <select class="dm-select" id="navPartyAt"><option value="">— Not set —</option>${opts}</select>
      ${here ? `<div class="dm-hint">${here.shape ? '' : 'Not marked on the map, so it can\'t be shown there. '}${_party.at ? `Since ${escapeHtml(_party.at)}.` : ''}</div>` : '<div class="dm-hint">Pick where the players are -- the map lights it up and shows what\'s planned there and nearby.</div>'}
      <label class="dm-check"><input type="checkbox" id="navPartyBoard" ${_party?.onBoard !== false ? 'checked' : ''}><span>📺 Show it on the table's map
        <small>${here?.secret ? '🔒 This location is secret, so the table\'s map doesn\'t show it -- untick Secret in Admin once they\'ve found it.' : 'Untick for a journey the players shouldn\'t see on the map.'}</small></span></label>
      ${recent.length ? `<div class="dm-nav-recent"><small>Before:</small>${recent.map(l => `<button class="dm-btn small" data-party="${escapeHtml(l.id)}">${escapeHtml(l.name || 'Unnamed')}</button>`).join('')}</div>` : ''}
      ${eventsHtml}
    </div>`;
}

async function drawLocations() {
  const box = document.getElementById('navLocations');
  if (!box) return;
  let locations, events;
  try {
    [locations, events] = await Promise.all([loadLocations(), loadEvents(), _party ? null : loadParty()]);
  } catch (err) {
    box.innerHTML = `<div class="dm-card-title"><span>📍 Locations</span></div><div class="dm-hint">Couldn't load them: ${escapeHtml(err.message)}</div>`;
    return;
  }
  _map?.setLocations(locations);
  _map?.setParty(_party?.locationId);
  if (_lit && !locations.some(l => l.id === _lit && l.shape)) { _lit = null; _map?.highlight(null); }
  // a location inside another under it, a step in (the user's call, 2026-10-20) -- picked, what it's part of lights up too
  const row = (l, depth = 0) => `<div class="dm-nav-locrow${depth ? ' sub' : ''}" ${depth ? `style="--depth: ${depth}"` : ''}><button class="dm-nav-loc${l.id === _lit ? ' lit' : ''}${l.id === _party?.locationId ? ' party' : ''}${l.shape ? '' : ' off-map'}" data-loc="${escapeHtml(l.id)}"
      title="${l.shape ? 'Show it on the map' : 'Not marked on the map yet (Admin › Locations)'}">
      <span>${depth ? '<span class="dm-nav-subarrow">⤷</span> ' : ''}${l.id === _party?.locationId ? `${PARTY_ICON} ` : ''}${escapeHtml(l.name || 'Unnamed')}${l.secret ? ' 🔒' : ''}</span>
      <small>${[!l.shape && 'not on the map', events.some(e => e.locationId === l.id) && `${events.filter(e => e.locationId === l.id).length} event(s)`].filter(Boolean).join(' · ')}</small></button>
    <button class="dm-icon-btn" data-party="${escapeHtml(l.id)}" title="The party is here">${PARTY_ICON}</button>
    <button class="dm-icon-btn" data-info="${escapeHtml(l.id)}" title="Location info">ⓘ</button></div>`;
  box.innerHTML = `${partyHtml(locations, events)}
    <div class="dm-card-title"><span>📍 Locations</span></div>
    ${Object.entries(LOCATION_TYPES).map(([k, label]) => {
      const here = withInside(locations.filter(l => (l.type || 'city') === k && isTopLocation(l, locations)).sort((a, b) => String(a.name).localeCompare(String(b.name))), locations);
      return `<div class="dm-nav-locgroup"><div class="dm-cs-group-title">${label} <small>${here.length}</small></div>
        ${here.map(({ l, depth }) => row(l, depth)).join('') || '<div class="dm-hint dm-nav-locnone">None yet</div>'}</div>`;
    }).join('')}
    <div class="dm-hint">Locations are added and marked on the map in the Admin module (📍 Locations).</div>`;
  box.querySelector('#navPartyAt').onchange = e => setPartyAt(e.target.value);
  box.querySelector('#navPartyBoard').onchange = e => saveParty({ ..._party, onBoard: e.target.checked });
  box.onclick = (e) => {
    const ev = e.target.closest('[data-event]');
    if (ev) { showEvent(events.find(x => x.id === ev.dataset.event), locations); return; }
    const party = e.target.closest('[data-party]');
    if (party) { setPartyAt(party.dataset.party); return; }
    const info = e.target.closest('[data-info]');
    const b = e.target.closest('[data-loc]');
    const l = locations.find(x => x.id === (info || b)?.dataset[info ? 'info' : 'loc']);
    if (!l) return;
    if (info || !l.shape) { showLocation(l, events.filter(x => x.locationId === l.id)); return; }
    _lit = _lit === l.id ? null : l.id;
    _map?.highlight(_lit);
    if (_lit) _map?.flyToLocation(l.id);
    box.querySelectorAll('.dm-nav-loc').forEach(x => x.classList.toggle('lit', x.dataset.loc === _lit));
  };
}

function showEvent(e, locations) {
  if (!e) return;
  const where = e.locationId === '__manual' ? e.locationText : locations.find(l => l.id === e.locationId)?.name;
  openDmModal({
    title: `📅 ${e.title || 'Event'}`,
    wide: true,
    html: `<div class="dm-nav-locview">
      ${e.image ? `<img class="dm-nav-locimg" src="${escapeHtml(e.image)}" alt="">` : ''}
      <div class="dm-hint">${escapeHtml([where && `📍 ${where}`, e.timeframe && `When: ${e.timeframe}`].filter(Boolean).join(' · '))}</div>
      ${e.description ? `<p class="dm-world-text">${escapeHtml(e.description)}</p>` : ''}
      ${e.trigger ? `<div class="dm-card-title">Trigger</div><p class="dm-world-text">${escapeHtml(e.trigger)}</p>` : ''}
    </div>`,
  });
}

function showLocation(l, events) {
  openDmModal({
    title: `📍 ${l.name || 'Location'}`,
    wide: true,
    html: `<div class="dm-nav-locview">
      ${l.image ? `<img class="dm-nav-locimg" src="${escapeHtml(l.image)}" alt="">` : ''}
      <div class="dm-hint">${escapeHtml(LOCATION_TYPES[l.type || 'city'] || '')}</div>
      ${l.description ? `<p class="dm-world-text">${escapeHtml(l.description)}</p>` : ''}
      ${(l.pois || []).filter(p => String(p).trim()).length ? `<div class="dm-card-title">Points of interest</div><ul>${l.pois.filter(p => String(p).trim()).map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` : ''}
      <div class="dm-card-title">Events</div>
      ${events.map(e => `<div class="dm-world-event" style="cursor:default"><strong>${escapeHtml(e.title || 'Untitled event')}</strong>
        <small>${escapeHtml([e.timeframe && `When: ${e.timeframe}`, e.trigger && `Trigger: ${e.trigger}`].filter(Boolean).join(' · '))}</small>
        ${e.description ? `<span class="dm-world-text" style="font-size:0.84rem">${escapeHtml(e.description)}</span>` : ''}</div>`).join('') || '<div class="dm-hint">No events here.</div>'}
    </div>`,
  });
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
      await startAdventure({ canJoin: false, onScreen: 'adventure' });
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
