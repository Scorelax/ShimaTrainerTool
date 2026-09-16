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
  renderBattlePhase, attachBattleListeners, rerenderBattle, setBattleCardOptions,
  setCombatStateKey, setOnCombatStateSave,
} from './combat.js';

const WIP_CSS = `
  /* Breaks out of the SPA shell's own centered/padded ".app" container
     (max-width:1400px, padding:20px, both on top of a dark red body
     background) so this page's own background actually reaches every edge
     of the viewport instead of leaving a red band around it regardless of
     nesting depth -- the width:100vw + negative-margin pair is relative to
     the viewport, not the parent, which is what makes that possible here. */
  .combat-wip-page {
    min-height: 100vh; background: #14141f; color: #e0e0e0; font-family: inherit;
    width: 100vw; margin-left: calc(50% - 50vw); margin-right: calc(50% - 50vw);
    overflow-x: hidden; /* 100vw can run a few px wider than the true scrollbar-adjusted
      viewport -- clip that sliver instead of letting it show as a stray offset/scrollbar */
  }
  .combat-wip-header-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.75rem 1rem; background: rgba(0,0,0,0.3); border-bottom: 1px solid rgba(255,255,255,0.1);
  }
  .combat-wip-title { font-size: 1.2rem; font-weight: 700; color: #FFD700; text-transform: uppercase; letter-spacing: 1px; }
  .combat-wip-back-btn {
    background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
    color: #e0e0e0; padding: 0.4rem 0.8rem; border-radius: 6px; cursor: pointer; font-size: 0.9rem;
  }
  .combat-wip-layout { display: flex; align-items: flex-start; gap: 1rem; padding: 0 1rem; }
  .combat-wip-body { flex: 1 1 auto; min-width: 0; max-width: 700px; padding: 1.5rem 0 3rem; }
  .combat-wip-turnorder {
    flex: 0 0 42px; display: flex; flex-direction: column; gap: 0.4rem;
    padding: 1.5rem 0 3rem; position: sticky; top: 0;
  }
  .wip-turn-item { display: flex; flex-direction: column; align-items: center; cursor: pointer; }
  .wip-turn-portrait {
    position: relative; width: 42px; height: 42px; border-radius: 6px; overflow: hidden;
    background: rgba(255,255,255,0.05); border: 2px solid transparent; box-sizing: border-box;
  }
  .wip-turn-item.focused .wip-turn-portrait { border-color: #5dade2; }
  .wip-turn-item.active .wip-turn-portrait { border-color: #FFD700; box-shadow: 0 0 5px rgba(255,215,0,0.5); }
  .wip-turn-item.spectating { opacity: 0.4; }
  .wip-turn-portrait-media { width: 100%; height: 100%; }
  .wip-turn-portrait-media img, .wip-turn-portrait-media video { width: 100%; height: 100%; object-fit: contain; }
  .wip-turn-reaction {
    position: absolute; bottom: 0; left: 1px; font-size: 0.55rem;
    filter: grayscale(1) opacity(0.35); text-shadow: 0 1px 2px #000;
  }
  .wip-turn-reaction.used { filter: none; }
  .wip-turn-name {
    font-size: 0.55rem; font-weight: 600; margin-top: 0.15rem; text-align: center;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 42px;
  }
  /* The single focused card's React button -- takes over the slot combat.js's
     own card footer normally gives the End Turn button (which moves below
     the moves section instead, see renderCombatCard's endTurnAtBottom
     option and this same footer slot's showReactButton option). */
  .wip-react-btn {
    background: linear-gradient(135deg, #f1c40f, #e67e22); color: #1a1a1a;
    border: none; border-radius: 6px; padding: 0.3rem 0.7rem; font-size: 0.82rem; font-weight: 700; cursor: pointer;
  }
  .wip-react-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  /* Compact read-only info shown in the main area when the focused sidebar
     portrait isn't one of the viewer's own -- name/type/HP/VP/level only,
     no card, no actions. */
  .wip-foreign-focus {
    max-width: 360px; margin: 2rem auto; padding: 1.2rem; text-align: center;
    background: rgba(255,255,255,0.04); border-radius: 12px;
  }
  .wip-foreign-focus-name { font-size: 1.1rem; font-weight: 700; color: #FFD700; margin-bottom: 0.4rem; }
  .wip-foreign-focus-row { color: #cfd0e0; margin-top: 0.25rem; font-size: 0.95rem; }
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
    display: flex; align-items: center; justify-content: flex-end;
    margin-bottom: 1rem;
  }
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
  /* combat.js's own nested "Round X / ⚔️ Battle / End Combat" header --
     redundant with this page's own header (title + End Battle) and round
     tracking (no longer shown at all, per explicit direction), so hidden
     wholesale rather than picked apart piece by piece. */
  #wipBattlePhase .combat-header-bar { display: none; }
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
  .placement-actions { min-height: 2.6rem; margin-bottom: 0.75rem; }
  .placement-confirm-btn {
    background: linear-gradient(135deg, #27ae60, #1e8449); border: none; border-radius: 6px;
    color: #fff; font-weight: 700; font-size: 0.95rem; padding: 0.55rem 1.4rem; cursor: pointer;
  }
  .placement-stage { position: relative; width: 100%; aspect-ratio: 5 / 4; background: #0a0a12; border-radius: 8px; overflow: hidden; }
  .placement-grid { position: absolute; inset: 0; display: grid; gap: 2px; background: #1a1a24; }
  .bmap-cell { background: #20202e; cursor: pointer; }
  .bmap-cell:hover { outline: 1px solid rgba(255,215,0,0.5); outline-offset: -1px; }
  .bmap-cell.marked {
    background: #4a3520; display: flex; align-items: center; justify-content: center;
    font-size: 0.6rem; color: #e0c080; overflow: hidden; text-align: center; padding: 1px; box-sizing: border-box;
  }
  .bmap-cell.taken { background: #3a1f1f; cursor: not-allowed; }
  .bmap-cell.taken:hover { outline: 1px solid rgba(231,76,60,0.6); outline-offset: -1px; }
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
  .placement-token.staged { opacity: 0.85; }
  .placement-token.staged .placement-token-portrait { outline: 2px dashed #27ae60; outline-offset: 2px; border-radius: 6px; animation: placementPulse 1.1s ease-in-out infinite; }
  .placement-token.staged .placement-token-name { color: #27ae60; }
  @keyframes placementPulse { 0%, 100% { outline-color: #27ae60; } 50% { outline-color: rgba(39,174,96,0.3); } }
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
// The cell the player has clicked but not yet confirmed for the CURRENT
// placement-queue entry -- placement no longer locks in on click; clicking
// a cell only stages a preview (which can be changed by clicking elsewhere)
// until the confirm button is pressed. Reset to null on every queue advance.
let _stagedPosition = null; // {col, row} | null

// The pokemonKey (e.g. "pokemon3") for whichever party Pokémon this device
// chose during Setup -- remembered so the battle view can rebuild the same
// rich local combatant (full stat block, moves, items -- everything
// buildPokemonCombatant already knows how to compute from sessionStorage)
// on every re-render, the same way the legacy combat.js page does. Only
// meaningful for the current trainer's own cards; every other participant's
// card is a lightweight stand-in (see _syncLocalCombatState below).
let _myPokemonKey = null;

// ---------------------------------------------------------------------------
// Battle view -- once placement is done, the normal view renders combat.js's
// ACTUAL renderBattlePhase/attachBattleListeners (the full existing tool:
// click-to-expand cards, moves list, HP/VP/AC/stat adjusters, status
// effects, type calculator, inventory, trainer buffs, switching Pokémon --
// everything), operating on a *local mirror* of the shared session rather
// than the legacy page's own 'combatState' key (see setCombatStateKey/
// setOnCombatStateSave, both exported from combat.js specifically for this).
// This device's own combatants keep their full local object (recharge
// states, status effects, Stockpile stacks, expand state) across every
// server push; only HP/VP are kept in sync both directions -- pulled in
// from the server on every push, and pushed back up whenever combat.js's
// own engine changes them locally (VP cost of a move, Ingrain/direct/drain
// heals, manual adjusters). Everything else (status effects, recharge
// tracking, Stockpile) intentionally stays local-only for now, same
// boundary use-move's own docstring already draws server-side.
// ---------------------------------------------------------------------------
const WIP_COMBAT_STATE_KEY = 'wipCombatState';
let _battleSyncActive = false;
let _myParticipantIds = new Set();
let _lastSyncedStats = {}; // participantId -> {hp, vp} last pushed to the server, to dedupe redundant pushes

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
      <style>${WIP_CSS}</style>
      <div class="combat-wip-header-bar">
        <button class="combat-wip-back-btn" id="combatWipBackBtn">← Back</button>
        <div class="combat-wip-title" id="wipHeaderTitle"></div>
        <div id="wipHeaderEndBtn"></div>
      </div>
      <div class="combat-wip-layout">
        <div class="combat-wip-body" id="combatWipBody">${renderBody(session)}</div>
        <div class="combat-wip-turnorder" id="wipTurnOrder"></div>
      </div>
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
    level: c.level,
  };
}

function _enterBattleSync() {
  if (_battleSyncActive) return;
  _battleSyncActive = true;
  setCombatStateKey(WIP_COMBAT_STATE_KEY);
  setOnCombatStateSave(_onLocalCombatStateSave);
}

function _exitBattleSync() {
  _battleSyncActive = false;
  _myParticipantIds = new Set();
  _lastSyncedStats = {};
  _statsSyncInFlight = {};
  _statsSyncPending = {};
  setCombatStateKey('combatState');
  setOnCombatStateSave(null);
  _focusedParticipantId = null;
  _focusManuallySet = false;
}

/** combat.js's own battle engine (Ingrain/direct/drain heals, VP cost of
 * using a move, manual HP/VP adjusters -- everything that flows through
 * saveCombatState) only ever touches the local mirror. This is the other
 * half of the sync: whenever it changes one of OUR OWN combatants' HP/VP,
 * push the result up so every other client (and the display screen) sees
 * it too. Deduped against the last value actually sent so unrelated saves
 * (status effects, stat adjusters, isExpanded toggles) don't spam the
 * server with no-op requests. */
function _onLocalCombatStateSave(state) {
  state.combatants.forEach(c => {
    if (!_myParticipantIds.has(c.id)) return;
    const last = _lastSyncedStats[c.id];
    if (last && last.hp === c.currentHp && last.vp === c.currentVp) return;
    _lastSyncedStats[c.id] = { hp: c.currentHp, vp: c.currentVp };
    _pushStatsSync(c.id, c.currentHp, c.currentVp);
  });
}

// A rapid run of clicks (e.g. mashing the HP -1 button) fires several
// saveCombatState calls in the same tick, each wanting its own updateStats
// request -- with those as independent in-flight fetches, nothing
// guarantees they land at the server in the order they were sent, so a
// slow early request finishing last could silently overwrite a newer value
// with a stale one. This coalesces: at most one request in flight per
// participant at a time, with only the LATEST value queued behind it, so
// the value that ultimately reaches the server is always whatever this
// device's local state actually holds by the time the in-flight request
// clears -- never a stale intermediate one.
let _statsSyncInFlight = {}; // participantId -> true while a request is in flight
let _statsSyncPending = {}; // participantId -> {hp, vp} latest value waiting behind it

function _pushStatsSync(id, hp, vp) {
  if (_statsSyncInFlight[id]) {
    _statsSyncPending[id] = { hp, vp };
    return;
  }
  _statsSyncInFlight[id] = true;
  CombatAPI.updateStats(id, { currentHP: hp, currentVP: vp })
    .catch(() => {})
    .then(() => {
      _statsSyncInFlight[id] = false;
      const pending = _statsSyncPending[id];
      if (pending) {
        delete _statsSyncPending[id];
        _pushStatsSync(id, pending.hp, pending.vp);
      }
    });
}

/** Which sessionStorage pokemon_* key backs a participant this trainer
 * owns, by matching its name -- _myPokemonKey is set directly the moment
 * this device rolls initiative for it (see the initiative onComplete
 * handler below), but a page reload mid-battle loses that module var, so
 * this re-derives it from the party list the same way Setup does. */
function _resolveMyPokemonKey(participantName) {
  if (_myPokemonKey) return _myPokemonKey;
  for (const key of Object.keys(sessionStorage)) {
    if (!key.startsWith('pokemon_')) continue;
    const pData = JSON.parse(sessionStorage.getItem(key) || '[]');
    if ((pData[36] || pData[2]) === participantName) {
      _myPokemonKey = key;
      return key;
    }
  }
  return null;
}

/** Every field renderCombatCard/attachBattleListeners touch, filled with
 * safe placeholders -- a last-resort fallback for a participant this
 * trainer owns whose rich local object couldn't be resolved (e.g. right
 * after a page reload, if the name-matching fallback in
 * _resolveMyPokemonKey still comes up empty), so a lookup miss degrades to
 * a plain-looking card instead of throwing and blanking the battle view. */
function _standInCombatant(p) {
  return {
    id: p.id, name: p.name, image: p.image || 'assets/Pokeball.png',
    level: '?', types: [p.type1, p.type2].filter(Boolean),
    ac: '—', baseAc: '—', critMod: 0,
    currentHp: p.currentHP, maxHp: p.maxHP, currentVp: p.currentVP, maxVp: p.maxVP,
    str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0,
    strMod: 0, dexMod: 0, conMod: 0, intMod: 0, wisMod: 0, chaMod: 0,
    initiativeTotal: p.initiative ?? '—',
    statusEffects: [], isExpanded: false, hasStatBlock: false,
  };
}

/** Builds (first call) or merges (every subsequent server push) the local
 * mirror of the shared session that drives combat.js's actual
 * renderBattlePhase/attachBattleListeners -- deliberately restricted to
 * ONLY this trainer's own combatants (their trainer + their Pokémon), not
 * every participant. The user was explicit that this section is for
 * managing your own stuff, not for watching everyone else's stats -- that
 * information lives on the external display screen instead (see
 * display.js), and having it here too just eats space for no reason. Kept
 * combatants keep their FULL prior local object (recharge states, status
 * effects, Stockpile stacks, expand state) across pushes, with only HP/VP
 * overlaid fresh from the server both directions. */
function _syncLocalCombatState(session) {
  _enterBattleSync();

  const myName = _currentTrainerName();
  const existing = JSON.parse(sessionStorage.getItem(WIP_COMBAT_STATE_KEY) || 'null');
  const existingById = new Map((existing?.combatants || []).map(c => [c.id, c]));
  const myTrainerRich = myName ? buildTrainerCombatant() : null;

  _myParticipantIds = new Set();
  const activeId = session.reactingParticipantId || session.turnOrder[session.turnIndex];

  const combatants = session.turnOrder.map(id => {
    const p = session.participants[id];
    if (!p || !p.owner || p.owner !== myName) return null;

    _myParticipantIds.add(p.id);
    const prior = existingById.get(p.id);
    let merged, resolved = true;
    if (prior) {
      merged = { ...prior };
    } else if (myTrainerRich && p.name === myTrainerRich.name) {
      merged = { ...myTrainerRich };
    } else {
      const key = _resolveMyPokemonKey(p.name);
      if (key) {
        merged = { ...buildPokemonCombatant(key) };
      } else {
        merged = _standInCombatant(p);
        resolved = false;
      }
    }
    merged.id = p.id;
    merged.currentHp = p.currentHP; merged.maxHp = p.maxHP;
    merged.currentVp = p.currentVP; merged.maxVp = p.maxVP;
    if (resolved) merged.hasStatBlock = true;
    // This IS the server's current value -- prime the dedupe cache with it
    // so the very next local save (even one unrelated to HP/VP) doesn't
    // get misread as a new change and echoed straight back.
    _lastSyncedStats[p.id] = { hp: p.currentHP, vp: p.currentVP };
    return merged;
  }).filter(Boolean);

  // -1, not 0, when the active participant isn't one of mine -- so no card
  // in this now-own-only list is ever falsely highlighted as "your turn".
  const foundIdx = combatants.findIndex(c => c.id === activeId);
  const local = {
    phase: 'battle', round: session.round,
    activeTurnIndex: foundIdx,
    combatants,
    weather: existing?.weather || null, terrain: existing?.terrain || null,
  };
  sessionStorage.setItem(WIP_COMBAT_STATE_KEY, JSON.stringify(local));
  return local;
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
        <div class="placement-prompt">Click a cell to preview <strong>${current?.name || '…'}</strong>'s position, then confirm it.</div>
        <div class="placement-actions" id="placementActions"></div>
        <div class="placement-stage">
          <div class="placement-grid" id="placementGrid" style="${gridTemplateStyle(state.board)}">${gridCellsHtml(state.board, 'bmap-cell')}</div>
          <div class="placement-tokens" id="placementTokens"></div>
        </div>
      </div>
    </div>`;
}

