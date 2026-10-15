// DM console -- the running battle. The middle of the screen is the shared battle itself -- combat-wip.js, the exact
// screen the players use -- running as the DM (enableDmMode, see dm-console.js): every creature the DM set up is owned
// by 'DM', so it gets the same card, moves, saves, reactions and map tools a player's own Pokemon does, and anything a
// player's attack asks of it (a save, a Sturdy roll) pops up here. The panel on the right is the DM's own: the table
// screens, the encounter in play (its events and notes -- encounters.js), the DM's creatures in the fight (with the
// capture helper), and reinforcements.
import { CombatAPI, DmAPI } from '../api.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { VISIBILITY_DEFAULTS } from '../utils/combat-visibility.js';
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import { renderCombatWip, attachCombatWipListeners, startDmPlacement, setOnDmFocusChange } from '../pages/combat-wip.js';
import { DM, escapeHtml, typeBadges, getSpecies, rollD20, toast, participantFromPokemonRow, natureOptions, openDmModal } from './dm-common.js';
import { getClock, WEATHER } from './world-clock.js';
import { TERRAIN, WEATHER_ROLL_MOD, STATUS_CAPTURE_BONUS, captureDc, accuracyDc } from './encounter-rules.js';
import { getSetup } from './setup-store.js';
import { renderMapEditor } from './map-editor.js';
import { setLiveSession } from './live-map-store.js';
import { loadScene, getScene, updateScene, onSceneChange } from './display-store.js';

let session = { active: false, participants: {}, turnOrder: [] };
let species = [];
let selectedSpecies = null;
let adding = false;
let run = null; // the encounter loaded into this battle ('encounter-run'), or null
let lastRound = null;
let runSaveTimer = null;

export async function mountLive(stageEl, toolsEl, currentSession) {
  session = currentSession;
  setOnDmFocusChange(renderVisibilityColumn);
  stageEl.innerHTML = await renderCombatWip();
  attachCombatWipListeners();
  renderTools(toolsEl);
  renderCreatures();
  getSpecies().then(list => { species = list; renderSpeciesResults(); }).catch(() => {});
  lastRound = session.started ? Number(session.round) || 1 : null;
  DmAPI.getState('encounter-run').then((r) => { run = r; if (run) run.eventState = run.eventState || {}; renderEncounterCard(); }).catch(() => {});
}

export function updateLive(currentSession) {
  session = currentSession;
  setLiveSession(currentSession); // the live map editor, if it's open, follows the battle
  renderCreatures();
  const round = session.started ? Number(session.round) || 1 : null;
  if (round !== null && lastRound !== null && round > lastRound) newRound(round);
  if (round !== null) lastRound = round;
  renderEncounterCard();
}

// ---------------------------------------------------------------------------
// The encounter in play: its notes, and its events with a reminder when one is due
// ---------------------------------------------------------------------------

function evState(ev) {
  run.eventState[ev.id] = run.eventState[ev.id] || { done: false, stage: 0, firedAt: null };
  return run.eventState[ev.id];
}

function dueRound(ev) {
  return (Number(ev.startRound) || 1) + (Number(ev.countdown) || 0);
}

function eventStatus(ev, round) {
  const st = evState(ev);
  if (st.done) return st.firedAt ? `Happened in round ${st.firedAt}` : 'Done';
  if (ev.trigger === 'recurring') return 'Every round';
  if (ev.trigger === 'countdown') {
    const due = dueRound(ev);
    if (st.firedAt) return `Due since round ${st.firedAt}`;
    if (round === null) return `Round ${due}`;
    return round >= due ? 'Due now!' : `In ${due - round} round${due - round === 1 ? '' : 's'} (round ${due})`;
  }
  return 'When you trigger it';
}

