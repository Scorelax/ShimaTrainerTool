// New shared combat tool -- work in progress, open to every trainer (see
// combat.js setup header) so multiple people can log in as different
// trainers and actually test the shared/live parts together. The old
// combat page keeps being what's actually used to play until the real
// switchover. Phase 1 vertical slice: prove the combat-session schema and
// the real-time SSE plumbing (pi-server/app/routes_combat.py) hold up,
// before any real game logic or player-facing UI is built on top. Open
// this page in two tabs and add/remove/advance a session in one -- the
// other should update within the SSE stream's normal latency, with no
// manual refresh.
import { CombatAPI } from '../api.js';
import { pickTarget } from '../utils/target-picker.js';
import { showBattleMap, updateBattleMap } from '../utils/battle-map-popup.js';
import { gridCellsHtml, gridTemplateStyle, cellRect } from '../utils/battle-map-grid.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { visibleToViewer } from '../utils/combat-visibility.js';
import {
  renderSetupPhase, attachSetupListeners,
  renderInitiativePhase, attachInitiativeListeners,
  buildTrainerCombatant, buildPokemonCombatant,
  renderCombatCard, COMBAT_CSS,
} from './combat.js';

const WIP_CSS = `
  .combat-wip-page { min-height: 100vh; background: #14141f; color: #e0e0e0; font-family: inherit; }
  .combat-wip-header-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.75rem 1rem; background: rgba(0,0,0,0.3); border-bottom: 1px solid rgba(255,255,255,0.1);
  }
  .combat-wip-title { font-size: 1.2rem; font-weight: 700; color: #FFD700; text-transform: uppercase; letter-spacing: 1px; }
  .combat-wip-back-btn {
    background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
    color: #e0e0e0; padding: 0.4rem 0.8rem; border-radius: 6px; cursor: pointer; font-size: 0.9rem;
  }
  .combat-wip-body { max-width: 700px; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
  .combat-wip-empty { text-align: center; padding: 3rem 1rem; }
  .combat-wip-empty h2 { color: #FFD700; margin-bottom: 0.5rem; }
  .combat-wip-empty p { color: #a0a0c0; line-height: 1.5; margin-bottom: 1.5rem; }
  .combat-wip-btn-primary, .combat-wip-btn-danger, .combat-wip-btn-secondary {
    border: none; border-radius: 6px; padding: 0.6rem 1.2rem; font-size: 0.95rem;
    font-weight: 600; cursor: pointer; color: #fff;
  }
  .combat-wip-btn-primary { background: linear-gradient(135deg, #27ae60, #1e8449); }
  .combat-wip-btn-danger { background: linear-gradient(135deg, #c0392b, #922b21); }
  .combat-wip-btn-secondary { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); }
  .combat-wip-round-bar {
    display: flex; align-items: center; justify-content: space-between;
    background: rgba(255,255,255,0.05); border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1rem;
  }
  .combat-wip-round-label { font-weight: 700; color: #FFD700; }
  .combat-wip-battle-badge {
    font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
    background: rgba(255,255,255,0.12); border-radius: 4px; padding: 0.15rem 0.5rem; margin-left: 0.5rem;
  }
  .combat-wip-reacting-note { color: #e67e22; font-size: 0.85rem; }
  .combat-wip-battle-type-choice {
    display: flex; flex-direction: column; gap: 0.6rem; max-width: 380px; margin: 0 auto 1.5rem; text-align: left;
  }
  .combat-wip-battle-type-choice label {
    display: flex; gap: 0.5rem; align-items: flex-start; background: rgba(255,255,255,0.05);
    border-radius: 8px; padding: 0.6rem 0.8rem; cursor: pointer;
  }
  .combat-wip-battle-type-choice small { display: block; color: #a0a0c0; }
  .combat-wip-section-label {
    font-size: 0.75rem; font-weight: 700; color: #a0a0c0; text-transform: uppercase;
    letter-spacing: 0.5px; margin: 1rem 0 0.4rem;
  }
  .combat-wip-add-form {
    display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;
    background: rgba(255,255,255,0.05); border-radius: 8px; padding: 0.75rem; margin-bottom: 1rem;
  }
  .combat-wip-add-form input, .combat-wip-add-form select {
    background: #1e1e2e; border: 1px solid rgba(255,255,255,0.2); color: #e0e0e0;
    border-radius: 4px; padding: 0.4rem 0.5rem; font-size: 0.85rem;
  }
  .combat-wip-add-form input[type="text"] { flex: 1; min-width: 100px; }
  .combat-wip-add-form input[type="number"] { width: 64px; }
  .combat-wip-participant-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .combat-wip-participant {
    display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem;
    background: rgba(255,255,255,0.05); border: 1px solid transparent; border-radius: 8px; padding: 0.6rem 0.8rem;
  }
  .combat-wip-participant.active-turn { border-color: #FFD700; background: rgba(255,215,0,0.08); }
  .combat-wip-participant.reacting { border-color: #e67e22; background: rgba(230,126,34,0.1); }
  .combat-wip-participant.spectating { opacity: 0.55; }
  .combat-wip-side-badge { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; padding: 0.15rem 0.4rem; border-radius: 4px; }
  .combat-wip-side-badge.player { background: #2980b9; }
  .combat-wip-side-badge.enemy { background: #922b21; }
  .combat-wip-p-name { font-weight: 600; }
  .combat-wip-p-stats { color: #a0a0c0; font-size: 0.8rem; }
  .combat-wip-p-controls { margin-left: auto; display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .combat-wip-p-controls button {
    background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #e0e0e0;
    border-radius: 4px; padding: 0.25rem 0.5rem; font-size: 0.75rem; cursor: pointer;
  }
  .combat-wip-p-controls button:disabled { opacity: 0.35; cursor: not-allowed; }
  .combat-wip-p-controls button.on { background: #27ae60; border-color: #27ae60; }
  .combat-wip-p-controls button.remove { background: #922b21; border-color: #922b21; }

  /* Battle view: each combat-card (reused verbatim from combat.js) plus this
     page's own action row underneath it -- the card's own click-to-expand
     interaction isn't wired here yet (see Milestone D's own-turn move popups,
     still future work), so the pointer cursor it normally implies is turned
     back off to avoid promising an interaction that doesn't do anything yet. */
  .battle-card-wrap { margin-bottom: 0.6rem; }
  .battle-card-wrap .combat-card-main { cursor: default; }
  .battle-card-wrap .combat-wip-p-controls { margin: 0.4rem 0.2rem 0; }
  .battle-card-wrap.reacting .combat-card { border-color: #e67e22; box-shadow: 0 0 10px rgba(230,126,34,0.35); }
  .battle-card-wrap.spectating { opacity: 0.55; }
`;