/** A cell already holding a CONFIRMED token (anyone's -- a trainer and
 * their own Pokémon can't share a square either), or another participant's
 * CURRENT hover/staging preview, can't be picked. `currentId`'s own
 * hover echo (the server broadcasts your own hover-token calls back to
 * you too) is excluded, same as the ghost-rendering below already did. */
function _isCellTaken(state, col, row, currentId) {
  const occupied = Object.entries(state.board.tokens)
    .some(([id, pos]) => pos.col === col && pos.row === row && id !== currentId);
  if (occupied) return true;
  return Object.entries(_hoverGhosts)
    .some(([id, pos]) => pos && id !== currentId && pos.col === col && pos.row === row);
}

function _renderPlacementActions(currentId) {
  const el = document.getElementById('placementActions');
  if (!el) return;
  el.innerHTML = _stagedPosition
    ? `<button class="placement-confirm-btn" id="placementConfirmBtn">✅ Confirm Placement</button>`
    : '';
}

function _refreshCellTakenStates(state, currentId) {
  const gridEl = document.getElementById('placementGrid');
  if (!gridEl) return;
  gridEl.querySelectorAll('[data-cell]').forEach(cell => {
    const [col, row] = cell.dataset.cell.split(',').map(Number);
    cell.classList.toggle('taken', _isCellTaken(state, col, row, currentId));
  });
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

  if (_stagedPosition) {
    const current = state.participants[currentId];
    if (current) {
      const name = visibleToViewer(current, 'name') ? current.name : '???';
      const rect = cellRect(state.board, _stagedPosition.col, _stagedPosition.row);
      html.push(`
        <div class="placement-token staged ${current.side}" style="left:${rect.left};top:${rect.top};width:${rect.width};height:${rect.height};">
          <div class="placement-token-portrait" data-portrait-id="${currentId}"></div>
          <div class="placement-token-name">${name}</div>
        </div>`);
    }
  }

  layer.innerHTML = html.join('');

  layer.querySelectorAll('[data-portrait-id]').forEach(el => {
    const p = state.participants[el.dataset.portraitId];
    if (p) patchPortraitMedia(el, p.image, p.name);
  });
}