/** A new round: recurring events remind the DM (a note), a countdown that has run out pops up. */
function newRound(round) {
  if (!run?.events?.length) return;
  const every = [];
  run.events.forEach((ev) => {
    const st = evState(ev);
    if (st.done || ev.notify === false) return;
    if (ev.trigger === 'recurring') every.push(`${ev.icon || '⚡'} ${ev.name}`);
    if (ev.trigger === 'countdown' && !st.firedAt && round >= dueRound(ev)) {
      st.firedAt = round;
      showCombatAlert(`${ev.description || ''}${currentStageText(ev)}`.trim() || ev.name, { title: `${ev.icon || '⚡'} ${ev.name || 'Event'} -- round ${round}` });
    }
  });
  if (every.length) toast(`Round ${round}: ${every.join(' · ')}`);
  saveRunSoon();
}

function currentStageText(ev) {
  const stage = ev.stages?.[evState(ev).stage];
  return stage ? `\n\nStage ${evState(ev).stage + 1}: ${stage.name}${stage.description ? ` -- ${stage.description}` : ''}` : '';
}

function saveRunSoon() {
  clearTimeout(runSaveTimer);
  runSaveTimer = setTimeout(() => DmAPI.saveState('encounter-run', run).catch(() => {}), 500);
}

/** The terrain and weather a Poke Ball throw is up against: Map setup's (the map this battle started from); an encounter
 * put in play before they moved there still has its own. */
function battleSetting() {
  const m = getSetup()?.map || {};
  const terrain = m.terrain || run?.terrain || 'flat';
  const chosen = m.weather || run?.weather || 'world';
  return { terrain, chosen, weather: chosen === 'world' ? getClock()?.weather || 'clear' : chosen };
}

function renderEncounterCard() {
  const el = document.getElementById('dmEncCard');
  if (!el) return;
  if (!run) { el.hidden = true; return; }
  el.hidden = false;
  const round = session.started ? Number(session.round) || 1 : null;
  const { terrain: terrainKey, chosen, weather: weatherKey } = battleSetting();
  const open = el.querySelector('details')?.open;
  el.innerHTML = `
    <div class="dm-card-title"><span>🗺️ ${escapeHtml(run.name || 'Encounter')}</span><button class="dm-icon-btn" data-ev-act="unload" title="This battle isn't that encounter -- stop showing it">✕</button></div>
    <div class="dm-hint">${escapeHtml(TERRAIN[terrainKey]?.name || 'Flat ground')} · ${WEATHER[weatherKey]?.icon || ''} ${escapeHtml(WEATHER[weatherKey]?.name || weatherKey)}${chosen === 'world' ? ' (world clock)' : ''}</div>
    ${run.notes || run.noteCategories?.length ? `<details class="dm-live-notes" ${open ? 'open' : ''}><summary>Notes</summary>
      ${run.notes ? `<div class="dm-live-note">${escapeHtml(run.notes)}</div>` : ''}
      ${(run.noteCategories || []).map(c => `<div class="dm-live-note"><strong>${escapeHtml(c.icon || '📝')} ${escapeHtml(c.name)}</strong>\n${escapeHtml(c.content || '')}</div>`).join('')}</details>` : ''}
    ${(run.events || []).map((ev) => {
      const st = evState(ev);
      const due = !st.done && ev.trigger === 'countdown' && round !== null && round >= dueRound(ev);
      const stage = ev.stages?.length ? ev.stages[st.stage] : null;
      return `
      <div class="dm-live-evt${st.done ? ' done' : ''}${due ? ' due' : ''}" data-ev="${escapeHtml(ev.id)}" title="${escapeHtml(ev.description || '')}">
        <div class="dm-live-evt-top">
          <span>${ev.icon || '⚡'} <strong>${escapeHtml(ev.name || 'Event')}</strong></span>
          <span class="dm-live-evt-status">${escapeHtml(eventStatus(ev, round))}</span>
        </div>
        ${stage ? `<div class="dm-live-stage"><button class="dm-icon-btn" data-ev-act="prev" ${st.stage ? '' : 'disabled'}>‹</button>
          <span>Stage ${st.stage + 1}/${ev.stages.length}: <strong>${escapeHtml(stage.name)}</strong>${stage.description ? ` -- ${escapeHtml(stage.description)}` : ''}</span>
          <button class="dm-icon-btn" data-ev-act="next" ${st.stage < ev.stages.length - 1 ? '' : 'disabled'}>›</button></div>` : ''}
        <div class="dm-live-evt-btns">
          ${!st.done && ev.trigger === 'once' ? '<button class="dm-btn small" data-ev-act="fire">▶ Trigger</button>' : ''}
          <button class="dm-btn small" data-ev-act="done">${st.done ? '↺ Bring back' : '✓ Done'}</button>
        </div>
      </div>`;
    }).join('')}`;
  if (!el.dataset.bound) {
    el.dataset.bound = '1';
    el.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-ev-act]')?.dataset.evAct;
      if (!act || !run) return;
      if (act === 'unload') {
        if (!await showCombatConfirm(`Stop showing "${run.name}" here? (The encounter itself stays in the library.)`, { title: 'Encounter', yesLabel: 'Stop showing it', noLabel: 'Cancel' })) return;
        run = null;
        await DmAPI.saveState('encounter-run', null).catch(() => {});
        renderEncounterCard();
        return;
      }
      const ev = run.events.find(x => x.id === e.target.closest('[data-ev]')?.dataset.ev);
      if (!ev) return;
      const st = evState(ev);
      if (act === 'fire') {
        st.done = true;
        st.firedAt = Number(session.round) || 1;
        showCombatAlert(`${ev.description || ''}${currentStageText(ev)}`.trim() || ev.name, { title: `${ev.icon || '⚡'} ${ev.name || 'Event'}` });
      } else if (act === 'done') {
        st.done = !st.done;
        if (!st.done) st.firedAt = null;
      } else if (act === 'prev') st.stage = Math.max(0, st.stage - 1);
      else if (act === 'next') st.stage = Math.min(ev.stages.length - 1, st.stage + 1);
      renderEncounterCard();
      saveRunSoon();
    });
  }
}

