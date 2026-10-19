// DM console -- the running battle. The middle of the screen is the shared battle itself -- combat-wip.js, the exact
// screen the players use -- running as the DM (enableDmMode, see dm-console.js): every creature the DM set up is owned
// by 'DM', so it gets the same card, moves, saves, reactions and map tools a player's own Pokemon does, and anything a
// player's attack asks of it (a save, a Sturdy roll) pops up here. The panel on the right is the DM's own: the table
// screens, the encounter in play (its events and notes -- encounters.js), the DM's creatures in the fight (with the
// capture helper), and reinforcements.
//
// After the first playtest (2026-10-16): the battle has two tabs -- Battle (all of the above) and Map (the battle map
// the players use, moves, cones and lines included, or the live map editor -- objects, hidden objects, traps, the
// background, any creature moved / turned / resized). The DM can give any creature a turn out of order (Give a turn),
// and is told when a creature walks onto a trap.
//
// The second playtest batch (2026-10-16): the players see nothing of the DM's creatures but the picture until the DM ticks
// it (the HP / VP bars and their numbers are separate boxes), and 📖 shows them what their Pokedex already knows; a hidden
// creature (🙈) is on no screen but this one; ✏️ Edit changes anything about a creature mid-battle; and "Hide from the
// battle log" keeps what the DM does now out of the players' log (still in the DM's).
import { CombatAPI, DmAPI, GameDataAPI, setHideBattleLog } from '../api.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { VISIBILITY_DEFAULTS } from '../utils/combat-visibility.js';
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import { renderCombatWip, attachCombatWipListeners, startDmPlacement, setOnDmFocusChange, setDmMapOpener, focusParticipant, forgetLocalCombatant } from '../pages/combat-wip.js';
import { showBattleMap, hideBattleMap } from '../utils/battle-map-popup.js';
import { footprintCells, footprintForSize } from '../utils/battle-map-grid.js';
import { DM, escapeHtml, typeBadges, getSpecies, rollD20, toast, participantFromPokemon, natureOptions, openDmModal, abilityMod } from './dm-common.js';
import { getClock, WEATHER } from './world-clock.js';
import { TERRAIN, WEATHER_ROLL_MOD, STATUS_CAPTURE_BONUS, captureDc, accuracyDc } from './encounter-rules.js';
import { getSetup } from './setup-store.js';
import { abilityList, nameList, skillLists } from '../utils/battle-lists.js';
import { renderMapEditor, editorShownIn } from './map-editor.js';
import { setLiveSession } from './live-map-store.js';
import * as liveMapStore from './live-map-store.js';
import { loadScene, getScene, updateScene, onSceneChange } from './display-store.js';
import { renderEncounters, monConfig } from './encounters.js';

let session = { active: false, participants: {}, turnOrder: [] };
let species = [];
let selectedSpecies = null;
let adding = false;
let run = null; // the encounter loaded into this battle ('encounter-run'), or null
let lastRound = null;
let runSaveTimer = null;