// Reuses .bmap-cell/.bmap-token's exact rules from battle-map-popup.js (same
// class names, same properties) so the placement screen looks like the same
// map surface the popup and kiosk screen show -- defined again here (rather
// than only relying on battle-map-popup.js's injected <head> styles) so this
// page works even if that popup has never been opened yet this session.
const PLACEMENT_CSS = `
  .placement-page { min-height: 100vh; background: #14141f; color: #e0e0e0; font-family: inherit; }
  .placement-header-bar {
    display: flex; align-items: center; justify-content: center;
    padding: 0.75rem 1rem; background: rgba(0,0,0,0.3); border-bottom: 1px solid rgba(255,255,255,0.1);
  }
  .placement-title { font-size: 1.2rem; font-weight: 700; color: #FFD700; text-transform: uppercase; letter-spacing: 1px; }
  .placement-body { max-width: 640px; margin: 0 auto; padding: 1.5rem 1rem 3rem; text-align: center; }
  .placement-prompt { font-size: 1.05rem; margin-bottom: 1rem; }
  .placement-prompt strong { color: #FFD700; }
  .placement-stage { position: relative; width: 100%; aspect-ratio: 5 / 4; background: #0a0a12; border-radius: 8px; overflow: hidden; }
  .placement-grid { position: absolute; inset: 0; display: grid; gap: 2px; background: #1a1a24; }
  .bmap-cell { background: #20202e; cursor: pointer; }
  .bmap-cell:hover { outline: 1px solid rgba(255,215,0,0.5); outline-offset: -1px; }
  .bmap-cell.marked {
    background: #4a3520; display: flex; align-items: center; justify-content: center;
    font-size: 0.6rem; color: #e0c080; overflow: hidden; text-align: center; padding: 1px; box-sizing: border-box;
  }
  .placement-tokens { position: absolute; inset: 0; pointer-events: none; }
  .placement-token {
    position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 3px; box-sizing: border-box;
  }
  .placement-token-portrait { width: 70%; height: 70%; }
  .placement-token-portrait img, .placement-token-portrait video {
    width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 0 4px rgba(0,0,0,0.9));
  }
  .placement-token-name { font-size: 0.6rem; font-weight: 700; text-shadow: 0 1px 2px #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .placement-token.player .placement-token-name { color: #5dade2; }
  .placement-token.enemy .placement-token-name { color: #e57373; }
  .placement-token.ghost { opacity: 0.5; }
  .placement-token.ghost .placement-token-name { color: #FFD700; font-style: italic; }
`;