// ---------------------------------------------------------------------------
// The capture helper (the old tool's capture DC breakdown)
// ---------------------------------------------------------------------------

async function openCapture(p) {
  const sp = species.find(s => s.name === p.speciesName) || {};
  const { terrain: terrainKey, weather: weatherKey } = battleSetting();
  const cdc = captureDc(p, sp);
  const acc = accuracyDc(p, terrainKey);
  const wmod = WEATHER_ROLL_MOD[weatherKey] || 0;
  const conditions = (p.statuses || []).filter(s => s.kind === 'condition').map(s => String(s.apply || '').toLowerCase());
  const bonuses = Object.entries(STATUS_CAPTURE_BONUS).map(([name, bonus]) => ({ name, bonus, on: conditions.includes(name.toLowerCase()) }));
  const sign = n => (n >= 0 ? `+${n}` : `${n}`);
  const row = (label, value, cls = '') => `<div class="dm-cap-row ${cls}"><span>${label}</span><span>${value}</span></div>`;
  const choice = await openDmModal({
    title: `🔴 Catching ${p.name}`,
    html: `
      <div class="dm-cap-who">${typeBadges(p.type1, p.type2)} Lv ${p.level ?? '?'} · HP ${p.currentHP}/${p.maxHP} (${cdc.hpPct}%) · ${escapeHtml(p.size || sp.size || 'Medium')} · ${escapeHtml(sp.rarity || '?')} · ${escapeHtml(sp.behavior || '?')}</div>
      <div class="dm-cap-cols">
        <div>
          <div class="dm-card-title">1 · The throw</div>
          <div class="dm-hint">d20 + Animal Handling or Athletics, ${sign(wmod)} for the weather (${escapeHtml(WEATHER[weatherKey]?.name || weatherKey)}). A natural 20 adds +20 to the capture roll.</div>
          ${row('Base', 10)}${row(`DEX (${p.dex ?? 10})`, sign(acc.dexMod))}${row(`Terrain (${escapeHtml(TERRAIN[terrainKey]?.name || '')})`, sign(acc.terrain))}
          ${row('Accuracy DC', acc.total, 'total')}
        </div>
        <div>
          <div class="dm-card-title">2 · The capture roll</div>
          <div class="dm-hint">d100 + the ball's bonus + the bonuses below; meet or beat the capture DC.</div>
          ${row('Base', 50)}${row(`Type (${escapeHtml([p.type1, p.type2].filter(Boolean).join('/'))})`, sign(cdc.types))}${row(`Size`, sign(cdc.size))}
          ${row(`Rarity (${escapeHtml(sp.rarity || '?')})`, sign(cdc.rarity))}${row(`Behaviour (${escapeHtml(sp.behavior || '?')})`, sign(cdc.behavior))}
          ${row(`Health (${cdc.hpPct}% HP)`, sign(cdc.health))}
          ${row('Capture DC', cdc.total, 'total')}
          <div class="dm-hint" style="margin-top:0.4rem">Your call on top: in its lair +10 to +20; weather it likes +10, weather it hates −10.</div>
        </div>
      </div>
      <div class="dm-card-title" style="margin-top:0.8rem">Bonuses to the capture roll</div>
      <div class="dm-cap-bonus">${bonuses.map(b => `<span class="${b.on ? 'on' : ''}">${b.name} +${b.bonus}${b.on ? ' ✓' : ''}</span>`).join('')}</div>`,
    buttons: [{ label: 'Close', value: null }, { label: '🔴 Mark as caught', value: 'catch', kind: 'primary' }],
  });
  if (choice !== 'catch') return;
  try {
    await CombatAPI.capture(p.id);
    toast(`${p.name} was caught -- hand it to its trainer in Post battle after the battle.`);
  } catch (err) {
    showCombatAlert(err.message, { title: `Catch ${p.name}` });
  }
}

