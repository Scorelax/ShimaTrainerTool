// DM console -- the Clock module: the Shima date and time (moved on in steps, skipped to a time of day, or set), the
// world's weather, the calendar with its festivals, the DM's events and the NPCs' birthdays, and the DM's timers. The
// clock itself lives in world-clock.js; this is its screen.
import { DmAPI } from '../api.js';
import { showCombatConfirm, showCombatAlert } from '../utils/combat-alert.js';
import { escapeHtml, toast } from './dm-common.js';
import {
  MONTHS, DAYS_PER_MONTH, WEEKDAYS, PHASES, WEATHER, getClock, updateClock, onClockChange, onTimerTick, monthInfo,
  formatDate, formatTime, phaseName, festivalOn, weekday, stepDate, eventsOn, advanceMinutes, skipToPhase, setDateTime,
  rollWeather, timerValue, formatTimer, saveTimer, timerAction, DEFAULT_CLOCK,
} from './world-clock.js';

const STEPS = [[1, '1m'], [15, '15m'], [60, '1h'], [360, '6h'], [1440, '1d']];

let _root = null;
let _view = null; // the month the calendar shows: {year, month}
let _selDay = null; // the day picked in the calendar
let _eventForm = null; // null | 'new' | an event id
let _timerForm = null; // null | 'new' | a timer id
let _npcs = [];
let _pendingRender = false;
let _wired = false;

export function renderClock(root) {
  _root = root;
  const c = getClock();
  if (!_view) _view = { year: c.year, month: c.month };
  if (!_wired) {
    _wired = true;
    onClockChange(scheduleRender);
    onTimerTick(updateTimerNumbers);
    window.addEventListener('app:dm-npcs', loadNpcs);
    // A redraw put off while the DM was typing happens once they leave the field.
    root.addEventListener('focusout', () => setTimeout(() => { if (_pendingRender && !typing()) draw(); }, 0));
  }
  loadNpcs();
  draw();
}

async function loadNpcs() {
  try { _npcs = (await DmAPI.npcs()).data || []; } catch { _npcs = []; }
  if (_root && !_root.hidden) scheduleRender();
}

function typing() {
  const a = document.activeElement;
  return !!(a && _root?.contains(a) && a.matches('input:not([type=checkbox]), textarea, select'));
}

function scheduleRender() {
  if (!_root || _root.hidden || !document.body.contains(_root)) return;
  if (typing()) { _pendingRender = true; return; }
  draw();
}

function birthdaysOn(month, day) {
  return _npcs.filter(n => n.birthday && Number(n.birthday.month) === month && Number(n.birthday.day) === day);
}

function draw() {
  _pendingRender = false;
  const scroll = [..._root.querySelectorAll('.dm-clock-col')].map(el => el.scrollTop);
  _root.innerHTML = `
    <div class="dm-clock">
      <div class="dm-clock-col">${nowHtml()}</div>
      <div class="dm-clock-col">${calendarHtml()}</div>
      <div class="dm-clock-col">${timersHtml()}</div>
    </div>`;
  _root.querySelectorAll('.dm-clock-col').forEach((el, i) => { el.scrollTop = scroll[i] || 0; });
  wire();
}

// ---------------------------------------------------------------------------
// Now: date, time, moving it, weather
// ---------------------------------------------------------------------------