export async function mountLive(stageEl, toolsEl, currentSession) {
  session = currentSession;
  liveTab = 'battle';
  mapMode = 'play';
  trapsInside = trapOccupants(session); // whoever already stands on a trap isn't news
  bindLiveTabs();
  setDmMapOpener((selectId) => showLiveTab('map', { mode: 'play', selectId }));
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
  checkTraps();
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
  const detail = await DmAPI.speciesDetail(p.speciesName || p.name).then(r => r.data).catch(() => null);
  const { terrain: terrainKey, weather: weatherKey } = battleSetting();
  const cdc = captureDc(p, sp);
  const acc = accuracyDc(p, terrainKey);
  const wmod = WEATHER_ROLL_MOD[weatherKey] || 0;
  const statuses = (p.statuses || []).filter(s => s.kind === 'condition');
  const conditions = statuses.map(s => String(s.apply || '').toLowerCase());
  const bonuses = Object.entries(STATUS_CAPTURE_BONUS).map(([name, bonus]) => ({ name, bonus, on: conditions.includes(name.toLowerCase()) }));
  const statusBonus = bonuses.filter(b => b.on).reduce((n, b) => n + b.bonus, 0);
  const sign = n => (n >= 0 ? `+${n}` : `${n}`);
  const row = (label, value, cls = '') => `<div class="dm-cap-row ${cls}"><span>${label}</span><span>${value}</span></div>`;
  const pct = (cur, max) => (max > 0 ? Math.round((cur / max) * 100) : 0);
  const choice = await openDmModal({
    title: `🔴 Catching ${p.name}`,
    wide: true,
    html: `
      <div class="dm-cap-who">${typeBadges(p.type1, p.type2)} Lv ${p.level ?? '?'} · ${escapeHtml(p.size || sp.size || 'Medium')} · ${escapeHtml(sp.rarity || '?')} · ${escapeHtml(sp.behavior || '?')}</div>
      <div class="dm-cap-state">
        <span><b>HP</b> ${p.currentHP}/${p.maxHP} <small>(${pct(p.currentHP, p.maxHP)}%)</small></span>
        <span><b>VP</b> ${p.currentVP}/${p.maxVP} <small>(${pct(p.currentVP, p.maxVP)}%)</small></span>
        <span><b>Conditions</b> ${statuses.length ? statuses.map(s => escapeHtml(s.apply || s.name || '?')).join(', ') : 'none'}</span>
        <span><b>Catch difficulty</b> ${escapeHtml(detail?.catchDifficulty ?? '—')} <small>(its Pokédex entry)</small></span>
        <span><b>Here</b> ${escapeHtml(TERRAIN[terrainKey]?.name || terrainKey)} · ${escapeHtml(WEATHER[weatherKey]?.name || weatherKey)}${detail?.habitat ? ` <small>· it lives in: ${escapeHtml(detail.habitat)}</small>` : ''}</span>
      </div>
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
          <div class="dm-cap-row adjust"><span>Your call <small>(its lair +10 to +20, weather it likes / hates ±10, anything else)</small></span>
            <span><button class="dm-btn small" data-cap-adj="-5">−5</button><input class="dm-input" id="capAdjust" type="number" value="0" step="1"><button class="dm-btn small" data-cap-adj="5">+5</button></span></div>
          <div class="dm-cap-row total"><span>Capture DC</span><span id="capTotal">${cdc.total}</span></div>
        </div>
      </div>
      <div class="dm-card-title" style="margin-top:0.8rem">Bonuses to the capture roll</div>
      <div class="dm-cap-bonus">${bonuses.map(b => `<span class="${b.on ? 'on' : ''}">${b.name} +${b.bonus}${b.on ? ' ✓' : ''}</span>`).join('')}</div>
      ${statusBonus ? `<div class="dm-hint" style="margin-top:0.3rem">Its condition adds <b>+${statusBonus}</b> to the roll right now.</div>` : ''}`,
    buttons: [{ label: 'Close', value: null }, { label: '🔴 Caught!', value: 'catch', kind: 'primary' }],
    onOpen: (body) => {
      const input = body.querySelector('#capAdjust');
      const total = () => { body.querySelector('#capTotal').textContent = cdc.total + (Number(input.value) || 0); };
      input.addEventListener('input', total);
      body.querySelectorAll('[data-cap-adj]').forEach(b => b.addEventListener('click', () => { input.value = (Number(input.value) || 0) + Number(b.dataset.capAdj); total(); }));
    },
  });
  if (choice !== 'catch') return;
  await registerCatch(p);
}

/** "Caught!": which trainer caught it (and a nickname) -- it goes straight into that trainer's team (with the same
 * numbers the post battle would give it) and leaves the battle. */