// ---------------------------------------------------------------------------
// "Players can see" -- a column of checkboxes left of the card, for whichever of the DM's creatures is selected in the
// turn order (combat-wip.js's #dmFocusSide). Each one is a per-creature visibility field on the server; the players'
// info panel, the table TV and the pickers all go by it (combat-visibility.js). The moves a creature uses are always
// shown to the players, so there's no box for those.
// ---------------------------------------------------------------------------

const VISIBILITY_FIELDS = [
  ['hp', 'HP numbers', 'The HP bar always shows'], ['vp', 'VP numbers', 'The VP bar always shows'], ['ac', 'AC'], ['stats', 'Other stats', 'STR, DEX, CON, INT, WIS, CHA'],
  ['name', 'Name'], ['type', 'Type'], ['level', 'Level'], ['abilities', 'Abilities'], ['size', 'Size'],
];

function renderVisibilityColumn(focusId, currentSession) {
  const el = document.getElementById('dmFocusSide');
  if (!el) return;
  const p = currentSession?.participants?.[focusId];
  if (!p || p.owner !== DM) {
    el.innerHTML = '';
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const vis = { ...VISIBILITY_DEFAULTS, ...(p.visibility || {}) };
  el.innerHTML = `
    <div class="dm-vis" data-id="${p.id}">
      <div class="dm-vis-title">Players see</div>
      ${VISIBILITY_FIELDS.map(([field, label, sub]) => `
        <label class="dm-vis-row" ${sub ? `title="${sub}"` : ''}>
          <input type="checkbox" data-vis="${field}" ${vis[field] ? 'checked' : ''}>
          <span>${label}${sub ? `<small>${sub}</small>` : ''}</span>
        </label>`).join('')}
      <div class="dm-vis-note">Its picture and HP / VP bars always show. Moves it uses are shown to the players as it uses them.</div>
    </div>`;
  el.querySelectorAll('[data-vis]').forEach(cb => cb.addEventListener('change', async () => {
    try {
      await CombatAPI.setVisibility(p.id, cb.dataset.vis, cb.checked);
    } catch (err) {
      cb.checked = !cb.checked;
      showCombatAlert(err.message, { title: p.name });
    }
  }));
}

// ---------------------------------------------------------------------------
// Tools panel
// ---------------------------------------------------------------------------

function renderTools(el) {
  el.innerHTML = `
    <div class="dm-card">
      <div class="dm-card-title">Table screens</div>
      <div class="dm-row">
        <a class="dm-btn" href="battle-map.html" target="_blank" rel="noopener" title="Opens the table's battle map screen in a new tab">▦ Battle map ↗</a>
        <button class="dm-btn" id="dmEditMap" title="Change the map, move any creature -- any time, whoever's turn it is">✏️ Edit map</button>
      </div>
      <label class="dm-check" style="margin-top:0.5rem"><input type="checkbox" id="dmShowBattle" checked>
        <span>Show the battle on the display screen <small>Untick for the display's regular screen (the Display module's scene) meanwhile -- tick to bring the battle back.</small></span></label>
    </div>

    <div class="dm-card" id="dmEncCard" hidden></div>

    <div class="dm-card">
      <div class="dm-card-title">
        <span>Your creatures</span>
        <button class="dm-btn small" id="dmPlaceBtn" hidden>📍 Place on map</button>
      </div>
      <div id="dmCreatures"><div class="dm-hint">Nothing of yours in the battle.</div></div>
    </div>

    <details class="dm-card dm-collapsible">
      <summary class="dm-card-title">Reinforcements</summary>
      <div class="dm-hint" style="margin-bottom:0.5rem">Send in a Pokémon that wasn't in the setup.</div>
      <input class="dm-input" id="dmSpeciesSearch" placeholder="Search name, type or habitat…" autocomplete="off">
      <div class="dm-species-results" id="dmSpeciesResults"><div class="dm-species-empty">Loading the Pokédex…</div></div>
      <form id="dmAddForm" hidden>
        <div class="dm-selected-head" id="dmSelectedHead"></div>
        <div class="dm-row">
          <div class="dm-field"><label for="dmLevel">Level</label><input class="dm-input" id="dmLevel" type="number" min="1" max="20"></div>
          <div class="dm-field"><label for="dmCount">How many</label><input class="dm-input" id="dmCount" type="number" min="1" max="12" value="1"></div>
        </div>
        <div class="dm-field">
          <label for="dmNature">Nature</label>
          <select class="dm-select" id="dmNature">
            <option value="">None</option>
            <option value="__random">🎲 Random (each one)</option>
            ${natureOptions('')}
          </select>
        </div>
        <div class="dm-field"><label>Abilities</label><div id="dmAbilities"></div></div>
        <div class="dm-row">
          <div class="dm-field"><label for="dmItem">Held item</label><input class="dm-input" id="dmItem" placeholder="None"></div>
          <div class="dm-field"><label for="dmInit">Initiative</label><input class="dm-input" id="dmInit" type="number" placeholder="Roll for me"></div>
        </div>
        <label class="dm-check"><input type="checkbox" id="dmBench">Held back (not fighting yet)</label>
        <button type="submit" class="dm-btn primary wide" id="dmAddBtn">Send in</button>
      </form>
    </details>`;

  document.getElementById('dmSpeciesSearch').addEventListener('input', renderSpeciesResults);
  document.getElementById('dmSpeciesResults').addEventListener('click', (e) => {
    const item = e.target.closest('[data-species]');
    if (item) selectSpecies(item.dataset.species);
  });
  document.getElementById('dmAddForm').addEventListener('submit', (e) => { e.preventDefault(); addSelected(); });
  document.getElementById('dmPlaceBtn').addEventListener('click', () => {
    if (!startDmPlacement()) showCombatAlert('Everything of yours that is fighting is already on the map.', { title: 'Place on map' });
  });
  document.getElementById('dmCreatures').addEventListener('click', onCreatureAction);
  document.getElementById('dmEditMap').addEventListener('click', openLiveMapEditor);
  // The display screen: this battle on it, or the regular scene (display-scene.js's hideBattle -- just this battle).
  const showBox = document.getElementById('dmShowBattle');
  const syncShowBox = () => { if (showBox.isConnected) showBox.checked = !(getScene().hideBattle && getScene().hideBattle === session?.logFile); };
  loadScene().then(syncShowBox).catch(() => {});
  onSceneChange(syncShowBox);
  showBox.addEventListener('change', () => {
    updateScene((s) => { s.hideBattle = showBox.checked ? '' : (session?.logFile || ''); });
  });
}

/** The running battle's map in the Map setup editor (live mode, map-editor.js + live-map-store.js), over the battle
 * view until Done / Back. */
function openLiveMapEditor() {
  if (!session?.board) { showCombatAlert('No battle map yet.', { title: 'Edit map' }); return; }
  document.getElementById('dmLiveMapEditor')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'dmLiveMapEditor';
  overlay.className = 'dm-live-map-overlay';
  const root = document.createElement('div');
  root.className = 'dm-live-map-root';
  overlay.appendChild(root);
  document.body.appendChild(overlay);
  setLiveSession(session);
  renderMapEditor(root, { live: true, onDone: () => overlay.remove() });
}

function renderSpeciesResults() {
  const box = document.getElementById('dmSpeciesResults');
  if (!box || !species.length) return;
  const q = (document.getElementById('dmSpeciesSearch')?.value || '').trim().toLowerCase();
  const matches = species.filter(s => !q
    || s.name.toLowerCase().includes(q)
    || String(s.type1).toLowerCase() === q || String(s.type2).toLowerCase() === q
    || String(s.habitat).toLowerCase().includes(q)).slice(0, 60);
  if (!matches.length) {
    box.innerHTML = '<div class="dm-species-empty">No Pokémon match that.</div>';
    return;
  }
  box.innerHTML = matches.map(s => `
    <button type="button" class="dm-species-item${selectedSpecies?.name === s.name ? ' selected' : ''}" data-species="${escapeHtml(s.name)}">
      <span class="dm-species-thumb" data-img="${escapeHtml(s.image)}"></span>
      <span>
        <span class="dm-species-name">#${escapeHtml(s.dex)} ${escapeHtml(s.name)}</span>
        <span class="dm-species-meta">${typeBadges(s.type1, s.type2)} ${escapeHtml(s.rarity || '')}${s.habitat ? ` · ${escapeHtml(s.habitat)}` : ''}</span>
      </span>
    </button>`).join('');
  box.querySelectorAll('[data-img]').forEach(el => {
    if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, '');
    else el.innerHTML = '<img src="assets/Pokeball.png" alt="" style="opacity:0.35">';
  });
}

