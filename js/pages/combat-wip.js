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
import { CombatAPI, PokemonAPI, TrainerAPI } from '../api.js';
import { pickTarget, pickTargetAgain } from '../utils/target-picker.js';
import { pickSaveTarget, confirmSecondarySave, pickManualSaveTarget } from '../utils/save-picker.js';
import { pickMultipleTargets } from '../utils/multi-target-picker.js';
import { computeMoveDC, bestMoveStatModifier } from '../utils/pokemon-types.js';
import { showBattleMap, updateBattleMap } from '../utils/battle-map-popup.js';
import { gridCellsHtml, gridTemplateStyle, cellRect, footprintForSize, footprintCells } from '../utils/battle-map-grid.js';
import { patchPortraitMedia, prefetchSprite } from '../utils/sprite-media.js';
import { visibleToViewer } from '../utils/combat-visibility.js';
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import { showBattleLog, updateBattleLog } from '../utils/battle-log-popup.js';
import { showEffectsPopup } from '../utils/effects-popup.js';
import { showReactionPromptIfEligible } from '../utils/reaction-prompt-popup.js';
import { waitForDamagedReactions } from '../utils/reaction-wait-overlay.js';
import { promptRerollDamage } from '../utils/reroll-damage-popup.js';
import { promptHealRoll } from '../utils/heal-popup.js';
import { showStatusDetail } from '../utils/status-popup.js';
import { createBaseStatSync } from '../utils/stat-sync.js';
import { evaluateEffect, buildStatusSpec, critThreshold, statusLabel, describeStatusEnds, pendingTurnSaves, pendingTurnHeals, statDeltas, statSetOverrides, reapplyStatDeltas, effectiveStats, isConcentration, guaranteedCritStatusId, tempHpRemaining } from '../utils/move-effects.js';
import {
  renderSetupPhase, attachSetupListeners,
  renderInitiativePhase, attachInitiativeListeners,
  buildTrainerCombatant, buildPokemonCombatant,
  renderBattlePhase, attachBattleListeners, rerenderBattle, setBattleCardOptions, renderCombatCard,
  setCombatStateKey, setOnCombatStateSave, setOnLogEvent, moveCategoriesFor, moveEffectsFor, findMoveRow,
  buildKnownMovesString,
} from './combat.js';

const WIP_CSS = `
  /* Breaks out of the SPA shell's own centered/padded ".app" container
     (max-width:1400px, padding:20px on every side, both on top of a dark
     red body background) so this page's own background actually reaches
     every edge of the viewport instead of leaving a red band around it
     regardless of nesting depth -- the width:100vw + negative-margin pair
     is relative to the viewport, not the parent, which is what makes that
     possible here. The top/bottom -20px margins are the same trick applied
     to .app's *vertical* padding, which the horizontal-only version of this
     left uncovered (min-height:100vh alone only guarantees this fills the
     viewport, not that it also eats into the padding around it). */
  .combat-wip-page {
    min-height: 100vh; background: #14141f; color: #e0e0e0; font-family: inherit;
    width: 100vw; margin-left: calc(50% - 50vw); margin-right: calc(50% - 50vw);
    margin-top: -20px; margin-bottom: -20px;
    overflow-x: hidden; /* 100vw can run a few px wider than the true scrollbar-adjusted
      viewport -- clip that sliver instead of letting it show as a stray offset/scrollbar */
  }
  .combat-wip-header-bar {
    position: relative; display: flex; align-items: center; justify-content: space-between;
    padding: 0.75rem 1rem; background: rgba(0,0,0,0.3); border-bottom: 1px solid rgba(255,255,255,0.1);
  }
  /* Absolutely positioned (out of the flex flow) so it sits dead-center on
     the bar regardless of the Map button and End Battle button either side
     being different widths -- justify-content:space-between alone would
     only center it when both side items happen to match in width. */
  .combat-wip-title {
    position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
    display: flex; align-items: center; gap: 0.4rem;
    font-size: 1.2rem; font-weight: 700; color: #FFD700; text-transform: uppercase; letter-spacing: 1px;
    white-space: nowrap;
  }
  .combat-wip-title img { height: 1.6em; width: auto; }
  .wip-map-btn, .wip-log-btn { font-size: 0.9rem; letter-spacing: 0.3px; }
  .wip-header-btn-group { display: flex; gap: 0.5rem; }
  /* The turn order is a strip ABOVE the info box, not a column beside it, so
     on a phone the info box gets the full width instead of what's left after
     the portraits. The portraits wrap onto extra rows once there are more
     than fit on one line, which keeps every participant visible. */
  .combat-wip-layout { display: flex; flex-direction: column; align-items: center; padding: 0 1rem; }
  .combat-wip-body { width: 100%; max-width: 700px; min-width: 0; padding: 1.5rem 0 3rem; }
  .combat-wip-turnorder {
    display: flex; flex-flow: row wrap; justify-content: center; gap: 0.6rem 0.5rem;
    width: 100%; max-width: 700px; padding: 0.75rem 0 0;
  }
  /* No participants yet (empty/setup screen) leaves this with zero
     children -- collapse it instead of still reserving its padding above
     nothing. */
  .combat-wip-turnorder:empty { display: none; }
  .wip-turn-item { display: flex; flex-direction: column; align-items: center; cursor: pointer; }
  .wip-turn-portrait {
    position: relative; width: 42px; height: 42px;
    background: rgba(255,255,255,0.05); border: 2px solid transparent; box-sizing: border-box;
  }
  .wip-turn-item.focused .wip-turn-portrait { border-color: #5dade2; }
  .wip-turn-item.active .wip-turn-portrait { border-color: #FFD700; box-shadow: 0 0 5px rgba(255,215,0,0.5); }
  .wip-turn-item.spectating { opacity: 0.4; }
  /* border-radius/overflow live here (not on .wip-turn-portrait) so the
     reaction dot(s) below can sit fully outside the portrait's edge instead
     of being clipped into its corner. */
  .wip-turn-portrait-media { width: 100%; height: 100%; border-radius: 6px; overflow: hidden; }
  .wip-turn-portrait-media img, .wip-turn-portrait-media video { width: 100%; height: 100%; object-fit: contain; }
  /* One dot per available reaction, sitting on the portrait's top-right
     corner (partly outside it, not clipped into it) so a boss with multiple
     reactions can just get more .wip-turn-reaction-dot children here later --
     they grow leftwards from the corner. (Beside the portrait, as it was in
     the old vertical column, it would land on the neighbouring portrait in
     this horizontal strip.) Green = available, grey = used/unavailable. */
  .wip-turn-reaction {
    position: absolute; top: -4px; right: -4px;
    display: flex; flex-direction: row; align-items: center; gap: 3px;
  }
  .wip-turn-reaction-dot {
    width: 9px; height: 9px; border-radius: 50%; background: #2ecc71; box-shadow: 0 0 0 2px #14141f;
  }
  .wip-turn-reaction.used .wip-turn-reaction-dot { background: #6b6b6b; }
  /* How many live effects (conditions, stat changes, advantage...) this participant has,
     on the portrait's bottom-right corner -- hidden at zero. */
  .wip-turn-status-count {
    position: absolute; bottom: -4px; right: -4px; min-width: 14px; height: 14px; padding: 0 3px; box-sizing: border-box;
    border-radius: 7px; background: #9b59b6; color: #fff; font-size: 0.6rem; font-weight: 700; line-height: 14px;
    text-align: center; box-shadow: 0 0 0 2px #14141f;
  }
  .wip-turn-name {
    font-size: 0.55rem; font-weight: 600; margin-top: 0.15rem; text-align: center;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 42px;
  }
  /* The single focused card's Reaction button -- sits in the name row, to
     the right of the type badges (see renderCombatCard's compactWip
     option), which is also where Init used to be (moved into the mods row
     instead) and where End Turn used to be (moved below the moves section,
     see the same option's endTurnAtBottom). */
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
  .wip-foreign-focus-statuses { display: flex; flex-wrap: wrap; gap: 0.3rem; justify-content: center; margin-top: 0.6rem; }
  .wip-foreign-focus-statuses .status-badge { cursor: pointer; }
  .wip-foreign-focus-portrait { width: 140px; height: 140px; margin: 0 auto 0.8rem; }
  .wip-foreign-focus-portrait img, .wip-foreign-focus-portrait video { width: 100%; height: 100%; object-fit: contain; }
  /* Centered both ways within the viewport, not just horizontally --
     min-height keeps it clear of the header/footer chrome so a short
     "Battle Mode" panel doesn't just sit pinned to the top of a tall page. */
  .combat-wip-empty {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 60vh; text-align: center; padding: 3rem 1rem;
  }
  .combat-wip-empty h2 { color: #FFD700; margin-bottom: 1.25rem; }
  /* _renderJoinOrSpectateChoice's own top bar -- that screen bypasses the shared
     header entirely (no session-in-progress chrome makes sense before a decision
     is even made), so its one way out gets its own minimal strip instead. */
  .combat-wip-join-choice-topbar { padding: 0.8rem 1rem 0; }
  .combat-wip-btn-primary, .combat-wip-btn-danger, .combat-wip-btn-secondary {
    border: none; border-radius: 6px; padding: 0.6rem 1.2rem; font-size: 0.95rem;
    font-weight: 600; cursor: pointer; color: #fff;
  }
  .combat-wip-btn-primary { background: linear-gradient(135deg, #27ae60, #1e8449); }
  .combat-wip-btn-danger { background: linear-gradient(135deg, #c0392b, #922b21); }
  .combat-wip-btn-secondary { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); }
  .combat-wip-battle-type-choice {
    display: flex; flex-direction: row; gap: 1rem; max-width: 420px; margin: 0 auto 1.5rem;
  }
  .combat-wip-battle-type-choice label {
    flex: 1; display: flex; align-items: center; justify-content: center;
    background: rgba(255,255,255,0.05); border: 2px solid transparent; border-radius: 12px;
    padding: 1.8rem 0.75rem; cursor: pointer; font-size: 1.4rem; font-weight: 700;
    transition: border-color 0.15s, background-color 0.15s, color 0.15s;
  }
  /* Native radio hidden but still present (and still keyboard-focusable/
     tabbable) -- the label itself is the visible button, highlighted via
     :has() rather than needing separate JS to toggle a "selected" class. */
  .combat-wip-battle-type-choice input { position: absolute; opacity: 0; width: 0; height: 0; }
  .combat-wip-battle-type-choice label:has(input:checked) {
    border-color: #FFD700; background: rgba(255,215,0,0.12); color: #FFD700;
  }
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
  /* Weather/Terrain -- explicitly parked for now, destination undecided. */
  #wipBattlePhase .combat-global-bar { display: none; }
  /* With that header and global bar both gone, .combat-page's own
     min-height:100vh (sized for the legacy page's full turn-order list)
     just leaves a lot of empty space below the one card now shown here --
     and its padding-top:3.5rem (there to clear its own now-hidden *fixed*
     header bar) leaves a big band of its burgundy background above the
     card instead, so both get zeroed here. */
  #wipBattlePhase .combat-page { min-height: 0; padding-top: 0; }
  .combat-wip-body { padding: 0.75rem 0 1.5rem; }
  /* A bit more room for the single focused card's portrait -- there's
     nothing else competing for that space anymore. */
  #wipBattlePhase .combat-card-img { width: 100px; height: 100px; }
  /* A PvP opponent's read-only card (see _renderForeignFocusFull) reuses
     combat.js's own card styling wholesale -- centered and width-capped like
     the old minimal .wip-foreign-focus panel it replaces, rather than
     stretching edge to edge the way the viewer's own (always the sole card
     shown) does. */
  .wip-foreign-focus-full { max-width: 420px; margin: 0 auto; }
  /* Damage/HP-VP Calculator stacks below the HP+VP rows instead of beside
     them (its own single-line text, set by the same compactWip option,
     needs the extra width that frees up). */
  #wipBattlePhase .hpvp-hpvp-left--stacked { flex-direction: column; align-items: stretch; }
  /* End Turn, moved below the moves section by the same option, centered
     rather than left-aligned like a plain block-level button defaults to. */
  #wipBattlePhase .combat-end-turn-bottom { display: block; width: fit-content; margin: 0.7rem auto 0.9rem; }
`;