let session = null;
let combatUpdateHandler = null;

// Joining a fight reuses combat.js's actual Setup + Initiative phases
// (trainer auto-included, pick one lead Pokémon, roll a d20) instead of a
// separate ad-hoc picker -- see js/pages/combat.js's renderSetupPhase/
// attachSetupListeners/renderInitiativePhase/attachInitiativeListeners,
// exported with optional callback params specifically for this reuse (their
// default, no-callback behavior is untouched, still driving the legacy
// local-only combat page exactly as before). This is purely local UI state
// for *this device's* own join process -- separate from the shared
// `session` above -- until it completes and pushes to the server.
let _joinStage = null; // null | 'setup' | 'initiative' | 'placement'
let _joinState = null; // { combatants: [trainerCombatant, activePokemon] } while in 'initiative'
let _placementQueue = []; // participant ids this trainer still needs to place, while in 'placement'
let _hoverGhosts = {}; // participantId -> {col,row} live previews from OTHER players, while in 'placement'
let _hoverThrottle = null;
let _placementHoverHandler = null;

// The pokemonKey (e.g. "pokemon3") for whichever party Pokémon this device
// chose during Setup -- remembered so the battle view can rebuild the same
// rich local combatant (full stat block, moves, items -- everything
// buildPokemonCombatant already knows how to compute from sessionStorage)
// on every re-render, the same way the legacy combat.js page does. Only
// meaningful for the current trainer's own cards; every other participant's
// card is a lightweight stand-in (see _buildBattleCombatants below).
let _myPokemonKey = null;

function _needsToJoin(state) {
  const name = _currentTrainerName();
  if (!name) return false;
  return !Object.values(state.participants).some(p => p.owner === name);
}

export async function renderCombatWip() {
  const result = await CombatAPI.getState();
  session = result.status === 'success' ? result.data : { active: false };
  return _renderCurrentView();
}

function _renderCurrentView() {
  const inJoinFlow = _joinStage === 'setup' || _joinStage === 'initiative' || _joinStage === 'placement';

  if (session.active && (inJoinFlow || _needsToJoin(session))) {
    if (_joinStage === 'initiative' && _joinState) {
      return renderInitiativePhase(_joinState);
    }
    if (_joinStage === 'placement' && _placementQueue.length) {
      return renderPlacementPhase(session, _placementQueue[0]);
    }
    _joinStage = 'setup';
    return renderSetupPhase({ showWipButton: false });
  }

  _joinStage = null;
  _joinState = null;
  _placementQueue = [];
  _hoverGhosts = {};

  return `
    <div class="combat-wip-page">
      <style>${COMBAT_CSS}${WIP_CSS}</style>
      <div class="combat-wip-header-bar">
        <button class="combat-wip-back-btn" id="combatWipBackBtn">← Back</button>
        <div class="combat-wip-title">🛠️ New Combat Tool (WIP)</div>
        <div></div>
      </div>
      <div class="combat-wip-body" id="combatWipBody">${renderBody(session)}</div>
    </div>`;
}