function selectSpecies(name) {
  selectedSpecies = species.find(s => s.name === name) || null;
  const form = document.getElementById('dmAddForm');
  if (!selectedSpecies) { form.hidden = true; return; }
  const s = selectedSpecies;
  document.getElementById('dmSelectedHead').innerHTML = `
    <span class="dm-species-thumb" id="dmSelectedThumb"></span>
    <span>
      <span class="dm-species-name">${escapeHtml(s.name)}</span>
      <span class="dm-species-meta">${typeBadges(s.type1, s.type2)} ${escapeHtml(s.size || '')} · base level ${s.level}</span>
    </span>`;
  if (s.image) patchPortraitMedia(document.getElementById('dmSelectedThumb'), s.image, s.name);
  document.getElementById('dmLevel').value = s.level || 1;
  document.getElementById('dmCount').value = 1;
  const slotNames = ['Primary', 'Secondary', 'Hidden'];
  document.getElementById('dmAbilities').innerHTML = s.abilities.length
    ? s.abilities.map(a => `
        <label class="dm-check">
          <input type="checkbox" name="dmAbility" value="${a.slot}" ${a.slot === 0 ? 'checked' : ''}>
          <span>${escapeHtml(a.name)} <small>${slotNames[a.slot] || ''} -- ${escapeHtml(a.description)}</small></span>
        </label>`).join('')
    : '<div class="dm-hint">No abilities listed.</div>';
  form.hidden = false;
  renderSpeciesResults();
}