function nowHtml() {
  const c = getClock();
  const m = monthInfo(c.month);
  const fest = festivalOn(c.month, c.day);
  return `
    <div class="dm-card-title">Now</div>
    <div class="dm-clock-now">
      <div class="dm-clock-date">${escapeHtml(formatDate(c))}</div>
      <div class="dm-clock-formal">${escapeHtml(formatDate(c, true))} · ${weekday(c.day)}</div>
      <div class="dm-clock-tags"><span class="dm-pill todo">${escapeHtml(m.season)}</span>${fest ? `<span class="dm-pill ok">🎉 ${escapeHtml(fest)}</span>` : ''}</div>
      <div class="dm-clock-time">${formatTime(c)}<span>${phaseName(c)}</span></div>
      <div class="dm-clock-steps">
        ${STEPS.map(([n, l]) => `<button class="dm-btn small" data-advance="${-n}">−${l}</button>`).join('')}
        ${STEPS.map(([n, l]) => `<button class="dm-btn small primary" data-advance="${n}">+${l}</button>`).join('')}
      </div>
    </div>

    <div class="dm-card-title">Skip to</div>
    <div class="dm-clock-phases">${PHASES.map(p => `<button class="dm-btn small" data-phase="${p.name}">${p.name} <small>${String(p.h).padStart(2, '0')}:00</small></button>`).join('')}</div>

    <div class="dm-card-title">Weather</div>
    <div class="dm-row">
      <select class="dm-select" id="clkWeather">${Object.entries(WEATHER).map(([k, w]) => `<option value="${k}" ${k === c.weather ? 'selected' : ''}>${w.icon} ${w.name}</option>`).join('')}</select>
      <button class="dm-btn" id="clkRoll" title="Roll a weather that fits the season">🎲 Roll</button>
    </div>
    <div class="dm-hint">The world's weather -- separate from a battle's weather.</div>

    <div class="dm-card-title">Set the date and time</div>
    <div class="dm-clock-set">
      <label>Year<input class="dm-input" id="clkYear" type="number" min="0" value="${c.year}"></label>
      <label>Month<select class="dm-select" id="clkMonth">${MONTHS.map((mo, i) => `<option value="${i + 1}" ${i + 1 === c.month ? 'selected' : ''}>${i + 1}. ${mo.common}</option>`).join('')}</select></label>
      <label>Day<input class="dm-input" id="clkDay" type="number" min="1" max="${DAYS_PER_MONTH}" value="${c.day}"></label>
      <label>Hour<input class="dm-input" id="clkHour" type="number" min="0" max="23" value="${c.hour}"></label>
      <label>Minute<input class="dm-input" id="clkMinute" type="number" min="0" max="59" value="${c.minute}"></label>
      <button class="dm-btn primary" id="clkApply">Set</button>
    </div>

    <div class="dm-clock-foot">
      <button class="dm-btn small" id="clkRestore" title="Bring over the clock saved from the old DM tool (shima-worldclock-….json)">📂 Restore from the old DM tool</button>
      <input type="file" id="clkRestoreFile" accept="application/json,.json" hidden>
      <button class="dm-btn small danger" id="clkReset">Reset</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// Calendar: the month, the picked day's events, and what's coming up
// ---------------------------------------------------------------------------

function calendarHtml() {
  const c = getClock();
  const { year, month } = _view;
  const m = monthInfo(month);
  const cells = [];
  for (let d = 1; d <= DAYS_PER_MONTH; d++) {
    const today = c.year === year && c.month === month && c.day === d;
    const fest = festivalOn(month, d);
    const evs = eventsOn(year, month, d);
    const bdays = birthdaysOn(month, d);
    const tip = [fest, ...evs.map(e => e.title), ...bdays.map(n => `${n.name}'s birthday`)].filter(Boolean).join('\n');
    cells.push(`
      <button class="dm-cal-day${today ? ' today' : ''}${_selDay === d ? ' selected' : ''}" data-day="${d}" title="${escapeHtml(tip)}">
        <span class="dm-cal-num">${d}</span>
        <span class="dm-cal-marks">${fest ? '🎉' : ''}${bdays.length ? '🎂' : ''}${evs.length ? `📌${evs.length > 1 ? evs.length : ''}` : ''}</span>
        ${evs[0] ? `<span class="dm-cal-first">${escapeHtml(evs[0].title)}</span>` : fest ? `<span class="dm-cal-first">${escapeHtml(fest)}</span>` : ''}
      </button>`);
  }
  return `
    <div class="dm-cal-head">
      <button class="dm-btn small" data-cal="-12" title="A year back">«</button>
      <button class="dm-btn small" data-cal="-1" title="A month back">‹</button>
      <div class="dm-cal-title"><strong>${escapeHtml(m.common)} ${year} AFR</strong><small>${escapeHtml(m.formal)} · ${escapeHtml(m.season)}</small></div>
      <button class="dm-btn small" data-cal="1" title="A month on">›</button>
      <button class="dm-btn small" data-cal="12" title="A year on">»</button>
      <button class="dm-btn small" id="calToday">Today</button>
    </div>
    <div class="dm-cal-grid">
      ${WEEKDAYS.map(w => `<div class="dm-cal-wd">${w.slice(0, 3)}</div>`).join('')}
      ${cells.join('')}
    </div>
    ${_selDay ? dayHtml(year, month, _selDay) : '<div class="dm-hint" style="margin-top:0.8rem">Click a day to see its events or add one.</div>'}
    ${upcomingHtml()}`;
}