// Reuses .bmap-cell/.bmap-token's exact rules from battle-map-popup.js (same
// class names, same properties) so the placement screen looks like the same
// map surface the popup and kiosk screen show -- defined again here (rather
// than only relying on battle-map-popup.js's injected <head> styles) so this
// page works even if that popup has never been opened yet this session.
const PLACEMENT_CSS = `
  .placement-page { min-height: 100vh; background: #14141f; color: #e0e0e0; font-family: inherit; }
  .placement-header-bar {
    position: relative; display: flex; align-items: center; justify-content: center;
    padding: 0.75rem 1rem; background: rgba(0,0,0,0.3); border-bottom: 1px solid rgba(255,255,255,0.1);
  }
  .placement-back-btn {
    position: absolute; left: 1rem; top: 50%; transform: translateY(-50%);
    background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #e0e0e0;
    border-radius: 6px; padding: 0.4rem 0.8rem; font-size: 0.85rem; font-weight: 600; cursor: pointer;
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
  /* aspect-ratio is set inline from the board's own cols/rows (see
     renderPlacementPhase) so cells stay square for whatever grid size is
     actually set, not just the default -- see .bmap-stage's own comment in
     battle-map-popup.js for the same reasoning. */
  .placement-stage { position: relative; width: 100%; background: #0a0a12; border-radius: 8px; overflow: hidden; background-size: cover; background-position: center; }
  .placement-grid { position: absolute; inset: 0; display: grid; gap: 2px; background: #1a1a24; }
  .placement-stage.has-bg .placement-grid { background: rgba(26,26,36,0.35); }
  .bmap-cell { background: #20202e; cursor: pointer; }
  .placement-stage.has-bg .bmap-cell { background: rgba(32,32,46,0.35); }
  .bmap-cell:hover { outline: 1px solid rgba(255,215,0,0.5); outline-offset: -1px; }
  .bmap-cell.marked {
    background: #4a3520; display: flex; align-items: center; justify-content: center;
    font-size: 0.6rem; color: #e0c080; overflow: hidden; text-align: center; padding: 1px; box-sizing: border-box;
  }
  .bmap-cell.taken { background: #3a1f1f; cursor: not-allowed; }
  .bmap-cell.taken:hover { outline: 1px solid rgba(231,76,60,0.6); outline-offset: -1px; }
  .placement-bg-picker { margin-top: 1rem; text-align: center; }
  .placement-bg-picker label { display: block; font-size: 0.8rem; color: #a0a0c0; margin-bottom: 0.4rem; }
  .placement-bg-picker select {
    background: #1e1e2e; border: 1px solid rgba(255,255,255,0.2); color: #e0e0e0;
    border-radius: 6px; padding: 0.5rem 0.7rem; font-size: 0.9rem; min-width: 200px;
  }
  .placement-grid-size-row { display: flex; align-items: center; justify-content: center; gap: 0.4rem; }
  .placement-grid-size-row input {
    background: #1e1e2e; border: 1px solid rgba(255,255,255,0.2); color: #e0e0e0;
    border-radius: 6px; padding: 0.4rem 0.5rem; font-size: 0.9rem; text-align: center;
  }
  .placement-grid-size-row span { color: #a0a0c0; }
  .placement-grid-size-row button {
    background: linear-gradient(135deg, #8e44ad, #5b2c6f); border: none; color: #fff;
    border-radius: 6px; padding: 0.4rem 0.8rem; font-size: 0.85rem; font-weight: 600; cursor: pointer;
  }
  .placement-tokens { position: absolute; inset: 0; pointer-events: none; }
  .placement-token {
    position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 3px; box-sizing: border-box;
  }
  /* Portrait fills the whole footprint now that there's no name label to
     leave room for -- side, previously conveyed by the name's text color,
     moves to an outline on the portrait itself instead (name's still
     available as a title tooltip, see _renderPlacementTokens). */
  .placement-token-portrait { width: 100%; height: 100%; }
  .placement-token-portrait img, .placement-token-portrait video {
    width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 0 4px rgba(0,0,0,0.9));
  }
  .placement-token.player .placement-token-portrait { outline: 2px solid rgba(93,173,226,0.55); outline-offset: -2px; border-radius: 4px; }
  .placement-token.enemy .placement-token-portrait { outline: 2px solid rgba(231,115,115,0.55); outline-offset: -2px; border-radius: 4px; }
  .placement-token.ghost { opacity: 0.5; }
  .placement-token.ghost .placement-token-portrait { outline-color: rgba(255,215,0,0.55); }
  .placement-token.staged { opacity: 0.85; }
  .placement-token.staged .placement-token-portrait { outline: 2px dashed #27ae60; outline-offset: 2px; border-radius: 6px; animation: placementPulse 1.1s ease-in-out infinite; }
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
// Whether this device is watching the active session without owning any
// participant in it -- set only by an explicit "Spectate" choice (see
// _renderJoinOrSpectateChoice), never inferred, so a trainer who genuinely
// hasn't joined yet still gets steered into the join flow by default.
// Reset back to false whenever the session ends, so the next battle asks
// again rather than silently spectating forever.
let _spectating = false;
// True from the moment THIS device's own Create Battle click fires until the
// live push echoing that exact creation is consumed (see combatUpdateHandler) --
// the one case where auto-switching into the join flow on a live push is
// actually wanted, since the player just asked for it themselves.
let _justCreatedSession = false;
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
// Manual stat edits (AC, ability scores + modifiers, crit modifier) made on this device's own
// cards, pushed to the server so every other player's popups read the same values -- see
// stat-sync.js. The card's numbers include live status effects; what's sent is the base.
const _baseStatSync = createBaseStatSync((id, stats) => CombatAPI.updateBaseStats(id, stats));
let _lastSyncedStats = {}; // participantId -> {hp, vp} last pushed to the server, to dedupe redundant pushes
let _lastSyncedRecharge = {}; // combatantId -> KnownMoves string last written to the DB, same dedupe reasoning

function _needsToJoin(state) {
  const name = _currentTrainerName();
  if (!name) return false;
  return !Object.values(state.participants).some(p => p.owner === name);
}

let _prefetchedAllBackgrounds = false; // fire the list+warm pass at most once per page load

/** Warms the browser's cache for EVERY available battle background, not
 * just whichever one (if any) is already chosen -- the first player into
 * a session is the one who'll actually pick a background once they reach
 * Placement, so there's no single "the" URL to prefetch yet at this point.
 * Shares _backgroundOptionsCache with _populateBackgroundSelect (see
 * below) so whichever of the two runs first saves the other a redundant
 * list-backgrounds call. */
async function _prefetchAllBackgrounds() {
  if (_prefetchedAllBackgrounds) return;
  _prefetchedAllBackgrounds = true;
  if (!_backgroundOptionsCache) {
    try {
      const result = await CombatAPI.listBackgrounds();
      _backgroundOptionsCache = result.status === 'success' ? result.backgrounds : [];
    } catch {
      _backgroundOptionsCache = [];
    }
  }
  _backgroundOptionsCache.forEach(b => prefetchSprite(b.url).catch(() => {}));
}

export async function renderCombatWip() {
  const result = await CombatAPI.getState();
  session = result.status === 'success' ? result.data : { active: false };
  return _renderCurrentView();
}

function _renderCurrentView() {
  const inJoinFlow = _joinStage === 'setup' || _joinStage === 'initiative' || _joinStage === 'placement';

  // Needs-to-join but hasn't picked a side yet (join vs. just watch) --
  // ask, rather than assuming everyone wants to play. Only reached once per
  // session (picking either option moves past this: 'setup' starts
  // inJoinFlow, Spectate sets _spectating).
  if (session.active && !_spectating && _needsToJoin(session) && !inJoinFlow) {
    return _renderJoinOrSpectateChoice();
  }

  if (session.active && !_spectating && inJoinFlow) {
    // Start warming the browser's cache for every available background now
    // -- Setup/Initiative give a real few seconds of "picking a Pokemon,
    // entering initiative" time, so by the time this trainer actually
    // reaches Placement (where one gets picked, possibly by them if
    // they're first in) it's very likely already local instead of a
    // multi-MB fetch stalling that screen's first paint.
    _prefetchAllBackgrounds();
    if (_joinStage === 'initiative' && _joinState) {
      return renderInitiativePhase(_joinState);
    }
    if (_joinStage === 'placement' && _placementQueue.length) {
      return renderPlacementPhase(session, _placementQueue[0]);
    }
    return renderSetupPhase({ showWipButton: false });
  }

  _joinStage = null;
  _joinState = null;
  _placementQueue = [];
  _hoverGhosts = {};
  if (!session.active) _spectating = false;

  return `
    <div class="combat-wip-page">
      <style>${WIP_CSS}</style>
      <div class="combat-wip-header-bar">
        <div id="wipHeaderLeftBtn"></div>
        <div class="combat-wip-title" id="wipHeaderTitle"></div>
        <div id="wipHeaderEndBtn"></div>
      </div>
      <div class="combat-wip-layout">
        <div class="combat-wip-turnorder" id="wipTurnOrder"></div>
        <div class="combat-wip-body" id="combatWipBody">${renderBody(session)}</div>
      </div>
    </div>`;
}

/** Shown once, the first time this trainer sees an active session they
 * haven't joined -- join with your own trainer/Pokémon (the existing Setup
 * -> Initiative -> Placement -> Battle flow), or just watch (the same
 * normal view everyone else gets, but with nothing of yours in it -- see
 * _getDefaultFocusId's spectator fallback and _computeFocusContext's
 * isMine:false read-only path, both already built for "focused-on-someone-
 * else's-combatant" and now reused for "own nothing at all" too). */
function _renderJoinOrSpectateChoice() {
  return `
    <div class="combat-wip-page">
      <style>${WIP_CSS}</style>
      <div class="combat-wip-join-choice-topbar">
        <button class="combat-wip-btn-secondary" id="joinChoiceBackBtn">← Back</button>
      </div>
      <div class="combat-wip-empty">
        <h2>${session.battleType === 'pvp' ? 'PvP' : 'PvE'} Battle in Progress</h2>
        <p style="color:#a0a0c0;margin-bottom:1.5rem;max-width:340px;">Join in with your own trainer and Pokémon, or just watch the battle.</p>
        <button class="combat-wip-btn-primary" id="joinChoiceJoinBtn" style="margin-bottom:0.7rem;">⚔ Join Battle</button>
        <button class="combat-wip-btn-secondary" id="joinChoiceSpectateBtn">👁 Spectate</button>
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
    size: c.size || '', // map footprint -- see footprintForSize in battle-map-grid.js; trainers have no size at all, always 1x1
    speeds: c.speeds || [], // battle-map movement tracker -- see battle-map-popup.js
    // Full stat block -- see routes_combat.py's _add_participant for why
    // this is sent unconditionally for a trainer's own combatants (PvP has
    // no reason to hide it) and _richCombatantFromParticipant below for
    // where every OTHER device turns it back into a usable combatant.
    combatantType: c.type, speciesName: c.speciesName || '',
    ac: c.ac, baseAc: c.baseAc, critMod: c.critMod || 0,
    proficiency: c.proficiency, stabBonusValue: c.stabBonusValue,
    str: c.str, dex: c.dex, con: c.con, int: c.int, wis: c.wis, cha: c.cha,
    strMod: c.strMod, dexMod: c.dexMod, conMod: c.conMod,
    intMod: c.intMod, wisMod: c.wisMod, chaMod: c.chaMod,
    abilities: c.abilities || '', item: c.item || '',
    moves: c.moves || [],
    savingThrows: c.savingThrows || '', skills: c.skills || '',
  };
}

/** The other half of _combatantToParticipant -- reconstructs a full
 * combat.js-shaped combatant (same shape buildTrainerCombatant/
 * buildPokemonCombatant produce) from a server participant record, for a
 * combatant this device does NOT own. Only possible when that participant
 * actually carries the full stat block (see routes_combat.py's
 * _add_participant) -- a DM's freeform PvE enemy, or anything added before
 * this existed, falls back to _standInCombatant instead (checked by the
 * caller). rechargeStates/statusEffects/isExpanded stay at their defaults
 * -- those are genuinely local-only, this device was never going to know
 * another device's in-progress recharge/status state regardless of how
 * much of the static stat block it now has. */
function _richCombatantFromParticipant(p) {
  const isTrainer = p.combatantType === 'trainer';
  return {
    id: p.id, type: p.combatantType, entityKey: null,
    name: p.name, speciesName: p.speciesName || '',
    image: p.image,
    level: p.level, initiativeScore: p.initiative, initiativeRoll: 0, initiativeBonus: 0, initiativeTotal: p.initiative,
    ac: p.ac, baseAc: p.baseAc, critMod: p.critMod || 0,
    maxHp: p.maxHP, currentHp: p.currentHP, maxVp: p.maxVP, currentVp: p.currentVP,
    proficiency: p.proficiency, stabBonusValue: p.stabBonusValue,
    savingThrows: p.savingThrows || '', skills: p.skills || '',
    str: p.str, dex: p.dex, con: p.con, int: p.int, wis: p.wis, cha: p.cha,
    strMod: p.strMod, dexMod: p.dexMod, conMod: p.conMod,
    intMod: p.intMod, wisMod: p.wisMod, chaMod: p.chaMod,
    moves: p.moves || [], types: [p.type1, p.type2].filter(Boolean),
    abilities: p.abilities || '', item: p.item || '',
    size: p.size || '', speeds: p.speeds || [],
    rechargeStates: {}, statusEffects: [], isExpanded: false,
    hasStatBlock: true,
    // Trainer combatants never carry these pokemon-only fields at all
    // (see buildTrainerCombatant) -- stripped rather than left as
    // meaningless undefined/empty values on a trainer's own card.
    ...(isTrainer ? { abilities: undefined, item: undefined, stabBonusValue: undefined } : {}),
  };
}

/** True once a participant's record actually carries the full stat block
 * (see _add_participant) -- the specific field checked (proficiency) is
 * never legitimately 0/falsy-but-present for a real combatant, so this
 * can't false-negative on a genuinely-loaded block. */
function _hasFullStatBlock(p) {
  return p.combatantType != null && p.proficiency != null;
}

function _enterBattleSync() {
  if (_battleSyncActive) return;
  _battleSyncActive = true;
  setCombatStateKey(WIP_COMBAT_STATE_KEY);
  setOnCombatStateSave(_onLocalCombatStateSave);
  setOnLogEvent((event) => CombatAPI.logEvent(event).catch(() => {}));
}