/** The next free letters for `count` more of `name` ("Zubat A", "Zubat B"...), counting what is already in the
 * battle. A lone Pokemon of its species gets no letter. */
function labelsFor(name, count) {
  const taken = new Set();
  let unlabelled = false;
  Object.values(session.participants || {}).forEach(p => {
    if (p.name === name) unlabelled = true;
    const rest = p.name.startsWith(`${name} `) ? p.name.slice(name.length + 1) : '';
    if (/^[A-Z]$/.test(rest)) taken.add(rest);
  });
  if (count === 1 && !unlabelled && !taken.size) return [''];
  const out = [];
  for (let i = 0; out.length < count && i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    if (!taken.has(letter)) out.push(letter);
  }
  return out;
}

async function addSelected() {
  if (!selectedSpecies || !session?.active || adding) return;
  const s = selectedSpecies;
  const level = Math.max(1, Math.min(20, parseInt(document.getElementById('dmLevel').value, 10) || s.level || 1));
  const count = Math.max(1, Math.min(12, parseInt(document.getElementById('dmCount').value, 10) || 1));
  const natureChoice = document.getElementById('dmNature').value;
  const abilities = [...document.querySelectorAll('input[name="dmAbility"]:checked')].map(cb => Number(cb.value));
  const item = document.getElementById('dmItem').value.trim();
  const initTyped = document.getElementById('dmInit').value;
  const bench = document.getElementById('dmBench').checked;
  const natures = JSON.parse(sessionStorage.getItem('natures') || '[]').map(n => n.name);
  const btn = document.getElementById('dmAddBtn');

  adding = true;
  btn.disabled = true;
  const added = [];
  try {
    for (const label of labelsFor(s.name, count)) {
      const nature = natureChoice === '__random' ? (natures[Math.floor(Math.random() * natures.length)] || '') : natureChoice;
      const res = await DmAPI.buildPokemon({ species: s.name, level, nature, abilities, item, nickname: label ? `${s.name} ${label}` : '' });
      const { combatant, participant } = participantFromPokemonRow(res.data);
      // No number typed: roll d20 + the Pokemon's initiative bonus for it.
      participant.initiative = initTyped !== '' ? parseInt(initTyped, 10) : rollD20() + (combatant.initiativeTotal || 0);
      participant.status = bench ? 'spectating' : 'participating';
      await CombatAPI.addParticipant(participant);
      added.push(`${participant.name} (init ${participant.initiative})`);
    }
  } catch (err) {
    showCombatAlert(err.message, { title: `Couldn't add ${s.name}` });
  } finally {
    adding = false;
    btn.disabled = false;
  }
  if (added.length) toast(`Sent in ${added.join(', ')} -- place them on the map from "Your creatures".`);
}