function dayHtml(year, month, day) {
  const c = getClock();
  const fest = festivalOn(month, day);
  const evs = eventsOn(year, month, day);
  const bdays = birthdaysOn(month, day);
  const isToday = c.year === year && c.month === month && c.day === day;
  const editing = _eventForm && _eventForm !== 'new' ? (c.events.find(e => e.id === _eventForm) || null) : null;
  const form = (e) => `
    <div class="dm-cal-form">
      <input class="dm-input" id="evTitle" placeholder="What happens" value="${escapeHtml(e?.title || '')}">
      <textarea class="dm-input" id="evNotes" rows="3" placeholder="Notes">${escapeHtml(e?.notes || '')}</textarea>
      <label class="dm-check"><input type="checkbox" id="evRecurring" ${e?.recurring ? 'checked' : ''}>Every year</label>
      <div class="dm-row"><button class="dm-btn" id="evCancel">Cancel</button><button class="dm-btn primary" id="evSave">${e ? 'Save' : 'Add event'}</button></div>
    </div>`;
  return `
    <div class="dm-cal-dayview">
      <div class="dm-cal-dayhead">
        <strong>${weekday(day)}, ${escapeHtml(monthInfo(month).common)} ${day}, ${year}</strong>
        ${isToday ? '<span class="dm-pill ok">Today</span>' : '<button class="dm-btn small" id="calSetDay">Make this today</button>'}
      </div>
      ${fest ? `<div class="dm-cal-item fest">🎉 ${escapeHtml(fest)}</div>` : ''}
      ${bdays.map(n => `<div class="dm-cal-item bday">🎂 ${escapeHtml(n.name)}'s birthday</div>`).join('')}
      ${evs.map(e => (editing?.id === e.id ? form(e) : `
        <div class="dm-cal-item event">
          <div><strong>📌 ${escapeHtml(e.title)}</strong>${e.recurring ? ' <small class="dm-hint">every year</small>' : ''}
            ${e.notes ? `<div class="dm-cal-notes">${escapeHtml(e.notes)}</div>` : ''}</div>
          <span><button class="dm-icon-btn" data-edit-event="${e.id}" title="Change">✎</button><button class="dm-icon-btn" data-del-event="${e.id}" title="Delete">×</button></span>
        </div>`)).join('')}
      ${_eventForm === 'new' ? form(null) : (!editing ? '<button class="dm-btn small" id="evNew">+ Add an event</button>' : '')}
    </div>`;
}

function upcomingHtml() {
  const c = getClock();
  const items = [];
  for (let i = 0; i <= 28 && items.length < 12; i++) {
    const d = stepDate(c, i);
    const when = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `In ${i} days · ${monthInfo(d.month).common} ${d.day}`;
    const fest = festivalOn(d.month, d.day);
    if (fest) items.push(`<div class="dm-cal-up"><span>${when}</span>🎉 ${escapeHtml(fest)}</div>`);
    birthdaysOn(d.month, d.day).forEach(n => items.push(`<div class="dm-cal-up"><span>${when}</span>🎂 ${escapeHtml(n.name)}'s birthday</div>`));
    eventsOn(d.year, d.month, d.day).forEach(e => items.push(`<div class="dm-cal-up"><span>${when}</span>📌 ${escapeHtml(e.title)}</div>`));
  }
  return `<div class="dm-card-title" style="margin-top:1rem">Coming up (4 weeks)</div>${items.join('') || '<div class="dm-hint">Nothing in the next four weeks.</div>'}`;
}

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

const SOURCE_LABEL = { real: 'Real time', world: 'World clock', turn: 'Battle turns' };

function timersHtml() {
  const timers = getClock().timers;
  return `
    <div class="dm-clock-timerhead"><div class="dm-card-title">Timers</div>${_timerForm ? '' : '<button class="dm-btn small primary" id="tmNew">+ New timer</button>'}</div>
    ${_timerForm === 'new' ? timerFormHtml(null) : ''}
    ${timers.map(t => (_timerForm === t.id ? timerFormHtml(t) : timerCardHtml(t))).join('')
      || (_timerForm ? '' : '<div class="dm-hint">No timers. A countdown for a puzzle, a poison that wears off after 3 turns, a ship that leaves in 2 days…</div>')}`;
}