function _exitBattleSync() {
  _battleSyncActive = false;
  _myParticipantIds = new Set();
  _lastSyncedStats = {};
  _lastSyncedRecharge = {};
  _baseStatSync.reset();
  _statsSyncInFlight = {};
  _statsSyncPending = {};
  setCombatStateKey('combatState');
  setOnCombatStateSave(null);
  setOnLogEvent(null);
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
 * server with no-op requests. Also persists a recharge-locked move's spent
 * charge (Roar of Time, Overheat, ...) through to the DB -- see
 * _persistRechargeStates, same reasoning as HP/VP just below. */
function _onLocalCombatStateSave(state) {
  _baseStatSync.onSave(state.combatants, id => _myParticipantIds.has(id));
  state.combatants.forEach(c => {
    if (!_myParticipantIds.has(c.id)) return;
    const last = _lastSyncedStats[c.id];
    if (last && last.hp === c.currentHp && last.vp === c.currentVp) return;
    _lastSyncedStats[c.id] = { hp: c.currentHp, vp: c.currentVp };
    _pushStatsSync(c.id, c.currentHp, c.currentVp);
    _persistStatsToDb(c, c.currentHp, c.currentVp);
  });
  _persistRechargeStates(state);
}

/** Writes a Pokemon's recharge-locked moves (rechargeStates -- "used this
 * short/long rest", see combat.js's buildPokemonCombatant/parseRecharge)
 * through to its real DB record (the same KnownMoves field, same
 * buildKnownMovesString format) -- combat.js's own endCombat does this for
 * the legacy flow, but that's tied to its own End Combat button and never
 * runs for a shared session. Without this, a once-per-rest move correctly
 * locks for the rest of THIS session (rechargeStates itself already tracks
 * fine, initialized by buildPokemonCombatant and decremented by the shared
 * move-use flow -- see move-effects-schema.md's own note on this) but
 * silently comes back fresh the next time this Pokemon enters ANY battle,
 * since the database was never actually told it was spent. Deduped against
 * the last string actually written, same pattern as HP/VP. Trainers don't
 * have recharge-locked moves in this game (Pokemon-only, same as
 * buildPokemonCombatant's own rechargeStates handling). */
function _persistRechargeStates(state) {
  state.combatants.forEach(c => {
    if (c.type !== 'pokemon' || !c.entityKey || !_myParticipantIds.has(c.id)) return;
    const knownMovesStr = buildKnownMovesString(c.rechargeStates || {});
    if (_lastSyncedRecharge[c.id] === knownMovesStr) return;
    _lastSyncedRecharge[c.id] = knownMovesStr;
    const pd = JSON.parse(sessionStorage.getItem(c.entityKey) || 'null');
    if (!pd) return;
    pd[59] = knownMovesStr;
    sessionStorage.setItem(c.entityKey, JSON.stringify(pd));
    PokemonAPI.update(pd).catch(e => console.error('Pokemon KnownMoves sync:', e));
  });
}

/** Writes a combatant's current HP/VP through to their real trainer/Pokemon
 * DB record (not just the ephemeral combat_session), so stats set during a
 * battle are still there afterward -- the special-case heal popups
 * (Ingrain/drain/direct heal) already did this themselves for their own
 * narrow case; this is the one place that now covers every path (VP cost of
 * a move, manual HP/VP adjusters, status-effect end-of-turn damage, and --
 * via _syncLocalCombatState below -- damage taken from another player's
 * attack too), same trust model as the rest of this app (client computes,
 * server just stores). No-ops gracefully for a stand-in combatant with no
 * real entityKey to write back to. */
function _persistStatsToDb(combatant, hp, vp) {
  const trainerName = _currentTrainerName();
  if (combatant.type === 'trainer') {
    const td = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
    if (!td.length) return;
    td[34] = hp; td[35] = vp;
    sessionStorage.setItem('trainerData', JSON.stringify(td));
    TrainerAPI.update(td).catch(e => console.error('Trainer HP/VP sync:', e));
  } else if (combatant.entityKey) {
    const pd = JSON.parse(sessionStorage.getItem(combatant.entityKey) || 'null');
    if (!pd) return;
    pd[45] = hp; pd[46] = vp;
    sessionStorage.setItem(combatant.entityKey, JSON.stringify(pd));
    PokemonAPI.updateLiveStats(trainerName, pd[2], 'HP', hp).catch(e => console.error('Pokemon HP sync:', e));
    PokemonAPI.updateLiveStats(trainerName, pd[2], 'VP', vp).catch(e => console.error('Pokemon VP sync:', e));
  }
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
// Shared conditions that match a status combat.js has always handled itself (end-of-turn
// damage / reminders, its own badge colors) borrow that name so they inherit it.
const LEGACY_BADGE_NAMES = { poisoned: 'Poison', burned: 'Burn', confused: 'Confusion', paralyzed: 'Paralysis', asleep: 'Sleep', frozen: 'Freeze' };

/** A shared status as combat.js's local statusEffects entry (see renderCombatCard).
 * `concentration` (true when the status ends with concentration -- see move-effects.js's
 * isConcentration) is what renderCombatCard groups on: several concentration effects
 * (Sharpen's attack bonus, a future concentration move alongside it, ...) show together
 * under one "Concentration" umbrella instead of as separate badges, while each stays its
 * own clickable entry underneath (same detail popup, same use-status wiring). */
function _statusToBadge(st, round) {
  const name = (st.kind === 'condition' && LEGACY_BADGE_NAMES[st.apply]) || statusLabel(st);
  return { name, description: describeStatusEnds(st, round), duration: -1, serverStatusId: st.id, concentration: isConcentration(st) };
}

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
    // The shared session owns the effects the shared combat applied; hand-added local
    // badges (combat.js's add-status buttons) are kept, the shared ones re-derived.
    merged.statusEffects = [
      ...(merged.statusEffects || []).filter(se => !se.serverStatusId),
      ...(p.statuses || []).map(st => _statusToBadge(st, session.round)),
    ];
    // A change here that this device didn't already know about (prior's old
    // value differs from the server's) means someone ELSE's action moved
    // this HP/VP -- the only realistic case being another player's
    // apply-damage landing a hit on this combatant. That path never touches
    // this device's own saveCombatState, so it's the one HP/VP change
    // _onLocalCombatStateSave's DB-persist hook can never see; persist it
    // here instead so a hit taken while it's not your turn still ends up in
    // the real trainer/Pokemon record, not just this ephemeral session.
    if (prior && resolved && (prior.currentHp !== p.currentHP || prior.currentVp !== p.currentVP)) {
      _persistStatsToDb(merged, p.currentHP, p.currentVP);
    }
    merged.currentHp = p.currentHP; merged.maxHp = p.maxHP;
    merged.currentVp = p.currentVP; merged.maxVp = p.maxVP;
    // Bide's own two-phase state (see routes_combat.py's _bide_use) -- read
    // straight off the live participant, never held locally, since it's the
    // server that decides "activate" vs "resolve" each time the move is used.
    merged.bideCharging = !!p.bideChargingSinceLogId;
    merged.pendingBideDamage = p.pendingBideDamage ?? null;
    merged.bideHeld = !!p.bideHeld;
    // A direct read of the server's own pool (see move-effects.js's tempHpRemaining),
    // not a base+delta round-trip like the stat fields below -- it shrinks on its own as
    // damage lands, there's no "manual edit" to preserve.
    merged.tempHp = tempHpRemaining(p);
    if (resolved) {
      merged.hasStatBlock = true;
      // Live stat statuses (AC -1, all abilities +1, ...) move the card's CURRENT AC and ability
      // scores/modifiers -- the same values the Modify Stats buttons edit, and the ones the move
      // popup reads for attack bonus, damage bonus and Move DC -- so a buff or debuff shows up
      // everywhere at once. Only the change since the last sync is applied, so manual edits stay.
      reapplyStatDeltas(merged, merged.appliedStatMods, { ...statDeltas(p), set: statSetOverrides(p) });
    }
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
  const { cols, rows } = state.board.grid;
  const bg = state.board.backgroundImage;
  return `
    <div class="placement-page">
      <style>${PLACEMENT_CSS}</style>
      <div class="placement-header-bar">
        <button class="placement-back-btn" id="placementBackBtn">← Back</button>
        <div class="placement-title">📍 Place Your Team</div>
      </div>
      <div class="placement-body">
        <div class="placement-prompt">Click a cell to preview <strong>${current?.name || '…'}</strong>'s position, then confirm it.</div>
        <div class="placement-actions" id="placementActions"></div>
        <div class="placement-stage${bg ? ' has-bg' : ''}" id="placementStage"
             style="aspect-ratio:${cols} / ${rows};${bg ? ` background-image:url(${bg});` : ''}">
          <div class="placement-grid" id="placementGrid" style="${gridTemplateStyle(state.board)}">${gridCellsHtml(state.board, 'bmap-cell')}</div>
          <div class="placement-tokens" id="placementTokens"></div>
        </div>
        <div class="placement-bg-picker">
          <label for="placementGridCols">Grid Size</label>
          <div class="placement-grid-size-row">
            <input type="number" id="placementGridCols" min="1" value="${cols}" style="width:56px;">
            <span>×</span>
            <input type="number" id="placementGridRows" min="1" value="${rows}" style="width:56px;">
            <button type="button" id="placementSetGridBtn">Set</button>
          </div>
        </div>
        ${state.battleType === 'pvp' ? `
        <div class="placement-bg-picker">
          <label for="placementBgSelect">Battle Background</label>
          <select id="placementBgSelect">
            <option value="">No Background</option>
          </select>
        </div>` : ''}
      </div>
    </div>`;
}

/** A cell is unusable as currentId's placement anchor if ANY cell of ITS
 * OWN footprint from here (a Large/Huge Pokemon spans more than the one
 * cell actually clicked -- see footprintForSize) would run off the grid,
 * or would overlap a cell already holding a CONFIRMED token (anyone's --
 * a trainer and their own Pokémon can't share a square either, and each
 * existing token blocks its own full footprint, not just its anchor cell)
 * or another participant's CURRENT hover/staging preview. `currentId`'s
 * own hover echo (the server broadcasts your own hover-token calls back to
 * you too) is excluded, same as the ghost-rendering below already did. */
function _isCellTaken(state, col, row, currentId) {
  const { cols, rows } = state.board.grid;
  const mySize = footprintForSize(state.participants[currentId]?.size);
  const myCells = footprintCells(col, row, mySize);
  if (myCells.some(c => c.col < 0 || c.row < 0 || c.col >= cols || c.row >= rows)) return true;

  const overlaps = (otherCol, otherRow, otherSize) =>
    footprintCells(otherCol, otherRow, otherSize)
      .some(oc => myCells.some(mc => mc.col === oc.col && mc.row === oc.row));

  const occupied = Object.entries(state.board.tokens)
    .some(([id, pos]) => id !== currentId &&
      overlaps(pos.col, pos.row, footprintForSize(state.participants[id]?.size)));
  if (occupied) return true;

  return Object.entries(_hoverGhosts)
    .some(([id, pos]) => pos && id !== currentId &&
      overlaps(pos.col, pos.row, footprintForSize(state.participants[id]?.size)));
}

let _backgroundOptionsCache = null; // [{key,label,url}] from list-backgrounds, fetched once and reused

/** Fills in every option beyond the static "No Background" one already in
 * the markup (see renderPlacementPhase) -- async since the list is a
 * network call the initial synchronous render can't wait on. Guards
 * against the select having been torn down (rerendered away, or this
 * trainer's placement finished) by the time the fetch resolves. */
async function _populateBackgroundSelect(selectEl, currentUrl) {
  if (!_backgroundOptionsCache) {
    try {
      const result = await CombatAPI.listBackgrounds();
      _backgroundOptionsCache = result.status === 'success' ? result.backgrounds : [];
    } catch {
      _backgroundOptionsCache = [];
    }
  }
  if (!document.body.contains(selectEl)) return;
  selectEl.insertAdjacentHTML('beforeend',
    _backgroundOptionsCache.map(b => `<option value="${b.url}">${b.label}</option>`).join(''));
  selectEl.value = currentUrl || '';
}

/** Keeps the placement stage's background/aspect-ratio and the picker's own
 * value in sync with the live session -- another player picking a
 * background (or the DM resizing the grid) should show up here too, not
 * just on whoever set it. */
function _syncPlacementBackground(state) {
  const stageEl = document.getElementById('placementStage');
  if (stageEl) {
    const { cols, rows } = state.board.grid;
    stageEl.style.aspectRatio = `${cols} / ${rows}`;
    const url = state.board.backgroundImage;
    stageEl.classList.toggle('has-bg', !!url);
    stageEl.style.backgroundImage = url ? `url(${url})` : '';
  }
  const bgSelect = document.getElementById('placementBgSelect');
  if (bgSelect && document.activeElement !== bgSelect) bgSelect.value = state.board.backgroundImage || '';

  const colsInput = document.getElementById('placementGridCols');
  const rowsInput = document.getElementById('placementGridRows');
  if (colsInput && document.activeElement !== colsInput) colsInput.value = state.board.grid.cols;
  if (rowsInput && document.activeElement !== rowsInput) rowsInput.value = state.board.grid.rows;
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
    const rect = cellRect(state.board, pos.col, pos.row, footprintForSize(p.size));
    html.push(`
      <div class="placement-token ${p.side}" data-token-id="${id}" title="${name}" style="left:${rect.left};top:${rect.top};width:${rect.width};height:${rect.height};">
        <div class="placement-token-portrait" data-portrait-id="${id}"></div>
      </div>`);
  });

  Object.entries(_hoverGhosts).forEach(([id, pos]) => {
    if (!pos || id === currentId) return; // no ghost for your own in-progress placement
    if (state.board.tokens[id]) return; // already confirmed -- the real token above is authoritative
    const p = state.participants[id];
    if (!p) return;
    const name = visibleToViewer(p, 'name') ? p.name : '???';
    const rect = cellRect(state.board, pos.col, pos.row, footprintForSize(p.size));
    html.push(`
      <div class="placement-token ghost ${p.side}" title="${name}" style="left:${rect.left};top:${rect.top};width:${rect.width};height:${rect.height};">
        <div class="placement-token-portrait" data-portrait-id="${id}"></div>
      </div>`);
  });

  if (_stagedPosition) {
    const current = state.participants[currentId];
    if (current) {
      const name = visibleToViewer(current, 'name') ? current.name : '???';
      const rect = cellRect(state.board, _stagedPosition.col, _stagedPosition.row, footprintForSize(current.size));
      html.push(`
        <div class="placement-token staged ${current.side}" title="${name}" style="left:${rect.left};top:${rect.top};width:${rect.width};height:${rect.height};">
          <div class="placement-token-portrait" data-portrait-id="${currentId}"></div>
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

  // By this point the trainer's own combatants have already been added
  // server-side (see onComplete above), so "back" can't just return to
  // Setup/Initiative without leaving duplicates behind -- it backs all the
  // way out of joining instead, via the same leave-session cleanup as the
  // End Battle button, and drops the trainer back on their own card.
  document.getElementById('placementBackBtn')?.addEventListener('click', async () => {
    try { await CombatAPI.leaveSession(_currentTrainerName()); } catch (err) { showCombatAlert(err.message, { title: 'Error' }); }
    sessionStorage.removeItem(WIP_COMBAT_STATE_KEY);
    _joinStage = null; _joinState = null; _placementQueue = []; _hoverGhosts = {};
    window.dispatchEvent(new CustomEvent('navigate', { detail: { route: 'trainer-card' } }));
  });

  // Battle background picker (PvP only, see renderPlacementPhase) -- the
  // list is fetched once and cached module-wide (rarely changes), and the
  // select is left showing whatever's already chosen so it reflects
  // another player's pick too, not just whoever set it first.
  const bgSelect = document.getElementById('placementBgSelect');
  if (bgSelect) {
    _populateBackgroundSelect(bgSelect, state.board.backgroundImage);
    bgSelect.addEventListener('change', () => {
      CombatAPI.setBoardBackground(bgSelect.value).catch(err => showCombatAlert(err.message, { title: 'Error' }));
    });
  }

  // Grid size -- setup-only now (moved out of the in-battle map popup, which
  // used to let anyone resize mid-fight -- see battle-map-popup.js's own
  // history). Any placer can still set it, same open-trust model as the
  // background picker above; whoever sets it last wins, same as before.
  document.getElementById('placementSetGridBtn')?.addEventListener('click', async () => {
    const cols = parseInt(document.getElementById('placementGridCols').value, 10) || 10;
    const rows = parseInt(document.getElementById('placementGridRows').value, 10) || 12; // matches routes_combat.py's own default
    try { await CombatAPI.setBoardTemplate(cols, rows); } catch (err) { showCombatAlert(err.message, { title: 'Error' }); }
  });

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
      showCombatAlert(err.message, { title: 'Error' });
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
        <h2>Battle Mode</h2>
        <div class="combat-wip-battle-type-choice">
          <label>
            <input type="radio" name="battleType" value="pve" checked>
            <span>PvE</span>
          </label>
          <label>
            <input type="radio" name="battleType" value="pvp">
            <span>PvP</span>
          </label>
        </div>
        <button class="combat-wip-btn-primary" id="createSessionBtn">Create Battle</button>
      </div>`;
  }

  return `
    ${state.battleType === 'pve' && !_spectating ? `
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

/** Header title ("PvP Combat"/"PvE Combat", based on the active session's
 * battleType), the left-side button (Back before there's a session to show
 * a map of, Map once one's active), and the End Battle button (renamed
 * from End Session, moved here from the round bar) -- all three live
 * outside #combatWipBody, so unlike everything the SSE fast path patches,
 * they need their own explicit refresh call wherever `session` changes. */
function _syncHeaderBar(state) {
  const titleEl = document.getElementById('wipHeaderTitle');
  if (titleEl) {
    const vsIcon = '<img src="assets/VS.png" alt="">';
    titleEl.innerHTML = !state?.active
      ? `${vsIcon}Battle`
      : `${vsIcon}${state.battleType === 'pvp' ? 'PvP' : 'PvE'} Battle`;
  }
  const leftBtnEl = document.getElementById('wipHeaderLeftBtn');
  if (leftBtnEl) {
    leftBtnEl.innerHTML = state?.active
      ? '<div class="wip-header-btn-group"><button class="combat-wip-btn-secondary wip-map-btn" id="battleMapBtn">▦ Map</button><button class="combat-wip-btn-secondary wip-log-btn" id="battleLogBtn">📜 Log</button></div>'
      : '<button class="combat-wip-btn-secondary" id="wipHeaderBackBtn">← Back</button>';
    document.getElementById('battleMapBtn')?.addEventListener('click', () => {
      showBattleMap(session, _currentTrainerName());
    });
    document.getElementById('battleLogBtn')?.addEventListener('click', () => {
      showBattleLog(session);
    });
    document.getElementById('wipHeaderBackBtn')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('navigate', { detail: { route: 'trainer-card' } }));
    });
  }
  const endBtnEl = document.getElementById('wipHeaderEndBtn');
  if (endBtnEl) {
    // A spectator hasn't joined anything to end -- leaving just stops
    // watching, no session mutation at all (unlike End Battle, which
    // removes this trainer's own participants via leaveSession).
    endBtnEl.innerHTML = !state?.active ? '' : _spectating
      ? '<button class="combat-wip-btn-secondary" id="stopSpectatingBtn">👁 Stop Spectating</button>'
      : '<button class="combat-wip-btn-danger" id="endSessionBtn">End Battle</button>';
    document.getElementById('endSessionBtn')?.addEventListener('click', async () => {
      await CombatAPI.leaveSession(_currentTrainerName());
      sessionStorage.removeItem(WIP_COMBAT_STATE_KEY);
      window.dispatchEvent(new CustomEvent('navigate', { detail: { route: 'trainer-card' } }));
    });
    document.getElementById('stopSpectatingBtn')?.addEventListener('click', () => {
      _spectating = false;
      window.dispatchEvent(new CustomEvent('navigate', { detail: { route: 'trainer-card' } }));
    });
  }
}