/** Full page re-render + re-attach -- used for join-flow transitions, which
 * swap between entirely different page structures (combat.js's own
 * self-styled pages vs. this page's own shell), unlike the SSE handler
 * below which only patches #combatWipBody in place for the normal view. */
function _rerenderFull() {
  const content = document.getElementById('content');
  if (content) content.innerHTML = _renderCurrentView();
  attachCombatWipListeners();
}

/** combat.js's combatant shape (buildTrainerCombatant/buildPokemonCombatant)
 * -> this app's participant payload (CombatAPI.addParticipant). */
function _combatantToParticipant(c) {
  return {
    name: c.name,
    side: 'player',
    image: c.image,
    owner: _currentTrainerName(),
    maxHP: c.maxHp, currentHP: c.currentHp,
    maxVP: c.maxVp, currentVP: c.currentVp,
    type1: (c.types && c.types[0]) || '',
    type2: (c.types && c.types[1]) || '',
    initiative: c.initiativeTotal,
  };
}

/** combat.js's renderCombatCard expects a rich "combatant" shape. For this
 * device's own trainer/Pokémon we rebuild that full object fresh on every
 * call (buildTrainerCombatant/buildPokemonCombatant read straight from
 * sessionStorage, so this stays cheap and always current) -- every existing
 * mechanic that already works in the legacy combat page (ability scores,
 * types, moves data) shows up here unchanged. HP/VP are overlaid from the
 * server record so damage applied by anyone (via use-move) is reflected.
 * Every other participant -- another player's or the DM's -- only has the
 * lightweight fields the server actually tracks, so it gets a stand-in
 * combatant with hasStatBlock:false, which renderCombatCard renders without
 * the ability-score/AC rows rather than showing fabricated zeros. */