function timerCardHtml(t) {
  const runs = t.source === 'world' || t.running;
  return `
    <div class="dm-timer${t.expired ? ' expired' : ''}">
      <div class="dm-timer-head">
        <strong>${t.mode === 'countdown' ? '⏳' : '⏱'} ${escapeHtml(t.name)}</strong>
        <button class="dm-icon-btn${t.pinned ? ' on' : ''}" data-timer="${t.id}" data-act="pin" title="${t.pinned ? 'Shown in the top bar -- click to stop' : 'Show in the top bar'}">📌</button>
      </div>
      ${t.description ? `<div class="dm-hint">${escapeHtml(t.description)}</div>` : ''}
      <div class="dm-timer-value${runs ? ' running' : ''}" data-timer-value="${t.id}">${t.expired ? 'Done!' : formatTimer(t)}</div>
      <div class="dm-timer-src">${SOURCE_LABEL[t.source]}${t.mode === 'countdown' ? ` · from ${formatTimer(t, t.initial)}` : ' · counting up'}${t.source === 'world' ? ' · moves with the clock' : ''}</div>
      <div class="dm-timer-btns">
        ${t.expired ? `<button class="dm-btn small primary" data-timer="${t.id}" data-act="dismiss">OK</button>` : ''}
        ${t.source !== 'world' ? `<button class="dm-btn small ${t.running ? '' : 'primary'}" data-timer="${t.id}" data-act="toggle">${t.running ? '⏸ Pause' : '▶ Start'}</button>` : ''}
        ${t.source !== 'real' ? `<button class="dm-btn small" data-timer="${t.id}" data-act="minus">−1</button><button class="dm-btn small" data-timer="${t.id}" data-act="plus">+1</button>` : ''}
        <button class="dm-btn small" data-timer="${t.id}" data-act="reset">↺</button>
        <button class="dm-btn small" data-timer-edit="${t.id}" title="Change">✎</button>
        <button class="dm-btn small danger" data-timer="${t.id}" data-act="delete" title="Delete">×</button>
      </div>
    </div>`;
}

/** Split a duration into the boxes the form shows: h/m/s for real time, d/h/m for the world clock, turns. */
function splitDuration(v, source) {
  if (source === 'real') return [Math.floor(v / 3600), Math.floor((v % 3600) / 60), v % 60];
  if (source === 'world') return [Math.floor(v / 1440), Math.floor((v % 1440) / 60), v % 60];
  return [v, 0, 0];
}
const DURATION_UNITS = { real: ['hours', 'min', 'sec'], world: ['days', 'hours', 'min'], turn: ['turns'] };

