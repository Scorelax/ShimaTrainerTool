// DM console (dm-console.html) -- the landscape page the DM runs the game from, on their laptop. A separate page with
// its own URL, like display.html and battle-map.html: no trainer login, no player SPA around it.
//
// Module 1, the battle cockpit: the middle of the screen is the shared battle itself -- combat-wip.js, the exact
// screen the players use -- running as the DM (enableDmMode). Everything the DM adds is owned by 'DM'
// (routes_combat.py's DM_OWNER), so an enemy gets the same card, moves, saves, reactions and map tools a player's own
// Pokemon does, and anything a player's attack asks of it (a save, a Sturdy roll) pops up here. The panel on the
// right is the DM's own: building enemies from the full encyclopedia and managing them in the fight.
import { CombatAPI, DmAPI, GameDataAPI } from '../api.js';
import { initLiveUpdates } from '../utils/live-updates.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { getMoveTypeColor } from '../utils/pokemon-types.js';
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import { buildPokemonCombatant } from '../pages/combat.js';
import { renderCombatWip, attachCombatWipListeners, enableDmMode, dmEnemyParticipant, startDmPlacement } from '../pages/combat-wip.js';

const DM = 'DM'; // routes_combat.py's DM_OWNER
enableDmMode(DM);

let session = { active: false, participants: {}, turnOrder: [] };
let species = []; // DmAPI.speciesList() -- every species, not only the ones unlocked for players
let selectedSpecies = null;
let adding = false;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function init() {
  initLiveUpdates();
  try {
    await loadGameData();
  } catch (err) {
    document.getElementById('content').innerHTML = `<div class="dm-loading">Couldn't load the game data: ${escapeHtml(err.message)}</div>`;
    return;
  }
  await mountBattle();
  renderTools();

  const res = await CombatAPI.getState().catch(() => null);
  if (res?.status === 'success') session = res.data;
  onSession();

  window.addEventListener('app:combat-updated', (e) => { session = e.detail; onSession(); });
  window.addEventListener('app:live-resync', async () => {
    const r = await CombatAPI.getState().catch(() => null);
    if (r?.status === 'success') { session = r.data; onSession(); }
  });
  // The battle screen asks the player app to go back to the trainer card in a few places; there is none here, so
  // the battle is simply shown again.
  window.addEventListener('navigate', () => mountBattle());

  DmAPI.speciesList().then((r) => { species = r.data || []; renderSpeciesResults(); }).catch((err) => {
    const box = document.getElementById('dmSpeciesResults');
    if (box) box.innerHTML = `<div class="dm-species-empty">Couldn't load the Pokédex: ${escapeHtml(err.message)}</div>`;
  });
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

async function mountBattle() {
  const content = document.getElementById('content');
  content.innerHTML = await renderCombatWip();
  attachCombatWipListeners();
}

function onSession() {
  renderStatus();
  renderCreatures();
  syncAddAvailability();
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

function renderStatus() {
  const el = document.getElementById('dmStatus');
  if (!el) return;
  if (!session?.active) {
    el.innerHTML = 'No battle running -- start one in the middle of the screen.';
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
// Tools panel
// ---------------------------------------------------------------------------

function renderTools() {
  const natures = JSON.parse(sessionStorage.getItem('natures') || '[]');
  document.getElementById('dmTools').innerHTML = `
    <div class="dm-card">
      <div class="dm-card-title">Add Pokémon</div>
      <div class="dm-hint" id="dmAddHint"></div>
      <div class="dm-row">
        <input class="dm-input" id="dmSpeciesSearch" placeholder="Search name, type or habitat…" autocomplete="off">
      </div>
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
            ${natures.map(n => `<option value="${escapeHtml(n.name)}">${escapeHtml(n.name)}</option>`).join('')}
          </select>
        </div>
        <div class="dm-field"><label>Abilities</label><div id="dmAbilities"></div></div>
        <div class="dm-row">
          <div class="dm-field"><label for="dmItem">Held item</label><input class="dm-input" id="dmItem" placeholder="None"></div>
          <div class="dm-field"><label for="dmInit">Initiative</label><input class="dm-input" id="dmInit" type="number" placeholder="Roll for me"></div>
        </div>
        <div class="dm-row">
          <label class="dm-check"><input type="checkbox" id="dmShiny">Shiny</label>
          <label class="dm-check"><input type="checkbox" id="dmBench">Held back (not fighting yet)</label>
        </div>
        <button type="submit" class="dm-btn primary wide" id="dmAddBtn">Add to battle</button>
      </form>
    </div>

    <div class="dm-card">
      <div class="dm-card-title">
        <span>Your creatures</span>
        <button class="dm-btn small" id="dmPlaceBtn" hidden>📍 Place on map</button>
      </div>
      <div id="dmCreatures"><div class="dm-hint">Nothing of yours in the battle yet.</div></div>
    </div>`;

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
}

function typeBadges(t1, t2) {
  return [t1, t2].filter(Boolean).map(t => `<span class="dm-type" style="background:${getMoveTypeColor(t)}">${escapeHtml(t)}</span>`).join('');
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
      <span class="dm-species-meta">${typeBadges(s.type1, s.type2)} ${escapeHtml(s.size || '')} · base level ${s.level}${s.behavior ? ` · ${escapeHtml(s.behavior)}` : ''}</span>
    </span>`;
  const thumb = document.getElementById('dmSelectedThumb');
  if (s.image) patchPortraitMedia(thumb, s.image, s.name);
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
  syncAddAvailability();
}

function syncAddAvailability() {
  const hint = document.getElementById('dmAddHint');
  const btn = document.getElementById('dmAddBtn');
  const ready = !!session?.active;
  if (hint) hint.textContent = ready ? '' : 'Start a battle first -- then add the Pokémon the players will face.';
  if (hint) hint.style.display = ready ? 'none' : 'block';
  if (btn) btn.disabled = !ready || adding;
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
  const shiny = document.getElementById('dmShiny').checked;
  const initTyped = document.getElementById('dmInit').value;
  const bench = document.getElementById('dmBench').checked;
  const natures = JSON.parse(sessionStorage.getItem('natures') || '[]').map(n => n.name);

  adding = true;
  syncAddAvailability();
  const added = [];
  try {
    for (const label of labelsFor(s.name, count)) {
      const nature = natureChoice === '__random' ? (natures[Math.floor(Math.random() * natures.length)] || '') : natureChoice;
      const res = await DmAPI.buildPokemon({
        species: s.name, level, nature, abilities, item, shiny, nickname: label ? `${s.name} ${label}` : '',
      });
      // Built with the very same function a player's own Pokemon is (it reads the row from sessionStorage), then
      // the key is removed again so nothing of the DM's lingers there.
      const key = 'pokemon__dm_build';
      sessionStorage.setItem(key, JSON.stringify(res.data));
      let combatant;
      try { combatant = buildPokemonCombatant(key); } finally { sessionStorage.removeItem(key); }
      const participant = dmEnemyParticipant(combatant);
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
    syncAddAvailability();
  }
  if (added.length) toast(`Added ${added.join(', ')}`);
}

function rollD20() {
  return Math.floor(Math.random() * 20) + 1;
}

// ---------------------------------------------------------------------------
// The DM's creatures in the battle
// ---------------------------------------------------------------------------

function renderCreatures() {
  const box = document.getElementById('dmCreatures');
  const placeBtn = document.getElementById('dmPlaceBtn');
  if (!box) return;
  const mine = session?.active
    ? orderedParticipants().filter(p => p.owner === DM)
    : [];
  const unplaced = mine.filter(p => p.status === 'participating' && !session.board?.tokens?.[p.id]);
  if (placeBtn) {
    placeBtn.hidden = !unplaced.length;
    placeBtn.textContent = `📍 Place on map (${unplaced.length})`;
  }
  if (!mine.length) {
    box.innerHTML = '<div class="dm-hint">Nothing of yours in the battle yet.</div>';
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
      row.innerHTML = `
        <div class="dm-creature-portrait"></div>
        <div class="dm-creature-info"></div>
        <div class="dm-creature-actions"></div>`;
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
    const vis = p.visibility || {};
    row.querySelector('.dm-creature-actions').innerHTML = `
      <button class="dm-icon-btn${vis.name === false ? ' off' : ''}" data-act="vis" data-field="name" title="Players see its name">Nm</button>
      <button class="dm-icon-btn${vis.hp === false ? ' off' : ''}" data-act="vis" data-field="hp" title="Players see its HP bar">HP</button>
      <button class="dm-icon-btn${vis.vp === false ? ' off' : ''}" data-act="vis" data-field="vp" title="Players see its VP bar">VP</button>
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
  try {
    if (btn.dataset.act === 'vis') {
      const field = btn.dataset.field;
      await CombatAPI.setVisibility(id, field, (p.visibility || {})[field] === false);
    } else if (btn.dataset.act === 'status') {
      await CombatAPI.setStatus(id, p.status === 'spectating' ? 'participating' : 'spectating');
    } else if (btn.dataset.act === 'remove') {
      if (!await showCombatConfirm(`Remove ${p.name} from the battle?`, { title: 'Remove', yesLabel: 'Remove', noLabel: 'Cancel' })) return;
      await CombatAPI.removeParticipant(id);
    }
  } catch (err) {
    showCombatAlert(err.message, { title: p.name });
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function toast(text) {
  let box = document.getElementById('dmToast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'dmToast';
    box.style.cssText = 'position:fixed;right:400px;bottom:16px;z-index:10050;max-width:420px;background:rgba(23,24,43,0.97);'
      + 'color:#e6e6f0;border:1px solid rgba(255,215,0,0.5);border-radius:10px;padding:0.6rem 0.9rem;font-size:0.86rem;'
      + 'box-shadow:0 6px 20px rgba(0,0,0,0.45);transition:opacity 0.3s;';
    document.body.appendChild(box);
  }
  box.textContent = text;
  box.style.opacity = '1';
  clearTimeout(box._timer);
  box._timer = setTimeout(() => { box.style.opacity = '0'; }, 4000);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

init();
