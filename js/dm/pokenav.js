// PokeNav: the region map in 3D (js/region-map/region-map.js) as the table's board screen (battle-map.html) shows it
// whenever no battle is running. What the DM sees here is what's on that screen -- the frame has its 16:9 shape --
// and turning, zooming, moving it or flying to a town here moves it there (POST /api/dm/region-map-view, a few times a
// second while it moves, pushed live). It's stored on the Pi at most once a second, and where it comes to rest. The
// board itself can't be touched. three.js is only loaded the first time the module is opened.
import { DmAPI } from '../api.js';
import { escapeHtml, toast } from './dm-common.js';

const SEND_EVERY_MS = 120;
const SAVE_EVERY_MS = 1000;
const SETTLED_MS = 600;   // no move for this long: it has come to rest, store where

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

export async function renderPokenav(section, { session } = {}) {
  _session = session;
  if (_section === section) { renderStatus(); return; }
  _section = section;
  section.innerHTML = `
    <div class="dm-nav">
      <div class="dm-nav-head">
        <h2>🧭 PokéNav</h2>
        <span class="dm-pill" id="navStatus"></span>
      </div>
      <div class="dm-nav-frame"><div class="dm-nav-screen"><div id="navMap"></div></div></div>
    </div>`;
  renderStatus();
  try {
    const [{ mountRegionMap }, saved] = await Promise.all([
      import('../region-map/region-map.js'),
      DmAPI.getState('region-map-view').catch(() => null),
    ]);
    _map = mountRegionMap(document.getElementById('navMap'), { title: false, rememberStyle: false, onView: queue });
    if (saved) _map.setView(saved);
    await _map.ready;
    // Never steered yet: the whole island lying along the screen, north to the right
    if (!saved) _map.home({ ms: 0, azimuth: Math.PI / 2 });
  } catch (err) {
    document.getElementById('navMap').innerHTML = `<div class="dm-loading">Couldn't load the map: ${escapeHtml(err.message)}</div>`;
  }
}

/** A battle started or ended: the board shows the battle map meanwhile. */
export function pokenavSessionChanged(session) {
  _session = session;
  renderStatus();
}

function renderStatus() {
  const el = document.getElementById('navStatus');
  if (!el) return;
  const battle = !!_session?.active;
  el.className = `dm-pill ${battle ? 'todo' : 'ok'}`;
  el.textContent = battle ? 'Battle running -- back on the table screen when it ends' : 'On the table screen';
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
