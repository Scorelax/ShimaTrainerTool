// DM console -- the Shima world clock: the in-game date and time, the world's weather, calendar events and the DM's
// timers. Kept on the Pi (routes_dm.py's dm_state 'world-clock') and pushed to every open DM console, so a reload or a
// second laptop shows the same time. One copy in memory here; clock.js is the module's screen, and the top bar shows
// the time, the weather and any pinned or finished timers (renderTopWidget).
//
// Shape: { year, month (1-12), day (1-28), hour, minute, weather, events: [{id, year, month, day, title, notes, recurring}],
//          timers: [{id, name, description, mode: 'countdown'|'stopwatch', source: 'real'|'world'|'turn', initial, value,
//                    running, startedAt, pinned, expired}] }
// A real-time timer that's running keeps the value it had when started plus `startedAt` (ms), so it counts on while no
// page is open; world-clock timers move whenever the clock is moved; turn timers move on each turn of a battle.
//
// The calendar itself is the one from Benjakronk's old DM tool: 12 months of 28 days (so every month starts on a
// Monday), the year counted AFR.
import { DmAPI } from '../api.js';
import { escapeHtml, newId, toast } from './dm-common.js';

export const MONTHS = [
  { formal: 'Aestivus', common: 'Estia', season: 'Late Summer' },
  { formal: 'Aurantius', common: 'Aurel', season: 'Autumn' },
  { formal: 'Rubescens', common: 'Russa', season: 'Autumn' },
  { formal: 'Nebulus', common: 'Nebra', season: 'Autumn' },
  { formal: 'Glacialis', common: 'Gelo', season: 'Winter' },
  { formal: 'Umbrosus', common: 'Ombra', season: 'Winter' },
  { formal: 'Crystallus', common: 'Crista', season: 'Winter' },
  { formal: 'Vernalis', common: 'Primo', season: 'Spring' },
  { formal: 'Floralis', common: 'Flora', season: 'Spring' },
  { formal: 'Viridis', common: 'Verde', season: 'Spring' },
  { formal: 'Solarius', common: 'Sola', season: 'Summer' },
  { formal: 'Ardentus', common: 'Ardena', season: 'Summer' },
];
export const DAYS_PER_MONTH = 28;
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const FESTIVALS = {
  '1-1': 'Star Festival (New Year)', '2-15': 'Harvest Moon Festival', '6-14': 'Festival of Lights',
  '8-1': 'Spring Awakening', '11-14': 'Summer Solstice', '12-28': "Trainer's Day",
};
export const PHASES = [
  { name: 'Dawn', h: 6 }, { name: 'Morning', h: 8 }, { name: 'Midday', h: 12 }, { name: 'Afternoon', h: 14 },
  { name: 'Dusk', h: 18 }, { name: 'Evening', h: 20 }, { name: 'Night', h: 22 }, { name: 'Late Night', h: 2 },
];
export const WEATHER = {
  clear: { name: 'Clear', icon: '☀️' }, overcast: { name: 'Overcast', icon: '☁️' }, rain: { name: 'Heavy rain', icon: '🌧️' },
  storm: { name: 'Thunderstorm', icon: '⛈️' }, wind: { name: 'Strong winds', icon: '💨' }, fog: { name: 'Fog', icon: '🌫️' },
  snow: { name: 'Snow', icon: '🌨️' }, hail: { name: 'Hail', icon: '🧊' }, sandstorm: { name: 'Sandstorm', icon: '🏜️' },
};
const SEASONAL_WEATHER = {
  'Late Summer': { clear: 10, overcast: 3, rain: 2, storm: 2, wind: 2, fog: 1 },
  Autumn: { clear: 6, overcast: 6, rain: 5, wind: 4, fog: 4, storm: 2 },
  Winter: { clear: 4, overcast: 6, snow: 6, hail: 3, wind: 4, fog: 3, storm: 1 },
  Spring: { clear: 6, overcast: 4, rain: 6, wind: 3, fog: 3, storm: 2 },
  Summer: { clear: 10, overcast: 2, rain: 2, storm: 3, wind: 2, sandstorm: 1 },
};
export const DEFAULT_CLOCK = { year: 847, month: 1, day: 1, hour: 8, minute: 0, weather: 'clear', events: [], timers: [] };

// ---------------------------------------------------------------------------
// Calendar maths
// ---------------------------------------------------------------------------

