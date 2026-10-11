// DM console -- the running battle. The middle of the screen is the shared battle itself -- combat-wip.js, the exact
// screen the players use -- running as the DM (enableDmMode, see dm-console.js): every creature the DM set up is owned
// by 'DM', so it gets the same card, moves, saves, reactions and map tools a player's own Pokemon does, and anything a
// player's attack asks of it (a save, a Sturdy roll) pops up here. The panel on the right is the DM's own: the table
// screens, the DM's creatures in the fight, and reinforcements.
import { CombatAPI, DmAPI } from '../api.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import { renderCombatWip, attachCombatWipListeners, startDmPlacement } from '../pages/combat-wip.js';
import { DM, escapeHtml, typeBadges, getSpecies, rollD20, toast, participantFromPokemonRow } from './dm-common.js';

let session = { active: false, participants: {}, turnOrder: [] };
let species = [];
let selectedSpecies = null;
let adding = false;

export async function mountLive(stageEl, toolsEl, currentSession) {
  session = currentSession;
  stageEl.innerHTML = await renderCombatWip();
  attachCombatWipListeners();
  renderTools(toolsEl);
  renderCreatures();
  getSpecies().then(list => { species = list; renderSpeciesResults(); }).catch(() => {});
}

export function updateLive(currentSession) {
  session = currentSession;
  renderCreatures();
}

// ---------------------------------------------------------------------------
// Tools panel
// ---------------------------------------------------------------------------

function renderTools(el) {
  const natures = JSON.parse(sessionStorage.getItem('natures') || '[]');
  el.innerHTML = `
    <div class="dm-card">
      <div class="dm-card-title">Table screens</div>
      <div class="dm-row">
        <a class="dm-btn" href="display.html" target="_blank" rel="noopener" title="The table TV's turn / HP screen">📺 Display</a>
        <a class="dm-btn" href="battle-map.html" target="_blank" rel="noopener" title="The table's battle map screen">▦ Battle map</a>
      </div>
    </div>

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
            ${natures.map(n => `<option value="${escapeHtml(n.name)}">${escapeHtml(n.name)}</option>`).join('')}
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