// ---------------------------------------------------------------------------
// Turn-order strip -- a compact row above the info box (wrapping onto extra
// rows when there are many), in turn order, of every
// participant's portrait (including DM-controlled enemies in PvE), the
// current turn/reaction holder framed in gold, a reaction-availability dot
// (outside the portrait's left edge) per portrait, and a lighter blue frame
// on whichever one is currently
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
            <div class="wip-turn-reaction"><div class="wip-turn-reaction-dot"></div></div>
            <div class="wip-turn-status-count" style="display:none"></div>
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
    reactionEl.style.display = p.status === 'participating' ? 'flex' : 'none';
    reactionEl.classList.toggle('used', !!p.reactionUsed);

    const statuses = p.statuses || [];
    const countEl = node.querySelector('.wip-turn-status-count');
    if (countEl) {
      countEl.style.display = statuses.length ? '' : 'none';
      countEl.textContent = statuses.length;
      countEl.title = statuses.map(st => statusLabel(st)).join(', ');
    }

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
// Which foreign (PvP opponent) participant currently has its read-only card
// manually COLLAPSED (the user's own call: a PvP opponent's card should show
// everything by default, same as your own combatant's -- collapsing is an
// opt-in you can still click into, not the default). See _foreignCombatantView
// / the click handler in _bindStatusBadgeClicks. Not persisted; resets back
// to expanded whenever focus moves to a different participant, same as the
// "mine" side never remembering isExpanded across a fresh focus either.
let _foreignCollapsedId = null;
// Which participant combat.js's button handlers (HP/VP, stats, moves, End
// Turn's local half...) are currently attached for. Those handlers look their
// combatant up in the state object they were attached with, so they only work
// for THAT participant -- showing a different one of the viewer's own
// combatants needs a fresh attach, not just a re-render (see _syncMainFocus).
let _attachedFocusId = null;

/** The viewer's own next combatant in turn order after `fromId`, wrapping
 * round to the start of the order. Returns `fromId` itself when it's the only
 * one they own, and null if `fromId` isn't in the turn order at all. */
function _nextOwnedAfter(state, fromId) {
  const myName = _currentTrainerName();
  const order = state.turnOrder;
  const start = order.indexOf(fromId);
  if (start === -1) return null;
  for (let step = 1; step <= order.length; step++) {
    const id = order[(start + step) % order.length];
    if (state.participants[id]?.owner === myName) return id;
  }
  return null;
}

function _getDefaultFocusId(state) {
  const myName = _currentTrainerName();
  const mine = state.turnOrder.find(id => state.participants[id]?.owner === myName);
  // A spectator (or anyone else who owns nothing in this session) has no
  // "own combatant" to default to -- fall back to whoever's first in turn
  // order instead of showing nothing at all, same read-only info panel
  // every other participant already gets for a non-owned focus.
  return mine || state.turnOrder[0] || null;
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
  // merged.combatants only ever covers session.turnOrder (see
  // _syncLocalCombatState) -- if this participant has dropped out of it
  // for any reason (e.g. status flipped away from 'participating' server-
  // side) while still being genuinely owned by this trainer, fall back to
  // a stand-in built straight from the raw participant instead of
  // degrading all the way to the foreign read-only view below, which has
  // no End Turn/HP-VP/anything -- this is still YOUR OWN combatant, it
  // should stay interactive even in a degraded, moves-list-less form.
  const focused = merged.combatants.find(c => c.id === focusId) || _standInCombatant(p);

  focused.isExpanded = true; // always uncollapsed -- there's only ever one shown at a time now
  const activeId = state.reactingParticipantId || state.turnOrder[state.turnIndex];
  const filteredState = { ...merged, combatants: [focused], activeTurnIndex: focused.id === activeId ? 0 : -1 };
  const canReact = p.status === 'participating' && !p.reactionUsed &&
    !state.reactingParticipantId && p.id !== state.turnOrder[state.turnIndex];
  const cardOptions = { compactWip: true, canReact, endTurnAtBottom: true };
  return { p, isMine: true, filteredState, cardOptions };
}

/** The full read-only card view for a PvP opponent's participant -- same field
 * shape combat.js's renderCombatCard/renderExpandedSection read for "mine"
 * (see _syncLocalCombatState), built straight off the server record instead of
 * a persisted local mirror (there's nothing to persist for a combatant this
 * device doesn't own). The server already sends a PvP participant's full stat
 * block (see routes_combat.py's _add_participant: "no reason to hide a PvP
 * opponent's stats from the app itself, since every human at the table
 * already sees them on paper anyway") -- this is that data finally reaching
 * the screen, with the same live-status deltas (effectiveStats/statDeltas)
 * and base-stat sync (stat-sync.js) the viewer's own card already gets, so an
 * opponent's manual AC edit or an active Crunch shows up here exactly like it
 * would on their own screen. A PvE freeform enemy has none of this
 * (hasStatBlock stays false, same degrade as _standInCombatant) -- callers
 * only use this for battleType 'pvp' (see _renderMainFocusHtml/_syncMainFocus),
 * where there's no DM fog-of-war to preserve (see routes_combat.py's `status`
 * module docstring's "PvP-only in practice" and the user's own call that PvP
 * has no DM intervention). */
function _foreignCombatantView(p) {
  const eff = effectiveStats(p);
  return {
    id: p.id, type: p.combatantType, name: p.name, image: p.image, level: p.level,
    types: [p.type1, p.type2].filter(Boolean),
    currentHp: p.currentHP, maxHp: p.maxHP, currentVp: p.currentVP, maxVp: p.maxVP,
    tempHp: tempHpRemaining(p),
    ac: eff.ac, baseAc: p.baseAc, critMod: eff.critMod || 0,
    str: eff.str, dex: eff.dex, con: eff.con, int: eff.int, wis: eff.wis, cha: eff.cha,
    strMod: eff.strMod, dexMod: eff.dexMod, conMod: eff.conMod,
    intMod: eff.intMod, wisMod: eff.wisMod, chaMod: eff.chaMod,
    proficiency: p.proficiency, abilities: p.abilities, item: p.item,
    savingThrows: p.savingThrows, skills: p.skills, size: p.size,
    moves: p.moves || [], rechargeStates: {}, // this device doesn't track another player's recharge state
    initiativeTotal: p.initiative,
    statusEffects: (p.statuses || []).map(st => _statusToBadge(st, session?.round)),
    appliedStatMods: { ...statDeltas(p), set: statSetOverrides(p) },
    hasStatBlock: p.combatantType != null && p.proficiency != null,
    isExpanded: _foreignCollapsedId !== p.id,
  };
}

/** data-focus-id (read by the expand-toggle click handler in
 * _bindStatusBadgeClicks) marks which participant this card is currently
 * showing. No attempt to preserve mp4 playback position across a rebuild
 * (unlike the "mine" path below) -- there's no button state to lose either,
 * this is read-only, so a restarted sprite on every push is an acceptable
 * trade for not needing a second copy of that logic. */
function _renderForeignFocusFull(p) {
  return `<div class="wip-foreign-focus-full" data-focus-id="${p.id}">${renderCombatCard(_foreignCombatantView(p), false, { compactWip: true, readOnly: true })}</div>`;
}

/** PvE's minimal foreign panel (name/type/level/HP/VP/statuses only, respecting
 * DM-controlled visibility -- see visibleToViewer) -- kept exactly as it was
 * for PvE fog-of-war; _renderForeignFocusFull above is the PvP-only upgrade to
 * the full card, gated in _renderMainFocusHtml/_syncMainFocus by battleType. */
function _renderForeignFocusInfo(p) {
  const showName = visibleToViewer(p, 'name');
  const showHp = visibleToViewer(p, 'hp');
  const showVp = visibleToViewer(p, 'vp');
  const name = showName ? p.name : '???';
  const typesText = [p.type1, p.type2].filter(Boolean).join(' / ');
  // data-focus-id marks which participant this panel is currently showing --
  // _syncMainFocus checks it to tell "still the same focus, just updated
  // stats" (patch in place, portrait untouched) from "focus actually
  // switched" (full rebuild is fine, there's no video to preserve yet).
  return `
    <div class="wip-foreign-focus" data-focus-id="${p.id}">
      <div class="wip-foreign-focus-portrait" id="wipForeignFocusPortrait"></div>
      <div class="wip-foreign-focus-name" id="wipForeignFocusName">${name}</div>
      ${typesText ? `<div class="wip-foreign-focus-row">${typesText}</div>` : ''}
      ${p.level ? `<div class="wip-foreign-focus-row">Level ${p.level}</div>` : ''}
      ${showHp ? `<div class="wip-foreign-focus-row" id="wipForeignFocusHp">HP: ${p.currentHP}/${p.maxHP}</div>` : '<div id="wipForeignFocusHp" hidden></div>'}
      ${showVp ? `<div class="wip-foreign-focus-row" id="wipForeignFocusVp">VP: ${p.currentVP}/${p.maxVP}</div>` : '<div id="wipForeignFocusVp" hidden></div>'}
      <div class="wip-foreign-focus-statuses" id="wipForeignFocusStatuses">${_statusBadgesHtml(p)}</div>
    </div>`;
}

/** One status as a clickable badge -- click opens the detail popup. Shared by
 * _statusBadgesHtml's grouped and ungrouped rows. */
function _statusBadgeHtml(p, st) {
  return `<span class="status-badge status-custom status-custom-expanded" data-combatant-id="${p.id}" data-server-status-id="${st.id}" data-effect="${statusLabel(st)}"><span class="status-custom-name">${statusLabel(st)}</span><span class="status-custom-desc">${describeStatusEnds(st, session?.round)}</span></span>`;
}

/** Clickable badges for a participant's live effects (the read-only counterpart to the
 * ones combat.js draws on the viewer's own card) -- click opens the detail popup.
 * Concentration effects (see isConcentration) are pulled into one "Concentration"
 * group instead of showing as separate badges, mirroring renderCombatCard's own
 * grouping -- each one is still individually clickable inside it. */
function _statusBadgesHtml(p) {
  const statuses = p.statuses || [];
  const conc = statuses.filter(isConcentration);
  const rest = statuses.filter(st => !isConcentration(st));
  const restHtml = rest.map(st => _statusBadgeHtml(p, st)).join('');
  const concHtml = conc.length
    ? `<span class="status-concentration-group"><span class="status-concentration-group-label">🧠 Concentration</span>${conc.map(st => _statusBadgeHtml(p, st)).join('')}</span>`
    : '';
  return restHtml + concHtml;
}

/** Patches the foreign-focus panel in place for the SAME focused
 * participant (see the data-focus-id check in _syncMainFocus) -- text
 * updates freely, but the portrait only rebuilds if the image URL actually
 * changed (patchPortraitMedia), so an mp4 sprite already playing there
 * isn't restarted by every unrelated SSE push (turn advance, another
 * player's roll, etc.), same discipline as the turn-order sidebar. PvE only
 * -- see _renderForeignFocusInfo. */
function _updateForeignFocusInfo(p) {
  const showName = visibleToViewer(p, 'name');
  const name = showName ? p.name : '???';
  patchPortraitMedia(document.getElementById('wipForeignFocusPortrait'), p.image, name);
  const nameEl = document.getElementById('wipForeignFocusName');
  if (nameEl) nameEl.textContent = name;
  const hpEl = document.getElementById('wipForeignFocusHp');
  if (hpEl) { hpEl.hidden = !visibleToViewer(p, 'hp'); hpEl.textContent = `HP: ${p.currentHP}/${p.maxHP}`; }
  const vpEl = document.getElementById('wipForeignFocusVp');
  if (vpEl) { vpEl.hidden = !visibleToViewer(p, 'vp'); vpEl.textContent = `VP: ${p.currentVP}/${p.maxVP}`; }
  const statusEl = document.getElementById('wipForeignFocusStatuses');
  if (statusEl) statusEl.innerHTML = _statusBadgesHtml(p);
}

/** Builds the #wipBattlePhase HTML string -- used before the DOM exists
 * (renderBody, for the initial page-shell string). See _attachMainFocusListeners
 * for the matching post-insertion attach step, and _syncMainFocus for every
 * subsequent update once the DOM already exists. */