function attachPlacementListeners(state, currentId) {
  _stagedPosition = null;
  _renderPlacementActions(currentId);
  _renderPlacementTokens(state, currentId);
  _refreshCellTakenStates(state, currentId);

  const gridEl = document.getElementById('placementGrid');
  if (!gridEl) return;

  gridEl.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-cell]');
    if (!cell || cell.classList.contains('taken')) return;
    const [col, row] = cell.dataset.cell.split(',').map(Number);
    _stagedPosition = { col, row };
    CombatAPI.hoverToken(currentId, col, row).catch(() => {}); // sticky reservation preview for other placers
    _renderPlacementActions(currentId);
    _renderPlacementTokens(session, currentId);
    _refreshCellTakenStates(session, currentId);
  });

  document.getElementById('placementActions')?.addEventListener('click', async (e) => {
    if (!e.target.closest('#placementConfirmBtn') || !_stagedPosition) return;
    const { col, row } = _stagedPosition;
    try {
      await CombatAPI.confirmPlacement(currentId, col, row);
    } catch (err) {
      alert(err.message);
      // Someone else likely just took it -- drop the stale preview and let
      // the next server push (which will include their now-confirmed
      // token) redraw the grid so the real occupancy is visible again.
      _stagedPosition = null;
      _renderPlacementActions(currentId);
      _renderPlacementTokens(session, currentId);
      _refreshCellTakenStates(session, currentId);
      return;
    }
    CombatAPI.hoverToken(currentId).catch(() => {}); // clear our own hover reservation for others
    _stagedPosition = null;
    _placementQueue.shift();
    if (!_placementQueue.length) _joinStage = null;
    _rerenderFull();
  });

  gridEl.addEventListener('mousemove', (e) => {
    if (_stagedPosition) return; // reservation now sticks to the staged cell, not the raw cursor
    const cell = e.target.closest('[data-cell]');
    if (!cell) return;
    if (_hoverThrottle) return;
    _hoverThrottle = setTimeout(() => { _hoverThrottle = null; }, 150);
    const [col, row] = cell.dataset.cell.split(',').map(Number);
    CombatAPI.hoverToken(currentId, col, row).catch(() => {});
  });

  gridEl.addEventListener('mouseleave', () => {
    if (_stagedPosition) return; // still reserved until confirmed or restaged elsewhere
    CombatAPI.hoverToken(currentId).catch(() => {});
  });

  if (_placementHoverHandler) window.removeEventListener('app:combat-hover', _placementHoverHandler);
  _placementHoverHandler = (e) => {
    const { participantId, col, row } = e.detail;
    _hoverGhosts[participantId] = (col === null || col === undefined) ? null : { col, row };
    if (_joinStage === 'placement') {
      _renderPlacementTokens(session, _placementQueue[0]);
      _refreshCellTakenStates(session, _placementQueue[0]);
    }
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

  return `
    <div class="combat-wip-round-bar" id="wipRoundBar">${_renderRoundBar(state)}</div>

    ${state.battleType === 'pve' ? `
    <div class="combat-wip-section-label">Add Freeform Enemy (DM-controlled)</div>
    <form class="combat-wip-add-form" id="addParticipantForm">
      <input type="text" name="name" placeholder="Name" required>
      <select name="status">
        <option value="participating">Participating</option>
        <option value="spectating">Spectating</option>
      </select>
      <input type="number" name="level" placeholder="Lv" min="1" style="width:56px;">
      <input type="number" name="maxHP" placeholder="HP" value="20" min="0">
      <input type="number" name="maxVP" placeholder="VP" value="10" min="0">
      <input type="text" name="type1" placeholder="Type 1 (optional)" style="width:110px;">
      <input type="text" name="type2" placeholder="Type 2 (optional)" style="width:110px;">
      <button type="submit" class="combat-wip-btn-primary">Add</button>
    </form>` : ''}

    <div id="wipBattlePhase">${_renderMainFocusHtml(state)}</div>`;
}

