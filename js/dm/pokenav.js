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
import { loadLocations, loadEvents, LOCATION_TYPES, readFolded, toggleFold } from './admin-world.js';
import { shapeDistance } from '../region-map/map-features.js';
import { currentMap, kmPerPx, parentOf, isTopLocation, withInside, routeSections, apply, invert, IDENTITY } from '../region-map/map-version.js';
import { getClock, formatDate, formatTime } from './world-clock.js';
import { renderAdventure, startAdventure } from './adventure.js';
import { regionPicture, wantsRegionPicture } from './region-picture.js';

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
    // The party's marker can be dragged anywhere on it (the user's call, 2026-11-12): out in the open, between locations.
    _map = mountRegionMap(document.getElementById('navMap'), { title: false, rememberStyle: false, onView: queue, homeAzimuth: HOME_AZIMUTH, turned: true, onPartyMove: setPartySpot });
    // Drawn without the graphics card (hardware acceleration off in the browser): it moves slowly, and that's why.
    if (_map.graphics.software) {
      const slow = document.getElementById('navSlow');
      slow.hidden = false;
      slow.textContent = 'Slow: this browser isn\'t using the graphics card';
      slow.title = 'Turn on hardware acceleration in the browser\'s settings (System), then restart it';
    }
    if (saved) _map.setView(saved); // (for the map style it was left in)
    Promise.all([loadLocations(), _party || loadParty()]).then(([list]) => { _map?.setLocations(list); _map?.setParty(_party?.locationId, _party?.spot); }).catch(() => {});
    await _map.ready;
    // Every start opens on the default view -- the compass's: straight down, north to the right, the whole painting
    // (the user's call, 2026-10-19) -- and the board screen follows (the move is sent like any other).
    _map.home({ ms: 0, azimuth: HOME_AZIMUTH, flat: true });
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
const NAV_FOLDED = 'dm-nav-folded';
const NAV_GROUPS_SHUT = 'dm-nav-groups-shut';   // the location types folded up in the list
// the players' marker (assets/MapMarker.png) as the party's icon here too (the user's call, 2026-10-20)
const PARTY_ICON = '<img class="dm-nav-partyicon" src="assets/region-map/party-marker.png" alt="">';
// What's inside a region, listed by type in this order and by name within a type (the user's call, 2026-11-09).
const INSIDE_ORDER = ['city', 'cave', 'forest', 'landmark', 'building', 'route'];
const insideRank = (l) => { const i = INSIDE_ORDER.indexOf(l.type || 'city'); return i < 0 ? INSIDE_ORDER.length : i; };
const insideOrder = (a, b) => insideRank(a) - insideRank(b) || String(a.name).localeCompare(String(b.name));

let _lit = null;     // the location drawn onto the map here
// { locationId, spot ([x, y] in the first map's pixels: the marker dragged there, out in the open -- with no locationId),
//   onBoard, at (the world clock's date and time), recent: [ids] }
let _party = null;

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
  if ((id || null) === (prev || null) && !_party?.spot) return;
  await saveParty({ ..._party, locationId: id || null, spot: null, at: id ? clockStamp() : '', recent: [prev, ...(_party?.recent || [])].filter((x, i, a) => x && x !== id && a.indexOf(x) === i).slice(0, 5) });
  _map?.setParty(_party.locationId);
  if (_party.locationId) {
    _lit = null;
    _map?.highlight(null);
    _map?.flyToLocation(_party.locationId, { sectionOnly: true });
  }
  drawLocations();
}

/** The party's marker dragged to `spot` (the map's onPartyMove): out in the open, at none of the locations -- the one it
 * was at goes on the recent list. The map has put it there already. */