function _renderMainFocusHtml(state) {
  const ctx = _computeFocusContext(state);
  if (!ctx) return '<div class="combat-wip-empty"><p style="color:#a0a0c0;">No participants yet.</p></div>';
  if (!ctx.isMine) return state.battleType === 'pvp' ? _renderForeignFocusFull(ctx.p) : _renderForeignFocusInfo(ctx.p);
  return renderBattlePhase(ctx.filteredState, ctx.cardOptions);
}

function _attachMainFocusListeners(state) {
  const ctx = _computeFocusContext(state);
  if (!ctx || !ctx.isMine) return;

  attachBattleListeners(ctx.filteredState, { onDamageResolved: _handleDamageResolved, onSaveTriggered: _handleSaveTriggered, onReactiveSave: _handleReactiveSave, onMultiHitAoe: _handleMultiHitAoe, onEffectsOnly: _handleEffectsOnly, onBideResolve: _handleBideResolve, ...ctx.cardOptions });
  _attachedFocusId = ctx.p.id;

  document.getElementById('battleList')?.addEventListener('click', (e) => {
    const reactBtn = e.target.closest('.wip-react-btn');
    if (reactBtn) {
      if (!reactBtn.disabled) CombatAPI.reactionStart(reactBtn.dataset.combatantId).catch(err => showCombatAlert(err.message, { title: 'Error' }));
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
    const endBtn = e.target.closest('.end-turn-btn');
    if (!endBtn) return;
    if (session.reactingParticipantId) {
      CombatAPI.reactionEnd().catch(() => {});
      return;
    }

    // Ending a real turn also moves the info box on to this viewer's own next
    // combatant (trainer or Pokémon, wrapping round the turn order), so the
    // next thing they see is whoever they'll be playing next. Only once the
    // server accepted the advance, so a rejected End Turn doesn't move focus.
    // Skipped for a combatant with Ingrain: combat.js finishes that End Turn
    // later, behind its heal popup, by redrawing THIS combatant's card --
    // which would land on top of the new focus.
    const endingId = endBtn.dataset.combatantId;
    const nextId = _nextOwnedAfter(session, endingId);
    const endingHasIngrain = ctx.filteredState.combatants[0]?.statusEffects
      ?.some(se => se.name === 'Ingrain' && se.duration > 0);
    // Effects that end on a repeat save, or a `heal` status due to re-trigger
    // (Aqua Ring/Ingrain), at the end of this turn get prompted first.
    _promptTurnSaves(endingId, 'end_of_turn')
      .then(() => _promptTurnHeals(endingId, 'end_of_turn'))
      .then(() => CombatAPI.advanceTurn())
      .then(() => { if (nextId && nextId !== endingId && !endingHasIngrain) _setFocus(nextId); })
      .catch(() => {});
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
  if (!ctx.isMine) {
    if (state.battleType === 'pvp') {
      el.innerHTML = _renderForeignFocusFull(ctx.p); // always a full rebuild -- see its own comment
      return;
    }
    const existingFocus = el.querySelector('.wip-foreign-focus');
    if (existingFocus && existingFocus.dataset.focusId === ctx.p.id) {
      _updateForeignFocusInfo(ctx.p);
    } else {
      el.innerHTML = _renderForeignFocusInfo(ctx.p);
    }
    return;
  }
  // Patch in place only while still showing the SAME combatant combat.js's
  // handlers were attached for. Switching to a different one of the viewer's
  // own (a sidebar click, or End Turn moving on to their next combatant) falls
  // through to the full rebuild + re-attach below instead -- otherwise the new
  // card would render but its buttons would look themselves up in the old
  // combatant's state and quietly do nothing.
  if (document.getElementById('battleList') && _attachedFocusId === ctx.p.id) {
    setBattleCardOptions(ctx.cardOptions);
    // rerenderBattle always rebuilds the card fresh (a plain innerHTML
    // replace shared with the legacy multi-card page, which this doesn't
    // touch) -- for this single focused card, that means every HP/VP/stat
    // tweak restarts an mp4 sprite's playback from frame 0, unlike the
    // turn-order sidebar's own portraits (patched via patchPortraitMedia,
    // which skips the rebuild entirely when the src hasn't changed).
    // Preserve the play position across the rebuild here instead.
    const oldVideo = document.querySelector('#battleList video.combat-card-img');
    const oldSrc = oldVideo?.getAttribute('src') || null;
    const oldTime = oldVideo?.currentTime || 0;
    rerenderBattle(ctx.filteredState);
    if (oldSrc) {
      try {
        const newVideo = document.querySelector('#battleList video.combat-card-img');
        if (newVideo && newVideo.getAttribute('src') === oldSrc) newVideo.currentTime = oldTime;
      } catch {
        // Best-effort cosmetic fix -- some WebViews throw setting
        // currentTime before a video's metadata has loaded. Never let that
        // take down the rest of this sync pass (turn-order sidebar, header,
        // map) over a seek that was only ever saving a visual restart.
      }
    }
  } else {
    el.innerHTML = renderBattlePhase(ctx.filteredState, ctx.cardOptions);
    _attachMainFocusListeners(state);
  }
}

export function attachCombatWipListeners() {
  _bindStatusBadgeClicks();
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
        _syncPlacementBackground(session);
      }
      return;
    }
    if (_joinStage) return;

    // Not already mid-join-flow, but the fresh session says this trainer
    // needs to join. Only actually switch views for it when THIS device is
    // the one that just clicked Create Battle (_justCreatedSession, set by
    // that button's own handler, below) -- otherwise every trainer who
    // happens to have this page open gets yanked into a forced "Join or
    // Spectate" decision the instant ANY other trainer starts a battle,
    // which is exactly the auto-join bug the user reported: nobody should be
    // pulled into anything by someone else's action. `session` above is
    // still kept current regardless, so navigating into this page fresh
    // (renderCombatWip) picks up the right state on its own, same as always
    // -- this only guards the *live, unprompted* switch. Spectators are
    // exempt from the whole check -- _needsToJoin is permanently true for
    // them (a spectator owns nothing by definition), so without this check
    // every single push would bounce a spectator back through _rerenderFull
    // and undo the whole point of _syncMainFocus's patch-in-place path below.
    if (session.active && !_spectating && _needsToJoin(session)) {
      const isMyOwnCreation = _justCreatedSession;
      _justCreatedSession = false; // consumed either way -- only ever applies to the first push after Create Battle
      if (isMyOwnCreation) {
        _exitBattleSync();
        _rerenderFull();
      }
      return;
    }

    if (!session.active) { _exitBattleSync(); _spectating = false; }

    if (session.active && document.getElementById('wipBattlePhase')) {
      // Fast path: patch things in place rather than replacing the whole
      // body -- _syncMainFocus already knows how to do this correctly for
      // BOTH cases (the viewer's own combatant, preserving any open popup
      // like move details/inventory, or someone else's read-only info).
      _syncMainFocus(session);

      _syncTurnOrderSidebar(session);
      _syncHeaderBar(session);
      updateBattleMap(session);
      updateBattleLog(session);
      _maybePromptStartOfTurnSaves(session);
      _maybeShowReactionPrompt(session);
      return;
    }

    const body = document.getElementById('combatWipBody');
    if (body) body.innerHTML = renderBody(session);
    attachBodyListeners();
    _syncTurnOrderSidebar(session);
    _syncHeaderBar(session);
    updateBattleMap(session); // no-ops if the popup isn't currently open
    updateBattleLog(session); // no-ops if the popup isn't currently open
    _maybePromptStartOfTurnSaves(session);
    _maybeShowReactionPrompt(session);
  };
  window.addEventListener('app:combat-updated', combatUpdateHandler);

  if (document.getElementById('joinChoiceJoinBtn')) {
    document.getElementById('joinChoiceJoinBtn').addEventListener('click', () => {
      _joinStage = 'setup';
      _rerenderFull();
    });
    document.getElementById('joinChoiceSpectateBtn').addEventListener('click', () => {
      _spectating = true;
      _rerenderFull();
    });
    // Leaves without deciding either way -- this trainer still owns nothing in
    // the session and isn't spectating, so it's simply not shown again until
    // they navigate back into this page themselves.
    document.getElementById('joinChoiceBackBtn').addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('navigate', { detail: { route: 'trainer-card' } }));
    });
    return;
  }

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
          showCombatAlert(err.message, { title: 'Error' });
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

  attachBodyListeners();
}

function attachBodyListeners() {
  document.getElementById('createSessionBtn')?.addEventListener('click', async () => {
    const battleType = document.querySelector('input[name="battleType"]:checked')?.value || 'pve';
    // See _justCreatedSession's own comment -- flags this device (and only this
    // one) to actually act on the live push this creates, rather than sitting
    // here doing nothing until the player happens to navigate back in.
    _justCreatedSession = true;
    try {
      await CombatAPI.createSession(battleType);
    } catch (err) {
      _justCreatedSession = false;
      showCombatAlert(err.message, { title: 'Error' });
    }
  });

  // Always synced, even for the empty state -- it's what puts the Back
  // button (rather than Map) in the header's left slot before there's a
  // session to show a map of.
  _syncHeaderBar(session);

  if (!session || !session.active) return; // empty-state view has nothing else to wire

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
}

/** Wired into combat.js's move-popup flow as onBideResolve (see
 * attachBattleListeners above and combat.js's own _handleBideClick) -- the
 * "unleash" half of Bide's two-phase toggle, once routes_combat.py's
 * bide-use has already computed `dealt` (2x damage taken while charging).
 * Deliberately NOT routed through _resolveOneHit below: that helper always
 * adds computedData.damageBonus (STAB/Ace Trainer/move-mod/...) on top of
 * the roll, correct for a normal attack but wrong here -- Bide's own
 * damage IS the computed number, nothing else stacks on top of it. The
 * attack roll still happens normally (the move text: "a normal ranged
 * attack"), just the damage step skips straight to applying `dealt` once a
 * hit is confirmed, no dice, no additional bonus. */