// Round/turn-order tracking, the reacting-participant note, and the
// per-user Advance Turn gate all used to live here as text/buttons -- all
// removed per explicit direction: the sidebar already shows turn order and
// who's active/reacting at a glance, and End Turn (on the focused card,
// see below) already covers ending a turn, so a separate Advance Turn
// button is redundant. Only the Battle Map button is left.
function _renderRoundBar(state) {
  return `<button class="combat-wip-btn-secondary" id="battleMapBtn">🗺️ Battle Map</button>`;
}

function _attachRoundBarListeners() {
  document.getElementById('battleMapBtn')?.addEventListener('click', () => {
    showBattleMap(session, _currentTrainerName());
  });
}

/** Header title ("PvP Combat"/"PvE Combat", based on the active session's
 * battleType) and the End Battle button (renamed from End Session, moved
 * here from the round bar) -- both live outside #combatWipBody, so unlike
 * everything the SSE fast path patches, these need their own explicit
 * refresh call wherever `session` changes. */
function _syncHeaderBar(state) {
  const titleEl = document.getElementById('wipHeaderTitle');
  if (titleEl) {
    titleEl.textContent = !state?.active ? '⚔️ Combat' : `⚔️ ${state.battleType === 'pvp' ? 'PvP' : 'PvE'} Combat`;
  }
  const endBtnEl = document.getElementById('wipHeaderEndBtn');
  if (endBtnEl) {
    endBtnEl.innerHTML = state?.active ? '<button class="combat-wip-btn-danger" id="endSessionBtn">End Battle</button>' : '';
    document.getElementById('endSessionBtn')?.addEventListener('click', async () => {
      await CombatAPI.endSession();
    });
  }
}

