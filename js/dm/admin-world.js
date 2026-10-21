// DM console -- the Admin module's world tabs (the user's call, 2026-10-20): Events (what the DM plans to happen -- a
// title, a description, a picture, a trigger and a timeframe in the DM's own words, and where), Locations (the region's
// places by type -- City, Route, Cave, Forest -- with a description, points of interest, a main picture and the events
// tied to them; PokeNav's region map lists them) and Status conditions (the rulebook's, to look up, and the DM's own,
// with a battle trigger and an optional automatic effect -- routes_combat.py runs them, see _custom_status_point).
// Kept on the Pi in dm_state ('events', 'locations', 'status-conditions') and saved as they change.
// A location can be marked on the region map (`shape`, js/dm/location-map.js) -- the 3D map's names and highlights
// come from these (region-map.js's setLocations; the board screen hears of a change live, routes_dm.save_state).
// The towns the map was made with (assets/region-map/places.json) are added as locations the first time, already
// marked ('region-map' state: townsSeeded). The tab's 🗺 The region map opens the map's paintings: a new one uploaded,
// lined up and built, or an older one put back in use (js/dm/map-upload.js, the user's call, 2026-10-20).
import { DmAPI } from '../api.js';
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import { CONDITION_RULES } from '../utils/condition-rules.js';
import { escapeHtml, newId, toast, stepperHtml } from './dm-common.js';
import { prepareImage } from './display.js';
import { openPicker } from './picker.js';
import { STATUS_TRIGGERS, STATUS_EFFECTS, describeTrigger } from '../utils/custom-status.js';
import { editLocationShape, drawShapePreview, describeShape } from './location-map.js';
import { currentMap, isMajor, parentOf, partOfChain, isTopLocation, withInside } from '../region-map/map-version.js';
import { iconSpot, pointInRings, shapeBounds } from '../region-map/map-features.js';
import { ICON_SIZE, iconFor, uploadIcon, pickLibraryIcon, openIconLibrary } from './location-icon.js';

export { STATUS_TRIGGERS, STATUS_EFFECTS, describeTrigger };

// (Landmark and Building added -- the user's call, 2026-10-20: a sawmill, a shrine... often inside a bigger location;
// each one spot on the map like a city, not major unless ticked)
// (Region added, first -- the user's call, 2026-10-20: the painting's dark lines mark the regions; everything inside one
// is listed under it, like folders)
export const LOCATION_TYPES = { region: '🗺️ Region', city: '🏙️ City', route: '🛤️ Route', cave: '🕳️ Cave', forest: '🌲 Forest', landmark: '🗿 Landmark', building: '🏠 Building' };

const PICTURE_SIDE = 1600;

// ---------------------------------------------------------------------------
// The records, kept on the Pi
// ---------------------------------------------------------------------------

const _data = { events: null, locations: null, 'status-conditions': null };
const _loading = {};
const _timers = {};

/** One of the lists, fetched once per page. Not reached (the Pi didn't answer): nothing is kept, so the next try
 * fetches again -- an empty list kept here would be saved over the real one by the next change. Two callers at once
 * share one fetch (the towns added only once). */
function load(key) {
  if (_data[key]) return Promise.resolve(_data[key]);
  if (!_loading[key]) {
    _loading[key] = (async () => {
      const saved = await DmAPI.getState(key);
      const list = Array.isArray(saved) ? saved.filter(x => x && x.id) : [];
      if (key === 'locations') await seedTowns(list);
      _data[key] = list;
      return list;
    })().finally(() => { delete _loading[key]; });
  }
  return _loading[key];
}

/** The first time: the towns the 3D map was made with as locations, marked where they are (one already made with the
 * same name only gets its spot). Kept from happening again by the 'region-map' state, so a town deleted stays gone. */
async function seedTowns(list) {
  let flags;
  try {
    flags = (await DmAPI.getState('region-map')) || {};
  } catch (err) {
    return; // not known whether it was done: not now
  }
  if (flags.townsSeeded) return;
  const places = (await currentMap().catch(() => null))?.places;
  if (!places?.towns) return;
  places.towns.forEach((t) => {
    const same = list.find(l => String(l.name || '').trim().toLowerCase() === t.name.toLowerCase());
    if (same) { if (!same.shape) same.shape = { kind: 'pin', x: t.x, y: t.y }; return; }
    list.push({ id: newId('loc'), name: t.name, type: 'city', description: '', pois: [], image: '', shape: { kind: 'pin', x: t.x, y: t.y }, createdAt: new Date().toISOString() });
  });
  try {
    await DmAPI.saveState('locations', list);
    await DmAPI.saveState('region-map', { ...flags, townsSeeded: true });
  } catch (err) { /* tried again next time */ }
}

function saveSoon(key) {
  setSaving(true);
  clearTimeout(_timers[key]);
  _timers[key] = setTimeout(async () => {
    _timers[key] = null;
    try {
      await DmAPI.saveState(key, _data[key]);
      setSaving(false);
    } catch (err) {
      setSaving(null);
      toast(`Couldn't save: ${err.message}`);
    }
  }, 500);
}

// Leaving the page (or the tab going to the background) with a change still waiting: it's sent right away.
if (typeof window !== 'undefined') {
  const flush = () => Object.keys(_timers).forEach((key) => {
    if (!_timers[key]) return;
    clearTimeout(_timers[key]);
    _timers[key] = null;
    DmAPI.saveState(key, _data[key]).catch(() => {});
  });
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}

function setSaving(on) {
  const pill = document.getElementById('worldSave');
  if (!pill) return;
  pill.className = `dm-pill ${on === null ? 'todo' : on ? 'warn' : 'ok'}`;
  pill.textContent = on === null ? 'Not saved' : on ? 'Saving…' : 'All saved';
}