async function _handleBideResolve({ combatantId, dealt }) {
  const picked = await pickTarget(combatantId, {
    moveName: 'Bide', damageDice: '', damageNotes: [], damageModifier: 0, presetRoll: dealt,
  });
  if (!picked || picked.blocked) return;
  const attackerName = session?.participants?.[combatantId]?.name || '?';
  if (!picked.hit) {
    const targetName = session?.participants?.[picked.targetId]?.name || '?';
    CombatAPI.logEvent({
      type: 'miss', actorId: combatantId, actorName: attackerName, targetId: picked.targetId, targetName,
      text: `${attackerName} used Bide on ${targetName} -- Miss`,
    }).catch(() => {});
    return;
  }
  try {
    // Bide is Normal-type (see DnD_moves_categorized_draft.json) -- still
    // passed through so type-effectiveness against the target applies same
    // as any other attack.
    await CombatAPI.applyDamage(combatantId, picked.targetId, picked.rawRoll, 'Normal', '', 'Bide');
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
  }
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
async function _handleDamageResolved({ combatantId, moveName, move, computedData, speciesName }) {
  const attackModifier = computedData.attackBonus || 0;
  const damageModifier = computedData.damageBonus || 0;
  // pickTarget's own popup now covers the whole rest of the flow: pick a
  // target, enter the attack roll, declare Hit/Miss yourself (same as this
  // game's other rolls -- the app shows the total, a human compares it to
  // the target's AC), and -- only on a Hit -- play the attacker's battle
  // animation and take a damage roll. See target-picker.js.
  // guaranteed_hit moves (Aerial Ace, Aura Sphere, etc.) skip the attack roll
  // entirely -- see target-picker.js -- so a low modifier can't make an
  // automatic hit "miss". Any exception in the move's own text (e.g. "unless
  // the target is in the invulnerable stage of Fly/Dig") stays a human call,
  // same trust model as the rest of this flow.
  const categories = moveCategoriesFor(moveName);
  // Laser Focus ("your first attack ... always results in a critical hit") also
  // skips the attack roll -- the move guarantees a hit, not just a crit conditional
  // on one -- see _resolveOneHit for where the crit itself gets forced and consumed.
  const guaranteedHit = categories.includes('guaranteed_hit') || !!guaranteedCritStatusId(session?.participants?.[combatantId]);
  // Target-conditional damage_note effects (Brine, Smelling Salts, Venoshock,
  // ...) -- see move-effects-schema.md and target-picker.js's own use of these.
  const damageNotes = _targetDamageNotes(moveName);
  const picked = await pickTarget(combatantId, { attackModifier, damageModifier, speciesName, guaranteedHit, moveName, damageDice: computedData.damageDice, damageNotes, moveModValue: computedData.highestMod });
  let hitTargetId = await _resolveOneHit(combatantId, moveName, move, computedData, speciesName, picked);

  const isSameTarget = categories.includes('multi_hit_same_target');
  const isChoice = categories.includes('multi_hit_choice');
  if (!isSameTarget && !isChoice) return;

  // "Hit again?" loop, for moves tagged multi_hit_same_target (Fury Attack/
  // Rock Blast's d4-continue-on-3-or-4 chains, Double Kick's fixed count --
  // always the SAME target, no re-picking) or multi_hit_choice (Hyperspace
  // Fury/Gear Grind -- a target chosen fresh each hit, possibly different
  // each time). How many times to actually loop is left entirely to the
  // human (a d4 roll, a fixed cap, a miss ending the chain -- all move-
  // specific rules this app doesn't encode), same trust model as every
  // other roll in this flow.
  while (true) {
    const again = await showCombatConfirm(
      isSameTarget ? 'Hit the same target again?' : 'Attack again (pick a target)?',
      { title: moveName, yesLabel: 'Hit Again', noLabel: 'Stop' },
    );
    if (!again) return;

    let nextPicked;
    if (isSameTarget) {
      if (!hitTargetId) return; // nothing landed yet (missed/closed) -- no target to repeat against
      const target = session?.participants?.[hitTargetId];
      if (!target) return; // target left the battle mid-chain
      nextPicked = await pickTargetAgain(target, target.name, { attackModifier, damageModifier, speciesName, guaranteedHit, attacker: session?.participants?.[combatantId], moveName, damageDice: computedData.damageDice, damageNotes, moveModValue: computedData.highestMod });
    } else {
      nextPicked = await pickTarget(combatantId, { attackModifier, damageModifier, speciesName, guaranteedHit, moveName, damageDice: computedData.damageDice, damageNotes, moveModValue: computedData.highestMod });
    }
    hitTargetId = await _resolveOneHit(combatantId, moveName, move, computedData, speciesName, nextPicked);
  }
}

/** " (rolled 12 vs DC 15)" for a save outcome that carried a roll, else "". */
function _saveRollNote(outcome) {
  if (!outcome || outcome.saveTotal === null || outcome.saveTotal === undefined) return '';
  return outcome.dc ? ` (rolled ${outcome.saveTotal} vs DC ${outcome.dc})` : ` (rolled ${outcome.saveTotal})`;
}

/** The ability of the first save-based effect on `moveName` ("WIS", ...), so the
 * save popup can add the target's modifier for it. null when the move has none. */
function _saveAbilityFor(moveName) {
  return moveEffectsFor(moveName).find(e => e.when?.type === 'save_fail')?.when.ability || null;
}

/** `moveName`'s TARGET-conditional `damage_note` effects (see move-effects-
 * schema.md) -- passed straight through to target-picker.js's own damage-
 * roll step (see its own targetDamageNoteResult call), which evaluates them
 * once a target is actually picked. Self-conditional ones are filtered out
 * here (already shown at move-popup time, combat.js's own
 * showCombatMoveDetails) -- harmless to also pass them, since none of
 * target-picker.js's condition types match `self_*`, but there's no reason
 * to hand it effects it'll never act on. */
function _targetDamageNotes(moveName) {
  return moveEffectsFor(moveName).filter(e => e.kind === 'damage_note' && !String(e.condition?.type || '').startsWith('self_'));
}

/** After an attack or save resolves: works out which of the move's structured
 * effects (moveEffectsFor) it triggered from what the flow recorded -- `ctx` =
 * {hit, attackRoll (natural d20 or null), crit, guaranteedHit, save: {passed,
 * failBy} | null} -- lists them in a popup for the player to confirm, and puts the
 * confirmed ones on the shared session (apply-status). An effect that hinges on a
 * save nobody has rolled yet (a move whose text says "make a CON save or ..."
 * without being tagged trigger_saving_throw*) gets its save asked for here.
 * `targetId` null offers only the user's own (target:'self') effects; includeSelf
 * false offers only the target's (for a loop that already offered self once). */
async function _offerMoveEffects({ attackerId, targetId = null, moveName, computedData, ctx, includeSelf = true }) {
  const effects = moveEffectsFor(moveName);
  if (!effects.length) return;
  const attacker = session?.participants?.[attackerId];
  const target = targetId ? session?.participants?.[targetId] : null;
  const dc = computedData?.moveDC ?? 0;
  const mine = effects.filter(e => (e.target === 'self' ? includeSelf : !!target));

  const verdictsFor = (c) => mine.map(effect => {
    let verdict = evaluateEffect(effect, c);
    // A self-inflicted effect that rides on a save (the user's own DC 20 CON save
    // after Devastating Tremors) isn't rolled anywhere in this flow -- a human's call.
    if (effect.target === 'self' && verdict === 'needs_save') verdict = 'manual';
    return { effect, verdict };
  });

  let verdicts = verdictsFor(ctx);
  const waiting = target && !ctx.save ? verdicts.find(v => v.verdict === 'needs_save') : null;
  if (waiting) {
    const outcome = await confirmSecondarySave(target, target.name, {
      dc, ability: waiting.effect.when.ability || null, title: 'Saving Throw', moveUser: attacker,
    });
    // Closing without declaring counts as no save result: nothing that hinges on one is offered.
    ctx = { ...ctx, save: outcome ? { passed: outcome.passed, failBy: outcome.failBy ?? null } : { passed: true, failBy: null } };
    if (outcome) {
      const attackerName = attacker?.name || '?';
      CombatAPI.logEvent({
        type: 'save', actorId: attackerId, actorName: attackerName, targetId, targetName: target.name,
        text: `${target.name} ${outcome.passed ? 'succeeded' : 'failed'} the saving throw against ${attackerName}'s ${moveName}${_saveRollNote(outcome)}`,
      }).catch(() => {});
    }
    verdicts = verdictsFor(ctx);
  }

  const offer = verdicts.filter(v => v.verdict === 'yes' || v.verdict === 'manual');
  if (!offer.length) return;
  const sections = [];
  const selfEntries = offer.filter(v => v.effect.target === 'self');
  const targetEntries = offer.filter(v => v.effect.target !== 'self');
  if (selfEntries.length) sections.push({ targetId: attackerId, targetName: `${attacker?.name || 'User'} (the user)`, entries: selfEntries });
  if (targetEntries.length) sections.push({ targetId, targetName: target?.name || '?', entries: targetEntries });

  const picks = await showEffectsPopup({ title: `${moveName} — effects`, sections });
  if (!picks || !picks.length) return;
  for (const pick of picks) {
    let effect = pick.effect;
    if (effect.kind === 'reroll_damage') {
      // Not a status -- a one-shot correction against a damage entry that
      // already happened. pick.targetId here is whoever the save_fail
      // resolved against (Attract's attacker); attackerId (closure) is
      // Attract's own caster, the one whose HP gets refunded.
      await _handleRerollDamage({ reactorId: attackerId, attackerId: pick.targetId, moveName });
      continue;
    }
    if (effect.kind === 'block_attack') {
      // Not a status either -- a one-shot signal to the ATTACKER's own
      // client (mid waitForReactionWindow) that this attack is blocked
      // entirely (Protect, King's Shield, ...). attackerId (closure) is
      // the reactor themselves, using the move -- same as any other
      // self-only reaction effect.
      try {
        await CombatAPI.blockPendingAttack(attackerId);
      } catch (err) {
        showCombatAlert(err.message, { title: 'Error' });
      }
      continue;
    }
    if (effect.kind === 'prevent_faint') {
      // Not a status -- a retroactive HP correction against damage that
      // already landed (Endure's own 'damaged' family reaction, unlike
      // block_attack's 'targeted' one -- there's no attack left to
      // cancel here, only its outcome). pick.targetId is the reactor
      // themselves (target: self).
      await _handlePreventFaint({ targetId: pick.targetId, moveName });
      continue;
    }
    if (effect.kind === 'heal' && !effect.repeat) {
      // Not a status -- an immediate HP/VP change. pick.targetId is whoever
      // gets healed (attackerId itself for a target:self effect, see the
      // section-building above); ctx.damageDealt only matters for a
      // fractionOfDamage amount (drain moves). A `repeat` heal (Aqua
      // Ring/Ingrain's heal-over-time) is the one exception -- that DOES
      // need to persist as a real status, so it falls through to the same
      // buildStatusSpec/apply-status path below instead of being
      // intercepted here; combat-wip.js's _promptTurnHeals re-triggers it
      // at each of its own turn boundaries from then on.
      await _handleApplyHeal({
        targetId: pick.targetId, effect, moveName,
        casterId: attackerId, casterName: attacker?.name,
        // Deliberately NOT computedData.damageBonus -- that bakes in STAB/Ace
        // Trainer/Type Master/held-item bonuses a heal's "+MOVE" text was
        // never talking about. See bestMoveStatModifier's own docstring.
        moveModBonus: effect.amount?.moveMod && attacker
          ? bestMoveStatModifier(findMoveRow(moveName) || [], attacker)
          : 0,
        damageDealt: ctx.damageDealt,
        casterLevel: attacker?.level,
      });
      continue;
    }
    if (effect.set !== undefined && typeof effect.set === 'object') {
      const resolved = _resolveSetValue(effect.set, attacker, target);
      if (resolved === null) {
        showCombatAlert(`Couldn't resolve ${moveName}'s effect (missing stat data) -- skipped`, { title: 'Error' });
        continue;
      }
      effect = { ...effect, set: resolved };
    }
    const spec = buildStatusSpec(effect, { sourceId: attackerId, sourceName: attacker?.name, moveName, dc, ends: pick.ends });
    try {
      await CombatAPI.applyStatus(pick.targetId, spec);
    } catch (err) {
      showCombatAlert(err.message, { title: 'Error' });
    }
  }
}

/** Resolves a `set` effect's sentinel formula (see move-effects-schema.md) against the
 * currently-known attacker/target into a plain number, once, right before the status is
 * applied -- from that point on it's stored as a concrete value like any other `set`
 * effect (move-effects.js's statSetOverrides never re-derives it). `{avgWithTarget:
 * "ac"}` (Guard Split) reads each participant's CURRENT effective value (their own live
 * statuses already folded in via effectiveStats) and floors the average. Returns null
 * when it can't be resolved (no target, or the target has no stat block) -- the caller
 * skips applying that pick rather than send a bad number. */
function _resolveSetValue(setSpec, attacker, target) {
  if (setSpec.avgWithTarget) {
    const field = setSpec.avgWithTarget;
    const a = attacker ? effectiveStats(attacker)[field] : null;
    const t = target ? effectiveStats(target)[field] : null;
    if (!Number.isFinite(a) || !Number.isFinite(t)) return null;
    return Math.floor((a + t) / 2);
  }
  return null;
}

/** Endure's own effect (see move-effects-schema.md's `prevent_faint` section):
 * a retroactive correction against damage that already landed (the
 * 'damaged' reaction family -- there's no attack left to cancel, only its
 * outcome, unlike block_attack's 'targeted' one). If the reactor's current
 * HP is already at or below 0 -- the only case "instead of fainting" means
 * anything -- it's set to exactly 1 via update-stats, the same client-
 * authoritative correction reroll_damage's own refund and every `heal`
 * effect already use. Above 0, this is a no-op: never a genuine heal, just
 * "nothing to prevent" (using Endure when it wasn't actually fatal is the
 * human's own call, same trust model as everywhere else). */
async function _handlePreventFaint({ targetId, moveName }) {
  const target = session?.participants?.[targetId];
  if (!target || !Number.isFinite(target.currentHP) || target.currentHP > 0) return;
  try {
    await CombatAPI.updateStats(targetId, { currentHP: 1 });
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
    return;
  }
  CombatAPI.logEvent({
    type: 'save', actorId: targetId, actorName: target.name,
    text: `${target.name} used ${moveName} -- falls to 1 HP instead of fainting`,
  }).catch(() => {});
}

/** Attract's own effect (see move-effects-schema.md's `reroll_damage` section):
 * `attackerId` just failed the WIS save Attract forced, so they reroll the
 * damage they already dealt to `reactorId` (Attract's own caster) and take
 * the lower result -- a correction against an already-applied log entry,
 * never a stored status, so this runs instead of _offerMoveEffects's normal
 * apply-status loop (see its own call site).
 *
 * Finds the most recent 'damage' log entry FROM attackerId TO reactorId --
 * reliable here because a reaction only ever answers the attack that just
 * happened (routes_combat.py's reaction window is anchored on that specific
 * hit), same trust as _handleReactiveSave's own log lookback. No matching
 * entry (a freeform PvE hit predating the full log, or the window closing
 * late) just tells the table to compare the two rolls by hand -- same
 * "can't auto-detect" fallback tone used everywhere else in this app. */
async function _handleRerollDamage({ reactorId, attackerId, moveName }) {
  const reactor = session?.participants?.[reactorId];
  const attacker = session?.participants?.[attackerId];
  if (!reactor || !attacker) return;

  const log = session?.log || [];
  let original = null;
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (entry.type === 'damage' && entry.actorId === attackerId && entry.targetId === reactorId) { original = entry; break; }
  }
  if (!original || !Number.isFinite(original.amount)) {
    showCombatAlert(`Couldn't find ${attacker.name}'s damage roll to reroll -- compare it with the table by hand.`, { title: moveName });
    return;
  }

  const rerolled = await promptRerollDamage({ originalAmount: original.amount, attackerName: attacker.name, targetName: reactor.name });
  if (rerolled === null || Number.isNaN(rerolled)) return; // closed without declaring

  const finalAmount = Math.min(original.amount, rerolled);
  const refund = original.amount - finalAmount;
  const text = refund > 0
    ? `${attacker.name} rerolled ${moveName}'s damage (was ${original.amount}, now ${rerolled}) -- ${reactor.name} recovers ${refund} HP`
    : `${attacker.name} rerolled ${moveName}'s damage (was ${original.amount}, now ${rerolled}) -- not lower, nothing changes`;
  CombatAPI.logEvent({
    type: 'save', actorId: reactorId, actorName: reactor.name, targetId: attackerId, targetName: attacker.name, text,
  }).catch(() => {});

  if (refund > 0) {
    const maxHp = Number.isFinite(reactor.maxHP) ? reactor.maxHP : Infinity;
    const newHp = Math.min(maxHp, reactor.currentHP + refund);
    try {
      await CombatAPI.updateStats(reactorId, { currentHP: newHp });
    } catch (err) {
      showCombatAlert(err.message, { title: 'Error' });
    }
  }
}

/** Applies ONE firing of a `heal` effect (see move-effects-schema.md's own
 * section): an immediate HP/VP change, never a status write itself -- called
 * straight from _offerMoveEffects's apply loop for a one-shot heal (that
 * loop intercepts it there instead of the normal apply-status path), and
 * from _applyRecurringHeal for each turn a `repeat` heal (Aqua Ring/Ingrain)
 * re-triggers, once the STATUS itself is already stored. Three `amount`
 * shapes:
 *   - `{dice}` (`moveModBonus` already includes the caller's own moveMod
 *     resolution): opens utils/heal-popup.js for the roll.
 *   - `{fractionOfDamage}`: no roll -- computed straight from `damageDealt`,
 *     the damage this same move-use just applied (threaded through from
 *     whichever damage-application call site actually hit; see the schema
 *     doc for which ones do). `capMultipleOfLevel` (Parabolic Charge's "no
 *     more than 5x level") clamps the result if `casterLevel` is known. No
 *     damageDealt to work with (a drain effect offered outside a hit, or a
 *     call site that doesn't thread it) just tells the table to apply it by
 *     hand, same fallback tone as every other "can't auto-detect" spot.
 *   - `{levelMultiple}`: no roll either -- Aqua Ring's "regain HP equal to
 *     your level", straight from `casterLevel`.
 * `amount.pool` ('HP', the default, or 'VP') picks which resource updates. */