// ---------------------------------------------------------------------------
// Turn-order sidebar -- a compact column, in turn order, of every
// participant's portrait (including DM-controlled enemies in PvE), the
// current turn/reaction holder framed in gold, a reaction-availability bolt
// per portrait, and a lighter blue frame on whichever one is currently
// FOCUSED (see below). Clicking a portrait sets focus to it; portraits are
// patched in place (never rebuilt wholesale) the same way display.js's own
// strip is, so an mp4 sprite's playback isn't restarted by an unrelated push.
// ---------------------------------------------------------------------------

function _syncTurnOrderSidebar(state) {
  const el = document.getElementById('wipTurnOrder');
  if (!el) return;

  if (!state || !state.active) {
    el.innerHTML = '';
    return;
  }

  const activeId = state.reactingParticipantId || state.turnOrder[state.turnIndex];
  const focusId = _resolveFocusId(state);
  const orderedIds = [
    ...state.turnOrder,
    ...Object.keys(state.participants).filter(id => !state.turnOrder.includes(id)),
  ];

  const liveIds = new Set(Object.keys(state.participants));
  [...el.children].forEach(node => { if (!liveIds.has(node.dataset.id)) node.remove(); });

  orderedIds.forEach((id, index) => {
    const p = state.participants[id];
    if (!p) return;

    let node = el.querySelector(`[data-id="${id}"]`);
    if (!node) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = `
        <div class="wip-turn-item" data-id="${id}">
          <div class="wip-turn-portrait">
            <div class="wip-turn-portrait-media" data-portrait-id="${id}"></div>
            <div class="wip-turn-reaction"></div>
          </div>
          <div class="wip-turn-name"></div>
        </div>`;
      node = wrapper.firstElementChild;
      node.addEventListener('click', () => _setFocus(id));
    }

    const showName = visibleToViewer(p, 'name');
    const name = showName ? p.name : '???';
    node.className = ['wip-turn-item',
      id === activeId ? 'active' : '',
      id === focusId ? 'focused' : '',
      p.status === 'spectating' ? 'spectating' : ''].filter(Boolean).join(' ');
    node.querySelector('.wip-turn-name').textContent = name;
    patchPortraitMedia(node.querySelector('[data-portrait-id]'), p.image, name);

    const reactionEl = node.querySelector('.wip-turn-reaction');
    reactionEl.textContent = p.status === 'participating' ? '⚡' : '';
    reactionEl.classList.toggle('used', !!p.reactionUsed);

    if (el.children[index] !== node) el.insertBefore(node, el.children[index] || null);
  });
}