async function registerCatch(p) {
  let trainers = [...new Set(Object.values(session.participants || {})
    .filter(x => x.combatantType === 'trainer' && x.owner && x.owner !== DM).map(x => x.owner))];
  if (!trainers.length) trainers = ((await DmAPI.party().catch(() => null))?.data || []).map(r => r.trainer?.name).filter(Boolean);
  if (!trainers.length) { showCombatAlert('No trainer to give it to.', { title: `Catch ${p.name}` }); return; }
  let picked = null;
  const answer = await openDmModal({
    title: `🔴 ${p.name} was caught`,
    html: `
      <div class="dm-field"><label for="capTrainer">Caught by</label>
        <select class="dm-select" id="capTrainer">${trainers.map(t => `<option>${escapeHtml(t)}</option>`).join('')}</select></div>
      <div class="dm-field"><label for="capNick">Nickname <small>(optional)</small></label>
        <input class="dm-input" id="capNick" maxlength="30" placeholder="${escapeHtml(p.speciesName || p.name)}"></div>
      <div class="dm-hint">It goes into the trainer's team now -- at its level, its abilities and the numbers it was set up with -- and leaves the battle.</div>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Register it', kind: 'primary', value: 'ok', keepOpen: true,
      onClick: (body) => { picked = { trainer: body.querySelector('#capTrainer').value, nickname: body.querySelector('#capNick').value.trim() }; return true; } }],
  });
  if (answer !== 'ok' || !picked) return;
  const c = getSetup()?.creatures.find(x => x.id === p.id);
  const speciesName = c?.config?.species || p.speciesName || p.name;
  const cfg = c ? { species: speciesName, ...monConfig(c.config) }
    : { species: speciesName, level: p.level, nature: p.nature || '', abilities: abilityList(p.abilities).map(a => a.slot).filter(n => n !== null && n !== undefined) };
  if (!cfg.abilities?.length) cfg.abilities = [0];
  const autoName = p.name !== speciesName && !/ [A-Z]$/.test(p.name) ? p.name : '';
  try {
    await DmAPI.givePokemon(picked.trainer, { ...cfg, nickname: picked.nickname || autoName });
  } catch (err) {
    showCombatAlert(err.message, { title: `Give ${p.name} to ${picked.trainer}` });
    return;
  }
  try {
    await CombatAPI.capture(p.id, picked.trainer);
  } catch (err) {
    showCombatAlert(`${p.name} is in ${picked.trainer}'s team, but couldn't leave the battle: ${err.message}`, { title: 'Catch' });
    return;
  }
  toast(`${picked.nickname || p.name} is in ${picked.trainer}'s team now.`);
}

// ---------------------------------------------------------------------------
// "Players can see" -- a column of checkboxes left of the card, for whichever of the DM's creatures is selected in the
// turn order (combat-wip.js's #dmFocusSide). Each one is a per-creature visibility field on the server; the players'
// info panel, the table TV and the pickers all go by it (combat-visibility.js). The moves a creature uses are always
// shown to the players, so there's no box for those.
// ---------------------------------------------------------------------------

const VISIBILITY_FIELDS = [
  ['hpBar', 'HP bar', 'How full it is'], ['hp', 'HP numbers', 'With the bar'], ['vpBar', 'VP bar', 'How full it is'], ['vp', 'VP numbers', 'With the bar'],
  ['ac', 'AC'], ['stats', 'Other stats', 'STR, DEX, CON, INT, WIS, CHA'],
  ['name', 'Name'], ['type', 'Type'], ['level', 'Level'], ['abilities', 'Abilities'], ['size', 'Size'],
];

/** A catchable Pokemon's card gets a Poke Ball at its picture's corner (the DM's screens only) -- the catch popup. */
function decorateCatchable(p) {
  const col = document.querySelector(`#card_${CSS.escape(p.id)} .combat-card-portrait-col`);
  if (!col) return;
  const want = p.combatantType === 'pokemon' && !!p.catchable;
  let ball = col.querySelector('.dm-catch-ball');
  if (!want) { ball?.remove(); return; }
  if (!ball) {
    ball = document.createElement('button');
    ball.type = 'button';
    ball.className = 'dm-catch-ball';
    ball.title = 'Catchable -- the catch details';
    ball.innerHTML = '<img src="assets/Pokeball.png" alt="Catch">';
    col.prepend(ball);
  }
  ball.onclick = (e) => { e.stopPropagation(); openCapture(session.participants?.[p.id] || p); };
}

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
  decorateCatchable(p);
  const vis = { ...VISIBILITY_DEFAULTS, ...(p.visibility || {}) };
  el.innerHTML = `
    <div class="dm-vis" data-id="${p.id}">
      <div class="dm-vis-title">Players see</div>
      <div class="dm-vis-actions">
        ${p.combatantType === 'pokemon' && p.speciesName ? '<button class="dm-btn small" data-vis-act="pokedex" title="Show what the players\' Pokédex already knows about its species">📖 Pokédex</button>' : ''}
        <button class="dm-btn small" data-vis-act="none" title="Untick everything -- only its picture shows">Only picture</button>
        <button class="dm-btn small" data-vis-act="edit" title="Change its level, stats, abilities, moves...">✏️ Edit</button>
      </div>
      ${p.combatantType === 'pokemon' ? `<label class="dm-vis-row dm-vis-catch" title="A Poké Ball on its card -- click it when a player throws one: the capture DC, and register it to the trainer">
        <input type="checkbox" data-catchable ${p.catchable ? 'checked' : ''}><span>🔴 Catchable<small>Only you see this</small></span></label>` : ''}
      ${VISIBILITY_FIELDS.map(([field, label, sub]) => `
        <label class="dm-vis-row" ${sub ? `title="${sub}"` : ''}>
          <input type="checkbox" data-vis="${field}" ${vis[field] ? 'checked' : ''}>
          <span>${label}${sub ? `<small>${sub}</small>` : ''}</span>
        </label>`).join('')}
      <div class="dm-vis-note">Its picture always shows. Moves it uses are shown to the players as it uses them.</div>
    </div>`;
  el.querySelector('[data-vis-act="pokedex"]')?.addEventListener('click', () => showPokedexKnowledge(p));
  el.querySelector('[data-catchable]')?.addEventListener('change', async (e) => {
    try {
      await CombatAPI.setCatchable(p.id, e.target.checked);
    } catch (err) {
      e.target.checked = !e.target.checked;
      showCombatAlert(err.message, { title: p.name });
    }
  });
  el.querySelector('[data-vis-act="none"]').addEventListener('click', () => {
    CombatAPI.setVisibilityMany(p.id, Object.fromEntries(Object.keys(VISIBILITY_DEFAULTS).map(f => [f, false])))
      .catch(err => showCombatAlert(err.message, { title: p.name }));
  });
  el.querySelector('[data-vis-act="edit"]').addEventListener('click', () => openEditCreature(session.participants[p.id] || p));
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
      <button class="dm-btn wide" id="dmGiveTurn" style="margin-top:0.5rem" title="Any creature takes a turn now -- then the turn order carries on where it was">🎯 Give a turn…</button>
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
        <label class="dm-check"><input type="checkbox" id="dmBench">Hidden (joins later -- only you see it until then)</label>
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
  document.getElementById('dmEditMap').addEventListener('click', () => showLiveTab('map', { mode: 'edit' }));
  document.getElementById('dmGiveTurn').addEventListener('click', giveTurn);
  // The display screen: this battle on it, or the regular scene (display-scene.js's hideBattle -- just this battle).
  const showBox = document.getElementById('dmShowBattle');
  const syncShowBox = () => { if (showBox.isConnected) showBox.checked = !(getScene().hideBattle && getScene().hideBattle === session?.logFile); };
  loadScene().then(syncShowBox).catch(() => {});
  onSceneChange(syncShowBox);
  showBox.addEventListener('change', () => {
    updateScene((s) => { s.hideBattle = showBox.checked ? '' : (session?.logFile || ''); });
  });
}

// ---------------------------------------------------------------------------
// The Battle / Map tabs. The Map tab shows either the battle map the players use (battle-map-popup.js, inside the tab:
// the DM's creatures move, turn and aim cones / lines by the same rules on their turns) or the live map editor
// (map-editor.js + live-map-store.js -- whoever's turn it is, nothing costs movement).
// ---------------------------------------------------------------------------

let liveTab = 'battle';
let mapMode = 'play'; // 'play' | 'edit'
let liveTabsBound = false;

function bindLiveTabs() {
  if (liveTabsBound) return;
  liveTabsBound = true;
  const bar = document.getElementById('dmLiveTabs');
  bar?.insertAdjacentHTML('beforeend', `<label class="dm-hidelog" id="dmHideLogLabel" title="While ticked, what you do is still logged, but the players' battle log and screens leave it out -- untick when you're done">
    <input type="checkbox" id="dmHideLog"><span>🙈 Hide from the battle log</span></label>`);
  document.getElementById('dmHideLog')?.addEventListener('change', (e) => setHideLog(e.target.checked));
  document.getElementById('dmLiveTabs')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ltab]');
    if (b) showLiveTab(b.dataset.ltab);
  });
}