export const loadEvents = () => load('events');
export const loadLocations = () => load('locations');
/** The DM's own status conditions (only the complete ones -- a name, a description and a trigger -- for a battle). */
export async function loadStatusConditions({ complete = false } = {}) {
  const list = await load('status-conditions');
  return complete ? list.filter(isComplete) : list;
}
/** "Needs a description" -- what a status condition still lacks of the three it must have. */
function missingText(d) {
  const miss = [!String(d.name || '').trim() && 'a name', !String(d.description || '').trim() && 'a description', !STATUS_TRIGGERS[d.trigger] && 'a trigger'].filter(Boolean);
  return `Needs ${miss.length > 1 ? `${miss.slice(0, -1).join(', ')} and ${miss[miss.length - 1]}` : miss[0]}`;
}
const isComplete = d =>!!(String(d.name || '').trim() && String(d.description || '').trim() && STATUS_TRIGGERS[d.trigger]);

// Another tab to go to (admin.js's showTab) -- a location's event opens it in Events.
let _goTo = null;
export function setWorldNav(fn) { _goTo = fn; }
let _selected = { events: null, locations: null, statuses: null };
/** Which record a tab opens on next (a location's "＋ New event here", an event clicked in a location). */
export function selectInWorld(tab, id) { _selected[tab] = id; }

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function shell(body, { title, newLabel, searchPh }) {
  body.innerHTML = `
    <div class="dm-editor dm-world">
      <aside class="dm-editor-tools">
        <div class="dm-editor-head"><h2>${title}</h2><span class="dm-pill ok" id="worldSave">All saved</span></div>
        <input class="dm-input" id="worldSearch" placeholder="${escapeHtml(searchPh)}" autocomplete="off">
        <button class="dm-btn primary" id="worldNew">${newLabel}</button>
        <div class="dm-pdx-list" id="worldList"></div>
      </aside>
      <section class="dm-editor-canvas" id="worldForm"></section>
    </div>`;
}

const field = (label, html, hint = '') => `<div class="dm-field"><label>${label}</label>${html}${hint ? `<div class="dm-hint">${hint}</div>` : ''}</div>`;
const input = (k, v, ph = '', max = 120) => `<input class="dm-input" data-w="${k}" value="${escapeHtml(v ?? '')}" placeholder="${escapeHtml(ph)}" maxlength="${max}">`;
const area = (k, v, ph = '', rows = 4) => `<textarea class="dm-input" data-w="${k}" rows="${rows}" placeholder="${escapeHtml(ph)}">${escapeHtml(v ?? '')}</textarea>`;

function pictureHtml(url) {
  return `<div class="dm-world-pic">
    <span class="dm-world-picimg">${url ? `<img src="${escapeHtml(url)}" alt="">` : '<span class="dm-hint">No picture</span>'}</span>
    <span class="dm-row"><button class="dm-btn small" data-w-act="pic">⬆ ${url ? 'Another picture' : 'Upload a picture'}</button>
    <button class="dm-btn small" data-w-act="pic-pick" title="One of the Display module's backgrounds, already on the Pi">🖼️ Select image</button>
    ${url ? '<button class="dm-btn small danger" data-w-act="pic-remove">Remove</button>' : ''}</span></div>`;
}

/** A picture from the DM's computer onto the Pi -> its URL (null: none picked / it failed, already told). A PNG stays a
 * PNG (an icon's see-through background kept). */
function uploadPicture(maxSide = PICTURE_SIDE) {
  return new Promise((resolve) => {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = 'image/*';
    el.addEventListener('change', async () => {
      const file = el.files?.[0];
      if (!file) { resolve(null); return; }
      try {
        resolve((await DmAPI.adminPicture(await prepareImage(file, maxSide))).url);
      } catch (err) {
        showCombatAlert(err.message, { title: "Couldn't upload the picture" });
        resolve(null);
      }
    });
    el.click();
  });
}

/** One of the pictures already uploaded as backgrounds in the Display module (the user's call, 2026-10-20: no need to
 * upload the same picture twice) -> its URL (null: none picked / it failed, already told). Searchable by name and by
 * the folder it's in. The event keeps pointing at the background's file, so deleting it there takes it off here too. */
async function pickBackground(locationId = '') {
  let images, folders;
  try {
    const [res, f] = await Promise.all([DmAPI.displayImages(), DmAPI.getState('display-folders').catch(() => null)]);
    images = res.data || [];
    folders = Array.isArray(f) ? f : [];
  } catch (err) {
    showCombatAlert(err.message, { title: "Couldn't load the backgrounds" });
    return null;
  }
  const pathOf = (id) => {
    const names = [];
    for (let f = folders.find(x => x.id === id), guard = 0; f && guard < 20; f = folders.find(x => x.id === f.parent), guard++) names.unshift(f.name);
    return names.join(' › ');
  };
  // the location's own folder (display.js keeps one for each, the user's call, 2026-10-20): its pictures first
  const own = locationId ? folders.find(f => f.locId === locationId) : null;
  const inOwn = (b) => {
    for (let f = folders.find(x => x.id === b.folder), guard = 0; own && f && guard < 20; f = folders.find(x => x.id === f.parent), guard++) if (f.id === own.id) return true;
    return false;
  };
  const sorted = [...images.filter(inOwn), ...images.filter(b => !inOwn(b))];
  const picked = await openPicker({
    title: '🖼️ Select an image',
    items: sorted.map(b => ({ key: b.id, label: b.name || 'Picture', sub: b.folder ? `${inOwn(b) ? '✓' : '📁'} ${pathOf(b.folder)}` : '', image: b.url })),
    hint: `The pictures uploaded as backgrounds in the Display module.${own ? ` The ones in ${own.name}'s folder first.` : ''}`,
    emptyText: 'No backgrounds uploaded yet -- the Display module\'s Backgrounds keeps them.',
  });
  const key = picked?.keys?.[0];
  return key ? images.find(b => b.id === key)?.url || null : null;
}