function _setFocus(id) {
  if (_focusManuallySet && _focusedParticipantId === id) return; // already focused, no-op
  _focusedParticipantId = id;
  _focusManuallySet = true;
  _syncMainFocus(session);
  _syncTurnOrderSidebar(session); // refresh the .focused highlight
}

// ---------------------------------------------------------------------------
// Main focus area -- replaces the old "show every owned combatant's card"
// approach: exactly ONE participant is shown at a time, big and (for the
// viewer's own) always fully expanded, chosen either by clicking a sidebar
// portrait (sticky until clicked elsewhere) or, absent that, defaulting to
// whichever of the viewer's own combatants is earliest in turn order. Own
// combatant -> combat.js's real card, single-entry so there's nothing left
// to collapse, with React taking over the footer slot End Turn normally
// sits in and End Turn itself moved below the moves section instead (both
// via renderCombatCard's additive options). Anyone else's -> just the
// read-only basics (name/type/HP/VP/level), no card, no actions.
// ---------------------------------------------------------------------------

let _focusedParticipantId = null;
let _focusManuallySet = false;

function _getDefaultFocusId(state) {
  const myName = _currentTrainerName();
  return state.turnOrder.find(id => state.participants[id]?.owner === myName) || null;
}

function _resolveFocusId(state) {
  if (_focusManuallySet && state.participants[_focusedParticipantId]) return _focusedParticipantId;
  const def = _getDefaultFocusId(state);
  _focusedParticipantId = def; // keep in sync for the sidebar's .focused highlight even in auto mode
  return def;
}

/** Everything both rendering and attaching need, computed once so they
 * don't independently re-derive (and potentially disagree on) the same
 * focus/eligibility logic. Returns null when there's nothing to focus on
 * yet (no participants at all). */