function _buildBattleCombatants(state) {
  const myName = _currentTrainerName();
  const myRichByName = new Map();
  if (myName) {
    const trainerC = buildTrainerCombatant();
    myRichByName.set(trainerC.name, trainerC);
    if (_myPokemonKey) {
      const pokemonC = buildPokemonCombatant(_myPokemonKey);
      myRichByName.set(pokemonC.name, pokemonC);
    }
  }

  return state.turnOrder.map(id => {
    const p = state.participants[id];
    if (!p) return null;

    const rich = (p.owner && p.owner === myName) ? myRichByName.get(p.name) : null;
    if (rich) {
      return {
        ...rich,
        id: p.id,
        currentHp: p.currentHP, maxHp: p.maxHP,
        currentVp: p.currentVP, maxVp: p.maxVP,
        hasStatBlock: true,
      };
    }

    const showName = visibleToViewer(p, 'name');
    const showHp = visibleToViewer(p, 'hp');
    const showVp = visibleToViewer(p, 'vp');
    return {
      id: p.id,
      name: showName ? p.name : '???',
      image: p.image || 'assets/Pokeball.png',
      level: '?', types: [p.type1, p.type2].filter(Boolean),
      ac: '—', baseAc: '—', critMod: 0,
      currentHp: showHp ? p.currentHP : 0, maxHp: showHp ? p.maxHP : 0,
      currentVp: showVp ? p.currentVP : 0, maxVp: showVp ? p.maxVP : 0,
      str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0,
      strMod: 0, dexMod: 0, conMod: 0, intMod: 0, wisMod: 0, chaMod: 0,
      initiativeTotal: p.initiative ?? '—',
      statusEffects: [], isExpanded: false, hasStatBlock: false,
    };
  }).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Placement -- after initiative, before the battle/turn-order view, each
// player places their own trainer then their own Pokémon on the grid, one
// at a time. Live: other players currently placing broadcast a hover
// preview (see routes_combat.py's hover-token) that renders here as a
// translucent ghost, and every confirmed placement (confirm-placement)
// shows immediately via the normal session broadcast, same channel as
// everything else in this file.
// ---------------------------------------------------------------------------

function renderPlacementPhase(state, currentId) {
  const current = state.participants[currentId];
  return `
    <div class="placement-page">
      <style>${PLACEMENT_CSS}</style>
      <div class="placement-header-bar"><div class="placement-title">📍 Place Your Team</div></div>
      <div class="placement-body">
        <div class="placement-prompt">Click a cell to place <strong>${current?.name || '…'}</strong> on the map.</div>
        <div class="placement-stage">
          <div class="placement-grid" id="placementGrid" style="${gridTemplateStyle(state.board)}">${gridCellsHtml(state.board, 'bmap-cell')}</div>
          <div class="placement-tokens" id="placementTokens"></div>
        </div>
      </div>
    </div>`;
}

function _renderPlacementTokens(state, currentId) {
  const layer = document.getElementById('placementTokens');
  if (!layer) return;

  const html = [];

  Object.entries(state.board.tokens).forEach(([id, pos]) => {
    const p = state.participants[id];
    if (!p) return;
    const name = visibleToViewer(p, 'name') ? p.name : '???';
    const rect = cellRect(state.board, pos.col, pos.row);
    html.push(`
      <div class="placement-token ${p.side}" data-token-id="${id}" style="left:${rect.left};top:${rect.top};width:${rect.width};height:${rect.height};">
        <div class="placement-token-portrait" data-portrait-id="${id}"></div>
        <div class="placement-token-name">${name}</div>
      </div>`);
  });

  Object.entries(_hoverGhosts).forEach(([id, pos]) => {
    if (!pos || id === currentId) return; // no ghost for your own in-progress placement
    if (state.board.tokens[id]) return; // already confirmed -- the real token above is authoritative
    const p = state.participants[id];
    if (!p) return;
    const name = visibleToViewer(p, 'name') ? p.name : '???';
    const rect = cellRect(state.board, pos.col, pos.row);
    html.push(`
      <div class="placement-token ghost ${p.side}" style="left:${rect.left};top:${rect.top};width:${rect.width};height:${rect.height};">
        <div class="placement-token-portrait" data-portrait-id="${id}"></div>
        <div class="placement-token-name">${name}</div>
      </div>`);
  });

  layer.innerHTML = html.join('');

  layer.querySelectorAll('[data-portrait-id]').forEach(el => {
    const p = state.participants[el.dataset.portraitId];
    if (p) patchPortraitMedia(el, p.image, p.name);
  });
}

function attachPlacementListeners(state, currentId) {
  _renderPlacementTokens(state, currentId);

  const gridEl = document.getElementById('placementGrid');
  if (!gridEl) return;

  gridEl.querySelectorAll('[data-cell]').forEach(cell => {
    cell.addEventListener('click', async () => {
      const [col, row] = cell.dataset.cell.split(',').map(Number);
      try {
        await CombatAPI.confirmPlacement(currentId, col, row);
      } catch (err) {
        alert(err.message);
        return;
      }
      CombatAPI.hoverToken(currentId).catch(() => {}); // clear our own hover ghost for others
      _placementQueue.shift();
      if (!_placementQueue.length) _joinStage = null;
      _rerenderFull();
    });
  });

  gridEl.addEventListener('mousemove', (e) => {
    const cell = e.target.closest('[data-cell]');
    if (!cell) return;
    if (_hoverThrottle) return;
    _hoverThrottle = setTimeout(() => { _hoverThrottle = null; }, 150);
    const [col, row] = cell.dataset.cell.split(',').map(Number);
    CombatAPI.hoverToken(currentId, col, row).catch(() => {});
  });

  gridEl.addEventListener('mouseleave', () => {
    CombatAPI.hoverToken(currentId).catch(() => {});
  });

  if (_placementHoverHandler) window.removeEventListener('app:combat-hover', _placementHoverHandler);
  _placementHoverHandler = (e) => {
    const { participantId, col, row } = e.detail;
    _hoverGhosts[participantId] = (col === null || col === undefined) ? null : { col, row };
    if (_joinStage === 'placement') _renderPlacementTokens(session, _placementQueue[0]);
  };
  window.addEventListener('app:combat-hover', _placementHoverHandler);
}

function renderBody(state) {
  if (!state || !state.active) {
    return `
      <div class="combat-wip-empty">
        <h2>No active session</h2>
        <p>Add real trainers and their party Pokémon, and confirm the turn order / reaction rules sync live across every open tab.</p>
        <div class="combat-wip-battle-type-choice">
          <label>
            <input type="radio" name="battleType" value="pve" checked>
            <span><strong>PvE</strong><small>Players vs. DM-controlled enemies -- the DM adds freeform enemies below.</small></span>
          </label>
          <label>
            <input type="radio" name="battleType" value="pvp">
            <span><strong>PvP</strong><small>Players fight each other -- no DM setup, everyone's added from real trainer data.</small></span>
          </label>
        </div>
        <button class="combat-wip-btn-primary" id="createSessionBtn">Create Session</button>
      </div>`;
  }

  const activeId = state.turnOrder[state.turnIndex];
  const orderLabel = state.turnOrder.map(id => state.participants[id]?.name || '?').join(' → ') || '(no participants yet)';

  return `
    <div class="combat-wip-round-bar">
      <div>
        <div class="combat-wip-round-label">Round ${state.round} <span class="combat-wip-battle-badge">${state.battleType === 'pvp' ? 'PvP' : 'PvE'}</span></div>
        <div style="font-size:0.8rem;color:#a0a0c0;">${orderLabel}</div>
        ${state.reactingParticipantId ? `<div class="combat-wip-reacting-note">⚡ ${state.participants[state.reactingParticipantId]?.name} is reacting out of turn</div>` : ''}
      </div>
      <div style="display:flex; gap:0.5rem;">
        <button class="combat-wip-btn-secondary" id="advanceTurnBtn" ${state.reactingParticipantId ? 'disabled' : ''}>Advance Turn →</button>
        <button class="combat-wip-btn-secondary" id="battleMapBtn">🗺️ Battle Map</button>
        <button class="combat-wip-btn-danger" id="endSessionBtn">End Session</button>
      </div>
    </div>

    ${state.battleType === 'pve' ? `
    <div class="combat-wip-section-label">Add Freeform Enemy (DM-controlled)</div>
    <form class="combat-wip-add-form" id="addParticipantForm">
      <input type="text" name="name" placeholder="Name" required>
      <select name="status">
        <option value="participating">Participating</option>
        <option value="spectating">Spectating</option>
      </select>
      <input type="number" name="maxHP" placeholder="HP" value="20" min="0">
      <input type="number" name="maxVP" placeholder="VP" value="10" min="0">
      <input type="text" name="type1" placeholder="Type 1 (optional)" style="width:110px;">
      <input type="text" name="type2" placeholder="Type 2 (optional)" style="width:110px;">
      <button type="submit" class="combat-wip-btn-primary">Add</button>
    </form>` : ''}

    <div class="battle-list" id="battleList">
      ${_buildBattleCombatants(state).map(c => _renderBattleCard(c, state, activeId)).join('') || '<p style="color:#a0a0c0;">No participants yet.</p>'}
    </div>`;
}

/** One combat-card (combat.js's real card -- same portrait, HP/VP bars, type
 * badges, ability scores when we have them) plus this page's own action row
 * underneath it (join/bench, react, visibility toggles, use-move, remove) --
 * that action mechanism is unchanged from before this milestone (already
 * server-integrated), only the visual card above it is new. */
function _renderBattleCard(c, state, activeId) {
  const p = state.participants[c.id];
  const isActive = c.id === activeId && !state.reactingParticipantId;
  const isReacting = c.id === state.reactingParticipantId;
  const canReact = p.status === 'participating' && !p.reactionUsed && !state.reactingParticipantId && p.id !== activeId;
  const mapPos = state.board?.tokens?.[p.id];

  const visToggle = (field, label) => `
    <button class="${p.visibility[field] ? 'on' : ''}" data-vis-id="${p.id}" data-vis-field="${field}" data-vis-value="${p.visibility[field] ? 0 : 1}">
      ${label} ${p.visibility[field] ? '👁️' : '🚫'}
    </button>`;

  const wrapClasses = ['battle-card-wrap'];
  if (isReacting) wrapClasses.push('reacting');
  if (p.status === 'spectating') wrapClasses.push('spectating');

  return `
    <div class="${wrapClasses.join(' ')}">
      ${renderCombatCard(c, isActive || isReacting)}
      <div class="combat-wip-p-controls">
        <span class="combat-wip-side-badge ${p.side}">${p.side}</span>
        ${mapPos ? `<span class="combat-wip-p-stats">📍(${mapPos.col},${mapPos.row})</span>` : ''}
        <button data-toggle-status="${p.id}" data-next-status="${p.status === 'participating' ? 'spectating' : 'participating'}">
          ${p.status === 'participating' ? 'Bench' : 'Join Fight'}
        </button>
        <button data-reaction="${p.id}" ${canReact ? '' : 'disabled'}>⚡ React${p.reactionUsed ? ' (used)' : ''}</button>
        ${p.side === 'enemy' ? visToggle('hp', 'HP') + visToggle('vp', 'VP') + visToggle('name', 'Name') : ''}
        <button data-use-move="${p.id}" title="Only works when it's this participant's turn (or they're reacting) -- server enforces it">⚔️ Use Move</button>
        <button data-play-anim="${p.id}" data-anim-species="${p.name}" title="Test the display screen's animation playback">🎬 Play Anim</button>
        <button class="remove" data-remove="${p.id}">Remove</button>
      </div>
    </div>`;
}

export function attachCombatWipListeners() {
  // Re-render in place on every live combat push (see live-updates.js) --
  // while mid-setup/initiative this only updates the background `session`
  // var (nothing about *your own* roll needs another player's action
  // mid-way); while placing, other players' just-confirmed tokens DO patch
  // in live so "see everyone's placement live" isn't only true for hover
  // previews. The normal view picks up the latest session the moment the
  // join flow completes and re-renders.
  if (combatUpdateHandler) window.removeEventListener('app:combat-updated', combatUpdateHandler);
  combatUpdateHandler = (e) => {
    session = e.detail;
    if (_joinStage === 'placement') {
      if (_placementQueue.length) _renderPlacementTokens(session, _placementQueue[0]);
      return;
    }
    if (_joinStage) return;

    // Not already mid-join-flow, but the fresh session says this trainer
    // needs to join (e.g. this device just created the session, or a
    // session just went active) -- switch into the join flow rather than
    // patching the normal-view body with something that no longer applies.
    if (session.active && _needsToJoin(session)) {
      _rerenderFull();
      return;
    }

    const body = document.getElementById('combatWipBody');
    if (body) body.innerHTML = renderBody(session);
    attachBodyListeners();
    updateBattleMap(session); // no-ops if the popup isn't currently open
  };
  window.addEventListener('app:combat-updated', combatUpdateHandler);

  if (_joinStage === 'setup') {
    attachSetupListeners({
      backRoute: 'combat',
      onStart: ({ trainerCombatant, activePokemon }) => {
        _joinState = { combatants: [trainerCombatant, activePokemon] };
        _joinStage = 'initiative';
        _rerenderFull();
      },
    });
    return;
  }

  if (_joinStage === 'initiative') {
    attachInitiativeListeners(_joinState, {
      onBack: () => {
        _joinStage = 'setup';
        _joinState = null;
        _rerenderFull();
      },
      onComplete: async (combatants) => {
        _myPokemonKey = combatants[1]?.id || null;
        try {
          for (const c of combatants) {
            await CombatAPI.addParticipant(_combatantToParticipant(c));
          }
        } catch (err) {
          alert(err.message);
        }
        // Pick up whatever the server now has (including this device's own
        // just-added participants) before deciding what's next.
        const result = await CombatAPI.getState();
        session = result.status === 'success' ? result.data : session;
        _joinState = null;

        const myName = _currentTrainerName();
        _placementQueue = Object.values(session.participants)
          .filter(p => p.owner === myName && !p.placed)
          .map(p => p.id);

        _joinStage = _placementQueue.length ? 'placement' : null;
        _rerenderFull();
      },
    });
    return;
  }

  if (_joinStage === 'placement') {
    attachPlacementListeners(session, _placementQueue[0]);
    return;
  }

  document.getElementById('combatWipBackBtn')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: { route: 'combat' } }));
  });

  attachBodyListeners();
}