async function _handleApplyHeal({ targetId, effect, moveName, casterId, casterName, moveModBonus, damageDealt, casterLevel }) {
  const target = session?.participants?.[targetId];
  if (!target) return;
  const pool = effect.amount?.pool === 'VP' ? 'VP' : 'HP';

  let amount, note;
  if (effect.amount?.fractionOfDamage) {
    if (!Number.isFinite(damageDealt)) {
      showCombatAlert(`Couldn't find ${moveName}'s damage dealt to compute the heal -- apply it manually.`, { title: moveName });
      return;
    }
    amount = Math.floor(effect.amount.fractionOfDamage * damageDealt);
    note = `${Math.round(effect.amount.fractionOfDamage * 100)}% of ${damageDealt} damage dealt`;
    const capMult = effect.amount.capMultipleOfLevel;
    if (capMult && Number.isFinite(casterLevel)) {
      const cap = capMult * casterLevel;
      if (amount > cap) {
        amount = cap;
        note += `, capped at ${cap} (${capMult}x level ${casterLevel})`;
      }
    }
  } else if (effect.amount?.levelMultiple) {
    // Aqua Ring's "regain HP equal to your level" -- no roll, straight from
    // the caster's own level (== the target's, always self-only so far).
    if (!Number.isFinite(casterLevel)) {
      showCombatAlert(`Couldn't find a level to compute ${moveName}'s heal -- apply it manually.`, { title: moveName });
      return;
    }
    amount = Math.floor(effect.amount.levelMultiple * casterLevel);
    note = `${effect.amount.levelMultiple}x level (${casterLevel})`;
  } else if (effect.amount?.dice) {
    const rolled = await promptHealRoll({ dice: effect.amount.dice, moveModBonus, targetName: target.name, moveName });
    if (rolled === null) return; // closed without entering one
    amount = rolled;
    note = `${effect.amount.dice}${moveModBonus ? ` + ${moveModBonus}` : ''}`;
  } else {
    return;
  }
  if (amount <= 0) return;

  const currentField = pool === 'VP' ? 'currentVP' : 'currentHP';
  const maxField = pool === 'VP' ? 'maxVP' : 'maxHP';
  const maxVal = Number.isFinite(target[maxField]) ? target[maxField] : Infinity;
  const newVal = Math.min(maxVal, target[currentField] + amount);
  const actualHealed = newVal - target[currentField];
  try {
    await CombatAPI.updateStats(targetId, { [currentField]: newVal });
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
    return;
  }
  CombatAPI.logEvent({
    type: 'heal', actorId: casterId, actorName: casterName || '?', targetId, targetName: target.name,
    text: `${target.name} healed ${actualHealed} ${pool} from ${casterName || '?'}'s ${moveName} (${note})`,
  }).catch(() => {});
}

/** Wired into combat.js's move-popup flow as onEffectsOnly -- for a move that has
 * structured effects but none of the other handlers took it (no damage, not save-
 * or AoE-tagged): Slack Off, Rest, Yawn, Gravity... The user's own effects are
 * offered straight away; if it also affects others, pick who (multi-target-picker),
 * then offer each target's effects (asking for their save when one hinges on it).
 *
 * A self effect gated on an ENEMY's save (Guard Split: "your AC becomes the average
 * of yours and the target's, on their failed CHA save") doesn't belong to this
 * handler at all, even though its buff is self-only -- it needs a SAVE target
 * (who has to save, see the DC, roll it), not the ally multi-target picker below,
 * which is what routes it to _handleSaveTriggered instead (its own
 * trigger_saving_throw tag, same as any other save-triggered move) -- see that
 * handler's own pickSaveTarget call. If a future move needed this same self+enemy-
 * save shape WITHOUT that tag, this handler would need the same treatment -- check
 * before assuming it just works. */
async function _handleEffectsOnly({ combatantId, moveName, computedData }) {
  const ctx = { hit: true, guaranteedHit: true, attackRoll: null, crit: false, save: null };
  await _offerMoveEffects({ attackerId: combatantId, moveName, computedData, ctx });
  if (!moveEffectsFor(moveName).some(e => e.target !== 'self')) return;
  const targetIds = await pickMultipleTargets(combatantId);
  if (!targetIds || !targetIds.length) return;
  for (const targetId of targetIds) {
    await _offerMoveEffects({ attackerId: combatantId, targetId, moveName, computedData, ctx, includeSelf: false });
  }
}

/** Resolves ONE already-picked hit ({targetId, hit, rawRoll} from
 * pickTarget/pickTargetAgain, or null if closed without picking): logs a
 * Miss, or applies damage (auto-logged server-side) and runs the ON HIT
 * secondary save if the move has one. Returns the target's id if the hit
 * actually landed (so a multi_hit_same_target loop knows who to keep
 * hitting), or null otherwise. Shared by the single-hit path, the "hit
 * again?" loop above, and _handleMultiHitAoe's per-target resolution. */
async function _resolveOneHit(combatantId, moveName, move, computedData, speciesName, picked) {
  if (!picked) return null; // "no target" / closed -- move's own cost still applied, nothing more to do
  if (picked.blocked) return null; // a reactor's block_attack effect (Protect, ...) ended this attack entirely -- routes_combat.py's own block-pending-attack already logged it (reaction-block), nothing left to do
  if (!picked.hit) {
    // Miss -- VP already spent when the move was confirmed, nothing else to
    // do mechanically, but it still belongs in the shared log (a Miss never
    // reaches the server otherwise -- apply-damage is only ever called on a
    // Hit, see below).
    const targetName = session?.participants?.[picked.targetId]?.name || '?';
    const attackerName = session?.participants?.[combatantId]?.name || '?';
    CombatAPI.logEvent({
      type: 'miss', actorId: combatantId, actorName: attackerName, targetId: picked.targetId, targetName,
      text: `${attackerName} used ${moveName} on ${targetName} -- Miss`,
    }).catch(() => {});
    // No popup here (see the user's own call: the players already know how a Miss reads,
    // it's right there in the shared battle log -- a modal for every routine result is
    // noise, not help). A miss can still trigger effects that don't need a hit (High Jump
    // Kick's self-prone).
    await _offerMoveEffects({
      attackerId: combatantId, targetId: picked.targetId, moveName, computedData,
      ctx: { hit: false, attackRoll: picked.attackRoll ?? null, crit: false },
    });
    return null;
  }

  const { targetId, rawRoll } = picked;
  const damageModifier = computedData.damageBonus || 0;
  const moveType = (move && move[1]) || '';
  let damageDealt;
  try {
    // No "N damage applied" popup -- it's already in the shared battle log
    // (routes_combat.py's _apply_damage_to_target logs it server-side, same as
    // every damage application here); see the user's own "less tooltip noise" call.
    // damageApplied (post type-multiplier) is captured for a `heal` effect's own
    // fractionOfDamage amount (Absorb, Drain Punch, ...) -- see _offerMoveEffects's
    // own apply loop.
    const dmgResult = await CombatAPI.applyDamage(combatantId, targetId, rawRoll + damageModifier, moveType, speciesName, moveName);
    damageDealt = dmgResult?.damageApplied;
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
    return null;
  }
  // 'damaged'-family reactions (Attract, Conversion 2, ...) fire right here --
  // after damage lands, before anything else about this hit is resolved.
  await waitForDamagedReactions(targetId, combatantId, moveName);

  // Some moves land a hit AND separately make the hit creature save against
  // a secondary consequence (e.g. Temporal Fang: damage on the attack roll,
  // then the hit target saves against being slowed) -- distinct from a pure
  // save move (no attack roll at all, see _handleSaveTriggered), per the
  // user's own explicit correction that "trigger saving throw" can't be
  // assumed to skip the attack roll. Only reachable once the attack already
  // landed, since a Miss never applies damage in the first place.
  const categories = moveCategoriesFor(moveName);
  let save = null;
  if (categories.includes('trigger_saving_throw_on_hit')) {
    const outcome = await _handleSecondarySave(combatantId, targetId, moveName, computedData);
    // Closed without declaring = no save result (nothing that hinges on one gets offered).
    save = { passed: outcome ? outcome.passed : true, failBy: outcome?.failBy ?? null };
  }

  // What the recorded rolls say this hit triggered: natural-roll thresholds, a crit,
  // the secondary save's failure margin, plain on-hit effects.
  const attackRoll = picked.attackRoll ?? null;
  const guaranteedHit = categories.includes('guaranteed_hit');
  const attacker = session?.participants?.[combatantId];
  let crit = false; // a guaranteed hit has no roll to crit on
  if (!guaranteedHit) {
    // undefined (not false) when the roll wasn't entered, so a crit-only effect asks a human.
    // effectiveStats, not the raw record -- a live crit-range status (Focus Energy) has to
    // actually change whether this roll counts, not just show up as a number on the card.
    crit = attackRoll === null ? undefined : attackRoll >= critThreshold(effectiveStats(attacker).critMod, categories.includes('base_crit'));
  }
  // Laser Focus overrides whatever the roll says (there may be no roll at all, see
  // guaranteedHit above) and is spent the moment this attack actually resolves --
  // hit or miss was never in question, but the crit itself only happens once.
  const laserFocusId = guaranteedCritStatusId(attacker);
  if (laserFocusId) {
    crit = true;
    CombatAPI.useStatus(combatantId, laserFocusId).catch(() => {});
  }
  await _offerMoveEffects({
    attackerId: combatantId, targetId, moveName, computedData,
    ctx: { hit: true, attackRoll, guaranteedHit, crit, save, damageDealt },
  });
  return targetId;
}

/** Wired into combat.js's move-popup flow as onMultiHitAoe -- for moves
 * tagged multi_hit_aoe (Judgment, Meteor Swarm, etc.), where one move-use
 * hits every creature caught in an area at once. This app has no
 * positional range-checking (see battle-map-popup.js's own deferred
 * range/distance note), so a human picks who was actually in range
 * (multi-target-picker.js), then each selected target gets resolved one at
 * a time via whichever mechanic the move already uses for a single target
 * -- a shared save (confirmSecondarySave, same DC for everyone since it's
 * one caster's move) if the move is ALSO TRIGGER SAVING THROW (Judgment:
 * one DEX save per creature in the circle), or its own attack roll
 * (pickTargetAgain + _resolveOneHit) otherwise (Meteor Swarm: "make as
 * many ranged attacks as there are targets"). */
async function _handleMultiHitAoe({ combatantId, moveName, move, computedData, speciesName }) {
  const targetIds = await pickMultipleTargets(combatantId);
  if (!targetIds || !targetIds.length) return; // closed / nobody picked -- move's own cost still applied

  const isSaveTriggered = moveCategoriesFor(moveName).includes('trigger_saving_throw');
  const guaranteedHit = moveCategoriesFor(moveName).includes('guaranteed_hit');
  const attackModifier = computedData.attackBonus || 0;
  const damageModifier = computedData.damageBonus || 0;
  const dc = computedData.moveDC ?? 0;
  const hasDamage = !!computedData.damageDice;
  const moveType = (move && move[1]) || '';
  const attackerName = session?.participants?.[combatantId]?.name || '?';
  const damageNotes = _targetDamageNotes(moveName);
  // Summed across every target this blast actually damaged -- a self-only
  // `heal` effect with fractionOfDamage (Parabolic Charge, Tera Drain) heals
  // off the WHOLE AoE's total, never one target's own share, so it's offered
  // once after the loop (see below) instead of the old "self effects ride
  // along with the first target's own popup" shortcut -- that shortcut never
  // actually depended on the first target's own save result either (a
  // self-effect gated on save_fail always falls back to 'manual' regardless,
  // see _offerMoveEffects's own verdictsFor), so no existing move's behavior
  // changes, only the popup timing (self effects are now their own popup, at
  // the end, instead of bundled into target #1's). Only wired for the
  // save-triggered branch below -- no current guaranteed-hit AoE move (the
  // `else` branch, which defers to _resolveOneHit) has a fractionOfDamage
  // self-heal, so that path's damage isn't summed here.
  let totalDamageDealt = 0;

  for (const targetId of targetIds) {
    const target = session?.participants?.[targetId];
    if (!target) continue;

    if (isSaveTriggered) {
      const outcome = await confirmSecondarySave(target, target.name, { dc, hasDamage, damageModifier, speciesName, ability: _saveAbilityFor(moveName), moveUser: session?.participants?.[combatantId] });
      if (!outcome) continue; // closed for this target -- move on to the next one
      const applyHint = moveEffectsFor(moveName).length ? '' : ' -- apply its effect';
      if (outcome.passed) {
        CombatAPI.logEvent({
          type: 'save', actorId: combatantId, actorName: attackerName, targetId, targetName: target.name,
          text: `${target.name} succeeded the saving throw against ${attackerName}'s ${moveName}${_saveRollNote(outcome)}`,
        }).catch(() => {});
      } else if (outcome.rawRoll !== undefined) {
        try {
          // No "N damage applied" popup here either -- see _resolveOneHit's own note;
          // doubly true in a loop over several AoE targets, one popup per target.
          const dmgResult = await CombatAPI.applyDamage(combatantId, targetId, outcome.rawRoll + damageModifier, moveType, speciesName, moveName);
          if (Number.isFinite(dmgResult?.damageApplied)) totalDamageDealt += dmgResult.damageApplied;
          await waitForDamagedReactions(targetId, combatantId, moveName);
        } catch (err) {
          showCombatAlert(err.message, { title: 'Error' });
        }
      } else {
        CombatAPI.logEvent({
          type: 'save', actorId: combatantId, actorName: attackerName, targetId, targetName: target.name,
          text: `${target.name} failed the saving throw against ${attackerName}'s ${moveName}${_saveRollNote(outcome)}${applyHint}`,
        }).catch(() => {});
      }
      // This target's own (non-self) effects only -- the move's self effects
      // are offered once, after the loop, with the full AoE total.
      await _offerMoveEffects({
        attackerId: combatantId, targetId, moveName, computedData,
        ctx: { hit: true, guaranteedHit: true, attackRoll: null, crit: false, save: { passed: outcome.passed, failBy: outcome.failBy ?? null } },
        includeSelf: false,
      });
    } else {
      // Shock Wave-style area moves: guaranteed to hit everything in the area,
      // so each selected target goes straight to its damage roll.
      const picked = await pickTargetAgain(target, target.name, { attackModifier, damageModifier, speciesName, guaranteedHit, attacker: session?.participants?.[combatantId], moveName, damageDice: computedData.damageDice, damageNotes, moveModValue: computedData.highestMod });
      await _resolveOneHit(combatantId, moveName, move, computedData, speciesName, picked);
    }
  }

  if (isSaveTriggered && moveEffectsFor(moveName).some(e => e.target === 'self')) {
    await _offerMoveEffects({
      attackerId: combatantId, moveName, computedData,
      ctx: { hit: true, guaranteedHit: true, attackRoll: null, crit: false, save: null, damageDealt: totalDamageDealt },
    });
  }
}

async function _handleSecondarySave(combatantId, targetId, moveName, computedData) {
  const target = session?.participants?.[targetId];
  if (!target) return null;
  const attackerName = session?.participants?.[combatantId]?.name || '?';
  const dc = computedData.moveDC ?? 0;
  const outcome = await confirmSecondarySave(target, target.name, { dc, ability: _saveAbilityFor(moveName), moveUser: session?.participants?.[combatantId] });
  if (!outcome) return null; // closed without declaring
  // Effects are offered (and applied) right after this returns, so the log no
  // longer tells someone to apply it by hand when the move has structured effects.
  const applyHint = moveEffectsFor(moveName).length ? '' : ' -- apply its effect';
  const text = outcome.passed
    ? `${target.name} succeeded the secondary saving throw against ${attackerName}'s ${moveName}${_saveRollNote(outcome)}`
    : `${target.name} failed the secondary saving throw against ${attackerName}'s ${moveName}${_saveRollNote(outcome)}${applyHint}`;
  CombatAPI.logEvent({
    type: 'save', actorId: combatantId, actorName: attackerName, targetId, targetName: target.name, text,
  }).catch(() => {});
  return outcome; // {passed, failBy, ...} -- _resolveOneHit decides which effects that triggered
}