/** Shows the Battle or the Map tab (the same one again when called without one -- dm-console.js's routing). */
export function showLiveTab(tab = liveTab, { mode = null, selectId = null } = {}) {
  const was = liveTab;
  liveTab = tab;
  if (mode) mapMode = mode;
  document.querySelectorAll('#dmLiveTabs [data-ltab]').forEach(b => b.classList.toggle('active', b.dataset.ltab === tab));
  const battle = document.getElementById('dmLive');
  const mapEl = document.getElementById('dmLiveMap');
  const encEl = document.getElementById('dmEncView');
  if (!battle || !mapEl) return;
  battle.hidden = tab !== 'battle';
  mapEl.hidden = tab !== 'map';
  if (encEl) encEl.hidden = tab !== 'encounters';
  // Encounter setup, while the battle runs: building the next encounter (encounters.js) -- drawn fresh when opened.
  if (tab === 'encounters' && was !== 'encounters') renderEncounters(encEl, { tab: 'library' });
  if (tab !== 'map') { if (was === 'map') hideBattleMap(); return; }
  // Already showing (unless the map editor was taken by another screen meanwhile -- map-editor.js draws one at a time).
  if (was === 'map' && !mode && !selectId && mapEl.firstElementChild && (mapMode !== 'edit' || editorShownIn(mapEl))) return;
  renderMapTab(selectId);
}

/** The battle is over (dm-console.js): the map goes back to being a popup, and the tabs start on Battle next time. */
export function leaveLive() {
  hideBattleMap();
  setHideLog(false);
  setDmMapOpener(null);
  liveTab = 'battle';
  const mapEl = document.getElementById('dmLiveMap');
  if (mapEl) mapEl.innerHTML = '';
}

function renderMapTab(selectId = null) {
  const mapEl = document.getElementById('dmLiveMap');
  hideBattleMap(); // out of the tab before the tab is redrawn
  mapEl.innerHTML = `
    <div class="dm-live-map-head">
      <div class="dm-seg">
        <button data-mmode="play" class="${mapMode === 'play' ? 'active' : ''}" title="The map as the players use it -- your creatures move, turn and aim on their turns">▶ Battle map</button>
        <button data-mmode="edit" class="${mapMode === 'edit' ? 'active' : ''}" title="Objects, traps, the background, and moving / resizing any creature -- any time">✏️ Edit map</button>
      </div>
      <span class="dm-hint">${mapMode === 'play'
        ? 'Your creatures move here on their turns, like the players\' do. Hidden objects and traps show see-through -- only you see them.'
        : 'Every change shows on the players\' screens and the table at once (except what you hide).'}</span>
    </div>
    <div class="dm-live-map-body" id="dmLiveMapBody"></div>`;
  mapEl.querySelector('.dm-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mmode]');
    if (b && b.dataset.mmode !== mapMode) { mapMode = b.dataset.mmode; renderMapTab(); }
  });
  const body = document.getElementById('dmLiveMapBody');
  if (!session?.board) { body.innerHTML = '<div class="dm-loading">No battle map yet.</div>'; return; }
  if (mapMode === 'play') {
    showBattleMap(session, DM, { container: body, selectId });
  } else {
    setLiveSession(session);
    renderMapEditor(body, { live: true, onDone: () => showLiveTab('battle') });
  }
}