// ---------------------------------------------------------------------------
// The DM's creatures in the battle
// ---------------------------------------------------------------------------

function renderCreatures() {
  const box = document.getElementById('dmCreatures');
  const placeBtn = document.getElementById('dmPlaceBtn');
  if (!box) return;
  const mine = session?.active ? orderedParticipants().filter(p => p.owner === DM) : [];
  const unplaced = mine.filter(p => p.status === 'participating' && !session.board?.tokens?.[p.id]);
  if (placeBtn) {
    placeBtn.hidden = !unplaced.length;
    placeBtn.textContent = `📍 Place on map (${unplaced.length})`;
  }
  if (!mine.length) {
    box.innerHTML = '<div class="dm-hint">Nothing of yours in the battle.</div>';
    return;
  }
  if (box.querySelector('.dm-hint')) box.innerHTML = '';

  const activeId = session.reactingParticipantId || session.turnOrder?.[session.turnIndex];
  const ids = new Set(mine.map(p => p.id));
  [...box.children].forEach(el => { if (!ids.has(el.dataset.id)) el.remove(); });

  mine.forEach((p, index) => {
    let row = box.querySelector(`[data-id="${p.id}"]`);
    if (!row) {
      row = document.createElement('div');
      row.dataset.id = p.id;
      row.innerHTML = '<div class="dm-creature-portrait"></div><div class="dm-creature-info"></div><div class="dm-creature-actions"></div>';
    }
    row.className = ['dm-creature', p.id === activeId && session.started ? 'active' : '', p.status === 'spectating' ? 'spectating' : ''].filter(Boolean).join(' ');
    patchPortraitMedia(row.querySelector('.dm-creature-portrait'), p.image, p.name);
    const pct = (cur, max) => (max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0);
    const placed = !!session.board?.tokens?.[p.id];
    const where = p.status === 'spectating' ? 'held back' : placed ? 'on the map' : 'not on the map';
    row.querySelector('.dm-creature-info').innerHTML = `
      <div class="dm-creature-name">${escapeHtml(p.name)}</div>
      <div class="dm-creature-sub">Lv ${p.level ?? '?'} · HP ${p.currentHP}/${p.maxHP} · VP ${p.currentVP}/${p.maxVP} · init ${p.initiative ?? '-'} · ${where}</div>
      <div class="dm-bar hp"><i style="width:${pct(p.currentHP, p.maxHP)}%"></i></div>
      <div class="dm-bar vp"><i style="width:${pct(p.currentVP, p.maxVP)}%"></i></div>`;
    // What the players can see of it is set in the checkbox column left of its card (renderVisibilityColumn).
    row.querySelector('.dm-creature-actions').innerHTML = `
      ${p.combatantType === 'pokemon' ? '<button class="dm-icon-btn" data-act="capture" title="Catch helper -- the capture DC, and mark it caught">🔴</button>' : ''}
      <button class="dm-icon-btn" data-act="status" title="${p.status === 'spectating' ? 'Send it into the fight' : 'Hold it back (out of the turn order)'}">${p.status === 'spectating' ? '▶' : '⏸'}</button>
      <button class="dm-icon-btn danger" data-act="remove" title="Remove from the battle">✕</button>`;
    if (box.children[index] !== row) box.insertBefore(row, box.children[index] || null);
  });
}

/** Turn order first, then anyone held back (not in it). */
function orderedParticipants() {
  const order = session.turnOrder || [];
  const rest = Object.keys(session.participants || {}).filter(id => !order.includes(id));
  return [...order, ...rest].map(id => session.participants[id]).filter(Boolean);
}

async function onCreatureAction(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('[data-id]')?.dataset.id;
  const p = session.participants?.[id];
  if (!p) return;
  if (btn.dataset.act === 'capture') { openCapture(p); return; }
  try {
    if (btn.dataset.act === 'status') {
      await CombatAPI.setStatus(id, p.status === 'spectating' ? 'participating' : 'spectating');
    } else if (btn.dataset.act === 'remove') {
      if (!await showCombatConfirm(`Remove ${p.name} from the battle?`, { title: 'Remove', yesLabel: 'Remove', noLabel: 'Cancel' })) return;
      await CombatAPI.removeParticipant(id);
    }
  } catch (err) {
    showCombatAlert(err.message, { title: p.name });
  }
}