function _computeFocusContext(state) {
  const focusId = _resolveFocusId(state);
  const p = focusId ? state.participants[focusId] : null;
  if (!p) return null;

  const myName = _currentTrainerName();
  if (p.owner !== myName) return { p, isMine: false };

  const merged = _syncLocalCombatState(state); // full mirror of ALL my own combatants, for continuity
  const focused = merged.combatants.find(c => c.id === focusId);
  if (!focused) return { p, isMine: false }; // couldn't resolve the rich object -- degrade to basic info rather than crash

  focused.isExpanded = true; // always uncollapsed -- there's only ever one shown at a time now
  const activeId = state.reactingParticipantId || state.turnOrder[state.turnIndex];
  const filteredState = { ...merged, combatants: [focused], activeTurnIndex: focused.id === activeId ? 0 : -1 };
  const canReact = p.status === 'participating' && !p.reactionUsed &&
    !state.reactingParticipantId && p.id !== state.turnOrder[state.turnIndex];
  const cardOptions = { showReactButton: true, canReact, endTurnAtBottom: true };
  return { p, isMine: true, filteredState, cardOptions };
}

function _renderForeignFocusInfo(p) {
  const showName = visibleToViewer(p, 'name');
  const showHp = visibleToViewer(p, 'hp');
  const showVp = visibleToViewer(p, 'vp');
  const typesText = [p.type1, p.type2].filter(Boolean).join(' / ');
  return `
    <div class="wip-foreign-focus">
      <div class="wip-foreign-focus-name">${showName ? p.name : '???'}</div>
      ${typesText ? `<div class="wip-foreign-focus-row">${typesText}</div>` : ''}
      ${p.level ? `<div class="wip-foreign-focus-row">Level ${p.level}</div>` : ''}
      ${showHp ? `<div class="wip-foreign-focus-row">HP: ${p.currentHP}/${p.maxHP}</div>` : ''}
      ${showVp ? `<div class="wip-foreign-focus-row">VP: ${p.currentVP}/${p.maxVP}</div>` : ''}
    </div>`;
}

/** Builds the #wipBattlePhase HTML string -- used before the DOM exists
 * (renderBody, for the initial page-shell string). See _attachMainFocusListeners
 * for the matching post-insertion attach step, and _syncMainFocus for every
 * subsequent update once the DOM already exists. */
function _renderMainFocusHtml(state) {
  const ctx = _computeFocusContext(state);
  if (!ctx) return '<div class="combat-wip-empty"><p style="color:#a0a0c0;">No participants yet.</p></div>';
  if (!ctx.isMine) return _renderForeignFocusInfo(ctx.p);
  return renderBattlePhase(ctx.filteredState, ctx.cardOptions);
}

function _attachMainFocusListeners(state) {
  const ctx = _computeFocusContext(state);
  if (!ctx || !ctx.isMine) return;

  attachBattleListeners(ctx.filteredState, { onDamageResolved: _handleDamageResolved, ...ctx.cardOptions });

  document.getElementById('battleList')?.addEventListener('click', (e) => {
    const reactBtn = e.target.closest('.wip-react-btn');
    if (reactBtn) {
      if (!reactBtn.disabled) CombatAPI.reactionStart(reactBtn.dataset.combatantId).catch(err => alert(err.message));
      return;
    }
    // The one extra thing this shared context needs on top of combat.js's
    // own End Turn handling: actually move the SERVER's turn pointer so
    // every other client agrees who's up, not just a local-only index.
    // This listens alongside (not instead of) attachBattleListeners' own
    // handling of the same click -- both fire, no conflict. Reacting vs.
    // a normal turn both resolve to this same button (see
    // _computeFocusContext's activeTurnIndex), so it has to mean "give up
    // the floor" either way: reactionEnd while reacting, advanceTurn otherwise.
    if (!e.target.closest('.end-turn-btn')) return;
    if (session.reactingParticipantId) {
      CombatAPI.reactionEnd().catch(() => {});
    } else {
      CombatAPI.advanceTurn().catch(() => {});
    }
  });
}

/** Updates #wipBattlePhase once the DOM already exists -- used by both the
 * SSE push handler and a sidebar click (focus never changes from a server
 * push, only a click, so either caller can safely assume "same context
 * shape as last render" and take the cheap already-attached path when it
 * applies). Patches combat.js's card in place (preserving any open popup --
 * move details, inventory...) when already showing the engine for this same
 * participant; otherwise (first entry, or focus just switched to/from a
 * foreign participant) replaces the whole region and reattaches. */