export const monthInfo = m => MONTHS[((m - 1) % 12 + 12) % 12];
export const formatDate = (c, formal = false) => `${formal ? monthInfo(c.month).formal : monthInfo(c.month).common} ${c.day}, ${c.year} AFR`;
export const formatTime = c => `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
export const festivalOn = (month, day) => FESTIVALS[`${month}-${day}`] || null;
/** Day 1 of every month is a Monday (28-day months, 12 of them: both divide by 7). */
export const weekday = day => WEEKDAYS[(day - 1) % 7];

export function phaseName(c) {
  const mins = c.hour * 60 + c.minute;
  if (mins < 6 * 60) return 'Late Night';
  let best = 'Late Night';
  let bestMins = -1;
  PHASES.forEach(p => { const pm = p.h * 60; if (pm <= mins && pm >= bestMins) { bestMins = pm; best = p.name; } });
  return best;
}

/** {year, month, day} moved by `delta` days. */
export function stepDate({ year, month, day }, delta) {
  let total = (year * 12 + (month - 1)) * DAYS_PER_MONTH + (day - 1) + delta;
  const y = Math.floor(total / (12 * DAYS_PER_MONTH));
  total -= y * 12 * DAYS_PER_MONTH;
  return { year: y, month: Math.floor(total / DAYS_PER_MONTH) + 1, day: (total % DAYS_PER_MONTH) + 1 };
}

export function eventsOn(year, month, day) {
  return (_clock?.events || []).filter(e => e.month === month && e.day === day && (e.recurring || e.year === year));
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

const TAB = newId('tab'); // tells this tab's own saves apart when the live push brings them back
let _clock = null;
let _saveTimer = null;
const _listeners = new Set();

export async function loadClock() {
  const res = await DmAPI.getClock().catch(() => null);
  _clock = normalise(res?.data);
  window.addEventListener('app:dm-clock', (e) => {
    const pushed = e.detail?.clock;
    if (!pushed || pushed._tab === TAB) return;
    _clock = normalise(pushed);
    notify();
  });
  setInterval(tickRealTimers, 1000);
  return _clock;
}

function normalise(c) {
  const out = { ...DEFAULT_CLOCK, ...(c || {}) };
  out.events = Array.isArray(out.events) ? out.events : [];
  out.timers = Array.isArray(out.timers) ? out.timers : [];
  delete out._tab;
  return out;
}

export function getClock() {
  return _clock;
}

export function onClockChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function notify() {
  _listeners.forEach(fn => fn(_clock));
}

// Once a second while a real-time timer runs -- only the numbers changed, so screens update those in place.
const _tickListeners = new Set();
export function onTimerTick(fn) {
  _tickListeners.add(fn);
  return () => _tickListeners.delete(fn);
}

/** Runs `fn(clock)` to change it, tells everyone, and saves a moment later. */
export function updateClock(fn) {
  fn(_clock);
  notify();
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveNow, 400);
}

async function saveNow() {
  clearTimeout(_saveTimer);
  try {
    await DmAPI.saveClock({ ..._clock, _tab: TAB });
  } catch (err) {
    toast(`Couldn't save the clock: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Moving time
// ---------------------------------------------------------------------------

/** Moves the clock by `n` minutes (negative goes back); world-clock timers move with it. */
export function advanceMinutes(n) {
  n = Math.round(n);
  if (!n) return;
  updateClock(c => {
    let total = c.hour * 60 + c.minute + n;
    const dayDelta = Math.floor(total / 1440);
    total -= dayDelta * 1440;
    c.hour = Math.floor(total / 60);
    c.minute = total % 60;
    Object.assign(c, stepDate(c, dayDelta));
    c.timers.filter(t => t.source === 'world').forEach(t => moveTimer(t, n));
  });
}

/** On to the next time that phase starts (tomorrow's, if it's already past today). */
export function skipToPhase(name) {
  const p = PHASES.find(x => x.name === name);
  if (!p) return;
  let delta = p.h * 60 - (_clock.hour * 60 + _clock.minute);
  if (delta <= 0) delta += 1440;
  advanceMinutes(delta);
}

export function setDateTime({ year, month, day, hour, minute }) {
  updateClock(c => {
    Object.assign(c, {
      year: Math.max(0, year | 0), month: Math.max(1, Math.min(12, month | 0)), day: Math.max(1, Math.min(DAYS_PER_MONTH, day | 0)),
      hour: Math.max(0, Math.min(23, hour | 0)), minute: Math.max(0, Math.min(59, minute | 0)),
    });
  });
}

/** A weather for the current season, weighted the way the old tool rolled it. */
export function rollWeather() {
  const table = SEASONAL_WEATHER[monthInfo(_clock.month).season] || { clear: 1 };
  let r = Math.random() * Object.values(table).reduce((a, b) => a + b, 0);
  const pick = Object.keys(table).find(k => (r -= table[k]) <= 0) || 'clear';
  updateClock(c => { c.weather = pick; });
  return pick;
}

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

/** A timer's value right now -- seconds (real), minutes (world) or turns. */
export function timerValue(t) {
  if (t.source !== 'real' || !t.running || !t.startedAt) return t.value;
  const elapsed = Math.floor((Date.now() - t.startedAt) / 1000);
  return t.mode === 'countdown' ? Math.max(0, t.value - elapsed) : t.value + elapsed;
}

export function formatTimer(t, value = timerValue(t)) {
  const v = Math.max(0, value | 0);
  if (t.source === 'turn') return `${v} turn${v === 1 ? '' : 's'}`;
  if (t.source === 'real') {
    const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), s = v % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }
  const d = Math.floor(v / 1440), h = Math.floor((v % 1440) / 60), m = v % 60;
  return [d && `${d}d`, (h || d) && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}