/** Wired into combat.js's move-popup flow as onReactiveSave -- for moves
 * tagged REACTIVE SAVE (Wing Buffer, etc.), where the move's own user is
 * the one who saves, against whoever attacked them, not a chosen target's
 * own DC. Auto-detects the attacker and their DC from the shared battle
 * log, falling back to a manual "pick who attacked you and type in their
 * DC" flow when that isn't possible -- no matching damage entry, the
 * attacker's record predates the full-stat-block feature (e.g. a PvE
 * freeform enemy), or the attacking move isn't in the moves dataset. */
async function _handleReactiveSave({ combatantId, moveName }) {
  const result = await CombatAPI.getState();
  const freshSession = result.status === 'success' ? result.data : session;
  const log = freshSession?.log || [];

  // Who I'm actually reacting to -- NOT just whoever's most recent in the
  // log (that could be stale, e.g. a hit from several rounds ago if this
  // reaction wasn't declared right away, or a hit from someone else
  // entirely if another turn passed in between). Reacting only ever
  // happens during someone ELSE's active turn (routes_combat.py's
  // reaction-start rejects reacting on your own turn), and starting a
  // reaction never touches turnIndex -- so turnOrder[turnIndex] still
  // points at that participant even while reactingParticipantId now holds
  // this device's own id. That's the actual attacker to auto-detect
  // against: the current turn order, not the log's literal last line.
  const activeAttackerId = freshSession.turnOrder?.[freshSession.turnIndex];

  let attacker = null;
  let dc = null;
  if (activeAttackerId && activeAttackerId !== combatantId) {
    for (let i = log.length - 1; i >= 0; i--) {
      const entry = log[i];
      if (entry.type !== 'damage' || entry.targetId !== combatantId || entry.actorId !== activeAttackerId) continue;
      const candidate = freshSession.participants?.[activeAttackerId];
      if (candidate && entry.move && _hasFullStatBlock(candidate)) {
        const moveRow = findMoveRow(entry.move);
        if (moveRow) { attacker = candidate; dc = computeMoveDC(moveRow, effectiveStats(candidate)); }
      }
      break; // only the most recent hit FROM the current turn holder counts
    }
  }

  const outcome = dc !== null
    ? await confirmSecondarySave(attacker, attacker.name, { dc })
    : await pickManualSaveTarget(combatantId, {});
  if (!outcome) return; // closed without declaring

  const reactorName = freshSession?.participants?.[combatantId]?.name || '?';
  const attackerName = (attacker || freshSession?.participants?.[outcome.targetId])?.name || '?';
  const text = outcome.passed
    ? `${reactorName} succeeded a reactive saving throw (DC ${outcome.dc}) against ${attackerName}'s attack using ${moveName}`
    : `${reactorName} failed a reactive saving throw (DC ${outcome.dc}) against ${attackerName}'s attack using ${moveName} -- apply its effect manually (e.g. half damage)`;
  CombatAPI.logEvent({
    type: 'save', actorId: combatantId, actorName: reactorName, targetId: outcome.targetId, targetName: attackerName, text,
  }).catch(() => {});
}

/** Wired into combat.js's move-popup flow as onSaveTriggered (see
 * attachBattleListeners above) -- the save-based counterpart to
 * _handleDamageResolved, for moves the user's own categorization tagged
 * TRIGGER SAVING THROW (see combat.js's moveCategoriesFor). No attack roll
 * here: save-picker.js shows the target the Move DC and lets a human
 * declare Save Success/Fail themselves, same "app shows the number, a
 * human compares it" pattern as everywhere else in this flow.
 *
 * Status/other non-damage consequences of a failed save are offered through
 * _offerMoveEffects (structured move effects -> apply-status on the shared
 * session, so it lands on whoever's Pokemon it is, on whichever device). A move
 * without structured effects yet is still just logged. */
async function _handleSaveTriggered({ combatantId, moveName, move, computedData, speciesName }) {
  const dc = computedData.moveDC ?? 0;
  const damageModifier = computedData.damageBonus || 0;
  const hasDamage = !!computedData.damageDice;
  const picked = await pickSaveTarget(combatantId, { dc, damageModifier, speciesName, hasDamage, ability: _saveAbilityFor(moveName) });
  if (!picked) return; // "no target" / closed -- move's own cost still applied, nothing more to do

  const attackerName = session?.participants?.[combatantId]?.name || '?';
  const targetName = session?.participants?.[picked.targetId]?.name || '?';
  const rollNote = _saveRollNote(picked);
  // No attack roll on a pure save move -- the save's result alone decides which effects land.
  // `extra` carries damageDealt through for the one branch below that actually applies
  // damage (a `heal` effect's fractionOfDamage amount needs it -- Soul Drain).
  const offerEffects = (extra = {}) => _offerMoveEffects({
    attackerId: combatantId, targetId: picked.targetId, moveName, computedData,
    ctx: { hit: true, guaranteedHit: true, attackRoll: null, crit: false, save: { passed: picked.passed, failBy: picked.failBy ?? null }, ...extra },
  });

  if (picked.passed) {
    CombatAPI.logEvent({
      type: 'save', actorId: combatantId, actorName: attackerName, targetId: picked.targetId, targetName,
      text: `${targetName} succeeded the saving throw against ${attackerName}'s ${moveName}${rollNote}`,
    }).catch(() => {});
    await offerEffects();
    return;
  }

  if (picked.rawRoll === undefined) {
    // No damage component -- purely a status/other effect (Taunt, Torment, Fear Ray, ...).
    // Moves with structured effects get them offered below; anything else is still
    // just logged so the table knows to apply it by hand.
    const applyHint = moveEffectsFor(moveName).length ? '' : ' -- apply its effect';
    CombatAPI.logEvent({
      type: 'save', actorId: combatantId, actorName: attackerName, targetId: picked.targetId, targetName,
      text: `${targetName} failed the saving throw against ${attackerName}'s ${moveName}${rollNote}${applyHint}`,
    }).catch(() => {});
    await offerEffects();
    return;
  }

  const moveType = (move && move[1]) || '';
  let damageDealt;
  try {
    // No "N damage applied" popup -- see _resolveOneHit's own note on why.
    const dmgResult = await CombatAPI.applyDamage(combatantId, picked.targetId, picked.rawRoll + damageModifier, moveType, speciesName, moveName);
    damageDealt = dmgResult?.damageApplied;
    await waitForDamagedReactions(picked.targetId, combatantId, moveName);
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
  }
  await offerEffects({ damageDealt });
}

/** The holder rolls the saving throw a status ends on (its Move DC, the save's
 * ability); a pass removes it. Returns the outcome, or null if closed. */
async function _rollStatusSave(holder, status, title) {
  const saveEnd = (status.ends || []).find(e => e.type === 'save');
  if (!saveEnd) return null;
  const outcome = await confirmSecondarySave(holder, holder.name, {
    dc: status.dc || 0, ability: saveEnd.ability, title: title || `${statusLabel(status)} — saving throw`,
    moveUser: status.sourceId ? session?.participants?.[status.sourceId] : null,
  });
  if (!outcome) return null;
  const note = _saveRollNote(outcome);
  if (outcome.passed) {
    await CombatAPI.removeStatus(holder.id, status.id, `passed the ${saveEnd.ability} save${note}`);
  } else {
    CombatAPI.logEvent({
      type: 'save', actorId: holder.id, actorName: holder.name,
      text: `${holder.name} failed the ${saveEnd.ability} save against ${statusLabel(status)}${note}`,
    }).catch(() => {});
  }
  return outcome;
}

let _promptingSaves = false;

/** Prompts `participantId`'s saving throw for every status that ends on a repeat save at
 * `timing` (start_of_turn / end_of_turn), one after the other. Closing a popup skips that
 * one for now; a failed save leaves the status until the next turn point, a pass removes it. */
async function _promptTurnSaves(participantId, timing) {
  const holder = session?.participants?.[participantId];
  if (!holder) return;
  const label = timing === 'start_of_turn' ? 'start of turn' : 'end of turn';
  for (const due of pendingTurnSaves(holder, timing)) {
    // Fresh lookup each time: an earlier prompt (or the server) may already have ended it.
    const status = (session?.participants?.[participantId]?.statuses || []).find(st => st.id === due.id);
    if (!status) continue;
    try {
      await _rollStatusSave(session.participants[participantId], status, `${statusLabel(status)} — ${label} save`);
    } catch (err) {
      showCombatAlert(err.message, { title: 'Error' });
    }
  }
}

/** A `heal` status's own repeat trigger (Aqua Ring/Ingrain -- see move-effects-
 * schema.md's `repeat` field and pendingTurnHeals's own docstring): rolls (or
 * computes) this turn's amount and applies it, same client-authoritative
 * update-stats correction every other heal in this app uses. The status
 * itself is never touched here -- its own `ends` (concentration, a rounds/
 * until_turn count) is what eventually removes it; this just fires again
 * every time it's still around at the right turn boundary. */
async function _applyRecurringHeal(targetId, status) {
  const target = session?.participants?.[targetId];
  if (!target) return;
  const moveModBonus = status.amount?.moveMod
    ? bestMoveStatModifier(findMoveRow(status.moveName) || [], target)
    : 0;
  await _handleApplyHeal({
    targetId, effect: status, moveName: status.moveName || statusLabel(status),
    casterId: status.sourceId || targetId, casterName: status.sourceName || target.name,
    moveModBonus, damageDealt: undefined, casterLevel: target.level,
  });
}

/** Prompts `participantId`'s repeat heal for every `heal` status due at `timing`
 * (start_of_turn / end_of_turn), same "one after the other" pattern as
 * _promptTurnSaves right above -- run alongside it at both this file's turn-
 * boundary hooks. */
async function _promptTurnHeals(participantId, timing) {
  const holder = session?.participants?.[participantId];
  if (!holder) return;
  for (const due of pendingTurnHeals(holder, timing)) {
    // Fresh lookup each time: an earlier prompt (or the server) may already have ended it.
    const status = (session?.participants?.[participantId]?.statuses || []).find(st => st.id === due.id);
    if (!status) continue;
    try {
      await _applyRecurringHeal(participantId, status);
    } catch (err) {
      showCombatAlert(err.message, { title: 'Error' });
    }
  }
}

const WIP_SAVE_PROMPT_KEY = 'combatWipLastSavePrompt';

/** A push just landed: if it's now the turn of one of THIS device's participants and it
 * hasn't been prompted yet, run its start-of-turn saves (and repeat heals -- Aqua Ring/
 * Ingrain, see _promptTurnHeals). Remembered per battle/round/turn in sessionStorage so a
 * repeated push or a page refresh mid-turn doesn't ask twice. Participants nobody owns (a
 * DM's enemies) aren't prompted here -- anyone can roll their save from the status badge. */
async function _maybePromptStartOfTurnSaves(state) {
  if (_promptingSaves || !state?.active || !state.started) return;
  const activeId = state.turnOrder?.[state.turnIndex];
  const p = activeId ? state.participants?.[activeId] : null;
  if (!p || !p.owner || p.owner !== _currentTrainerName()) return;
  const key = `${state.logFile}:${state.round}:${state.turnIndex}:${activeId}`;
  if (sessionStorage.getItem(WIP_SAVE_PROMPT_KEY) === key) return;
  sessionStorage.setItem(WIP_SAVE_PROMPT_KEY, key);
  if (!pendingTurnSaves(p, 'start_of_turn').length && !pendingTurnHeals(p, 'start_of_turn').length) return;
  _promptingSaves = true;
  try {
    await _promptTurnSaves(activeId, 'start_of_turn');
    await _promptTurnHeals(activeId, 'start_of_turn');
  } finally {
    _promptingSaves = false;
  }
}

/** Shows the reactor-side "you may react" popup (reaction-prompt-popup.js)
 * when this device owns a participant the live session says is currently
 * eligible to react to something -- no-ops otherwise, including while the
 * popup is already showing that same window (the popup module itself tracks
 * that). Wired in alongside _maybePromptStartOfTurnSaves at both places this
 * page re-renders from a live push, so it fires no matter which path
 * handled it. Focuses the reacting participant's own card once they commit
 * (reaction-start succeeds), so the next thing the player sees is the card
 * they'll actually use their reaction move from. */
function _maybeShowReactionPrompt(state) {
  if (!state?.pendingReaction) return;
  showReactionPromptIfEligible(state, _myParticipantIds, {
    getName: (id) => state.participants?.[id]?.name,
    onReacted: (participantId) => _setFocus(participantId),
  });
}

/** A status badge was clicked (own card or another participant's panel). */
async function _openStatusDetail(holderId, statusId) {
  const holder = session?.participants?.[holderId];
  const status = (holder?.statuses || []).find(st => st.id === statusId);
  if (!holder || !status) return;
  const action = await showStatusDetail(holder.name, status, session.round);
  if (!action) return;
  try {
    if (action === 'remove') await CombatAPI.removeStatus(holderId, statusId, 'removed by hand');
    else if (action === 'use') await CombatAPI.useStatus(holderId, statusId);
    else if (action === 'save') await _rollStatusSave(holder, status);
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
  }
}

let _statusClickHandler = null;

/** One delegated listener for every shared-status badge on the page, plus the
 * expand/collapse toggle for a PvP opponent's read-only card (see
 * _renderForeignFocusFull) -- that card has no attachBattleListeners of its
 * own (nothing on it is actionable), so its one interactive bit lives here
 * instead of duplicating a whole click-handling setup just for this. */
function _bindStatusBadgeClicks() {
  if (_statusClickHandler) document.removeEventListener('click', _statusClickHandler);
  _statusClickHandler = (e) => {
    const badge = e.target.closest?.('.status-badge[data-server-status-id]');
    if (badge) { _openStatusDetail(badge.dataset.combatantId, badge.dataset.serverStatusId); return; }
    const foreignMain = e.target.closest?.('.wip-foreign-focus-full .combat-card-main');
    if (!foreignMain) return;
    const id = foreignMain.closest('.wip-foreign-focus-full')?.dataset.focusId;
    _foreignCollapsedId = _foreignCollapsedId === id ? null : id;
    const el = document.getElementById('wipBattlePhase');
    if (el && session) el.innerHTML = _renderMainFocusHtml(session);
  };
  document.addEventListener('click', _statusClickHandler);
}

function _currentTrainerName() {
  const trainerData = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
  return trainerData[1] || '';
}