async function setPartySpot(spot) {
  const prev = _party?.locationId;
  await saveParty({ ..._party, locationId: null, spot, at: clockStamp(), recent: [prev, ...(_party?.recent || [])].filter((x, i, a) => x && a.indexOf(x) === i).slice(0, 5) });
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

/** `open`: the party out in the open (its marker dragged there) as a pin, in the map in use's pixels -- or null. */
function partyHtml(locations, events, open) {
  const here = locations.find(l => l.id === _party?.locationId);
  // (a region isn't a place the players can be -- the party is put on a location in it: the user's call, 2026-10-21)
  const opts = Object.entries(LOCATION_TYPES).filter(([k]) => k !== 'region').map(([k, label]) => {
    const list = locations.filter(l => (l.type || 'city') === k).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return list.length ? `<optgroup label="${escapeHtml(label)}">${list.map(l => `<option value="${escapeHtml(l.id)}" ${l.id === here?.id ? 'selected' : ''}>${escapeHtml(l.name || 'Unnamed')}${parentOf(l, locations) ? ` (in ${escapeHtml(parentOf(l, locations).name || 'Unnamed')})` : ''}${l.shape ? '' : ' (not on the map)'}${l.secret ? ' 🔒' : ''}</option>`).join('')}</optgroup>` : '';
  }).join('');
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
  } else if (open) {
    // out in the open: only what's planned near the spot
    const near = nearby(open, locations).flatMap(({ l, km }) => events.filter(e => e.locationId === l.id).map(e => ({ e, l, km })));
    eventsHtml = `
      <div class="dm-cs-group-title">📅 Nearby <small>${near.length}</small></div>
      ${near.map(({ e, l, km }) => eventRowHtml(e, `${l.name || 'Unnamed'}, ${kmText(km)}`)).join('') || `<div class="dm-hint dm-nav-locnone">Nothing planned within ${NEAR_KM} km.</div>`}`;
  }
  const dragHint = 'Drag the marker on the map to move the party off the locations.';
  return `<div class="dm-card-title"><span>${PARTY_ICON} The party</span></div>
    <div class="dm-nav-party">
      <select class="dm-select" id="navPartyAt"><option value="">— Not set —</option>${open ? '<option value="__open" selected>📍 Out in the open</option>' : ''}${opts}</select>
      ${here ? `<div class="dm-hint">${here.shape ? '' : 'Not marked on the map, so it can\'t be shown there. '}${_party.at ? `Since ${escapeHtml(_party.at)}. ` : ''}${here.shape ? dragHint : ''}</div>`
        : open ? `<div class="dm-hint">Where the marker was dragged, at none of the locations.${_party.at ? ` Since ${escapeHtml(_party.at)}.` : ''} Drag it again, or pick a location to put it back on one.</div>`
        : '<div class="dm-hint">Pick where the players are -- the map lights it up and shows what\'s planned there and nearby. Then the marker can be dragged anywhere on the map.</div>'}
      <label class="dm-check"><input type="checkbox" id="navPartyBoard" ${_party?.onBoard !== false ? 'checked' : ''}><span>📺 Show it on the table's map
        <small>${here?.secret ? '🔒 This location is secret, so the table\'s map doesn\'t show it -- untick Secret in Admin once they\'ve found it.' : 'Untick for a journey the players shouldn\'t see on the map.'}</small></span></label>
      ${eventsHtml}
    </div>`;
}