function _syncMainFocus(state) {
  const el = document.getElementById('wipBattlePhase');
  if (!el) return;
  const ctx = _computeFocusContext(state);
  if (!ctx) { el.innerHTML = '<div class="combat-wip-empty"><p style="color:#a0a0c0;">No participants yet.</p></div>'; return; }
  if (!ctx.isMine) { el.innerHTML = _renderForeignFocusInfo(ctx.p); return; }
  if (document.getElementById('battleList')) {
    setBattleCardOptions(ctx.cardOptions);
    rerenderBattle(ctx.filteredState);
  } else {
    el.innerHTML = renderBattlePhase(ctx.filteredState, ctx.cardOptions);
    _attachMainFocusListeners(state);
  }
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
      if (_placementQueue.length) {
        _renderPlacementTokens(session, _placementQueue[0]);
        _refreshCellTakenStates(session, _placementQueue[0]);
      }
      return;
    }
    if (_joinStage) return;

    // Not already mid-join-flow, but the fresh session says this trainer
    // needs to join (e.g. this device just created the session, or a
    // session just went active) -- switch into the join flow rather than
    // patching the normal-view body with something that no longer applies.
    if (session.active && _needsToJoin(session)) {
      _exitBattleSync();
      _rerenderFull();
      return;
    }

    if (!session.active) _exitBattleSync();

    if (session.active && document.getElementById('wipBattlePhase')) {
      // Fast path: patch things in place rather than replacing the whole
      // body -- _syncMainFocus already knows how to do this correctly for
      // BOTH cases (the viewer's own combatant, preserving any open popup
      // like move details/inventory, or someone else's read-only info).
      _syncMainFocus(session);

      const roundBar = document.getElementById('wipRoundBar');
      if (roundBar) { roundBar.innerHTML = _renderRoundBar(session); _attachRoundBarListeners(); }

      _syncTurnOrderSidebar(session);
      _syncHeaderBar(session);
      updateBattleMap(session);
      return;
    }

    const body = document.getElementById('combatWipBody');
    if (body) body.innerHTML = renderBody(session);
    attachBodyListeners();
    _syncTurnOrderSidebar(session);
    _syncHeaderBar(session);
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
    _exitBattleSync();
    window.dispatchEvent(new CustomEvent('navigate', { detail: { route: 'combat' } }));
  });

  attachBodyListeners();
}

function attachBodyListeners() {
  document.getElementById('createSessionBtn')?.addEventListener('click', async () => {
    const battleType = document.querySelector('input[name="battleType"]:checked')?.value || 'pve';
    await CombatAPI.createSession(battleType);
  });

  if (!session || !session.active) return; // empty-state view has nothing else to wire

  _attachRoundBarListeners();

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
      level: data.get('level') ? parseInt(data.get('level'), 10) : undefined,
      maxHP, currentHP: maxHP,
      maxVP, currentVP: maxVP,
      type1: data.get('type1') || '',
      type2: data.get('type2') || '',
    });
    form.reset();
  });

  // combat.js's own battle engine (move list, HP/VP/AC/stat adjusters,
  // status effects, type calculator, inventory, trainer buffs, switching
  // Pokémon -- everything) for whichever single participant currently has
  // focus, if it's one of the viewer's own -- see _attachMainFocusListeners.
  _attachMainFocusListeners(session);

  _syncTurnOrderSidebar(session);
  _syncHeaderBar(session);
}

/** Wired into combat.js's move-popup flow as onDamageResolved (see
 * attachBattleListeners above) -- fires right after the player confirms an
 * offensive move (combat.js has already handled that move's own VP cost
 * and local special-case mechanics by this point, synced up via
 * updateStats). This is the OTHER half: pick who it hit, roll the damage
 * dice, and resolve it server-side. computedData.damageBonus is the exact
 * modifier combat.js's move popup just showed the player, so it's added to
 * their raw table roll here client-side, before sending the combined total
 * up -- apply-damage on the server only ever applies type effectiveness on
 * top of whatever number it's given, it doesn't know about ability/STAB/
 * proficiency modifiers itself. */
async function _handleDamageResolved({ combatantId, moveName, move, computedData }) {
  const targetId = await pickTarget(combatantId);
  if (!targetId) return; // "no target" / closed -- move's own cost still applied, nothing more to do

  const modifier = computedData.damageBonus || 0;
  const rollStr = prompt(
    `Raw dice roll for ${moveName} (the ${modifier >= 0 ? '+' : ''}${modifier} modifier is added automatically):`
  );
  if (!rollStr) return;
  const rawRoll = parseInt(rollStr, 10);
  if (Number.isNaN(rawRoll)) return;

  const moveType = (move && move[1]) || '';
  try {
    const result = await CombatAPI.applyDamage(combatantId, targetId, rawRoll + modifier, moveType, moveName);
    if (result.multiplier !== undefined) {
      const label = result.multiplier >= 2 ? 'Super effective!' : result.multiplier === 0 ? 'No effect!' : result.multiplier < 1 ? 'Not very effective...' : '';
      alert(`${label ? label + ' — ' : ''}${result.multiplier}× effectiveness -- ${result.damageApplied} damage applied`);
    }
  } catch (err) {
    alert(err.message);
  }
}

function _currentTrainerName() {
  const trainerData = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
  return trainerData[1] || '';
}