/** The locations folded up in a list (their ids), kept on this computer: Admin's and the PokéNav's each their own. */
export const ADMIN_FOLDED = 'dm-admin-folded';
export function readFolded(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); }
}
export function toggleFold(key, id) {
  const s = readFolded(key);
  if (s.has(id)) s.delete(id); else s.add(id);
  try { localStorage.setItem(key, JSON.stringify([...s])); } catch { /* not remembered: fine */ }
}

/** A picture file picked on the DM's computer (null: none). */
function pickIconFile() {
  return new Promise((resolve) => {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = 'image/png,image/webp,image/jpeg,image/gif';
    el.addEventListener('change', () => resolve(el.files?.[0] || null));
    el.click();
  });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** The tab couldn't get its list from the Pi: said so, with a way to try again (nothing to edit meanwhile). */
function loadFailed(body, err, again) {
  body.innerHTML = `<div class="dm-cs-empty">Couldn't load it from the Pi: ${escapeHtml(err.message)}<br><button class="dm-btn" id="worldRetry">Try again</button></div>`;
  document.getElementById('worldRetry').addEventListener('click', () => again(body));
}

export async function drawEvents(body) {
  let events, locations;
  try { [events, locations] = await Promise.all([loadEvents(), loadLocations()]); } catch (err) { loadFailed(body, err, drawEvents); return; }
  shell(body, { title: '📅 Events', newLabel: '＋ New event', searchPh: 'Find an event…' });
  const locName = (e) => (e.locationId === '__manual' ? e.locationText : locations.find(l => l.id === e.locationId)?.name) || '';
  const list = () => {
    const q = document.getElementById('worldSearch').value.trim().toLowerCase();
    const shown = events.filter(e => !q || `${e.title} ${e.description} ${e.trigger} ${e.timeframe} ${locName(e)}`.toLowerCase().includes(q));
    document.getElementById('worldList').innerHTML = shown.map(e => `
      <button class="dm-pdx-row${e.id === _selected.events ? ' selected' : ''}" data-id="${escapeHtml(e.id)}">
        <span class="dm-pdx-thumb">${e.image ? `<img src="${escapeHtml(e.image)}" alt="">` : '📅'}</span>
        <span class="dm-pdx-main"><strong>${escapeHtml(e.title || 'Untitled event')}</strong><small>${escapeHtml([locName(e), e.timeframe].filter(Boolean).join(' · ') || 'No place or time yet')}</small></span><span></span>
      </button>`).join('') || `<div class="dm-hint">${events.length ? 'Nothing matches that.' : 'No events yet.'}</div>`;
  };
  const form = () => {
    const box = document.getElementById('worldForm');
    const e = events.find(x => x.id === _selected.events);
    if (!e) { box.innerHTML = '<div class="dm-cs-empty">Pick an event on the left, or make a new one.</div>'; return; }
    box.innerHTML = `<div class="dm-world-form">
      <div class="dm-world-formhead">${input('title', e.title, 'Title', 120).replace('class="dm-input"', 'class="dm-input dm-world-title"')}
        <button class="dm-btn danger" data-w-act="delete">🗑 Delete</button></div>
      ${field('Description', area('description', e.description, 'What happens', 5))}
      <div class="dm-row dm-world-two">
        ${field('Trigger', area('trigger', e.trigger, 'What sets it off -- the players reach the harbour, someone mentions the Apex…', 3))}
        ${field('Timeframe', area('timeframe', e.timeframe, 'When -- the 3rd day of Estia, after the gym battle, any time at night…', 3))}
      </div>
      ${field('Location', locationComboHtml(e, locations), 'Optional. "Manual input" for a place that isn\'t in Locations yet.')}
      <div class="dm-field" id="worldManualLoc" ${e.locationId === '__manual' ? '' : 'hidden'}><label>The place</label>${input('locationText', e.locationText, 'Where it happens')}</div>
      ${field('Picture', pictureHtml(e.image), 'Optional.')}
    </div>`;
    wireLocationCombo(box, e, locations, () => { document.getElementById('worldManualLoc').hidden = e.locationId !== '__manual'; changed(); });
  };
  const changed = () => { saveSoon('events'); list(); };
  wireShell(body, {
    list, form,
    create: () => {
      const e = { id: newId('evt'), title: 'New event', description: '', image: '', trigger: '', timeframe: '', locationId: '', locationText: '', createdAt: new Date().toISOString() };
      if (_selected.newAt) { e.locationId = _selected.newAt; _selected.newAt = null; }
      events.unshift(e);
      _selected.events = e.id;
      changed();
      form();
      document.querySelector('[data-w="title"]')?.select();
    },
    pick: id => { _selected.events = id; list(); form(); },
    current: () => events.find(x => x.id === _selected.events),
    onField: (e, k, v) => { e[k] = v; changed(); },
    onAct: async (e, act) => {
      if (act === 'delete') {
        if (!await showCombatConfirm(`Delete the event "${e.title}"?`, { title: 'Delete event', yesLabel: 'Delete', noLabel: 'Cancel' })) return;
        events.splice(events.indexOf(e), 1);
        _selected.events = null;
        changed(); form();
      } else if (act === 'pic' || act === 'pic-pick' || act === 'pic-remove') {
        const url = act === 'pic' ? await uploadPicture() : act === 'pic-pick' ? await pickBackground(e.locationId) : '';
        if (url === null) return;
        e.image = url; changed(); form();
      }
    },
  });
  if (_selected.newAt) document.getElementById('worldNew').click();
}

/** The location dropdown: a search on top, "Manual input" first, "No location", then every location by type. */
function locationComboHtml(e, locations) {
  const cur = e.locationId === '__manual' ? '✍️ Manual input' : locations.find(l => l.id === e.locationId)?.name || 'No location';
  return `<div class="dm-combo" data-combo>
    <button type="button" class="dm-select dm-combo-btn" data-combo-open>${escapeHtml(cur)}</button>
    <div class="dm-combo-panel" hidden>
      <input class="dm-input" data-combo-search placeholder="Search the locations…" autocomplete="off">
      <div class="dm-combo-list" data-combo-list></div>
    </div></div>`;
}

function wireLocationCombo(box, e, locations, onChange) {
  const combo = box.querySelector('[data-combo]');
  const panel = combo.querySelector('.dm-combo-panel');
  const search = combo.querySelector('[data-combo-search]');
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const opts = [`<button type="button" data-loc="__manual" class="dm-combo-opt">✍️ Manual input</button>`,
      `<button type="button" data-loc="" class="dm-combo-opt">No location</button>`];
    Object.entries(LOCATION_TYPES).forEach(([k, label]) => {
      const here = locations.filter(l => (l.type || 'city') === k && (!q || String(l.name || '').toLowerCase().includes(q)));
      if (here.length) opts.push(`<div class="dm-combo-group">${label}</div>`, ...here.map(l => `<button type="button" data-loc="${escapeHtml(l.id)}" class="dm-combo-opt${l.id === e.locationId ? ' on' : ''}">${escapeHtml(l.name || 'Unnamed')}</button>`));
    });
    if (!locations.length) opts.push('<div class="dm-hint" style="padding:0.4rem">No locations yet -- add them in the Locations tab.</div>');
    combo.querySelector('[data-combo-list]').innerHTML = opts.join('');
  };
  const close = () => { panel.hidden = true; document.removeEventListener('pointerdown', outside, true); };
  const outside = (ev) => { if (!combo.contains(ev.target)) close(); };
  combo.querySelector('[data-combo-open]').addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (panel.hidden) { close(); return; }
    search.value = '';
    draw();
    search.focus();
    document.addEventListener('pointerdown', outside, true);
  });
  search.addEventListener('input', draw);
  combo.querySelector('[data-combo-list]').addEventListener('click', (ev) => {
    const opt = ev.target.closest('[data-loc]');
    if (!opt) return;
    e.locationId = opt.dataset.loc;
    combo.querySelector('[data-combo-open]').textContent = opt.textContent;
    close();
    onChange();
  });
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export async function drawLocations(body) {
  let locations, events;
  try { [locations, events] = await Promise.all([loadLocations(), loadEvents(), currentMap()]); } catch (err) { loadFailed(body, err, drawLocations); return; }
  // the icon library on the Pi (location-icon.js): fetched again after an upload, for a location to find its own
  let library = [];
  const loadLibrary = () => DmAPI.locationIcons().then((l) => { library = l; }).catch(() => {});
  shell(body, { title: '📍 Locations', newLabel: '＋ New location', searchPh: 'Find a location…' });
  // the map's paintings (a new one, an older one back): every location moves onto the one in use
  const maps = document.createElement('button');
  maps.className = 'dm-btn';
  maps.textContent = '🗺 The region map';
  maps.title = 'Upload a new painting of the map, or go back to an older one';
  document.getElementById('worldNew').after(maps);
  // the icons on the Pi, many uploaded at once (the locations made later find their own)
  const iconsBtn = document.createElement('button');
  iconsBtn.className = 'dm-btn';
  iconsBtn.textContent = '🏰 Location icons';
  iconsBtn.title = 'The icons on the Pi -- upload many at once, named <Type>-<Location name>';
  maps.after(iconsBtn);
  iconsBtn.addEventListener('click', async () => {
    await openIconLibrary({ locations, onLocationsChanged: () => { saveSoon('locations'); list(); } });
    await loadLibrary();
    form();
  });
  maps.addEventListener('click', async () => {
    const { openRegionMaps } = await import('./map-upload.js');
    openRegionMaps({ locations, onChanged: () => { list(); form(); } });
  });
  // Folded up in the list: what's inside them hidden (remembered on this computer)
  document.getElementById('worldList').addEventListener('click', (e) => {
    const fold = e.target.closest('[data-fold]');
    if (!fold) return;
    e.stopPropagation();
    toggleFold(ADMIN_FOLDED, fold.dataset.fold);
    list();
  }, true);
  const list = () => {
    const q = document.getElementById('worldSearch').value.trim().toLowerCase();
    const folded = readFolded(ADMIN_FOLDED);
    const shown = locations.filter(l => !q || `${l.name} ${l.description} ${(l.pois || []).join(' ')}`.toLowerCase().includes(q));
    const byName = (a, b) => String(a.name).localeCompare(String(b.name));
    // A location inside another is listed under it, a step in, whatever its own type (the user's call, 2026-10-20);
    // searching lists what matches as it is, each saying what it's part of.
    const row = (l, depth = 0) => `
        <button class="dm-pdx-row${l.id === _selected.locations ? ' selected' : ''}${depth ? ' dm-world-sub' : ''}" data-id="${escapeHtml(l.id)}" ${depth ? `style="--depth: ${depth}"` : ''}>
          <span class="dm-pdx-thumb">${l.image ? `<img src="${escapeHtml(l.image)}" alt="">` : '📍'}</span>
          <span class="dm-pdx-main"><strong>${!q && locations.some(x => parentOf(x, locations) === l) ? `<span class="dm-world-fold" data-fold="${escapeHtml(l.id)}" title="${folded.has(l.id) ? 'Show' : 'Hide'} what's inside">${folded.has(l.id) ? '▸' : '▾'}</span> ` : ''}${depth ? '<span class="dm-world-subarrow">⤷</span> ' : ''}${escapeHtml(l.name || 'Unnamed')}${l.secret ? ' <span title="Secret: not on the table\'s map">🔒</span>' : ''}</strong><small>${[q && parentOf(l, locations) && `in ${escapeHtml(parentOf(l, locations).name || 'Unnamed')}`, l.shape ? '🗺 On the map' : '<span class="dm-warn-text">Not on the map</span>', `${events.filter(e => e.locationId === l.id).length} event(s)`, !q && locations.some(x => parentOf(x, locations) === l) && `${locations.filter(x => parentOf(x, locations) === l).length} inside`].filter(Boolean).join(' · ')}</small></span><span></span>
        </button>`;
    document.getElementById('worldList').innerHTML = Object.entries(LOCATION_TYPES).map(([k, label]) => {
      const here = q ? shown.filter(l => (l.type || 'city') === k).sort(byName).map(l => ({ l, depth: 0 }))
        : withInside(locations.filter(l => (l.type || 'city') === k && isTopLocation(l, locations)).sort(byName), locations, folded);
      return here.length ? `<div class="dm-cs-group-title">${label}</div>${here.map(({ l, depth }) => row(l, depth)).join('')}` : '';
    }).join('') || `<div class="dm-hint">${locations.length ? 'Nothing matches that.' : 'No locations yet.'}</div>`;
  };
  const form = () => {
    const box = document.getElementById('worldForm');
    const l = locations.find(x => x.id === _selected.locations);
    if (!l) { box.innerHTML = '<div class="dm-cs-empty">Pick a location on the left, or make a new one.</div>'; return; }
    const here = events.filter(e => e.locationId === l.id);
    box.innerHTML = `<div class="dm-world-form">
      <div class="dm-world-formhead">${input('name', l.name, 'Name / title').replace('class="dm-input"', 'class="dm-input dm-world-title"')}
        <button class="dm-btn danger" data-w-act="delete">🗑 Delete</button></div>
      ${field('Location type', `<select class="dm-select" data-w="type">${Object.entries(LOCATION_TYPES).map(([k, lab]) => `<option value="${k}" ${(l.type || 'city') === k ? 'selected' : ''}>${lab}</option>`).join('')}</select>`)}
      ${field('Part of', `<select class="dm-select" data-w="parentId"><option value="">— Not part of another location —</option>${
        // never itself, nor one that's inside it (a loop)
        locations.filter(x => x !== l && !partOfChain(x, locations).includes(l)).sort((a, b) => String(a.name).localeCompare(String(b.name)))
          .map(x => `<option value="${escapeHtml(x.id)}" ${parentOf(l, locations) === x ? 'selected' : ''}>${(LOCATION_TYPES[x.type || 'city'] || '').split(' ')[0]} ${escapeHtml(x.name || 'Unnamed')}</option>`).join('')
      }</select><div class="dm-hint">A place inside a bigger one -- a sawmill in a forest: listed under it, and on the PokéNav its outline lights up with it.</div>`)}
      <div class="dm-field"><label>On the map</label>
        <div class="dm-world-map">
          ${l.shape ? '<canvas class="dm-world-mapprev" id="worldMapPrev"></canvas>' : '<button class="dm-world-mapnone" data-w-act="map">🗺<span>Not on the map yet</span></button>'}
          <span class="dm-world-mapside">
            <strong>${escapeHtml(describeShape(l.shape))}</strong>
            <button class="dm-btn small primary" data-w-act="map">🗺 ${l.shape ? 'Change it on the map' : 'Mark it on the map'}</button>
            ${l.shape ? '<button class="dm-btn small danger" data-w-act="map-remove">Take it off the map</button>' : ''}
            <span class="dm-hint">A city, a cave, a landmark or a building is one spot, a route a line along the roads, a forest or a region an area (🗺 Region fills one in up to its border lines).</span>
          </span>
        </div>
        <label class="dm-check"><input type="checkbox" data-w="major" ${isMajor(l) ? 'checked' : ''}><span>⭐ Major location
          <small>Its name shows with the whole island in view -- the others' names come in as the map zooms in.</small></span></label>
        <label class="dm-check"><input type="checkbox" data-w="secret" ${l.secret ? 'checked' : ''}><span>🔒 Secret
          <small>Only on your PokéNav -- the table's map doesn't show it, its name or its icon.</small></span></label>
      </div>
      <div class="dm-field"><label>Icon on the map</label>
        <div class="dm-world-map">
          <span class="dm-world-icon">${l.icon?.url ? `<img src="${escapeHtml(l.icon.url)}" alt="">` : '🏰'}</span>
          <span class="dm-world-mapside">
            <strong>${!l.icon?.url ? 'No icon' : l.shape ? `Stands on its mark, about ${l.icon.size || ICON_SIZE.first} km tall` : 'Shows once it\'s marked on the map'}</strong>
            ${!l.icon?.url && iconFor(library, l) ? `<button class="dm-btn small primary" data-w-act="icon-mine">✔ Use ${escapeHtml(iconFor(library, l).file)}</button>` : ''}
            <span class="dm-row"><button class="dm-btn small" data-w-act="icon-up" title="Stored on the Pi as ${escapeHtml(`${(l.type || 'city') === 'city' ? 'City' : (l.type || '').replace(/^./, c => c.toUpperCase())}-${l.name || ''}`)}">⬆ ${l.icon ? 'Another icon' : 'Upload an icon'}</button>
              <button class="dm-btn small" data-w-act="icon-pick" title="One of the icons on the Pi (~/pokemon-dnd/images/locations)">🏰 Select icon</button></span>
            ${l.icon?.url ? '<span class="dm-row"><button class="dm-btn small danger" data-w-act="icon-remove">Remove</button></span>' : ''}
            <span class="dm-hint">A little model of the place, standing on its mark on the 3D map like the painted cities -- a PNG with a see-through background looks best. It's sized in On the map (Change it on the map).</span>
          </span>
        </div>
      </div>
      ${field('Description', area('description', l.description, 'What the place is like', 5))}
      <div class="dm-field"><label>Points of interest</label>
        <div class="dm-world-pois">${(l.pois || []).map((p, i) => `<div class="dm-row"><input class="dm-input" data-poi="${i}" value="${escapeHtml(p)}" placeholder="What the players can do here" maxlength="200"><button class="dm-icon-btn danger" data-w-act="poi-del" data-i="${i}" title="Remove">✕</button></div>`).join('')}</div>
        <button class="dm-btn small" data-w-act="poi-add">＋ Point of interest</button></div>
      ${field('Main picture', pictureHtml(l.image))}
      <div class="dm-field"><label>Events here</label>
        <div class="dm-world-events">${here.map(e => `<button class="dm-world-event" data-w-act="open-event" data-i="${escapeHtml(e.id)}">
          <strong>${escapeHtml(e.title || 'Untitled event')}</strong><small>${escapeHtml([e.timeframe, e.trigger].filter(Boolean).join(' · ') || 'No trigger or time yet')}</small></button>`).join('')
          || '<div class="dm-hint">No events tied to this location -- pick it as an event\'s Location in the Events tab.</div>'}</div>
        <button class="dm-btn small" data-w-act="new-event">＋ New event here</button></div>
    </div>`;
    box.querySelectorAll('[data-poi]').forEach(el => el.addEventListener('input', () => { l.pois[Number(el.dataset.poi)] = el.value; changed(); }));
    const prev = document.getElementById('worldMapPrev');
    if (prev) drawShapePreview(prev, l.shape).catch(() => {});
  };
  const changed = () => { saveSoon('locations'); list(); };
  wireShell(body, {
    list, form,
    create: () => {
      const l = { id: newId('loc'), name: 'New location', type: 'city', description: '', pois: [], image: '', createdAt: new Date().toISOString() };
      locations.unshift(l);
      _selected.locations = l.id;
      changed(); form();
      document.querySelector('[data-w="name"]')?.select();
    },
    pick: id => { _selected.locations = id; list(); form(); },
    current: () => locations.find(x => x.id === _selected.locations),
    onField: (l, k, v) => { l[k] = v; changed(); },
    onAct: async (l, act, btn) => {
      if (act === 'delete') {
        const n = events.filter(e => e.locationId === l.id).length;
        if (!await showCombatConfirm(`Delete the location "${l.name}"?${n ? ` Its ${n} event(s) stay, without a location.` : ''}`, { title: 'Delete location', yesLabel: 'Delete', noLabel: 'Cancel' })) return;
        locations.splice(locations.indexOf(l), 1);
        // what was inside it is part of what it was part of now
        // (or, if it was part of nothing, left free to go under the next area it's marked in)
        locations.forEach((x) => { if (x.parentId === l.id) { if (l.parentId) x.parentId = l.parentId; else delete x.parentId; } });
        if (n) { events.forEach((e) => { if (e.locationId === l.id) e.locationId = ''; }); saveSoon('events'); }
        _selected.locations = null;
        changed(); form();
      } else if (act === 'poi-add') {
        l.pois = [...(l.pois || []), ''];
        changed(); form();
        document.querySelector(`[data-poi="${l.pois.length - 1}"]`)?.focus();
      } else if (act === 'poi-del') {
        l.pois.splice(Number(btn.dataset.i), 1);
        changed(); form();
      } else if (act === 'pic' || act === 'pic-pick' || act === 'pic-remove') {
        const url = act === 'pic' ? await uploadPicture() : act === 'pic-pick' ? await pickBackground(l.id) : '';
        if (url === null) return;
        l.image = url; changed(); form();
      } else if (act === 'map') {
        const shape = await editLocationShape(l, locations.filter(x => x !== l && (x.shape || x.icon)), { onIcon: (icon) => { l.icon = icon; } });
        if (shape === undefined) return;
        l.shape = shape;
        // A region marked: every location inside it goes under it (the user's call, 2026-10-21: nothing to add by hand)
        // -- what it's part of goes under it instead when that's in the region too (a sawmill stays in its forest, the
        // forest goes in the region). Left as they are: one already in this region, and one in another region that
        // also covers it (overlapping, the DM's pick). Under this region but outside it now: taken out of it.
        if (l.type === 'region' && shape.kind === 'area') {
          const inRegion = x => { const p = iconSpot(x.shape); return !!p && pointInRings(shape.rings, p[0], p[1]); };
          const moved = new Set();
          locations.forEach((x) => {
            if (x === l || (x.type || 'city') === 'region' || !inRegion(x)) return;
            const chain = partOfChain(x, locations);
            if (chain.includes(l)) return;
            const r = chain.findIndex(c => c !== x && (c.type || 'city') === 'region');
            const other = r >= 0 ? chain[r] : null;
            const p = iconSpot(x.shape);
            if (other?.shape?.kind === 'area' && pointInRings(other.shape.rings, p[0], p[1])) return;
            // the outermost of what it's part of (below any region) that's in this region too
            const below = r >= 0 ? chain.slice(0, r) : chain;
            const top = [...below].reverse().find(c => !c.shape || inRegion(c)) || x;
            if (top.parentId !== l.id) { top.parentId = l.id; moved.add(top); }
          });
          let out = 0;
          locations.forEach((x) => {
            if (x.parentId !== l.id || inRegion(x) || !iconSpot(x.shape)) return;
            delete x.parentId;
            out++;
          });
          if (moved.size) toast(`${moved.size} location${moved.size === 1 ? '' : 's'} inside ${l.name || 'the region'} ${moved.size === 1 ? 'is' : 'are'} part of it now${out ? ` -- ${out} outside it now taken out` : ''}`);
          else if (out) toast(`${out} location${out === 1 ? '' : 's'} outside ${l.name || 'the region'} now ${out === 1 ? 'is' : 'are'} no longer part of it`);
        }
        // marked inside a forest (or another area, a region) and never given a Part of: it's put under it -- the
        // smallest one. Moved out of the area it was part of (into another region, say): it goes under the one it's in
        // now, or under none.
        const at = iconSpot(shape);
        const was = parentOf(l, locations);
        const movedOut = !!(at && was?.shape?.kind === 'area' && !pointInRings(was.shape.rings, at[0], at[1]));
        if ((l.parentId === undefined || movedOut) && l.type !== 'region' && at) {
          const size = x => { const b = shapeBounds(x.shape); return (b.x1 - b.x0) * (b.y1 - b.y0); };
          const holder = locations.filter(x => x !== l && x.shape?.kind === 'area' && pointInRings(x.shape.rings, at[0], at[1]) && !partOfChain(x, locations).includes(l))
            .sort((a, b) => size(a) - size(b))[0];
          if (holder) { l.parentId = holder.id; toast(`It's inside ${holder.name || 'an area'}, so it's listed under it -- change that in Part of`); }
          else if (movedOut) { delete l.parentId; toast(`It's outside ${was.name || 'the area'} now, so it's no longer listed under it`); }
        }
        changed(); form();
      } else if (act === 'icon-up' || act === 'icon-pick' || act === 'icon-mine') {
        // a new picture: it stands on the location's mark at the size the old one had (sized in the mark's editor --
        // the user's call, 2026-10-20). Uploaded here, it goes into the icon library as "<Type>-<the location's name>"
        // (one there already under that name replaced).
        let url = null;
        if (act === 'icon-mine') url = iconFor(library, l)?.url || null;
        else if (act === 'icon-pick') url = await pickLibraryIcon(l);
        else {
          if (!String(l.name || '').trim()) { toast('Give the location a name first -- the icon is stored under it'); return; }
          const file = await pickIconFile();
          if (!file) return;
          await loadLibrary();
          if (iconFor(library, l) && !await showCombatConfirm(`There's an icon for ${l.name} on the Pi already (${iconFor(library, l).file}). Replace it?`, { title: 'Upload an icon', yesLabel: 'Replace it', noLabel: 'Cancel' })) return;
          try {
            const r = await uploadIcon({ type: l.type || 'city', name: l.name.trim(), file }, library, locations);
            url = r.entry.url;
            if (r.moved) changed();
          } catch (err) {
            showCombatAlert(err.message, { title: "Couldn't upload the icon" });
            return;
          }
          loadLibrary();
        }
        if (!url) return;
        l.icon = { url, size: l.icon?.size || ICON_SIZE.first };
        changed(); form();
      } else if (act === 'icon-remove') {
        delete l.icon;
        changed(); form();
      } else if (act === 'map-remove') {
        if (!await showCombatConfirm(`Take "${l.name}" off the map? It stays a location, just not marked anywhere.`, { title: 'Take it off the map', yesLabel: 'Take it off', noLabel: 'Cancel' })) return;
        delete l.shape;
        changed(); form();
      } else if (act === 'open-event') {
        _selected.events = btn.dataset.i;
        _goTo?.('events');
      } else if (act === 'new-event') {
        _selected.newAt = l.id;
        _goTo?.('events');
      }
    },
  });
  // (once the icons on the Pi are known, a location without an icon offers its own)
  loadLibrary().then(() => { if (document.getElementById('worldForm')) form(); });
}