async function drawLocations() {
  const box = document.getElementById('navLocations');
  if (!box) return;
  let locations, events, mapInUse;
  try {
    [locations, events] = await Promise.all([loadLocations(), loadEvents(), _party ? null : loadParty()]);
    mapInUse = await currentMap();
  } catch (err) {
    box.innerHTML = `<div class="dm-card-title"><span>📍 Locations</span></div><div class="dm-hint">Couldn't load them: ${escapeHtml(err.message)}</div>`;
    return;
  }
  _map?.setLocations(locations);
  _map?.setParty(_party?.locationId, _party?.spot);
  // out in the open (the marker dragged there): the spot as a pin on the map in use, for what's near it
  const open = !_party?.locationId && Array.isArray(_party?.spot)
    ? (([x, y]) => ({ id: '__open', shape: { kind: 'pin', x, y } }))(apply(invert(mapInUse?.toBase || IDENTITY), ..._party.spot)) : null;
  if (_lit && !locations.some(l => l.id === _lit && l.shape)) { _lit = null; _map?.highlight(null); }
  // a location inside another under it, a step in (the user's call, 2026-10-20) -- picked, what it's part of lights up too
  // one with others inside folds up (▾ / ▸, remembered on this computer)
  const folded = readFolded(NAV_FOLDED);
  const groupsShut = readFolded(NAV_GROUPS_SHUT);
  // what's lit in the list: the picked location, and the rest of a route that runs on into other regions
  const litIds = () => routeSections(locations.find(l => l.id === _lit), locations).map(l => l.id);
  const litNow = litIds();
  const typeLabel = l => LOCATION_TYPES[l.type || 'city'] || '';
  const fold = l => (locations.some(x => parentOf(x, locations) === l)
    ? `<button class="dm-nav-fold" data-fold="${escapeHtml(l.id)}" title="${folded.has(l.id) ? 'Show' : 'Hide'} what's inside">${folded.has(l.id) ? '▸' : '▾'}</button>` : '<span class="dm-nav-fold"></span>');
  const row = (l, depth = 0) => `<div class="dm-nav-locrow${depth ? ' sub' : ''}" ${depth ? `style="--depth: ${depth}"` : ''}>${fold(l)}<button class="dm-nav-loc${litNow.includes(l.id) ? ' lit' : ''}${l.id === _party?.locationId ? ' party' : ''}${l.shape ? '' : ' off-map'}" data-loc="${escapeHtml(l.id)}"
      title="${l.shape ? 'Show it on the map' : 'Not marked on the map yet (Admin › Locations)'}">
      <span>${depth ? '<span class="dm-nav-subarrow">⤷</span> ' : ''}${l.id === _party?.locationId ? `${PARTY_ICON} ` : ''}${escapeHtml(l.name || 'Unnamed')}${l.secret ? ' 🔒' : ''}</span>
      <small>${[!l.shape && 'not on the map', events.some(e => e.locationId === l.id) && `${events.filter(e => e.locationId === l.id).length} event(s)`].filter(Boolean).join(' · ')}</small>
      <span class="dm-nav-loctype" title="${escapeHtml(typeLabel(l).split(' ').slice(1).join(' '))}" aria-hidden="true">${typeLabel(l).split(' ')[0]}</span></button>
    ${l.type === 'region' ? '<span class="dm-icon-btn dm-nav-noparty" aria-hidden="true"></span>' : `<button class="dm-icon-btn" data-party="${escapeHtml(l.id)}" title="The party is here">${PARTY_ICON}</button>`}
    <button class="dm-icon-btn" data-info="${escapeHtml(l.id)}" title="Location info">ⓘ</button></div>`;
  // Two columns side by side, using the room beside the map (the user's call, 2026-10-20): the party and what's planned
  // there, and the locations -- their groups flowing into as many columns as fit. Each scrolls on its own, and keeps its
  // place when the list is drawn again (a fold, the party moving).
  const scrolled = [...box.querySelectorAll('.dm-nav-col')].map(c => c.scrollTop);
  box.innerHTML = `<div class="dm-nav-col dm-nav-partycol">${partyHtml(locations, events, open)}</div>
    <div class="dm-nav-col dm-nav-placescol">
      <div class="dm-card-title"><span>📍 Locations</span></div>
      <div class="dm-nav-groups">${Object.entries(LOCATION_TYPES).map(([k, label]) => {
        const here = withInside(locations.filter(l => (l.type || 'city') === k && isTopLocation(l, locations)).sort((a, b) => String(a.name).localeCompare(String(b.name))), locations, folded, insideOrder);
        // (the count: the locations of this type -- not what's inside them, listed here under them whatever their type)
        // A type's list folds up from its title (the user's call, 2026-10-21: no scrolling past every city to the routes),
        // remembered on this computer.
        const shut = groupsShut.has(k);
        return `<div class="dm-nav-locgroup${shut ? ' shut' : ''}"><button class="dm-cs-group-title dm-nav-grouptoggle" data-group="${k}" aria-expanded="${shut ? 'false' : 'true'}" title="${shut ? 'Show' : 'Hide'} them">
            <span class="dm-nav-grouparrow">${shut ? '▸' : '▾'}</span>${label} <small>${locations.filter(l => (l.type || 'city') === k).length}</small></button>
          ${shut ? '' : here.map(({ l, depth }) => row(l, depth)).join('') || '<div class="dm-hint dm-nav-locnone">None yet</div>'}</div>`;
      }).join('')}</div>
      <div class="dm-hint">Locations are added and marked on the map in the Admin module (📍 Locations).</div>
    </div>`;
  box.querySelectorAll('.dm-nav-col').forEach((c, i) => { c.scrollTop = scrolled[i] || 0; });
  box.querySelector('#navPartyAt').onchange = (e) => { if (e.target.value !== '__open') setPartyAt(e.target.value); };
  box.querySelector('#navPartyBoard').onchange = e => saveParty({ ..._party, onBoard: e.target.checked });
  box.onclick = (e) => {
    const fb = e.target.closest('[data-fold]');
    if (fb) { toggleFold(NAV_FOLDED, fb.dataset.fold); drawLocations(); return; }
    const gb = e.target.closest('[data-group]');
    if (gb) { toggleFold(NAV_GROUPS_SHUT, gb.dataset.group); drawLocations(); return; }
    const ev = e.target.closest('[data-event]');
    if (ev) { showEvent(events.find(x => x.id === ev.dataset.event), locations); return; }
    const party = e.target.closest('[data-party]');
    if (party) { setPartyAt(party.dataset.party); return; }
    const info = e.target.closest('[data-info]');
    const b = e.target.closest('[data-loc]');
    const l = locations.find(x => x.id === (info || b)?.dataset[info ? 'info' : 'loc']);
    if (!l) return;
    if (info || !l.shape) { showLocation(l, events.filter(x => x.locationId === l.id)); return; }
    _lit = litIds().includes(l.id) ? null : l.id;
    _map?.highlight(_lit);
    if (_lit) _map?.flyToLocation(l.id);
    const lit = litIds();
    box.querySelectorAll('.dm-nav-loc').forEach(x => x.classList.toggle('lit', lit.includes(x.dataset.loc)));
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
    title: `${l.type === 'region' ? '🗺️' : '📍'} ${l.name || 'Location'}`,
    wide: true,
    html: `<div class="dm-nav-locview">
      ${l.image ? `<img class="dm-nav-locimg" src="${escapeHtml(l.image)}" alt="">` : wantsRegionPicture(l) ? '<img class="dm-nav-locimg region" data-region-img alt="" hidden>' : ''}
      <div class="dm-hint">${escapeHtml(LOCATION_TYPES[l.type || 'city'] || '')}</div>
      ${l.description ? `<p class="dm-world-text">${escapeHtml(l.description)}</p>` : ''}
      ${(l.pois || []).filter(p => String(p).trim()).length ? `<div class="dm-card-title">Points of interest</div><ul>${l.pois.filter(p => String(p).trim()).map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` : ''}
      <div class="dm-card-title">Events</div>
      ${events.map(e => `<div class="dm-world-event" style="cursor:default"><strong>${escapeHtml(e.title || 'Untitled event')}</strong>
        <small>${escapeHtml([e.timeframe && `When: ${e.timeframe}`, e.trigger && `Trigger: ${e.trigger}`].filter(Boolean).join(' · '))}</small>
        ${e.description ? `<span class="dm-world-text" style="font-size:0.84rem">${escapeHtml(e.description)}</span>` : ''}</div>`).join('') || '<div class="dm-hint">No events here.</div>'}
    </div>`,
    // a region with no picture: its stretch of the map (region-picture.js)
    onOpen: (body) => {
      const img = body.querySelector('[data-region-img]');
      if (img) regionPicture(l).then((url) => { if (url) { img.src = url; img.hidden = false; } });
    },
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
    el.textContent = shows === 'battle' ? (_session.adventurePaused ? 'Battle running -- the adventure comes back when it ends' : 'Battle running -- back on the table screen when it ends')
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