// ---------------------------------------------------------------------------
// Give a turn: the DM hands any creature a turn out of order -- it takes the floor like a reaction (without spending
// one), and its End Turn puts the turn order back where it was (routes_combat.py's _dm_give_turn).
// ---------------------------------------------------------------------------

async function giveTurn() {
  if (session?.reactingParticipantId) {
    const who = session.participants[session.reactingParticipantId]?.name || 'Someone';
    showCombatAlert(`${who} is taking a reaction or an extra turn right now -- wait until they end it.`, { title: 'Give a turn' });
    return;
  }
  const current = session?.turnOrder?.[session.turnIndex];
  const list = (session?.turnOrder || []).map(id => session.participants[id])
    .filter(p => p && p.status === 'participating' && p.id !== current);
  if (!list.length) { showCombatAlert('Nobody else is in the fight right now.', { title: 'Give a turn' }); return; }
  const pid = await openDmModal({
    title: 'Give a turn',
    html: `<div class="dm-hint" style="margin-bottom:0.6rem">They take a whole turn now (action, bonus action, movement -- not their reaction). When they end it, the turn order carries on from ${escapeHtml(session.participants[current]?.name || 'where it was')}.</div>
      <div class="dm-turn-pick-list">${list.map(p => `
        <button class="dm-turn-pick" data-pid="${escapeHtml(p.id)}"><span class="dm-turn-pick-img" data-img="${escapeHtml(p.image || '')}"></span>
          <span><b>${escapeHtml(p.name)}</b><small>${p.side === 'enemy' ? 'Yours' : escapeHtml(p.owner || '')} · init ${p.initiative ?? '?'}</small></span></button>`).join('')}</div>`,
    buttons: [{ label: 'Cancel', value: null }],
    onOpen: (bodyEl, close) => {
      bodyEl.querySelectorAll('[data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); });
      bodyEl.addEventListener('click', (e) => { const b = e.target.closest('[data-pid]'); if (b) close(b.dataset.pid); });
    },
  });
  if (!pid) return;
  try {
    await CombatAPI.dmGiveTurn(pid);
    if (session.participants[pid]?.owner === DM) focusParticipant(pid); // the DM's own: straight to its card to play it
    toast(`${session.participants[pid]?.name || 'They'} take${session.participants[pid] ? 's' : ''} a turn now.`);
  } catch (err) {
    showCombatAlert(err.message, { title: 'Give a turn' });
  }
}

// ---------------------------------------------------------------------------
// Traps: tell the DM when a creature walks onto one (map.traps, map-editor.js's Traps tool). A hidden one can be
// revealed right from the alert.
// ---------------------------------------------------------------------------

let trapsInside = new Set(); // "trapId:participantId" -- who stood on which trap at the last update

function trapOccupants(s) {
  const out = new Set();
  const traps = s?.board?.traps || [];
  if (!traps.length) return out;
  Object.entries(s.board.tokens || {}).forEach(([pid, t]) => {
    const p = s.participants?.[pid];
    if (!p || p.status !== 'participating' || (t.z || 0) > 0) return; // flying over it doesn't set it off
    const cells = new Set(footprintCells(t.col, t.row, footprintForSize(p.size)).map(c => `${c.col},${c.row}`));
    traps.forEach(tr => { if (tr.cells.some(c => cells.has(c))) out.add(`${tr.id}:${pid}`); });
  });
  return out;
}

function checkTraps() {
  const now = trapOccupants(session);
  const fresh = [...now].filter(k => !trapsInside.has(k));
  trapsInside = now;
  fresh.forEach(async (key) => {
    const [trapId, pid] = key.split(':');
    const trap = (session.board.traps || []).find(t => t.id === trapId);
    const p = session.participants[pid];
    if (!trap || !p) return;
    const text = `${p.name} walked onto ${trap.revealed ? 'the trap' : 'the hidden trap'} "${trap.name}".${trap.note ? `\n\n${trap.note}` : ''}`;
    if (trap.revealed) { showCombatAlert(text, { title: '🪤 Trap' }); return; }
    if (await showCombatConfirm(text, { title: '🪤 Trap', yesLabel: 'Reveal it', noLabel: 'Keep it hidden' })) {
      setLiveSession(session);
      liveMapStore.updateSetup(st => { const t = (st.map.traps || []).find(x => x.id === trapId); if (t) t.revealed = true; });
    }
  });
}

/** The DM's "Hide from the battle log" (api.js adds hideLog to every battle request while it's on). */
function setHideLog(on) {
  setHideBattleLog(on);
  const box = document.getElementById('dmHideLog');
  if (box) box.checked = on;
  document.getElementById('dmHideLogLabel')?.classList.toggle('on', on);
}

// ---------------------------------------------------------------------------
// 📖 Pokedex: the players see of this creature what their Pokedex already shows of its species (the DM console's Pokedex
// module decides that) -- its name, types, size, AC, ability scores, abilities. Only ever turns boxes on.
// ---------------------------------------------------------------------------

async function showPokedexKnowledge(p) {
  let entry;
  try {
    const res = await GameDataAPI.getPlayerPokedex();
    entry = (res?.data?.species || []).find(s => String(s.name).toLowerCase() === String(p.speciesName).toLowerCase());
  } catch (err) {
    showCombatAlert(err.message, { title: 'Pokédex' });
    return;
  }
  if (!entry) {
    showCombatAlert(`${p.speciesName} isn't in the players' Pokédex yet -- they know nothing about it.`, { title: '📖 Pokédex' });
    return;
  }
  const known = { name: 'Name' };
  if (entry.primaryType || entry.secondaryType) known.type = 'Type';
  if ((entry.info || []).some(i => i.key === 'charSize')) known.size = 'Size';
  if ((entry.combat || []).some(c => c.label === 'AC')) known.ac = 'AC';
  if ((entry.scores || []).length >= 6) known.stats = 'Ability scores';
  if ((entry.abilities || []).length) known.abilities = 'Abilities';
  const ok = await showCombatConfirm(`The players' Pokédex knows a ${p.speciesName}'s ${Object.values(known).join(', ')}. Show them that for ${p.name}?`,
    { title: '📖 Pokédex', yesLabel: 'Show it', noLabel: 'Cancel' });
  if (!ok) return;
  try {
    await CombatAPI.setVisibilityMany(p.id, Object.fromEntries(Object.keys(known).map(f => [f, true])));
  } catch (err) {
    showCombatAlert(err.message, { title: p.name });
  }
}

// ---------------------------------------------------------------------------
// ✏️ Edit: anything about one of the DM's creatures, mid-battle (routes_combat.py's _dm_update_participant). A Pokemon
// can also be worked out again from its species at a new level (Recalculate) -- filled into the form to adjust before
// saving. The card this console holds for it is rebuilt from the new record (combat-wip.js's forgetLocalCombatant).
// ---------------------------------------------------------------------------

const ALL_TYPES = ['Normal', 'Fire', 'Water', 'Grass', 'Electric', 'Ice', 'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug', 'Rock',
  'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy', 'Cosmic'];
const SIZE_NAMES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gigantic'];
const SCORE_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** Its skills as the Edit form's text -- "Stealth+" for one it has expertise in (read back by skillLists). */
function skillsText(p) {
  const { skills, expertise } = skillLists(p.skills, p.expertise);
  return skills.map(s => (expertise.includes(s) ? `${s}+` : s)).join(', ');
}

function speedsText(speeds) {
  return (speeds || []).map(sp => `${sp.type} ${sp.ft}`).join(', ');
}

function parseSpeeds(text) {
  return String(text || '').split(',').map(x => x.trim()).filter(Boolean).map((x) => {
    const m = x.match(/^(.*?)\s*(\d+)\s*(?:ft)?$/i);
    return m ? { type: m[1].trim() || 'Walking', ft: Number(m[2]) } : null;
  }).filter(Boolean);
}

async function openEditCreature(p) {
  const isMon = p.combatantType === 'pokemon';
  const sp = isMon ? species.find(s => String(s.name).toLowerCase() === String(p.speciesName).toLowerCase()) : null;
  const own = abilityList(p.abilities);
  const speciesAbilities = sp?.abilities || [];
  const custom = own.filter(a => !speciesAbilities.some(s => s.name === a.name));
  const num = (id, label, value, attrs = '') => `<div class="dm-field"><label for="${id}">${label}</label><input class="dm-input" id="${id}" type="number" value="${value ?? ''}" ${attrs}></div>`;
  const text = (id, label, value, ph = '') => `<div class="dm-field"><label for="${id}">${label}</label><input class="dm-input" id="${id}" value="${escapeHtml(value ?? '')}" placeholder="${escapeHtml(ph)}"></div>`;
  const typeSelect = (id, label, value) => `<div class="dm-field"><label for="${id}">${label}</label><select class="dm-select" id="${id}">
    <option value="">None</option>${ALL_TYPES.map(t => `<option ${t === value ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
  const html = `
    <div class="dm-edit-form">
      <div class="dm-row">${text('edName', 'Name', p.name)}${num('edLevel', 'Level', p.level, 'min="1" max="20"')}${num('edInit', 'Initiative', p.initiative)}</div>
      ${isMon ? `<div class="dm-row">${typeSelect('edType1', 'Type', p.type1)}${typeSelect('edType2', 'Second type', p.type2)}
        <div class="dm-field"><label for="edSize">Size</label><select class="dm-select" id="edSize">${SIZE_NAMES.map(z => `<option ${String(p.size).toLowerCase() === z.toLowerCase() ? 'selected' : ''}>${z}</option>`).join('')}</select></div></div>` : ''}
      <div class="dm-row">${num('edHp', 'HP now', p.currentHP)}${num('edMaxHp', 'Max HP', p.maxHP, 'min="1"')}${num('edVp', 'VP now', p.currentVP)}${num('edMaxVp', 'Max VP', p.maxVP, 'min="0"')}</div>
      <div class="dm-row">${num('edAc', 'AC', p.baseAc ?? p.ac)}${num('edProf', 'Proficiency', p.proficiency)}${isMon ? num('edStab', 'STAB bonus', p.stabBonusValue) : ''}${num('edCrit', 'Crit modifier', p.critMod || 0)}</div>
      <div class="dm-row dm-edit-scores">${SCORE_KEYS.map(k => num(`ed_${k}`, k.toUpperCase(), p[k], 'min="1" max="30"')).join('')}</div>
      ${isMon ? `<div class="dm-field"><label>Abilities</label>
        ${speciesAbilities.map(a => `<label class="dm-check"><input type="checkbox" name="edAbility" value="${a.slot}" ${own.some(o => o.name === a.name) ? 'checked' : ''}>
          <span>${escapeHtml(a.name)} <small>${escapeHtml(a.description)}</small></span></label>`).join('') || '<div class="dm-hint">Its species lists none.</div>'}
        <textarea class="dm-input" id="edAbilityOther" rows="2" placeholder="Other abilities -- one per line: Name; what it does">${escapeHtml(custom.map(a => `${a.name}; ${a.description}`).join('\n'))}</textarea>
      </div>
      <div class="dm-field"><label for="edMoves">Moves <small class="dm-label-note">comma-separated</small></label><textarea class="dm-input" id="edMoves" rows="2">${escapeHtml((p.moves || []).join(', '))}</textarea></div>` : ''}
      <div class="dm-row">${text('edItem', 'Held item', p.item, 'None')}${text('edSpeeds', 'Speeds', speedsText(p.speeds), 'Walking 30, Flying 60')}</div>
      <div class="dm-row">${text('edSaves', 'Saving throws', nameList(p.savingThrows).join(', '), 'e.g. Dexterity, Wisdom')}${text('edSkills', 'Skills', skillsText(p), 'e.g. Perception, Stealth+ (+ = expertise)')}</div>
      <div class="dm-hint" id="edNote">${isMon ? 'Recalculate works its numbers out again from its species at the level above (abilities and item as ticked; no nature or encounter bonuses) -- check them, then Save.' : ''}</div>
    </div>`;
  const val = (body, id) => body.querySelector(`#${id}`)?.value ?? '';
  const intOf = (body, id) => { const v = parseInt(val(body, id), 10); return Number.isNaN(v) ? null : v; };
  const buttons = [{ label: 'Cancel', value: null }];
  if (isMon && p.speciesName) {
    buttons.push({ label: '🔄 Recalculate', keepOpen: true, onClick: async (body) => {
      const level = Math.max(1, Math.min(20, intOf(body, 'edLevel') || p.level || 1));
      const slots = [...body.querySelectorAll('input[name="edAbility"]:checked')].map(cb => Number(cb.value));
      try {
        const res = await DmAPI.buildPokemon({ species: p.speciesName, level, abilities: slots.length ? slots : [0], item: val(body, 'edItem').trim(), preview: true });
        const { participant: np } = participantFromPokemon(res.data);
        const set = (id, v) => { const el = body.querySelector(`#${id}`); if (el && v !== undefined && v !== null) el.value = v; };
        // HP / VP lost so far stay lost.
        set('edHp', Math.max(0, np.maxHP - ((p.maxHP || 0) - (p.currentHP || 0))));
        set('edVp', Math.max(0, np.maxVP - ((p.maxVP || 0) - (p.currentVP || 0))));
        set('edMaxHp', np.maxHP); set('edMaxVp', np.maxVP); set('edAc', np.baseAc ?? np.ac); set('edProf', np.proficiency); set('edStab', np.stabBonusValue);
        SCORE_KEYS.forEach(k => set(`ed_${k}`, np[k]));
        set('edMoves', (np.moves || []).join(', ')); set('edSaves', nameList(np.savingThrows).join(', ')); set('edSkills', skillsText(np)); set('edSpeeds', speedsText(np.speeds));
        set('edType1', np.type1 || ''); set('edType2', np.type2 || '');
        body.querySelector('#edNote').textContent = `Worked out again for a level ${level} ${p.speciesName} -- check the numbers, then Save.`;
      } catch (err) {
        showCombatAlert(err.message, { title: 'Recalculate' });
      }
      return false;
    } });
  }
  buttons.push({ label: 'Save', kind: 'primary', keepOpen: true, onClick: async (body) => {
    const data = {
      name: val(body, 'edName').trim(), item: val(body, 'edItem').trim(),
      savingThrows: nameList(val(body, 'edSaves')), ...skillLists(val(body, 'edSkills')), speeds: parseSpeeds(val(body, 'edSpeeds')),
    };
    const ints = { level: 'edLevel', initiative: 'edInit', currentHP: 'edHp', maxHP: 'edMaxHp', currentVP: 'edVp', maxVP: 'edMaxVp',
      ac: 'edAc', proficiency: 'edProf', critMod: 'edCrit', ...(isMon ? { stabBonusValue: 'edStab' } : {}) };
    for (const [key, id] of Object.entries(ints)) {
      const v = intOf(body, id);
      if (v === null) { showCombatAlert(`${body.querySelector(`label[for="${id}"]`)?.textContent || key} needs a number.`, { title: 'Edit' }); return false; }
      data[key] = v;
    }
    data.baseAc = data.ac;
    for (const k of SCORE_KEYS) {
      const v = intOf(body, `ed_${k}`);
      if (v === null) { showCombatAlert(`${k.toUpperCase()} needs a number.`, { title: 'Edit' }); return false; }
      data[k] = v;
      data[`${k}Mod`] = abilityMod(v);
    }
    if (isMon) {
      data.type1 = val(body, 'edType1'); data.type2 = val(body, 'edType2'); data.size = val(body, 'edSize');
      data.moves = val(body, 'edMoves').split(',').map(m => m.trim()).filter(Boolean);
      const picked = [...body.querySelectorAll('input[name="edAbility"]:checked')].map(cb => speciesAbilities.find(a => String(a.slot) === cb.value)).filter(Boolean)
        .map(a => ({ slot: a.slot, name: a.name, description: a.description || '' }));
      // "Name; what it does" per line -- one the DM typed in has no slot.
      const others = val(body, 'edAbilityOther').split('\n').map(l => l.trim()).filter(Boolean).map((l) => {
        const [name, ...rest] = l.split(';');
        return { slot: null, name: name.trim(), description: rest.join(';').trim() };
      }).filter(a => a.name);
      data.abilities = [...picked, ...others];
    }
    if (!data.name) { showCombatAlert('It needs a name.', { title: 'Edit' }); return false; }
    try {
      await CombatAPI.dmUpdateParticipant(p.id, data);
      forgetLocalCombatant(p.id);
      toast(`${data.name} changed.`);
      return true;
    } catch (err) {
      showCombatAlert(err.message, { title: 'Edit' });
      return false;
    }
  } });
  await openDmModal({ title: `✏️ Edit ${p.name}`, html, buttons, wide: true });
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
      const { combatant, participant } = participantFromPokemon(res.data);
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
    const where = p.status === 'spectating' ? '🙈 hidden' : placed ? 'on the map' : 'not on the map';
    row.querySelector('.dm-creature-info').innerHTML = `
      <div class="dm-creature-name">${escapeHtml(p.name)}</div>
      <div class="dm-creature-sub">Lv ${p.level ?? '?'} · HP ${p.currentHP}/${p.maxHP} · VP ${p.currentVP}/${p.maxVP} · init ${p.initiative ?? '-'} · ${where}</div>
      <div class="dm-bar hp"><i style="width:${pct(p.currentHP, p.maxHP)}%"></i></div>
      <div class="dm-bar vp"><i style="width:${pct(p.currentVP, p.maxVP)}%"></i></div>`;
    // What the players can see of it is set in the checkbox column left of its card (renderVisibilityColumn).
    row.querySelector('.dm-creature-actions').innerHTML = `
      ${p.combatantType === 'pokemon' ? '<button class="dm-icon-btn" data-act="capture" title="Catch helper -- the capture DC, and mark it caught">🔴</button>' : ''}
      <button class="dm-icon-btn" data-act="edit" title="Edit -- level, stats, abilities, moves...">✏️</button>
      <button class="dm-icon-btn" data-act="status" title="${p.status === 'spectating' ? 'Unhide -- it appears and joins the fight' : 'Hide -- out of the turn order and off every screen but yours'}">${p.status === 'spectating' ? '👁' : '🙈'}</button>
      <button class="dm-icon-btn danger" data-act="remove" title="Remove from the battle">✕</button>`;
    if (box.children[index] !== row) box.insertBefore(row, box.children[index] || null);
  });
}

/** Turn order first, then anyone hidden (not in it). */
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
  if (btn.dataset.act === 'edit') { openEditCreature(p); return; }
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