// ---------------------------------------------------------------------------
// Status conditions
// ---------------------------------------------------------------------------

const RULE_NAME = k => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export async function drawStatuses(body) {
  let custom;
  try { custom = await loadStatusConditions(); } catch (err) { loadFailed(body, err, drawStatuses); return; }
  shell(body, { title: '🌀 Status conditions', newLabel: '＋ New status condition', searchPh: 'Find a status condition…' });
  const rules = Object.entries(CONDITION_RULES).map(([k, r]) => ({ key: `rule:${k}`, name: RULE_NAME(k), summary: r.summary || '', note: r.note || '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const list = () => {
    const q = document.getElementById('worldSearch').value.trim().toLowerCase();
    const mine = custom.filter(d => !q || `${d.name} ${d.description}`.toLowerCase().includes(q));
    const theirs = rules.filter(r => !q || `${r.name} ${r.summary}`.toLowerCase().includes(q));
    document.getElementById('worldList').innerHTML = `
      <div class="dm-cs-group-title">Your status conditions</div>
      ${mine.map(d => `<button class="dm-pdx-row${d.id === _selected.statuses ? ' selected' : ''}" data-id="${escapeHtml(d.id)}">
        <span class="dm-pdx-thumb">🌀</span><span class="dm-pdx-main"><strong>${escapeHtml(d.name || 'Unnamed')}</strong><small>${isComplete(d) ? escapeHtml(describeTrigger(d)) : `<span class="dm-warn-text">${escapeHtml(missingText(d))} -- not usable in a battle yet</span>`}</small></span><span></span></button>`).join('')
        || '<div class="dm-hint" style="padding:0.3rem 0.4rem">None yet -- "＋ New status condition".</div>'}
      <div class="dm-cs-group-title">In the rules</div>
      ${theirs.map(r => `<button class="dm-pdx-row${r.key === _selected.statuses ? ' selected' : ''}" data-id="${escapeHtml(r.key)}">
        <span class="dm-pdx-thumb">📖</span><span class="dm-pdx-main"><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(r.summary.slice(0, 70))}${r.summary.length > 70 ? '…' : ''}</small></span><span></span></button>`).join('')}`;
  };
  const form = () => {
    const box = document.getElementById('worldForm');
    const rule = rules.find(r => r.key === _selected.statuses);
    if (rule) {
      box.innerHTML = `<div class="dm-world-form">
        <h3 class="dm-cs-title">📖 ${escapeHtml(rule.name)}</h3>
        ${field('What it does', `<div class="dm-world-text">${escapeHtml(rule.summary) || '—'}</div>`)}
        ${rule.note ? field('How the app handles it', `<div class="dm-world-text dm-hint">${escapeHtml(rule.note)}</div>`) : ''}
        <div class="dm-hint">One of the rulebook's conditions -- it's added from a creature's card in a battle, with 🌀 Give a status in the Battle module, or by a move.</div></div>`;
      return;
    }
    const d = custom.find(x => x.id === _selected.statuses);
    if (!d) { box.innerHTML = '<div class="dm-cs-empty">Pick a status condition on the left, or make your own.</div>'; return; }
    const turns = /^turns_/.test(d.trigger);
    box.innerHTML = `<div class="dm-world-form">
      <div class="dm-world-formhead">${input('name', d.name, 'Name *', 40).replace('class="dm-input"', 'class="dm-input dm-world-title"')}
        <button class="dm-btn danger" data-w-act="delete">🗑 Delete</button></div>
      ${field('Description *', area('description', d.description, 'What it does -- the players see this when it triggers', 4))}
      <div class="dm-row dm-world-two">
        ${field('Trigger *', `<select class="dm-select" data-w="trigger">${Object.entries(STATUS_TRIGGERS).map(([k, l]) => `<option value="${k}" ${d.trigger === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`,
          'When it goes off in a battle. "Your" turn is the turn of the creature that has it.')}
        <div class="dm-field" ${turns ? '' : 'hidden'} id="worldTurns"><label>How many turns (X)</label>${stepperHtml({ id: 'worldTurnsIn', attrs: 'data-w="turns"', value: Math.max(1, Number(d.turns) || 1), min: 1, max: 99 })}</div>
      </div>
      <label class="dm-check"><input type="checkbox" data-w="recurring" ${d.recurring ? 'checked' : ''}><span>Recurring
        <small>It keeps going off every time its trigger comes round. Unticked, it goes off once and then wears off.</small></span></label>
      <div class="dm-row dm-world-two">
        ${field('Effect', `<select class="dm-select" data-w="effect">${Object.entries(STATUS_EFFECTS).map(([k, l]) => `<option value="${k}" ${(d.effect || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`,
          'Optional. Damage, Heal, VP gain and VP drain happen by themselves each time it goes off.')}
        <div class="dm-field" ${d.effect ? '' : 'hidden'} id="worldAmount"><label>How much</label>${stepperHtml({ id: 'worldAmountIn', attrs: 'data-w="amount"', value: Math.max(0, Number(d.amount) || 0), min: 0, max: 999 })}</div>
      </div>
      <div class="dm-hint">Each time it goes off, whoever controls the creature gets a popup with its description (and the effect) to handle the rest by hand.
        Give it to creatures in a battle from the Battle module (🌀 Status on a creature).</div>
    </div>`;
  };
  const changed = () => { saveSoon('status-conditions'); list(); };
  wireShell(body, {
    list, form,
    create: () => {
      const d = { id: newId('cond'), name: 'New status condition', description: '', trigger: 'turn_start', turns: 1, recurring: false, effect: '', amount: 0 };
      custom.unshift(d);
      _selected.statuses = d.id;
      changed(); form();
      document.querySelector('[data-w="name"]')?.select();
    },
    pick: id => { _selected.statuses = id; list(); form(); },
    current: () => custom.find(x => x.id === _selected.statuses),
    onField: (d, k, v) => {
      d[k] = k === 'turns' || k === 'amount' ? Math.max(0, parseInt(v, 10) || 0) : v;
      if (k === 'trigger') document.getElementById('worldTurns').hidden = !/^turns_/.test(v);
      if (k === 'effect') document.getElementById('worldAmount').hidden = !v;
      changed();
    },
    onAct: async (d, act) => {
      if (act !== 'delete') return;
      if (!await showCombatConfirm(`Delete the status condition "${d.name}"? Creatures that have it in a battle keep it.`, { title: 'Delete status condition', yesLabel: 'Delete', noLabel: 'Cancel' })) return;
      custom.splice(custom.indexOf(d), 1);
      _selected.statuses = null;
      changed(); form();
    },
  });
}

/** The list (search, New, pick) and the form's fields and buttons, the same for every tab. */
function wireShell(body, { list, form, create, pick, current, onField, onAct }) {
  document.getElementById('worldSearch').addEventListener('input', list);
  document.getElementById('worldNew').addEventListener('click', create);
  document.getElementById('worldList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-id]');
    if (row) pick(row.dataset.id);
  });
  const formBox = document.getElementById('worldForm');
  const onInput = (e) => {
    const el = e.target.closest('[data-w]');
    const rec = current();
    if (!el || !rec) return;
    onField(rec, el.dataset.w, el.type === 'checkbox' ? el.checked : el.value);
  };
  formBox.addEventListener('input', (e) => { if (e.target.tagName !== 'SELECT' && e.target.type !== 'checkbox') onInput(e); });
  formBox.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') onInput(e); });
  formBox.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-w-act]');
    const rec = current();
    if (btn && rec) onAct(rec, btn.dataset.wAct, btn);
  });
  list();
  form();
}