function timerFormHtml(t) {
  const f = t || { name: '', description: '', mode: 'countdown', source: 'world', initial: 60 };
  return `
    <div class="dm-timer dm-timer-form" id="tmForm">
      <input class="dm-input" id="tmName" placeholder="Name" value="${escapeHtml(f.name)}">
      <input class="dm-input" id="tmDesc" placeholder="Notes (optional)" value="${escapeHtml(f.description || '')}">
      <div class="dm-row">
        <select class="dm-select" id="tmMode"><option value="countdown" ${f.mode === 'countdown' ? 'selected' : ''}>Countdown</option><option value="stopwatch" ${f.mode === 'stopwatch' ? 'selected' : ''}>Count up</option></select>
        <select class="dm-select" id="tmSource">${Object.entries(SOURCE_LABEL).map(([k, l]) => `<option value="${k}" ${f.source === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      <div class="dm-timer-dur" id="tmDur"></div>
      <div class="dm-hint" id="tmHint"></div>
      <label class="dm-check"><input type="checkbox" id="tmPin" ${f.pinned ? 'checked' : ''}>Show in the top bar</label>
      <div class="dm-row"><button class="dm-btn" id="tmCancel">Cancel</button><button class="dm-btn primary" id="tmSave">${t ? 'Save' : 'Add timer'}</button></div>
    </div>`;
}

function drawDurationBoxes(initial) {
  const source = document.getElementById('tmSource').value;
  const mode = document.getElementById('tmMode').value;
  const box = document.getElementById('tmDur');
  const parts = splitDuration(initial, source);
  box.hidden = mode !== 'countdown';
  box.innerHTML = DURATION_UNITS[source].map((u, i) => `<label><input class="dm-input" type="number" min="0" data-dur="${i}" value="${parts[i]}"><span>${u}</span></label>`).join('');
  document.getElementById('tmHint').textContent = {
    real: 'Counts while it runs, in real seconds -- even with the console closed.',
    world: 'Moves whenever the world clock is moved on (or back).',
    turn: 'Moves one each time a turn passes in the running battle.',
  }[source];
}

function readDuration() {
  const source = document.getElementById('tmSource').value;
  const v = [...document.querySelectorAll('[data-dur]')].map(i => Math.max(0, parseInt(i.value, 10) || 0));
  if (source === 'real') return v[0] * 3600 + v[1] * 60 + v[2];
  if (source === 'world') return v[0] * 1440 + v[1] * 60 + v[2];
  return v[0];
}

function updateTimerNumbers() {
  if (!_root || _root.hidden) return;
  getClock().timers.forEach(t => {
    const el = _root.querySelector(`[data-timer-value="${t.id}"]`);
    if (el && !t.expired) el.textContent = formatTimer(t, timerValue(t));
  });
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function wire() {
  const $ = id => document.getElementById(id);
  _root.querySelectorAll('[data-advance]').forEach(b => b.addEventListener('click', () => advanceMinutes(Number(b.dataset.advance))));
  _root.querySelectorAll('[data-phase]').forEach(b => b.addEventListener('click', () => skipToPhase(b.dataset.phase)));
  $('clkWeather').addEventListener('change', e => updateClock(c => { c.weather = e.target.value; }));
  $('clkRoll').addEventListener('click', () => { const w = rollWeather(); toast(`Weather: ${WEATHER[w].icon} ${WEATHER[w].name}`); });
  $('clkApply').addEventListener('click', () => {
    const v = id => parseInt($(id).value, 10) || 0;
    setDateTime({ year: v('clkYear'), month: v('clkMonth'), day: v('clkDay'), hour: v('clkHour'), minute: v('clkMinute') });
    $('clkApply').blur();
    draw();
  });
  $('clkRestore').addEventListener('click', () => $('clkRestoreFile').click());
  $('clkRestoreFile').addEventListener('change', (e) => { if (e.target.files?.[0]) restoreBackup(e.target.files[0]); });
  $('clkReset').addEventListener('click', async () => {
    if (!await showCombatConfirm('Reset the clock to Estia 1, 847 AFR, 08:00 and clear weather? Events and timers stay.', { title: 'Reset the clock', yesLabel: 'Reset', noLabel: 'Cancel' })) return;
    updateClock(c => Object.assign(c, { year: DEFAULT_CLOCK.year, month: 1, day: 1, hour: 8, minute: 0, weather: 'clear' }));
  });

  // Calendar
  _root.querySelectorAll('[data-cal]').forEach(b => b.addEventListener('click', () => {
    let total = _view.year * 12 + (_view.month - 1) + Number(b.dataset.cal);
    _view = { year: Math.floor(total / 12), month: (total % 12) + 1 };
    _selDay = null;
    _eventForm = null;
    draw();
  }));
  $('calToday').addEventListener('click', () => { const c = getClock(); _view = { year: c.year, month: c.month }; _selDay = c.day; _eventForm = null; draw(); });
  _root.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => { _selDay = Number(b.dataset.day); _eventForm = null; draw(); }));
  $('calSetDay')?.addEventListener('click', () => { const c = getClock(); setDateTime({ ...c, year: _view.year, month: _view.month, day: _selDay }); });
  $('evNew')?.addEventListener('click', () => { _eventForm = 'new'; draw(); $('evTitle')?.focus(); });
  $('evCancel')?.addEventListener('click', () => { _eventForm = null; draw(); });
  $('evSave')?.addEventListener('click', () => {
    const title = $('evTitle').value.trim();
    if (!title) { $('evTitle').focus(); return; }
    const fields = { title, notes: $('evNotes').value.trim(), recurring: $('evRecurring').checked };
    const id = _eventForm;
    _eventForm = null;
    $('evSave').blur();
    updateClock(c => {
      if (id === 'new') c.events.push({ id: `evt${Date.now().toString(36)}`, year: _view.year, month: _view.month, day: _selDay, ...fields });
      else Object.assign(c.events.find(e => e.id === id) || {}, fields);
    });
  });
  _root.querySelectorAll('[data-edit-event]').forEach(b => b.addEventListener('click', () => { _eventForm = b.dataset.editEvent; draw(); }));
  _root.querySelectorAll('[data-del-event]').forEach(b => b.addEventListener('click', async () => {
    const e = getClock().events.find(x => x.id === b.dataset.delEvent);
    if (!e || !await showCombatConfirm(`Delete "${e.title}"?`, { title: 'Delete event', yesLabel: 'Delete', noLabel: 'Cancel' })) return;
    updateClock(c => { c.events = c.events.filter(x => x.id !== e.id); });
  }));

  // Timers
  $('tmNew')?.addEventListener('click', () => { _timerForm = 'new'; draw(); $('tmName')?.focus(); });
  _root.querySelectorAll('[data-timer-edit]').forEach(b => b.addEventListener('click', () => { _timerForm = b.dataset.timerEdit; draw(); }));
  _root.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
    if (b.dataset.act === 'delete') {
      const t = getClock().timers.find(x => x.id === b.dataset.timer);
      if (!t || !await showCombatConfirm(`Delete the timer "${t.name}"?`, { title: 'Delete timer', yesLabel: 'Delete', noLabel: 'Cancel' })) return;
    }
    timerAction(b.dataset.timer, b.dataset.act);
  }));
  if ($('tmForm')) {
    const existing = getClock().timers.find(t => t.id === _timerForm);
    drawDurationBoxes(existing?.initial ?? 60);
    const redraw = () => drawDurationBoxes(readDuration());
    $('tmSource').addEventListener('change', () => drawDurationBoxes(0));
    $('tmMode').addEventListener('change', redraw);
    $('tmCancel').addEventListener('click', () => { _timerForm = null; draw(); });
    $('tmSave').addEventListener('click', () => {
      const mode = $('tmMode').value;
      const initial = mode === 'countdown' ? readDuration() : 0;
      if (mode === 'countdown' && initial <= 0) { showCombatAlert('Give the countdown a length.', { title: 'Timer' }); return; }
      const id = _timerForm === 'new' ? null : _timerForm;
      _timerForm = null;
      $('tmSave').blur();
      saveTimer({ name: $('tmName').value.trim() || 'Timer', description: $('tmDesc').value.trim(), mode, source: $('tmSource').value, initial, pinned: $('tmPin').checked }, id);
    });
  }
}

/** The clock as the old DM tool saved it (Backup there: {kind: 'shima-world-clock', worldClock: {...}}) -- date, time,
 * weather and its events (added to the ones here; nothing here is removed). */
function restoreBackup(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    let wc;
    try {
      const parsed = JSON.parse(reader.result);
      wc = parsed.worldClock || parsed;
      if (!['year', 'month', 'day'].every(k => typeof wc[k] === 'number')) throw new Error('missing date');
    } catch {
      showCombatAlert("That file isn't a clock backup from the old DM tool.", { title: 'Restore' });
      return;
    }
    const preview = formatDate(wc) + (typeof wc.hour === 'number' ? `, ${formatTime({ hour: wc.hour, minute: wc.minute || 0 })}` : '');
    if (!await showCombatConfirm(`Set the clock to ${preview}${(wc.events || []).length ? ` and add its ${wc.events.length} event(s)` : ''}?`, { title: 'Restore from the old DM tool', yesLabel: 'Restore', noLabel: 'Cancel' })) return;
    updateClock(c => {
      Object.assign(c, { year: wc.year, month: wc.month, day: wc.day, hour: wc.hour ?? c.hour, minute: wc.minute ?? c.minute });
      if (WEATHER[wc.weather]) c.weather = wc.weather;
      const have = new Set(c.events.map(e => e.id));
      (wc.events || []).forEach(e => { if (e && e.title && !have.has(e.id)) c.events.push({ id: e.id || `evt${Math.random().toString(36).slice(2, 9)}`, year: e.year, month: e.month, day: e.day, title: e.title, notes: e.notes || '', recurring: !!e.recurring }); });
    });
    _view = { year: wc.year, month: wc.month };
    toast(`Clock restored: ${preview}`);
  };
  reader.readAsText(file);
}