/** Moves a (non-real-time) timer by `amount` of its unit; a countdown reaching 0 is done. */
function moveTimer(t, amount) {
  if (t.mode === 'countdown') {
    if (amount > 0 && (t.expired || t.value <= 0)) return;
    t.value = Math.max(0, t.value - amount);
    if (t.value === 0 && amount > 0) expire(t);
  } else {
    t.value = Math.max(0, t.value + amount);
  }
}

function expire(t) {
  t.expired = true;
  t.running = false;
  t.startedAt = null;
  t.value = 0;
  toast(`⏰ "${t.name}" is done`);
  beep();
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach(at => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.2);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch { /* no sound available -- the toast is enough */ }
}

/** Every second: running real-time countdowns that reached 0 are done; the timer displays are redrawn. */
function tickRealTimers() {
  if (!_clock) return;
  const running = _clock.timers.filter(t => t.source === 'real' && t.running);
  if (!running.length) return;
  const done = running.filter(t => t.mode === 'countdown' && timerValue(t) <= 0);
  if (done.length) updateClock(() => done.forEach(expire));
  else _tickListeners.forEach(fn => fn(_clock));
}

/** A battle turn passed (dm-console.js watches the running battle): running turn timers move by one. */
export function tickTurnTimers(turns = 1) {
  if (!_clock?.timers.some(t => t.source === 'turn' && t.running)) return;
  updateClock(c => c.timers.filter(t => t.source === 'turn' && t.running).forEach(t => moveTimer(t, turns)));
}

export function saveTimer(fields, id = null) {
  updateClock(c => {
    const existing = id && c.timers.find(t => t.id === id);
    if (existing) {
      const sourceChanged = existing.source !== fields.source || existing.mode !== fields.mode;
      Object.assign(existing, fields);
      if (sourceChanged || existing.value > fields.initial || existing.expired) {
        Object.assign(existing, { value: fields.mode === 'countdown' ? fields.initial : 0, running: false, startedAt: null, expired: false });
      }
    } else {
      c.timers.push({
        id: newId('tmr'), ...fields, value: fields.mode === 'countdown' ? fields.initial : 0,
        // World-clock timers always move with the clock; the others wait for Start.
        running: fields.source === 'world', startedAt: null, expired: false,
      });
    }
  });
}

export function timerAction(id, action) {
  updateClock(c => {
    const t = c.timers.find(x => x.id === id);
    if (!t) return;
    if (action === 'delete') { c.timers = c.timers.filter(x => x.id !== id); return; }
    if (action === 'pin') { t.pinned = !t.pinned; return; }
    if (action === 'dismiss') { t.expired = false; return; }
    if (action === 'reset') { Object.assign(t, { value: t.mode === 'countdown' ? t.initial : 0, running: t.source === 'world', startedAt: null, expired: false }); return; }
    if (action === 'toggle') {
      if (t.running) {
        t.value = timerValue(t);
        Object.assign(t, { running: false, startedAt: null });
      } else {
        if (t.mode === 'countdown' && t.value <= 0) Object.assign(t, { value: t.initial, expired: false });
        Object.assign(t, { running: true, startedAt: t.source === 'real' ? Date.now() : null });
      }
      return;
    }
    if (action === 'plus' || action === 'minus') {
      const d = action === 'plus' ? 1 : -1;
      // "+1" adds a unit to what's left / what's counted; for a countdown that's the other way round from ticking.
      if (t.mode === 'countdown') { t.value = Math.max(0, t.value + d); if (t.value > 0) t.expired = false; } else t.value = Math.max(0, t.value + d);
    }
  });
}

// ---------------------------------------------------------------------------
// The top bar: date, time, weather, and timers that are pinned or done
// ---------------------------------------------------------------------------

export function renderTopWidget(el, onOpen) {
  const draw = () => {
    const c = _clock;
    if (!c) return;
    const w = WEATHER[c.weather] || WEATHER.clear;
    const fest = festivalOn(c.month, c.day);
    const shown = c.timers.filter(t => t.pinned || t.expired);
    el.innerHTML = `
      ${shown.map(t => `<button class="dm-top-timer${t.expired ? ' expired' : ''}" data-open title="${escapeHtml(t.description || t.name)}">
        ${t.mode === 'countdown' ? '⏳' : '⏱'} ${escapeHtml(t.name)} <strong>${t.expired ? 'done!' : formatTimer(t)}</strong></button>`).join('')}
      <button class="dm-top-clock" data-open title="Open the clock">
        <span class="dm-top-date">${fest ? '🎉 ' : ''}${escapeHtml(monthInfo(c.month).common)} ${c.day}, ${c.year}</span>
        <span class="dm-top-time">${formatTime(c)}</span>
        <span class="dm-top-phase">${phaseName(c)}</span>
        <span class="dm-top-weather" title="${escapeHtml(w.name)}">${w.icon}</span>
      </button>`;
  };
  el.addEventListener('click', (e) => { if (e.target.closest('[data-open]')) onOpen(); });
  onClockChange(draw);
  onTimerTick(draw);
  draw();
}