function attachBodyListeners() {
  document.getElementById('createSessionBtn')?.addEventListener('click', async () => {
    const battleType = document.querySelector('input[name="battleType"]:checked')?.value || 'pve';
    await CombatAPI.createSession(battleType);
  });

  document.getElementById('endSessionBtn')?.addEventListener('click', async () => {
    await CombatAPI.endSession();
  });

  document.getElementById('battleMapBtn')?.addEventListener('click', () => {
    showBattleMap(session, _currentTrainerName());
  });

  document.getElementById('advanceTurnBtn')?.addEventListener('click', async () => {
    try { await CombatAPI.advanceTurn(); } catch (err) { alert(err.message); }
  });

  document.querySelectorAll('.end-turn-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try { await CombatAPI.advanceTurn(); } catch (err) { alert(err.message); }
    });
  });

  document.getElementById('addParticipantForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = new FormData(form);
    const maxHP = parseInt(data.get('maxHP'), 10) || 0;
    const maxVP = parseInt(data.get('maxVP'), 10) || 0;
    await CombatAPI.addParticipant({
      name: data.get('name'),
      side: 'enemy', // this form is PvE-only (see renderBody) -- freeform is always DM-controlled enemies
      status: data.get('status'),
      maxHP, currentHP: maxHP,
      maxVP, currentVP: maxVP,
      type1: data.get('type1') || '',
      type2: data.get('type2') || '',
    });
    form.reset();
  });

  document.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => CombatAPI.removeParticipant(btn.dataset.remove));
  });

  document.querySelectorAll('[data-toggle-status]').forEach(btn => {
    btn.addEventListener('click', () => CombatAPI.setStatus(btn.dataset.toggleStatus, btn.dataset.nextStatus));
  });

  document.querySelectorAll('[data-reaction]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try { await CombatAPI.reactionStart(btn.dataset.reaction); } catch (err) { alert(err.message); }
    });
  });

  document.querySelectorAll('[data-use-move]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.useMove;
      const move = prompt('Move name (VP cost is looked up server-side from the moves dataset):');
      if (!move) return;
      const targetId = await pickTarget(id) || undefined;
      const rollStr = targetId ? prompt('Dice roll result (the raw number rolled at the table, optional):', '') : '';
      const diceRoll = rollStr ? parseInt(rollStr, 10) : undefined;
      try {
        const result = await CombatAPI.useMove(id, move, { targetId, diceRoll });
        if (result.multiplier !== undefined) {
          alert(`${result.multiplier}× effectiveness -- ${result.damageApplied} damage applied`);
        }
      } catch (err) { alert(err.message); }
    });
  });

  document.querySelectorAll('[data-play-anim]').forEach(btn => {
    btn.addEventListener('click', () => {
      const species = prompt('Species name for the animation clip (must match an uploaded battle-animation filename):', btn.dataset.animSpecies);
      if (species) CombatAPI.playAnimation(btn.dataset.playAnim, species);
    });
  });

  document.querySelectorAll('[data-vis-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      CombatAPI.setVisibility(btn.dataset.visId, btn.dataset.visField, btn.dataset.visValue === '1');
    });
  });

  if (session && session.reactingParticipantId) {
    document.getElementById('advanceTurnBtn')?.insertAdjacentHTML('afterend',
      '<button class="combat-wip-btn-secondary" id="reactionEndBtn">End Reaction</button>');
    document.getElementById('reactionEndBtn')?.addEventListener('click', () => CombatAPI.reactionEnd());
  }
}

function _currentTrainerName() {
  const trainerData = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
  return trainerData[1] || '';
}
