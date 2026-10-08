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
import { pickTarget, pickTargetAgain, setMoveAbilityResolver, setMoveFlagResolver, setWeatherAttackModeResolver } from '../utils/target-picker.js';
import { setSaveAbilityResolver } from '../utils/save-picker.js';
import { pickSwitchTile } from '../utils/token-placement-picker.js';
import { waitForOpenWindow } from '../utils/reaction-window.js';
import { pickSaveTarget, confirmSecondarySave, pickManualSaveTarget } from '../utils/save-picker.js';
import { pickMultipleTargets } from '../utils/multi-target-picker.js';
import { computeMoveDC, bestMoveStatModifier } from '../utils/pokemon-types.js';
import { showBattleMap, updateBattleMap } from '../utils/battle-map-popup.js';
import { pickTerrainArea, radiusFtFromRange } from '../utils/terrain-area-picker.js';
import { injectBattleMapStyles, zoneKind, spriteTransform } from '../utils/battle-map-view.js';
import { promptHazard, closeHazardPopup, isHazardPopupOpen } from '../utils/hazard-popup.js';
import { playBattleAnimationFloating } from '../utils/move-popup.js';
import { pickRepositionCell } from '../utils/reposition-picker.js';
import { gridCellsHtml, gridTemplateStyle, cellRect, footprintForSize, footprintCells } from '../utils/battle-map-grid.js';
import { patchPortraitMedia, prefetchSprite } from '../utils/sprite-media.js';
import { visibleToViewer } from '../utils/combat-visibility.js';
import { showCombatAlert, showCombatConfirm, showCombatPrompt } from '../utils/combat-alert.js';
import { showBattleLog, updateBattleLog } from '../utils/battle-log-popup.js';
import { showEffectsPopup } from '../utils/effects-popup.js';
import { showReactionPromptIfEligible } from '../utils/reaction-prompt-popup.js';
import { waitForDamagedReactions, waitForTargetedAoeReactions, waitForBeneficialReactions } from '../utils/reaction-wait-overlay.js';
import { promptRerollDamage } from '../utils/reroll-damage-popup.js';
import { pickOneStatus, pickOneMoveName, pickOneAbility } from '../utils/status-picker.js';
import { promptHealRoll, promptDrainRoll, promptValueRoll } from '../utils/heal-popup.js';
import { showStatusDetail } from '../utils/status-popup.js';
import { createBaseStatSync } from '../utils/stat-sync.js';
import { setTargetabilityResolver } from '../utils/targetability.js';
import { evaluateEffect, buildStatusSpec, untargetableState, UNTARGETABLE_STATES, parseAbilityList, effectiveAbilities, critThreshold, statusLabel, describeStatusEnds, pendingTurnSaves, pendingTurnHeals, statDeltas, statSetOverrides, reapplyStatDeltas, effectiveStats, isConcentration, guaranteedCritStatusId, guaranteedHitStatusId, tempHpRemaining, activeBuffCount, activeBuffCountsByStat, echoedVoiceMultiplier, maxSpeed, damageRollBonusOf, terrainKindOf, terrainHealDice, terrainsAffecting, weathersAffecting, weatherKindOf, applyWeatherVariants, weatherAttackMode, isGrounded, tierAt, critReductionFrom, zoneRuleActive, isMeleeMoveRow, isGroundedIn } from '../utils/move-effects.js';
import { CONDITION_RULES } from '../utils/condition-rules.js';
import {
  renderSetupPhase, attachSetupListeners,
  renderInitiativePhase, attachInitiativeListeners,
  buildTrainerCombatant, buildPokemonCombatant,
  renderBattlePhase, attachBattleListeners, rerenderBattle, setBattleCardOptions, renderCombatCard,
  setCombatStateKey, setOnCombatStateSave, setOnLogEvent, setOnSwitchPokemon, openSwitchPopup, moveCategoriesFor, moveEffectsFor, moveFlagsFor, findMoveRow,
  buildKnownMovesString, COMBAT_CSS,
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
  .wip-turn-reaction-dot.bonus { background: #f39c12; }
  .wip-turn-reaction-dot.used { background: #6b6b6b; }
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
  .wip-foreign-focus-full { max-width: 700px; margin: 0 auto; padding: 0 0.8rem; }
  /* Damage/HP-VP Calculator stacks below the HP+VP rows instead of beside
     them (its own single-line text, set by the same compactWip option,
     needs the extra width that frees up). */
  #wipBattlePhase .hpvp-hpvp-left--stacked { flex-direction: column; align-items: stretch; }
  /* End Turn, moved below the moves section by the same option, centered
     rather than left-aligned like a plain block-level button defaults to. */
  #wipBattlePhase .combat-end-turn-bottom { display: block; width: fit-content; margin: 0.7rem auto 0.9rem; }

  /* ===================================================================================================================
     Card redesign (shared battle only -- the legacy local combat page keeps combat.js's own look). Same dark-navy glass
     as the battle map: one panel per card, the portrait in a ringed tile, big HP/VP bars, ability scores as tiles, each
     expanded section as its own sub-panel. Purely a style layer over combat.js's markup -- every button, input and
     data-* hook is untouched, so nothing about how the card works changes.
     =================================================================================================================== */
  #wipBattlePhase .combat-page { background: transparent; }
  #wipBattlePhase .battle-list { padding: 0.4rem 0.8rem 0.8rem; gap: 0.8rem; }
  #wipBattlePhase .combat-card {
    --ring: 140,170,255;
    background: linear-gradient(180deg, rgba(30,34,64,0.96), rgba(16,18,40,0.98));
    border: 1px solid rgba(var(--ring), 0.22); border-radius: 18px; overflow: hidden;
    box-shadow: 0 14px 40px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05);
  }
  #wipBattlePhase .combat-card--active {
    --ring: 255,215,0;
    border: 1px solid rgba(255,215,0,0.75);
    box-shadow: 0 0 0 1px rgba(255,215,0,0.35), 0 0 28px rgba(255,215,0,0.22), 0 14px 40px rgba(0,0,0,0.55);
  }
  #wipBattlePhase .combat-card--fainted { opacity: 0.55; filter: grayscale(0.7); }

  /* ---- header ---- */
  #wipBattlePhase .combat-card-main {
    gap: 1rem; padding: 1rem 1.1rem 0.9rem; cursor: default;
    background: radial-gradient(ellipse at 0% 0%, rgba(var(--ring), 0.12), transparent 60%);
  }
  #wipBattlePhase .combat-card-img {
    width: 104px; height: 104px; border-radius: 16px; padding: 4px; box-sizing: border-box;
    background: radial-gradient(circle at 50% 30%, rgba(255,255,255,0.16), rgba(8,10,22,0.75) 75%);
    box-shadow: 0 0 0 2px rgba(var(--ring), 0.85), 0 0 18px -2px rgba(var(--ring), 0.6), inset 0 0 12px rgba(0,0,0,0.5);
  }
  #wipBattlePhase .combat-initiative-badge--under-portrait {
    margin-top: 0.35rem; font-size: 0.68rem; font-weight: 800; letter-spacing: 0.04em; color: #0b0d1a;
    background: rgb(var(--ring)); padding: 0.12rem 0.55rem; border-radius: 999px;
  }
  #wipBattlePhase .combat-card-name-row { gap: 0.45rem; margin-bottom: 0.55rem; }
  #wipBattlePhase .combat-card-name { font-size: 1.3rem; font-weight: 800; letter-spacing: 0.02em; color: #f4f6ff; }
  #wipBattlePhase .combat-card-level {
    font-size: 0.72rem; font-weight: 700; color: #b9c8ff; padding: 0.12rem 0.5rem; border-radius: 999px;
    background: rgba(140,170,255,0.14); border: 1px solid rgba(140,170,255,0.3);
  }
  #wipBattlePhase .combat-card-name-row .type-badge { border-radius: 999px; padding: 0.15rem 0.6rem; font-size: 0.68rem; letter-spacing: 0.05em; }
  #wipBattlePhase .wip-react-btn {
    margin-left: auto; border-radius: 999px; padding: 0.35rem 0.9rem; font-weight: 700;
    background: linear-gradient(135deg, #f1c40f, #d68910); color: #1a1300; border: none; box-shadow: 0 0 14px rgba(241,196,15,0.35);
  }
  #wipBattlePhase .wip-react-btn:disabled { background: rgba(255,255,255,0.08); color: #8a8fb0; box-shadow: none; }

  /* AC chip + HP / VP bars */
  #wipBattlePhase .combat-card-stats-group { background: none; padding: 0; margin-bottom: 0.65rem; display: flex; flex-direction: column; gap: 0.45rem; }
  #wipBattlePhase .combat-card-ac-line {
    align-self: flex-start; font-size: 0.78rem; color: #cfd6ff; margin: 0; padding: 0.2rem 0.65rem; border-radius: 999px;
    background: rgba(140,170,255,0.12); border: 1px solid rgba(140,170,255,0.28);
  }
  #wipBattlePhase .combat-card-ac-line::before { content: '🛡 '; }
  #wipBattlePhase .combat-card-stats-group .combat-card-stats-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.7rem; font-size: 0.8rem; }
  #wipBattlePhase .stat-bar-wrap { flex-wrap: wrap; gap: 0.15rem 0.35rem; color: #a9b0d6; }
  #wipBattlePhase .stat-bar-wrap strong { color: #f4f6ff; font-size: 0.95rem; }
  #wipBattlePhase .mini-bar { flex-basis: 100%; width: auto; height: 8px; border-radius: 999px; background: rgba(255,255,255,0.08); box-shadow: inset 0 1px 2px rgba(0,0,0,0.5); }
  #wipBattlePhase .mini-bar-fill { border-radius: 999px; }
  #wipBattlePhase .hp-bar { background: linear-gradient(90deg, #27ae60, #58d68d); box-shadow: 0 0 8px rgba(46,204,113,0.55); }
  #wipBattlePhase .vp-bar { background: linear-gradient(90deg, #2e86de, #5dade2); box-shadow: 0 0 8px rgba(52,152,219,0.55); }

  /* ability scores as tiles */
  #wipBattlePhase .combat-mods-row { grid-template-columns: repeat(6, 1fr); gap: 0.35rem; font-size: 0.74rem; color: #d7dcff; }
  #wipBattlePhase .combat-mods-row > span {
    display: flex; flex-direction: column; align-items: center; line-height: 1.2; padding: 0.3rem 0.1rem; border-radius: 10px;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(140,170,255,0.14); font-weight: 700;
  }
  #wipBattlePhase .combat-mods-row small { color: #8f97c4; font-weight: 600; margin: 0; }

  /* footer: live status badges */
  #wipBattlePhase .combat-card-footer { background: rgba(0,0,0,0.18); border-top: 1px solid rgba(140,170,255,0.12); padding: 0.5rem 1.1rem; min-height: 0; }
  #wipBattlePhase .combat-card-footer:has(.combat-status-badges:empty) { display: none; }
  #wipBattlePhase .status-badge { border-radius: 999px; }

  /* ---- expanded sections: each its own sub-panel ---- */
  #wipBattlePhase .combat-card-expanded { background: none; border-top: none; padding: 0.3rem 0.8rem 0.4rem; display: flex; flex-direction: column; gap: 0.6rem; }
  #wipBattlePhase .expanded-feats-section,
  #wipBattlePhase .expanded-info-section,
  #wipBattlePhase .expanded-hpvp-section,
  #wipBattlePhase .expanded-stats-adj-section,
  #wipBattlePhase .expanded-status-section,
  #wipBattlePhase .expanded-trainer-actions,
  #wipBattlePhase .expanded-moves-section {
    padding: 0.75rem 0.85rem; border: 1px solid rgba(140,170,255,0.13); border-radius: 14px; background: rgba(255,255,255,0.025);
  }
  #wipBattlePhase .expanded-section-label {
    display: flex; align-items: center; gap: 0.45rem; font-size: 0.68rem; letter-spacing: 0.14em; color: #9fb0ff; margin-bottom: 0.55rem;
  }
  #wipBattlePhase .expanded-section-label::before { content: ''; width: 3px; height: 0.85rem; border-radius: 2px; background: rgb(var(--ring)); box-shadow: 0 0 6px rgba(var(--ring), 0.8); }
  #wipBattlePhase .info-row { font-size: 0.85rem; padding: 0.2rem 0; }
  #wipBattlePhase .info-row + .info-row { border-top: 1px solid rgba(255,255,255,0.05); }
  #wipBattlePhase .info-label { color: #8f97c4; min-width: 92px; }

  /* steppers */
  #wipBattlePhase .hpvp-stat-label { color: #b9c8ff; min-width: 26px; }
  #wipBattlePhase .hpvp-btn, #wipBattlePhase .stat-delta-btn {
    width: 30px; height: 30px; border-radius: 50%; border: 1px solid rgba(140,170,255,0.3);
    background: rgba(140,170,255,0.1); color: #e8ecff; font-weight: 700; transition: background 0.12s, transform 0.08s;
  }
  #wipBattlePhase .stat-delta-btn { width: 26px; height: 26px; }
  #wipBattlePhase .hpvp-btn:hover, #wipBattlePhase .stat-delta-btn:hover { background: rgba(255,215,0,0.28); }
  #wipBattlePhase .hpvp-btn:active, #wipBattlePhase .stat-delta-btn:active { transform: scale(0.92); }
  #wipBattlePhase .hpvp-input, #wipBattlePhase .stat-adjust-val {
    background: rgba(8,10,22,0.6); border: 1px solid rgba(140,170,255,0.25); border-radius: 10px; color: #f4f6ff; font-weight: 700; padding: 0.3rem;
  }
  #wipBattlePhase .hpvp-input:focus, #wipBattlePhase .stat-adjust-val:focus { outline: none; border-color: #FFD700; box-shadow: 0 0 0 2px rgba(255,215,0,0.25); }
  #wipBattlePhase .hpvp-hpvp-right { border-left-color: rgba(140,170,255,0.15); }
  #wipBattlePhase .combat-type-calc-btn { border-radius: 999px; }
  #wipBattlePhase .stat-adjust-grid { gap: 0.5rem; }
  #wipBattlePhase .stat-adjust-item { background: rgba(255,255,255,0.03); border: 1px solid rgba(140,170,255,0.12); border-radius: 12px; padding: 0.45rem 0.5rem; }
  #wipBattlePhase .stat-adjust-name { color: #d7dcff; }

  /* status + trainer actions */
  #wipBattlePhase .add-status-btn, #wipBattlePhase .combat-trainer-action-btn {
    border-radius: 999px; background: rgba(140,170,255,0.08); border: 1px solid rgba(140,170,255,0.25); color: #e8ecff; transition: background 0.12s;
  }
  #wipBattlePhase .add-status-btn:hover, #wipBattlePhase .combat-trainer-action-btn:hover { background: rgba(255,215,0,0.2); }
  #wipBattlePhase .status-remove-hint { color: #8f97c4; }

  /* moves as a grid of type-coloured buttons */
  #wipBattlePhase .expanded-moves-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.5rem; }
  #wipBattlePhase .combat-move-row { display: block; }
  #wipBattlePhase .combat-move-item {
    width: 100%; padding: 0.55rem 0.7rem; border-radius: 12px; font-size: 0.85rem; font-weight: 800; text-align: center;
    box-shadow: 0 4px 12px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.25); transition: transform 0.08s, filter 0.12s;
  }
  #wipBattlePhase .combat-move-item:not(:disabled):not(.combat-move-item--display):hover { filter: brightness(1.12); transform: translateY(-1px); }
  #wipBattlePhase .combat-move-item--display { box-sizing: border-box; }

  /* End Turn */
  #wipBattlePhase .end-turn-btn {
    border-radius: 999px; padding: 0.55rem 1.6rem; font-size: 0.95rem; font-weight: 800; letter-spacing: 0.03em;
    background: linear-gradient(135deg, #f39c12, #d35400); box-shadow: 0 0 18px rgba(230,126,34,0.45);
  }
  #wipBattlePhase .combat-end-turn-bottom { margin: 0.4rem auto 1rem; }

  @media (max-width: 560px) {
    #wipBattlePhase .combat-mods-row { grid-template-columns: repeat(3, 1fr); }
    #wipBattlePhase .combat-card-img { width: 84px; height: 84px; }
    #wipBattlePhase .combat-card-name { font-size: 1.1rem; }
  }
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
  /* Stage, grid, cells and tokens are styled by battle-map-view.js (shared with the in-app map popup), injected in
     renderPlacementPhase. aspect-ratio is set inline from the board's own cols/rows so cells stay square. */
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
  .placement-actions { display: flex; align-items: center; justify-content: center; gap: 0.6rem; flex-wrap: wrap; }
  .placement-rotate { display: inline-flex; gap: 0.3rem; }
  .placement-rotate-btn {
    border: none; border-radius: 999px; min-width: 2.4rem; height: 2.4rem; font-size: 1.1rem; font-weight: 700; cursor: pointer;
    background: rgba(255,255,255,0.1); color: #e8ecff;
  }
  .placement-rotate-btn:hover { background: rgba(255,215,0,0.28); }
  .placement-token.ghost { opacity: 0.5; }
  .placement-token.ghost .placement-token-portrait { outline-color: rgba(255,215,0,0.55); }
  .placement-token.staged { opacity: 0.85; }
  .placement-token.staged .placement-token-portrait { outline: 2px dashed #27ae60; outline-offset: 3px; animation: placementPulse 1.1s ease-in-out infinite; }
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
let _placementKeyHandler = null;
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
// Pokemon name -> its sessionStorage pokemon_* key. One per Pokemon: a trainer can switch between several in one battle.
const _myPokemonKeys = new Map();

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
    abilities: effectiveAbilities(p) || '', item: p.item || '',
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
  setOnSwitchPokemon((bench, options) => _switchPokemonShared(bench, options)); // swaps on the server, not the local mirror
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
  setOnSwitchPokemon(null); // the legacy local combat page switches in its own local state again
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
 * owns, by matching its name -- _myPokemonKeys is filled directly the moment
 * this device rolls initiative for it (see the initiative onComplete
 * handler below), but a page reload mid-battle loses that module var, so
 * this re-derives it from the party list the same way Setup does. */
function _resolveMyPokemonKey(participantName) {
  // Cached per NAME -- it used to remember only the first Pokemon it found, so a Pokemon switched in later was built from
  // the first one's data (its card showed the Pokemon that had left).
  if (_myPokemonKeys.has(participantName)) return _myPokemonKeys.get(participantName);
  for (const key of Object.keys(sessionStorage)) {
    if (!key.startsWith('pokemon_')) continue;
    const pData = JSON.parse(sessionStorage.getItem(key) || '[]');
    if ((pData[36] || pData[2]) === participantName) {
      _myPokemonKeys.set(participantName, key);
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

/** Distinct move TYPES (Fire, Water, ...) actually dealt as damage in the
 * shared log, from the entry AFTER `pid`'s own 'join' entry onward --
 * Archive Blast's own condition (see _syncLocalCombatState's own comment).
 * Only 'damage' log entries carry a moveType at all (see
 * routes_combat.py's _apply_damage_to_target) -- a non-damaging move use
 * isn't logged with type info anywhere, so "witnessed" here really means
 * "witnessed dealing damage", a deliberate (and reasonable) approximation
 * given what's actually reliably in the log. No 'join' entry for this
 * participant (shouldn't happen -- every participant gets one) -- empty. */
function _witnessedMoveTypesSince(session, pid) {
  const log = session.log || [];
  const joinIdx = log.findIndex(e => e.type === 'join' && e.actorId === pid);
  if (joinIdx === -1) return [];
  const types = new Set();
  for (let i = joinIdx + 1; i < log.length; i++) {
    const entry = log[i];
    if (entry.type === 'damage' && entry.moveType) types.add(entry.moveType);
  }
  return [...types];
}

/** {moveName, count} -- how many CONSECUTIVE prior rounds `pid` has landed
 * a hit with the SAME move, read straight off the shared log. Fury Cutter/
 * Ice Ball/Rollout's own "double the dice each consecutive [turn/round]
 * you hit" escalation -- moveName is whatever move they hit with on their
 * most recent prior round (null if none), count is how many rounds in a
 * row (going backward, unbroken) that exact move landed (0 = no streak at
 * all yet, this would be their first use). A round with no matching
 * 'damage' log entry from this attacker -- whether they missed, used a
 * different move, or were incapacitated (which already blocks move-use
 * entirely, see routes_combat.py's INCAPACITATING_CONDITIONS) -- ends the
 * streak right there. The rules' own "also resets if your speed is reduced
 * to 0" clause (Ice Ball/Rollout) isn't separately checked -- a narrow edge
 * case (speed independently dropping to 0 while still somehow landing
 * hits with an unrelated move) -- documented, not modeled. WIP-only, same
 * log-dependency limitation as _witnessedMoveTypesSince/Bide's own damage
 * tracking (empty on the legacy standalone engine, which has no log). */
function _lastHitMoveStreak(session, pid) {
  const log = session.log || [];
  const currentRound = session.round || 0;
  let moveName = null, count = 0;
  for (let round = currentRound - 1; round >= 1; round--) {
    const hit = log.find(e => e.type === 'damage' && e.actorId === pid && e.round === round);
    if (!hit) break;
    if (moveName === null) moveName = hit.move || null;
    if (hit.move !== moveName) break;
    count++;
  }
  return { moveName, count };
}

setMoveFlagResolver((moveName) => moveFlagsFor(moveName));
// Wonder Room: WIS saves become CON saves and CON saves become WIS saves for creatures standing in it.
setSaveAbilityResolver((ability, saver) => {
  if (!saver?.id || !zoneRuleActive(terrainsAffecting(session, saver.id), 'wonder_room')) return ability;
  return ability === 'WIS' ? 'CON' : ability === 'CON' ? 'WIS' : ability;
});
// Hurricane's advantage in rain / disadvantage in harsh sunlight, read off the weather the attacker stands in.
setWeatherAttackModeResolver((moveName, attackerId) => {
  // Smog: "any attacks made from inside it are done at disadvantage" -- a zone rule on the attacker's own tile.
  const smog = terrainsAffecting(session, attackerId).find(t => t.rule === 'smog');
  if (smog) return { mode: 'disadvantage', note: `Attacking from inside ${smog.name}: disadvantage` };
  return weatherAttackMode(moveEffectsFor(moveName), weathersAffecting(session, attackerId));
});
// Semi-invulnerable targets (underground, airborne, ...) are hidden from every picker unless the move
// lists their state in `hitsStates`.
setTargetabilityResolver((participant, moveName) => {
  const hidden = untargetableState(participant, moveFlagsFor(moveName).hitsStates || []);
  if (hidden) return hidden;
  // Earthquake, Bulldoze, Land's Wrath, ...: "each grounded creature" -- a flyer (or anything up in the air) isn't hit.
  if (moveFlagsFor(moveName).affectsGroundedOnly && !_groundedNow(participant.id)) return 'not grounded';
  // Dream Eater, Dream Rush, Dream Seal, Nightmare, Cerulean Haunt: only a sleeping creature.
  const needs = moveFlagsFor(moveName).targetRequiresStatus;
  if (needs && !(participant.statuses || []).some((s) => s.kind === 'condition' && s.apply === needs)) return `not ${needs}`;
  return null;
});
// Nasty Plot's "attacks with the Wisdom move power": which ability keys a move's power uses.
setMoveAbilityResolver((moveName) => String(findMoveRow(moveName)?.[2] || '').split('/').map((m) => m.trim().toUpperCase()).filter(Boolean));

/** Throat Chop: "unable to activate sound based attacks for its next 1d4 turns". Rolls the 1d4 (typed in),
 * then disables every move the target KNOWS that's flagged `soundBased` (the move data's own flag) via the
 * existing `move_disabled` condition, each ending after that many of the target's own turns. */
async function _handleDisableSoundMoves({ targetId, moveName, sourceId, sourceName, dc }) {
  const target = session?.participants?.[targetId];
  if (!target) return;
  const sound = (target.moves || []).filter((m) => moveFlagsFor(m).soundBased);
  if (!sound.length) {
    showCombatAlert(`${target.name} knows no sound-based moves -- ${moveName} has nothing to silence.`, { title: moveName });
    return;
  }
  const turns = await promptValueRoll({ dice: '1d4', moveName, description: `${moveName} -- roll 1d4: how many of ${target.name}'s turns are they unable to use sound-based moves?` });
  if (!turns || turns < 1) return;
  try {
    for (const name of sound) {
      await CombatAPI.applyStatus(targetId, buildStatusSpec(
        { kind: 'condition', apply: 'move_disabled', value: name },
        { sourceId, sourceName, moveName, dc, ends: [{ type: 'until_turn', whose: 'holder', point: 'end', count: turns }] }));
    }
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
  }
}

/** Entrainment / Role Play / Skill Swap / Simple Beam: temporarily replace one ability with another via
 * `ability_override` statuses (see move-effects.js's effectiveAbilities -- an overlay computed from the
 * session's base abilities, never written back, so it can't outlive the status, the combat or the
 * participant). Modes: 'give' (Entrainment: one of THEIR abilities becomes one of YOURS), 'take' (Role
 * Play: one of YOURS becomes one of THEIRS), 'swap' (Skill Swap: both directions), 'replace_with' (Simple
 * Beam: one of THEIRS becomes `replacement`, name only). The human picks which abilities. */
async function _handleAbilitySwap({ mode, attackerId, targetId, moveName, ends, dc, replacement }) {
  const attacker = session?.participants?.[attackerId];
  const target = session?.participants?.[targetId];
  if (!attacker || !target) return;
  const mine = parseAbilityList(effectiveAbilities(attacker));
  const theirs = parseAbilityList(effectiveAbilities(target));
  const needMine = mode !== 'replace_with';
  if ((needMine && !mine.length) || !theirs.length) {
    showCombatAlert(`${moveName} needs both creatures to have an ability on record -- apply it by hand.`, { title: moveName });
    return;
  }
  const body = (a) => `${a.name}${a.desc ? `;${a.desc}` : ''}`;
  const apply = async (holderId, replacedName, replacementText) => {
    await CombatAPI.applyStatus(holderId, buildStatusSpec(
      { kind: 'condition', apply: 'ability_override', value: replacedName, value2: replacementText },
      { sourceId: attackerId, sourceName: attacker.name, moveName, dc, ends }));
  };
  try {
    if (mode === 'replace_with') {
      const t = await pickOneAbility(theirs, { title: moveName, message: `Which of ${target.name}'s abilities becomes ${replacement}?` });
      if (!t) return;
      await apply(targetId, t.name, replacement);
    } else if (mode === 'give') {
      const t = await pickOneAbility(theirs, { title: moveName, message: `Which of ${target.name}'s abilities is replaced?` });
      if (!t) return;
      const m = await pickOneAbility(mine, { title: moveName, message: `Which of your abilities do they get?` });
      if (!m) return;
      await apply(targetId, t.name, body(m));
    } else if (mode === 'take') {
      const m = await pickOneAbility(mine, { title: moveName, message: `Which of your abilities is replaced?` });
      if (!m) return;
      const t = await pickOneAbility(theirs, { title: moveName, message: `Which of ${target.name}'s abilities do you copy?` });
      if (!t) return;
      await apply(attackerId, m.name, body(t));
    } else if (mode === 'swap') {
      const m = await pickOneAbility(mine, { title: moveName, message: `Which of your abilities do you give up?` });
      if (!m) return;
      const t = await pickOneAbility(theirs, { title: moveName, message: `Which of ${target.name}'s abilities do you take?` });
      if (!t) return;
      await apply(attackerId, m.name, body(t));
      await apply(targetId, t.name, body(m));
    }
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
  }
}

/** Guillotine/Horn Drill/Explosion: "roll a d20; on a 20 the target faints; if the target's level
 * is 10 more than your own, this automatically fails." One d20 per use (cached on the shared `ctx`
 * so an AoE like Explosion doesn't re-ask per creature); the level gate is per target. Fainting
 * sets HP to 0 -- the dying/"death" half of any lethal move is outside this tool by design. */
async function _handleFaintOnRoll({ attackerId, targetId, moveName, effect, ctx }) {
  const caster = session?.participants?.[attackerId];
  const target = session?.participants?.[targetId];
  if (!caster || !target) return;
  const gap = effect.levelGap;
  const casterLevel = Number(caster.level), targetLevel = Number(target.level);
  if (gap && Number.isFinite(casterLevel) && Number.isFinite(targetLevel) && targetLevel >= casterLevel + gap) {
    showCombatAlert(`${target.name} is ${gap}+ levels above ${caster.name} -- ${moveName} automatically fails against them.`, { title: moveName });
    return;
  }
  if (ctx.faintRoll === undefined) {
    ctx.faintRoll = await promptValueRoll({
      dice: '1d20', moveName,
      description: `${moveName} -- roll a d20 (${effect.min} or higher and the target faints).`,
    });
  }
  const roll = ctx.faintRoll;
  if (roll === null || roll === undefined) return; // closed without entering one
  const text = roll >= effect.min
    ? `${caster.name}'s ${moveName} succeeds (d20 = ${roll}) -- ${target.name} faints`
    : `${caster.name}'s ${moveName} fails (d20 = ${roll}) on ${target.name}`;
  if (roll >= effect.min && target.currentHP > 0) {
    try {
      await CombatAPI.updateStats(targetId, { currentHP: 0 });
    } catch (err) {
      showCombatAlert(err.message, { title: 'Error' });
      return;
    }
  }
  CombatAPI.logEvent({ type: 'faint', actorId: attackerId, actorName: caster.name, targetId, targetName: target.name, text }).catch(() => {});
}

/** First half of Dig/Dive/Bounce/Fly/Phantom Force/Shadow Force/Aqua Phase: the user "vanishes" into
 * `state` (a plain condition -- underground, underwater, airborne or vanished -- that hides them from
 * every target picker and from apply-damage unless the move lists the state in `hitsStates`), and gets a
 * one-use advantage on their next attack roll for the reappearing strike. Both end by the end of the
 * user's next turn. No attack, target or damage this time. */
async function _enterSemiInvulnerable(combatantId, moveName, state) {
  const holder = session?.participants?.[combatantId];
  const ends = [{ type: 'until_turn', whose: 'holder', point: 'end', count: 1 }];
  const common = { sourceId: combatantId, sourceName: holder?.name, moveName };
  try {
    await CombatAPI.applyStatus(combatantId, buildStatusSpec({ kind: 'condition', apply: state }, { ...common, ends }));
    await CombatAPI.applyStatus(combatantId, buildStatusSpec(
      { kind: 'roll', roll: 'advantage', on: 'attack_rolls', note: `The reappearing strike from ${moveName}` },
      { ...common, ends: [{ type: 'uses', n: 1 }, ...ends] }));
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
    return;
  }
  CombatAPI.logEvent({ type: 'vanish', actorId: combatantId, actorName: holder?.name, text: `${holder?.name || 'Someone'} used ${moveName} and is now ${state} -- can't be targeted until their next turn` }).catch(() => {});
}

/** Fire Shield's passive retaliation: after a MELEE hit lands on a target holding a
 * `retaliation_on_melee_hit` status (value = damage type, value2 = dice), prompt for the
 * damage roll and apply it to the attacker. Not a reaction -- no window, no floor-grab. The
 * roll prompt appears on the device that resolved the hit (the only one running this flow);
 * the table rolls physically either way. */
async function _maybeMeleeRetaliate(attackerId, targetId, moveName) {
  if (!isMeleeMoveRow(findMoveRow(moveName))) return;
  const holder = session?.participants?.[targetId];
  const shield = (holder?.statuses || []).find(s => s.kind === 'condition' && s.apply === 'retaliation_on_melee_hit');
  if (!shield || holder.currentHP <= 0) return;
  const attackerName = session?.participants?.[attackerId]?.name || 'the attacker';
  // Acid Armor: "must succeed on a CON save or take 1d6 poison damage" -- the attacker's save (enter 0 when it passes).
  const saveNote = shield.ability ? ` (${attackerName} makes a ${shield.ability} save -- enter 0 if it succeeds)` : '';
  const rolled = await promptValueRoll({
    dice: shield.value2, moveName: shield.moveName || 'Retaliation',
    description: `${holder.name}'s ${shield.moveName || 'shield'} erupts against ${attackerName} -- enter the ${shield.value || ''} damage roll${saveNote}`,
  });
  if (rolled === null || rolled <= 0) return;
  try {
    await CombatAPI.applyRetaliation(targetId, attackerId, rolled);
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
  }
}

/** Forced movement (`push`): the caster picks where the target lands. `direction` -- 'away' (every step increases the distance
 * to the caster: "pushed 30 feet away"), 'toward' (pulled, never onto the caster), 'choice' (either -- Magnetic Pulse), 'any'
 * (Circle Throw, Telekinetic Ray; Dawn Dance's random direction is rolled by the table). The distance is `ft`, the target's own
 * speed (`ft: 'speed'`, Roar), or by relative size (`bySize`, Circle Throw: 30ft if your size or smaller, 15ft one size larger,
 * 5ft two or more). Shorter is allowed ("until met by an impeding force"). */
async function _handlePush({ casterId, targetId, effect, moveName }) {
  const tokens = session?.board?.tokens || {};
  const c = tokens[casterId];
  const t = tokens[targetId];
  const target = session?.participants?.[targetId];
  if (!c || !t || !target || casterId === targetId) {
    showCombatAlert(`${moveName}: move ${target?.name || 'the target'} by hand (it isn't on the map).`, { title: moveName });
    return;
  }
  let ft = Number(effect.ft) || 0;
  if (effect.ft === 'speed') ft = maxSpeed(target) || 0;
  if (effect.bySize) {
    const rank = (p) => ({ tiny: 0, small: 1, medium: 2, large: 3, huge: 4, gigantic: 5 })[String(p?.size || 'medium').toLowerCase()] ?? 2;
    const diff = rank(target) - rank(session.participants[casterId]);
    ft = diff <= 0 ? effect.bySize[0] : diff === 1 ? effect.bySize[1] : effect.bySize[2];
  }
  ft = Math.floor(ft / 5) * 5;
  if (!ft) return;
  const cheb = (a, b, x, y) => Math.max(Math.abs(a - x), Math.abs(b - y));
  const d0 = cheb(c.col, c.row, t.col, t.row);
  const dir = effect.direction || 'away';
  const allow = (col, row) => {
    const steps = cheb(t.col, t.row, col, row);
    if (!steps) return false;
    const d1 = cheb(c.col, c.row, col, row);
    const away = d1 - d0 === steps;
    const toward = d0 - d1 === steps && d1 >= 1;
    return dir === 'any' || (dir === 'away' && away) || (dir === 'toward' && toward) || (dir === 'choice' && (away || toward));
  };
  const how = dir === 'away' ? 'away from' : dir === 'toward' ? 'toward' : dir === 'choice' ? 'toward or away from' : 'in any direction from';
  const name = visibleToViewer(target, 'name') ? target.name : '???';
  await pickRepositionCell(session, targetId, t.col, t.row, ft, {
    title: `${moveName}: move ${name}`,
    hint: `Up to ${ft}ft ${how} ${dir === 'any' ? 'where it stands' : session.participants[casterId]?.name || 'the user'}${effect.note ? ` -- ${effect.note}` : ''}. Close to skip.`,
    allow,
  });
}

/** 'hot' | 'cold' | 'temperate' -- the map's environment (Chill / Superheat set one; windy or none counts as temperate). */
function _environmentKind(state) {
  const k = state?.environment?.kind;
  return k === 'hot' || k === 'cold' ? k : 'temperate';
}

/** Dragon Tail: in a trainer battle the target's trainer must switch it out (their device opens the switch picker -- see
 * _maybePromptForcedSwitch); a creature nobody owns (a wild battle) instead moves up to half its speed away from the user. */
async function _handleForceSwitch({ casterId, targetId, effect, moveName }) {
  const target = session?.participants?.[targetId];
  if (!target) return;
  if (!target.owner || target.combatantType !== 'pokemon') {
    await _handlePush({ casterId, targetId, moveName, effect: { ft: Math.floor((maxSpeed(target) || 0) / 2), direction: 'away',
      note: 'a wild creature lower level than the user flees outright' } });
    return;
  }
  try {
    await CombatAPI.requestForcedSwitch(targetId, moveName, casterId);
  } catch (err) {
    showCombatAlert(err.message, { title: moveName });
  }
}

const _forcedSwitchPrompted = new Set();

/** The server says one of THIS viewer's Pokemon must be switched out (Dragon Tail): ask once, then open the switch picker.
 * Nothing to send in clears the request. */
function _maybePromptForcedSwitch(state) {
  const req = state?.pendingForcedSwitch;
  if (!req || req.owner !== _currentTrainerName()) return;
  const key = `${req.pokemonId}:${state.round}:${state.turnIndex}`;
  if (_forcedSwitchPrompted.has(key)) return;
  _forcedSwitchPrompted.add(key);
  const name = state.participants?.[req.pokemonId]?.name || 'Your Pokémon';
  const available = _benchFor(state, req.owner).filter(b => (b.currentHp ?? 1) > 0);
  if (!available.length) {
    showCombatAlert(`${name} is hit by ${req.moveName || 'a forced switch'}, but you have no other Pokémon to send in -- it stays.`, { title: req.moveName || 'Switch' });
    CombatAPI.clearForcedSwitch().catch(() => {});
    return;
  }
  showCombatAlert(`${name} is too frightened to stay in battle (${req.moveName || 'forced switch'}) -- choose who to send in.`, { title: 'Switch Pokémon' })
    .then(() => openSwitchPopup({}))
    .catch(() => {});
}

/** Sing: "Roll 5d8 + MOVE; the total is how many hit points of creatures this move can affect. Creatures within 30 feet of you
 * are affected in ascending order of their current hit points ... A creature's hit points must be equal to or less than the
 * remaining total." Creatures already asleep, at 0 HP, or out of reach (Fly, Dig) are skipped; one that can't fall asleep
 * (Misty / Electric Terrain, Safeguard, Uproar) is passed over without using up any of the total. */
async function _handleSleepPool({ casterId, effect, moveName }) {
  const caster = session?.participants?.[casterId];
  const tokens = session?.board?.tokens || {};
  if (!caster || !tokens[casterId]) {
    showCombatAlert(`${moveName}: ${caster?.name || 'the singer'} isn't on the map -- resolve it by hand.`, { title: moveName });
    return;
  }
  const dice = tierAt(effect.diceTiers, caster.level) || effect.dice;
  const mod = effect.addMove ? bestMoveStatModifier(findMoveRow(moveName) || [], caster) : 0;
  const pool = await promptValueRoll({ dice: mod ? `${dice}${mod > 0 ? '+' : ''}${mod}` : dice, moveName,
    description: `${moveName}: roll ${dice} + MOVE -- the total is how many hit points of creatures fall asleep` });
  if (pool === null || pool <= 0) return;
  const at = tokens[casterId];
  const reach = (effect.radiusFt || 30) / 5;
  const candidates = Object.values(session.participants)
    .filter(p => p.id !== casterId && p.status === 'participating' && tokens[p.id] && (p.currentHP ?? 0) > 0)
    .filter(p => Math.max(Math.abs(tokens[p.id].col - at.col), Math.abs(tokens[p.id].row - at.row)) <= reach)
    .filter(p => !untargetableState(p, []) && !(p.statuses || []).some(s => s.kind === 'condition' && s.apply === 'asleep'))
    .sort((a, b) => a.currentHP - b.currentHP);
  let left = pool;
  const slept = [];
  for (const p of candidates) {
    if (p.currentHP > left) break;
    try {
      await CombatAPI.applyStatus(p.id, buildStatusSpec({ kind: 'condition', apply: 'asleep' }, { sourceId: casterId, sourceName: caster.name, moveName }));
      left -= p.currentHP;
      slept.push(visibleToViewer(p, 'name') ? p.name : '???');
    } catch {
      // immune -- passed over without using up the total
    }
  }
  CombatAPI.logEvent({ type: 'save', actorId: casterId, actorName: caster.name,
    text: slept.length ? `${caster.name}'s ${moveName} (${pool}) puts ${slept.join(', ')} to sleep` : `${caster.name}'s ${moveName} (${pool}) puts nobody to sleep` }).catch(() => {});
}

/** Feet to the nearest hostile creature on the map (Chebyshev, 5ft squares -- the same distance the server's reaction ranges
 * use), or null when this participant or nobody hostile has a token. Hostile = another side, or another owner in PvP. */
function _nearestHostileFt(state, pid) {
  const tokens = state?.board?.tokens || {};
  const me = state?.participants?.[pid];
  const at = tokens[pid];
  if (!me || !at) return null;
  let best = null;
  for (const [id, p] of Object.entries(state.participants || {})) {
    if (id === pid || p.status !== 'participating' || !tokens[id]) continue;
    const hostile = p.side !== me.side || (state.battleType === 'pvp' && (p.owner || '') !== (me.owner || ''));
    if (!hostile) continue;
    const ft = Math.max(Math.abs(tokens[id].col - at.col), Math.abs(tokens[id].row - at.row)) * 5;
    if (best === null || ft < best) best = ft;
  }
  return best;
}

/** Blood Shield's own "melee damage you have dealt since the beginning of
 * your last turn": the sum of this participant's logged 'damage' entries
 * from the previous round (their last turn) through now whose move's range
 * is Melee. The log carries no range field, so each entry's move is looked
 * up in the moves dataset; an entry whose move can't be found is skipped
 * rather than guessed. WIP-only, same log-dependency limitation as every
 * other log-derived value here. */
function _meleeDamageSinceLastTurn(session, pid) {
  const since = (session.round || 0) - 1;
  let total = 0;
  for (const e of session.log || []) {
    if (e.type !== 'damage' || e.actorId !== pid || e.targetId === pid || e.round < since) continue;
    if (!e.move || !isMeleeMoveRow(findMoveRow(e.move))) continue;
    total += Number(e.amount) || 0;
  }
  return total;
}

/** Move names used by ANYONE so far in the CURRENT round, read straight off
 * the shared log -- Fusion Bolt's own "if Fusion Bolt or Fusion Flare was
 * already used this round, double the damage" (a combo move pair almost
 * always cast by two DIFFERENT creatures, unlike _lastHitMoveStreak's own
 * single-caster streak). Only 'move-used' log entries carry a move name at
 * all, so this is every move actually confirmed through the normal use-move
 * flow this round, hit or miss alike -- the condition only cares that the
 * move was USED, not that it landed. WIP-only, same log-dependency
 * limitation as every other bridged field here. */
function _movesUsedThisRound(session) {
  const log = session.log || [];
  const currentRound = session.round || 0;
  const names = new Set();
  for (const e of log) {
    if (e.type === 'move-used' && e.move && e.round === currentRound) names.add(e.move);
  }
  return [...names];
}

/** Whether `pid`'s own MOST RECENT attack (any move) missed, read straight
 * off the shared log -- Stomping Tantrum's own "if your last attack missed,
 * double the dice roll". Walks the log backward for `pid`'s own most recent
 * 'damage' or 'miss' entry (whichever comes first going backward) rather
 * than bounding by round, since "your last attack" means whenever that
 * actually was, even if it was earlier the SAME round. false (not true) if
 * no prior attack is found at all -- "your last attack missed" can't be
 * true with no last attack to judge. */
function _didLastAttackMiss(session, pid) {
  const log = session.log || [];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.actorId !== pid) continue;
    if (e.type === 'miss') return true;
    if (e.type === 'damage') return false;
  }
  return false;
}

/** The last move `pid` actually used, read straight off the shared log --
 * Oblivion Ink's own "the last move used by the creature is disabled" (a
 * one-time lookup at apply time, not a bridged WIP field, since nothing
 * needs to keep watching it the way _movesUsedThisRound/_didLastAttackMiss
 * do). Only 'move-used' entries carry a move name (routes_combat.py's
 * _apply_move logs one on every confirmed move use, hit or miss alike), so
 * this walks the log backward for pid's own most recent one. null if pid
 * hasn't used a move yet this encounter. */
function _lastMoveUsedBy(session, pid) {
  const log = session.log || [];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.type === 'move-used' && e.actorId === pid && e.move) return e.move;
  }
  return null;
}

/** The viewer's party Pokemon (party slots 1-6) that aren't currently fighting. One that has been in the battle before (benched
 * or fainted) keeps its session record -- id, HP, VP, initiative -- so switching back resumes it instead of starting fresh;
 * one that hasn't has to roll initiative when it's first sent out (combat.js's switch popup asks for it). */
function _benchFor(session, myName) {
  if (!myName) return [];
  const mine = Object.values(session.participants || {}).filter(p => p.owner === myName && p.combatantType === 'pokemon');
  const keys = [];
  for (const key of Object.keys(sessionStorage)) {
    if (!key.startsWith('pokemon_')) continue;
    try {
      const slot = parseInt(JSON.parse(sessionStorage.getItem(key))[38], 10);
      if (slot >= 1 && slot <= 6) keys.push({ key, slot });
    } catch { /* an unreadable cache entry is just not a party member */ }
  }
  keys.sort((a, b) => a.slot - b.slot);
  return keys.map(({ key }) => {
    const bench = { ...buildPokemonCombatant(key) };
    const existing = mine.find(p => p.name === bench.name);
    if (existing && existing.status === 'participating') return null; // already out there
    if (existing) {
      bench.id = existing.id;
      bench.currentHp = existing.currentHP; bench.currentVp = existing.currentVP;
      bench.hasRolledInitiative = true;
      bench.initiativeTotal = existing.initiative ?? bench.initiativeTotal;
    } else {
      bench.hasRolledInitiative = false;
    }
    return bench;
  }).filter(Boolean);
}

/** Switches the viewer's active Pokemon for `bench` in the shared battle: a Pokemon new to the fight is added to the session
 * first (as a spectator, with its freshly rolled initiative), then the server swaps the two -- map token, turn, and (Baton Pass)
 * statuses -- see routes_combat.py's _switch_pokemon. */
async function _switchPokemonShared(bench, options = {}) {
  const myName = _currentTrainerName();
  const out = Object.values(session?.participants || {}).find(p => p.owner === myName && p.combatantType === 'pokemon' && p.status === 'participating');
  if (!out) {
    showCombatAlert('You have no Pokémon in the battle to switch out.', { title: 'Switch' });
    return;
  }
  try {
    // Where it appears: a free tile within 20ft of the trainer, picked on the map. (No trainer or no map tokens: the server places it.)
    let tile = null;
    const trainer = Object.values(session.participants).find(p => p.owner === myName && p.combatantType === 'trainer' && session.board?.tokens?.[p.id]);
    if (trainer && session.board?.tokens?.[out.id]) {
      tile = await pickSwitchTile({ session, trainerId: trainer.id, outId: out.id, incoming: { name: bench.name, image: bench.image, size: bench.size } });
      if (!tile) return; // cancelled -- nothing has changed yet
    }
    let inId = bench.id && session.participants[bench.id] ? bench.id : null;
    if (!inId) {
      inId = `p${Math.random().toString(36).slice(2, 10)}`;
      await CombatAPI.addParticipant({ ..._combatantToParticipant(bench), id: inId, status: 'spectating' });
    }
    const result = await CombatAPI.switchPokemon(out.id, inId, !!options.pass, tile);
    // A hostile creature may get a chance to react (Pursuit, Block) -- the switch waits on that window; run its clock.
    if (result?.data?.pendingReaction) waitForOpenWindow();
  } catch (err) {
    showCombatAlert(err.message, { title: 'Switch' });
  }
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
    // Psychic Terrain: grounded creatures can't use bonus actions at all (the server rejects it too).
    merged.activeTerrains = terrainsAffecting(session, p.id); // only the terrains this combatant is standing in
    merged.itemsEmbargoed = (p.statuses || []).some((s) => s.kind === 'condition' && s.apply === 'embargo'); // Embargo: held items do nothing
    merged.activeWeathers = weathersAffecting(session, p.id); // ...and the weather (Solar Beam's "in harsh sunlight" reads this)
    const psychic = merged.activeTerrains.find(t => terrainKindOf(t) === 'psychic');
    merged.bonusActionBlockedBy = psychic && isGroundedIn(p, merged.activeTerrains) ? psychic.name : '';
    merged.bonusActionUsed = !!p.bonusActionUsed; // one bonus action per round -- see combat.js's _isBonusActionMove
    merged.bideHeld = !!p.bideHeld;
    // Archive Blast's own "every type of move you have witnessed so far
    // during this battle" -- distinct move types from the shared log,
    // AFTER this participant's own join entry ("since the user was sent
    // out", not from round 1 -- the user's own call). WIP-only, same
    // limitation as Bide -- the legacy standalone engine has no log
    // equivalent at all to derive this from.
    merged.witnessedMoveTypes = _witnessedMoveTypesSince(session, p.id);
    // Power Trip's own "each positive stat change affecting you" -- counted
    // straight off the raw session participant's own statuses (see
    // move-effects.js's activeBuffCount), same WIP-only bridging pattern as
    // witnessedMoveTypes above (quietly reads 0 on the legacy engine, which
    // never populates this field at all).
    merged.activeBuffCount = activeBuffCount(p);
    merged.activeBuffCountsByStat = activeBuffCountsByStat(p);
    merged.echoedVoiceMultiplier = echoedVoiceMultiplier(session, p.id);
    // Fury Cutter/Ice Ball/Rollout's own consecutive-hit escalation -- see
    // _lastHitMoveStreak's own docstring. Same WIP-only bridging pattern.
    merged.lastHitMoveStreak = _lastHitMoveStreak(session, p.id);
    // Fusion Bolt's own "if Fusion Bolt or Fusion Flare was already used
    // this round" -- see _movesUsedThisRound's own docstring. Same move
    // names regardless of WHO this combatant is, so it's bridged once per
    // sync, not scoped to p.id -- harmless to compute per-combatant since
    // _syncLocalCombatState already runs once per owned combatant anyway.
    merged.movesUsedThisRound = _movesUsedThisRound(session);
    // Stomping Tantrum's own "if your last attack missed" -- see
    // _didLastAttackMiss's own docstring. Same WIP-only bridging pattern.
    merged.lastAttackMissed = _didLastAttackMiss(session, p.id);
    // Calm Mind/Tail Glow's own "double your STAB [bonus/damage]" -- a
    // standalone flag condition (same family as guaranteed_next_crit/
    // guaranteed_next_hit, see move-effects-schema.md's own vocab note),
    // read straight off p's own live statuses and bridged onto the merged
    // combatant so computeMoveData's call in combat.js can see it (that
    // function only ever receives this WIP-built `c`, never the raw
    // session participant).
    merged.damageRollBonus = damageRollBonusOf(p);
    // Dig/Fly/...'s reappearing second use costs no VP again (see combat.js's vpCostOverride).
    merged.semiHeldMoves = (p.statuses || []).filter((s) => s.kind === 'condition' && UNTARGETABLE_STATES.includes(s.apply) && s.moveName).map((s) => s.moveName);
    merged.powerUpStacks = (p.statuses || []).find((s) => s.kind === 'condition' && s.apply === 'power_up')?.stacks || 0;
    // Spirit Growth: moves using these abilities cost half VP (see combat.js's vpCostOverride).
    merged.vpHalvedAbilities = (p.statuses || []).filter((s) => s.kind === 'condition' && s.apply === 'vp_cost_halved' && s.value).map((s) => String(s.value).toUpperCase());
    merged.stabMultiplier = (p.statuses || []).some((s) => s.kind === 'condition' && s.apply === 'stab_doubled') ? 2 : 1;
    // Move gates on the user's own state (combat.js's selfRequirementUnmet): Snore needs `asleep`, Recompose no enemy in reach.
    merged.liveStatuses = p.statuses || [];
    merged.environmentKind = _environmentKind(session); // Thermal Shock
    merged.enteredRound = p.enteredRound ?? null; // Fake Out / First Impression
    // Pursuit's doubled dice against a switch-out: the trigger of the window this participant is reacting to.
    merged.reactingToTrigger = session.reactingParticipantId === p.id ? (session.pendingReaction?.trigger || null) : null;
    merged.nearestHostileFt = _nearestHostileFt(session, p.id);
    // A direct read of the server's own pool (see move-effects.js's tempHpRemaining),
    // not a base+delta round-trip like the stat fields below -- it shrinks on its own as
    // damage lands, there's no "manual edit" to preserve.
    merged.tempHp = tempHpRemaining(p);
    // Entrainment/Role Play/Skill Swap/Simple Beam: the session's BASE abilities with any live overrides
    // applied (never persisted, so it reverts with the status / when the combat or the participant ends).
    if (p.abilities) merged.abilities = effectiveAbilities(p);
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
    // The trainer's party Pokemon that aren't in the battle right now -- what the "⇄ Switch Pokémon" picker offers.
    bench: _benchFor(session, myName),
    // Read off the server session, not this device's own local cache
    // (existing) -- weather/terrain are shared session state now (see
    // routes_combat.py's set-weather/set-terrain), so every device sees
    // whatever the DM actually set, not just whoever set it.
    weather: session.weather || null, terrain: session.terrain || null, environment: session.environment || null,
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
  injectBattleMapStyles();
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

// Which way the token being placed faces (degrees clockwise from up, 45-degree steps) -- turned with the buttons next to
// Confirm (or Q / E) and sent with confirm-placement.
let _stagedFacing = 0;

function _renderPlacementActions(currentId) {
  const el = document.getElementById('placementActions');
  if (!el) return;
  el.innerHTML = _stagedPosition
    ? `<div class="placement-rotate">
         <button type="button" class="placement-rotate-btn" data-turn="-45" title="Turn left 45° (Q)">⟲</button>
         <button type="button" class="placement-rotate-btn" data-turn="45" title="Turn right 45° (E)">⟳</button>
       </div>
       <button class="placement-confirm-btn" id="placementConfirmBtn">✅ Confirm Placement</button>`
    : '';
}

function _turnStagedPlacement(delta, currentId) {
  if (!_stagedPosition) return;
  _stagedFacing = (((_stagedFacing + delta) % 360) + 360) % 360;
  _renderPlacementTokens(session, currentId);
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
        <div class="placement-token-portrait"><div class="bmap-sprite" data-portrait-id="${id}" style="transform:${spriteTransform(pos.facing || 0)}"></div></div>
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
          <div class="placement-token-portrait"><div class="bmap-sprite" data-portrait-id="${currentId}" style="transform:${spriteTransform(_stagedFacing)}"></div></div>
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
  _stagedFacing = 0;
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
    const turn = e.target.closest('.placement-rotate-btn');
    if (turn) { _turnStagedPlacement(Number(turn.dataset.turn), currentId); return; }
    if (!e.target.closest('#placementConfirmBtn') || !_stagedPosition) return;
    const { col, row } = _stagedPosition;
    try {
      await CombatAPI.confirmPlacement(currentId, col, row, _stagedFacing);
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
    _stagedFacing = 0;
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

  // Q / E turn the staged token, same keys as the battle map.
  if (_placementKeyHandler) document.removeEventListener('keydown', _placementKeyHandler);
  _placementKeyHandler = (e) => {
    if (_joinStage !== 'placement' || !_stagedPosition || e.target.closest?.('input, select, textarea')) return;
    if (e.key === 'q' || e.key === 'Q') _turnStagedPlacement(-45, _placementQueue[0]);
    else if (e.key === 'e' || e.key === 'E') _turnStagedPlacement(45, _placementQueue[0]);
  };
  document.addEventListener('keydown', _placementKeyHandler);

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
  // Benched (switched-out) and spectating creatures aren't in the battle -- they don't belong in the turn order at all.
  const orderedIds = [
    ...state.turnOrder,
    ...Object.keys(state.participants).filter(id => !state.turnOrder.includes(id) && state.participants[id].status === 'participating'),
  ];

  const liveIds = new Set(orderedIds);
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
            <div class="wip-turn-reaction"><div class="wip-turn-reaction-dot" data-kind="reaction" title="Reaction"></div><div class="wip-turn-reaction-dot bonus" data-kind="bonus" title="Bonus action"></div></div>
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
    reactionEl.querySelector('[data-kind="reaction"]').classList.toggle('used', !!p.reactionUsed);
    reactionEl.querySelector('[data-kind="bonus"]').classList.toggle('used', !!p.bonusActionUsed);

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
  const manual = _focusManuallySet ? state.participants[_focusedParticipantId] : null;
  if (manual && manual.status === 'participating') return _focusedParticipantId;
  if (manual && manual.combatantType === 'pokemon' && manual.owner === _currentTrainerName()) {
    // The Pokemon you were looking at was switched out: follow the one that came in for it.
    const replacement = state.turnOrder.find(id => {
      const p = state.participants[id];
      return p && p.owner === manual.owner && p.combatantType === 'pokemon' && p.status === 'participating';
    });
    if (replacement) {
      _focusedParticipantId = replacement;
      return replacement;
    }
  }
  if (manual) _focusManuallySet = false; // the manual pick left the battle -- back to the default
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
    proficiency: p.proficiency, abilities: effectiveAbilities(p), item: p.item,
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
  // The card styles normally ride along inside the viewer's own battle markup (combat.js's renderBattlePhase), which this
  // replaces -- without them in <head> another player's card rendered as unstyled text.
  _ensureCombatCardStyles();
  return `<div class="wip-foreign-focus-full" data-focus-id="${p.id}">${renderCombatCard(_foreignCombatantView(p), false, { compactWip: true, readOnly: true })}</div>`;
}

/** Another trainer's own participants (themselves and their Pokemon) show their full card, read-only, in every battle type;
 * only a DM's enemy in PvE (no owner) keeps the short fog-of-war panel. */
function _showsFullForeignCard(state, p) {
  return state.battleType === 'pvp' || !!p.owner;
}

function _ensureCombatCardStyles() {
  if (document.getElementById('combat-card-base-styles')) return;
  const style = document.createElement('style');
  style.id = 'combat-card-base-styles';
  style.textContent = COMBAT_CSS;
  document.head.appendChild(style);
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
  if (!ctx.isMine) return _showsFullForeignCard(state, ctx.p) ? _renderForeignFocusFull(ctx.p) : _renderForeignFocusInfo(ctx.p);
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
      .then(() => _promptSleepCheck(endingId))
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
    if (_showsFullForeignCard(state, ctx.p)) {
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
      _maybePromptHazards(session);
      _maybeShowReactionPrompt(session);
      _maybePromptForcedSwitch(session);
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
    _maybePromptHazards(session);
    _maybeShowReactionPrompt(session);
    _maybePromptForcedSwitch(session);
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
        if (combatants[1]?.id) _myPokemonKeys.set(combatants[1].name, combatants[1].id);
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

/** Whether `combatantId`'s NEXT attack roll is guaranteed to hit -- a fixed
 * move-level property (guaranteed_hit-tagged moves like Aerial Ace/Aura
 * Sphere) OR a live status (Laser Focus's guaranteed_next_crit, Lock-On/
 * Mind Reader's guaranteed_next_hit). Re-checked fresh from the CURRENT
 * session on every call rather than cached once -- both status flags are
 * one-shot and get consumed (use-status) the moment an attack actually
 * resolves (see _resolveOneHit), so a multi-hit move's "hit again?" loop
 * must re-evaluate this each time through, not reuse whatever was true
 * before the first hit already spent it. */
function _guaranteedHitFor(combatantId, categories, moveName) {
  if (categories.includes('guaranteed_hit')) return true;
  const attacker = session?.participants?.[combatantId];
  // Thunderstorm Dance's standing "all electric type moves are guaranteed to hit" -- NOT
  // consumed (unlike the one-shot flags below), scoped to the move's own type.
  const moveType = String(findMoveRow(moveName)?.[1] || '').toUpperCase();
  if (moveType && (attacker?.statuses || []).some((st) => st.kind === 'condition' && st.apply === 'guaranteed_hit_type' && String(st.value || '').toUpperCase() === moveType)) return true;
  return !!guaranteedCritStatusId(attacker) || !!guaranteedHitStatusId(attacker);
}

/** The name of a move `combatantId` knows that carries `negatesProtectBlock`
 * (Feint), or '' if they don't know one -- target-picker.js has no
 * dependency on combat.js (see its own header comment) and so can't call
 * moveFlagsFor itself, hence resolving this HERE and passing the result in
 * as a plain string, same layering `moveCategoriesFor`'s own callers
 * already respect. Scans by flag, not by hardcoding "Feint", so a future
 * homebrew move with the same shape works with no code change. */
function _feintMoveNameFor(combatantId) {
  const attacker = session?.participants?.[combatantId];
  return (attacker?.moves || []).find(name => moveFlagsFor(name)?.negatesProtectBlock) || '';
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
  // Dig/Dive/Bounce/Fly/Phantom Force/...: the first use only vanishes the user; the next one (while
  // still in that state) reappears and attacks, with advantage -- see _enterSemiInvulnerable.
  const semiState = moveFlagsFor(moveName).semiInvulnerable;
  if (semiState) {
    const holder = session?.participants?.[combatantId];
    const held = (holder?.statuses || []).find((s) => s.kind === 'condition' && s.apply === semiState && s.moveName === moveName);
    if (!held) {
      await _enterSemiInvulnerable(combatantId, moveName, semiState);
      return;
    }
    try { await CombatAPI.removeStatus(combatantId, held.id, 'reappeared'); } catch (err) { showCombatAlert(err.message, { title: 'Error' }); }
  }
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
  // Target-conditional damage_note effects (Brine, Smelling Salts, Venoshock,
  // ...) -- see move-effects-schema.md and target-picker.js's own use of these.
  const damageNotes = _targetDamageNotes(moveName);
  const picked = await pickTarget(combatantId, { attackModifier, damageModifier, speciesName, guaranteedHit: _guaranteedHitFor(combatantId, categories, moveName), moveName, damageDice: computedData.damageDice, damageNotes, moveModValue: computedData.highestMod, nextTierDice: computedData.nextTierDice, feintMoveName: _feintMoveNameFor(combatantId) });
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
      nextPicked = await pickTargetAgain(target, target.name, { attackModifier, damageModifier, speciesName, guaranteedHit: _guaranteedHitFor(combatantId, categories, moveName), attacker: session?.participants?.[combatantId], moveName, damageDice: computedData.damageDice, damageNotes, moveModValue: computedData.highestMod, nextTierDice: computedData.nextTierDice });
    } else {
      nextPicked = await pickTarget(combatantId, { attackModifier, damageModifier, speciesName, guaranteedHit: _guaranteedHitFor(combatantId, categories, moveName), moveName, damageDice: computedData.damageDice, damageNotes, moveModValue: computedData.highestMod, nextTierDice: computedData.nextTierDice, feintMoveName: _feintMoveNameFor(combatantId) });
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
/** Clear Smog/Psych Up/Heart Swap/Spectral Thief/Haze's own "read the
 * currently active statuses on one or two participants and remove/copy/
 * swap/steal them" family -- not a status applied to the move's own user,
 * a one-shot bulk operation against whatever's ALREADY live right now.
 * `mode`:
 *   'dispel'     -- remove every kind:'stat' status from targetId (Clear
 *     Smog: "any stat changes ... are reset").
 *   'dispel_all' -- remove EVERY status regardless of kind (Haze: "stat
 *     bonuses, status effects, shields ... are removed" -- broader than
 *     plain 'dispel', which only ever touched kind:'stat'). The one mode
 *     that gets authored with `target:'self'` too (Haze hits everyone in
 *     its own blast radius, caster included) -- see the call site's own
 *     comment for why targetId has to come from `pick.targetId`, not the
 *     closure, for this to actually reach the caster.
 *   'dispel_conditions' -- remove every kind:'condition' status from
 *     targetId (Aromatherapy/Heal Bell's own "cured of all negative status
 *     ailments") -- the inverse scope of plain 'dispel', which only ever
 *     touches kind:'stat'. Also authored `target:'self'` + target-unset in
 *     pairs for an AoE (same Haze/Mat Block dual-effect shape), since
 *     Aromatherapy/Heal Bell heal "you and all allies", same reasoning as
 *     'dispel_all' above.
 *   'cure_named' -- Refresh's own "curing poison, paralysis, and burn", a
 *     NAMED subset of conditions (not "all ailments" the way
 *     dispel_conditions means it) -- `names` (array of `apply` values) says
 *     exactly which.
 *   'copy'       -- recreate every kind:'stat' status FROM targetId onto
 *     attackerId, target's own copy untouched (Psych Up).
 *   'swap'       -- exchange BOTH sides' current kind:'stat' statuses
 *     (Heart Swap).
 *   'steal'      -- move only targetId's POSITIVE kind:'stat' statuses
 *     onto attackerId, removed from target (Spectral Thief's own "steal
 *     all positive stat changes").
 *   'steal_choice' -- Aura Theft's own "loses ALL beneficial effects... the
 *     user gains the effects of ONE of these (user's choice)" -- every
 *     positive status still comes off the target, but the human picks
 *     (pickOneStatus) just ONE of them to recreate on the attacker.
 *   'swap_value' -- Guard Swap/Power Swap's own "switch [AC/an ability
 *     score] with the target" -- a DIFFERENT shape from plain 'swap' above
 *     (which moves whole status ENTRIES): this swaps the current EFFECTIVE
 *     VALUE of one named `field` via a `set`-override on each side instead,
 *     see its own case below for why (and why "speed" never belongs here).
 *   'swap_fastest_speed' -- Speed Swap's own "switch speed with the
 *     target" -- `speeds` is a whole array of movement types, not a flat
 *     scalar, so this swaps each side's own FASTEST recorded speed via a
 *     new `speed_override` condition instead of a `kind:'stat'` one.
 *   'transfer_condition' -- Psycho Shift's own "a status affecting [a
 *     willing ally, or yourself] is transferred to the target instead",
 *     shipped self-only (see its own case below for why "or a willing
 *     ally" isn't supported). Moves ONE kind:'condition' status, chosen by
 *     the human from the caster's own current list.
 *   'dispel_one' -- Searing Flame's own "burns away one positive effect on
 *     a hostile target, or one negative effect if used on an ally" --
 *     removes ONE status (stat or condition), chosen by the human from the
 *     target's own current list (this app has no hostile/ally concept to
 *     filter by itself, see its own case below).
 * Recreated statuses keep their ORIGINAL sourceId/sourceName/moveName/dc
 * (so a copied Focus Energy still reads "from Focus Energy", not "from
 * Psych Up") -- only the delta itself moves, never its own history. A
 * status's remaining duration isn't preserved exactly (it restarts from
 * its own authored `ends`, e.g. a fresh 10 rounds rather than however many
 * were actually left) -- a documented simplification, same "close enough"
 * trust level as everything else in this app that doesn't track exact
 * remaining-duration bookkeeping. */
async function _handleStatTransfer({ mode, attackerId, targetId, moveName, field, ends, dc, names }) {
  const attacker = session?.participants?.[attackerId];
  const target = session?.participants?.[targetId];
  if (!attacker || !target) return;
  const isPositive = (s) => typeof s.amount === 'number' && s.amount * (s.stacks || 1) > 0;
  const recreate = async (status, destId) => {
    // A stored status carries `stacks` as a COUNT; an apply spec wants {max}. Passing the count
    // through would crash the server's stack handling, so convert (the count itself resets to 1).
    if (typeof status.stacks === 'number') status = { ...status, stacks: status.stackMax ? { max: status.stackMax } : undefined };
    const spec = buildStatusSpec(status, {
      sourceId: status.sourceId, sourceName: status.sourceName, moveName: status.moveName,
      dc: status.dc, ends: status.ends,
    });
    try { await CombatAPI.applyStatus(destId, spec); } catch (err) { showCombatAlert(err.message, { title: 'Error' }); }
  };
  const remove = async (holderId, status, reason) => {
    try { await CombatAPI.removeStatus(holderId, status.id, reason); } catch (err) { showCombatAlert(err.message, { title: 'Error' }); }
  };

  if (mode === 'dispel_all') {
    for (const s of target.statuses || []) await remove(targetId, s, `dispelled by ${moveName}`);
    return;
  }
  if (mode === 'dispel_conditions') {
    // Aromatherapy/Heal Bell's own "cured of all NEGATIVE STATUS AILMENTS"
    // -- the inverse scope of plain 'dispel' (which only ever touches
    // kind:'stat'): this removes every kind:'condition' status instead,
    // leaving any active stat buffs/debuffs untouched. No "negative"
    // filtering beyond that -- this app has no condition that's ever
    // authored as a deliberate BENEFIT to its own holder, so "every
    // condition" and "every negative one" are the same set in practice.
    for (const s of (target.statuses || []).filter((st) => st.kind === 'condition')) {
      await remove(targetId, s, `cured by ${moveName}`);
    }
    return;
  }
  if (mode === 'cure_named') {
    // Refresh's own "curing poison, paralysis, and burn" -- a NAMED subset,
    // narrower than dispel_conditions's "every condition" (Refresh's own
    // text doesn't say "all status ailments", just these three by name, so
    // an unrelated condition like Confused is correctly left untouched).
    // `names` is a plain array of `apply` values, authored on the effect.
    for (const s of (target.statuses || []).filter((st) => st.kind === 'condition' && names.includes(st.apply))) {
      await remove(targetId, s, `cured by ${moveName}`);
    }
    return;
  }
  if (mode === 'invert') {
    // Topsy-Turvy's "any stat changes currently affecting the target have the opposite effect":
    // each flat stat status is replaced by one with the sign flipped (a `set` override or dice
    // amount has no sign to flip and is left alone). Stacks, ends and source carry over.
    for (const s of (target.statuses || []).filter((st) => st.kind === 'stat' && typeof st.amount === 'number' && st.amount !== 0)) {
      await remove(targetId, s, `reversed by ${moveName}`);
      await recreate({ ...s, amount: -s.amount * (s.stacks || 1) }, targetId); // fold the stack count into the amount
    }
    return;
  }
  if (mode === 'dispel_ac') {
    // Miracle Eye's own "any modifiers to their AC are reset" -- every AC stat status, buff
    // or debuff (including a `set` override), nothing else.
    for (const s of (target.statuses || []).filter((st) => st.kind === 'stat' && st.stat === 'ac')) {
      await remove(targetId, s, `reset by ${moveName}`);
    }
    return;
  }
  const targetStats = (target.statuses || []).filter(s => s.kind === 'stat');
  if (mode === 'dispel') {
    for (const s of targetStats) await remove(targetId, s, `dispelled by ${moveName}`);
    return;
  }
  if (mode === 'copy') {
    for (const s of targetStats) await recreate(s, attackerId);
    return;
  }
  if (mode === 'steal') {
    for (const s of targetStats.filter(isPositive)) {
      await remove(targetId, s, `stolen by ${moveName}`);
      await recreate(s, attackerId);
    }
    return;
  }
  if (mode === 'steal_choice') {
    // Aura Theft's own "the target loses ALL beneficial effects... the
    // user gains the effects of ONE of these (user's choice)" -- a
    // different shape from plain 'steal' above (which moves EVERY positive
    // stat buff, no choice involved): everything positive still comes OFF
    // the target, but only ONE of them is recreated on the attacker,
    // picked by the human from the removed list (status-picker.js's
    // pickOneStatus, same dynamic-list-picker shape Psycho Shift/Searing
    // Flame's own "choose which status" already uses).
    const positives = targetStats.filter(isPositive);
    if (!positives.length) {
      showCombatAlert(`${target.name} has no beneficial effects for ${moveName} to steal.`, { title: moveName });
      return;
    }
    for (const s of positives) await remove(targetId, s, `stripped by ${moveName}`);
    const chosen = await pickOneStatus(positives, {
      title: `${moveName} — choose which effect to gain`,
      message: `Pick one of ${target.name}'s former effects to gain for yourself.`,
    });
    if (chosen) await recreate(chosen, attackerId);
    return;
  }
  if (mode === 'swap') {
    // Snapshot BOTH sides before touching either -- these are plain JS
    // arrays of the status objects as they stood the instant this ran, not
    // live references, so removing/recreating below can't shift out from
    // under this loop (the client's own `session` mirror only updates on
    // the next SSE push, well after this whole function has finished).
    const selfStats = (attacker.statuses || []).filter(s => s.kind === 'stat');
    for (const s of targetStats) await remove(targetId, s, `swapped by ${moveName}`);
    for (const s of selfStats) await remove(attackerId, s, `swapped by ${moveName}`);
    for (const s of targetStats) await recreate(s, attackerId);
    for (const s of selfStats) await recreate(s, targetId);
    return;
  }
  if (mode === 'swap_own_ac') {
    // Power Trick: swap the caster's OWN AC with a chosen ability score (CON excluded -- the
    // popup's dropdown already omits it). Both become `set` overrides holding the other's
    // current value, same overlay model as swap_value, just between two fields of one holder.
    if (!field || field === 'con') {
      showCombatAlert(`No valid ability chosen for ${moveName} -- nothing to swap.`, { title: moveName });
      return;
    }
    const stats = effectiveStats(attacker);
    const ac = stats.ac, score = stats[field];
    if (!Number.isFinite(ac) || !Number.isFinite(score)) {
      showCombatAlert(`Couldn't read AC and ${field.toUpperCase()} -- swap them by hand.`, { title: moveName });
      return;
    }
    const specFor = (stat, value) => buildStatusSpec(
      { kind: 'stat', stat, set: value },
      { sourceId: attackerId, sourceName: attacker.name, moveName, dc, ends },
    );
    try {
      await CombatAPI.applyStatus(attackerId, specFor('ac', score));
      await CombatAPI.applyStatus(attackerId, specFor(field, ac));
    } catch (err) {
      showCombatAlert(err.message, { title: 'Error' });
    }
    return;
  }
  if (mode === 'average_value') {
    // Power Split: replace the caster's chosen score with the average of their current score and
    // the target's (rounded down, same as Guard Split).
    const value = _resolveSetValue({ avgWithTarget: field }, attacker, target);
    if (!field || value === null) {
      showCombatAlert(`Couldn't average ${String(field || '?').toUpperCase()} for ${moveName} -- apply it by hand.`, { title: moveName });
      return;
    }
    try {
      await CombatAPI.applyStatus(attackerId, buildStatusSpec(
        { kind: 'stat', stat: field, set: value },
        { sourceId: attackerId, sourceName: attacker.name, moveName, dc, ends },
      ));
    } catch (err) {
      showCombatAlert(err.message, { title: 'Error' });
    }
    return;
  }
  if (mode === 'swap_value') {
    // Guard Swap (field:"ac", fixed)/Power Swap (field left null in the
    // move's own data, filled in by the human via effects-popup.js's own
    // stat-choice dropdown -- see _needsStatChoice) -- unlike plain 'swap'
    // above (which moves WHOLE kind:'stat' STATUS ENTRIES), this swaps the
    // CURRENT EFFECTIVE VALUE of one named field, via effectiveStats, since
    // AC/an ability score's current value can come from base stats as much
    // as from an active status, which moving status entries alone could
    // never capture. Applies a `set`-override status to EACH side holding
    // the OTHER's current value -- the overlay model's own existing
    // snapshot-at-apply/restore-at-expiry behavior (see move-effects-
    // schema.md's own `set` section) handles the "for the duration" half
    // with no extra code. Deliberately NEVER "speed" -- `effectiveStats`
    // has no notion of a flat speed scalar at all (movement lives in the
    // participant's own `speeds` ARRAY, a different shape entirely), which
    // is exactly why Speed Swap gets its own `swap_fastest_speed` mode
    // below instead of reusing this one (an earlier version of this file
    // tried `field:"speed"` here -- it silently never worked, since
    // effectiveStats(p).speed was always undefined).
    if (!field) {
      showCombatAlert(`No stat chosen for ${moveName} -- nothing to swap.`, { title: moveName });
      return;
    }
    const a = effectiveStats(attacker)[field];
    const t = effectiveStats(target)[field];
    if (!Number.isFinite(a) || !Number.isFinite(t)) {
      showCombatAlert(`Couldn't read ${field.toUpperCase()} for both sides -- swap it by hand.`, { title: moveName });
      return;
    }
    const specFor = (value) => buildStatusSpec(
      { kind: 'stat', stat: field, set: value },
      { sourceId: attackerId, sourceName: attacker.name, moveName, dc, ends },
    );
    try {
      await CombatAPI.applyStatus(attackerId, specFor(t));
      await CombatAPI.applyStatus(targetId, specFor(a));
    } catch (err) {
      showCombatAlert(err.message, { title: 'Error' });
    }
    return;
  }
  if (mode === 'swap_fastest_speed') {
    // Speed Swap's own "switch speed with the target" -- `speeds` is a
    // whole array of movement TYPES per participant (walking/flying/
    // swimming/...), not a flat scalar `effectiveStats`/`swap_value` above
    // has any notion of, so this reads each side's own FASTEST recorded
    // speed directly (maxSpeed, move-effects.js -- same helper Electro
    // Ball's own comparison already uses) as a reasonable approximation of
    // "their speed", rather than attempting a full per-type array swap. A
    // new `apply:"speed_override"` condition (not `kind:'stat'` -- nothing
    // reads a stat-kind "speed" field either) carries the swapped value;
    // conditions.py's own `_movement_budget` checks for it and, when
    // present, replaces the holder's entire `speeds` list with just that
    // one overridden number for the duration, the same "for the duration"
    // auto-expiry every other status here already gets for free.
    const a = maxSpeed(attacker);
    const t = maxSpeed(target);
    if (a === null || t === null) {
      showCombatAlert(`Couldn't read a movement speed for both sides -- swap it by hand.`, { title: moveName });
      return;
    }
    const specFor = (value) => buildStatusSpec(
      { kind: 'condition', apply: 'speed_override', value },
      { sourceId: attackerId, sourceName: attacker.name, moveName, dc, ends },
    );
    try {
      await CombatAPI.applyStatus(attackerId, specFor(t));
      await CombatAPI.applyStatus(targetId, specFor(a));
    } catch (err) {
      showCombatAlert(err.message, { title: 'Error' });
    }
    return;
  }
  if (mode === 'transfer_condition') {
    // Psycho Shift's own "a status affecting [a willing ally, or yourself]
    // is transferred to the target instead" -- shipped as a documented
    // simplification, self-only (never "or a willing ally"): this app has
    // no mechanism to pick a THIRD participant (the ally) on top of the
    // caster and the save-target, and the move's own text treats "yourself"
    // as the plain, always-available case. Reuses `remove`/`recreate`
    // exactly like every other stat_transfer mode -- the only new piece is
    // asking WHICH of the caster's own conditions to move, via a dynamic
    // list (status-picker.js), since there's no fixed vocabulary of
    // condition names to draw a dropdown from the way a stat name has.
    const selfConditions = (attacker.statuses || []).filter(s => s.kind === 'condition');
    const chosen = await pickOneStatus(selfConditions, {
      title: moveName, message: `Choose one of ${attacker.name}'s own conditions to transfer to ${target.name}.`,
    });
    if (!chosen) return;
    await remove(attackerId, chosen, `transferred by ${moveName}`);
    await recreate(chosen, targetId);
    return;
  }
  if (mode === 'dispel_one') {
    // Searing Flame's own "burns away one positive effect on a hostile
    // target, or one negative effect if used on an ally" -- this app has no
    // team/faction concept to tell hostile from ally itself (same
    // documented gap `blocking_shield` already has), so the human picks
    // from the target's WHOLE current list (stat buffs/debuffs and
    // conditions both) and judges which one fits their own use, rather than
    // the app silently filtering to only "positive" ones and guessing wrong
    // for an ally-cast use.
    const candidates = (target.statuses || []).filter(s => s.kind === 'stat' || s.kind === 'condition');
    const chosen = await pickOneStatus(candidates, {
      title: moveName, message: `Choose one effect on ${target.name} to burn away (a positive one if hostile, a negative one if an ally).`,
    });
    if (!chosen) return;
    await remove(targetId, chosen, `burned away by ${moveName}`);
  }
}

/** Covet/Thief's own "steal the opponent's held item if you are not
 * currently holding one" -- a plain client-authoritative move/remove
 * against the `item` field (a comma-separated freeform string, same shape
 * as `abilities`), via the new update-item action. Unlike a temporary
 * status, this is PERMANENT -- no duration, no restore-on-expiry to design
 * around, just moving one name from the target's own list onto the
 * attacker's. If the target holds more than one item, takes the
 * first-listed one -- a documented simplification rather than a new
 * "choose which item" picker, since this app's own data rarely populates
 * more than one anyway. Both of Covet's own "if you are not currently
 * holding one" and Thief's own "if the user does not have an item held"
 * gates are checked here, inside the handler, rather than via the generic
 * `when` vocabulary -- neither reads naturally as an attack-roll/save
 * condition, they're both about the ATTACKER's own unrelated state. */
async function _handleStealItem({ attackerId, targetId, moveName }) {
  const attacker = session?.participants?.[attackerId];
  const target = session?.participants?.[targetId];
  if (!attacker || !target) return;
  if ((attacker.item || '').trim()) {
    showCombatAlert(`${attacker.name} is already holding an item -- ${moveName} only works empty-handed.`, { title: moveName });
    return;
  }
  const items = (target.item || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!items.length) {
    showCombatAlert(`${target.name} isn't holding an item -- nothing for ${moveName} to steal.`, { title: moveName });
    return;
  }
  const [stolen, ...rest] = items;
  try {
    await CombatAPI.updateItem(attackerId, stolen);
    await CombatAPI.updateItem(targetId, rest.join(', '));
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
    return;
  }
  CombatAPI.logEvent({
    type: 'save', actorId: attackerId, actorName: attacker.name, targetId, targetName: target.name,
    text: `${attacker.name} used ${moveName} to steal ${target.name}'s ${stolen}`,
  }).catch(() => {});
}

/** Knock Off's own "any held item of the target falls to the ground... for
 * the rest of battle" -- unlike steal_item, nothing moves to the attacker
 * at all, the item is just GONE. Same plain client-authoritative `item`
 * field write as steal_item, just a clear instead of a move -- no gate on
 * the attacker's own state either, since Knock Off doesn't care whether
 * they're already holding something. A target with no item at all is a
 * harmless no-op (shown, not silently swallowed), same tone as every other
 * "nothing to do here" spot in this app. */
async function _handleDropItem({ targetId, moveName }) {
  const target = session?.participants?.[targetId];
  if (!target) return;
  if (!(target.item || '').trim()) {
    showCombatAlert(`${target.name} isn't holding an item -- nothing for ${moveName} to knock off.`, { title: moveName });
    return;
  }
  const dropped = target.item;
  try {
    await CombatAPI.updateItem(targetId, '');
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
    return;
  }
  CombatAPI.logEvent({
    type: 'save', actorId: targetId, actorName: target.name,
    text: `${target.name}'s ${dropped} is knocked to the ground by ${moveName}`,
  }).catch(() => {});
}

/** Switcheroo/Trick's own "swap held items with a creature" -- a full
 * two-way exchange of the whole `item` field on both sides, unlike
 * steal_item's one-way "only if you're empty-handed, take just their
 * first-listed item" shape. Deliberately swaps the ENTIRE string on each
 * side (not just a first-listed item) since there's no "only one item
 * moves" constraint here the way steal_item has -- a straight exchange.
 * This also covers Switcheroo's own explicit "if you do not have a held
 * item, you simply take theirs without replacement" for free: swapping an
 * empty string INTO the target is exactly "no replacement given", no
 * special-casing needed. */
async function _handleSwapItem({ attackerId, targetId, moveName }) {
  const attacker = session?.participants?.[attackerId];
  const target = session?.participants?.[targetId];
  if (!attacker || !target) return;
  const attackerItem = attacker.item || '';
  const targetItem = target.item || '';
  if (!attackerItem.trim() && !targetItem.trim()) {
    showCombatAlert(`Neither ${attacker.name} nor ${target.name} is holding an item -- nothing for ${moveName} to swap.`, { title: moveName });
    return;
  }
  try {
    await CombatAPI.updateItem(attackerId, targetItem);
    await CombatAPI.updateItem(targetId, attackerItem);
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
    return;
  }
  CombatAPI.logEvent({
    type: 'save', actorId: attackerId, actorName: attacker.name, targetId, targetName: target.name,
    text: `${attacker.name} and ${target.name} swap held items with ${moveName}`,
  }).catch(() => {});
}

/** Ally Switch's own "switching places on the battlefield" -- reads both
 * tokens' CURRENT positions straight off the board and swaps them via two
 * `set-token-position` calls (routes_combat.py -- "DM/setup placement, NOT
 * turn-gated", the same unrestricted reposition the board editor already
 * uses, reused here for a player's own move instead). No new cell to PICK
 * at all -- both destinations are already known (wherever the OTHER
 * creature currently stands) -- which is what makes this buildable at all:
 * Teleport's own "reappear at an unoccupied point" needs the human to
 * choose an ARBITRARY new cell, and the battle-map's own grid has no
 * coordinate labels anywhere (gridCellsHtml renders blank clickable
 * squares, nothing a text prompt could ask for and have the human read
 * back off the physical display) -- Teleport stays unmigrated for exactly
 * that reason, see move-effects-schema.md. */
async function _handleTeleportSwap({ casterId, targetId, moveName }) {
  const caster = session?.participants?.[casterId];
  const target = session?.participants?.[targetId];
  if (!caster || !target) return;
  const casterPos = session?.board?.tokens?.[casterId];
  const targetPos = session?.board?.tokens?.[targetId];
  if (!casterPos || !targetPos) {
    showCombatAlert(`Couldn't find both tokens on the map -- swap their positions by hand.`, { title: moveName });
    return;
  }
  try {
    await CombatAPI.setTokenPosition(casterId, targetPos.col, targetPos.row);
    await CombatAPI.setTokenPosition(targetId, casterPos.col, casterPos.row);
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
    return;
  }
  CombatAPI.logEvent({
    type: 'save', actorId: casterId, actorName: caster.name, targetId, targetName: target.name,
    text: `${caster.name} and ${target.name} switched places with ${moveName}`,
  }).catch(() => {});
}

/** Disable's own "choose one of the opponent's known moves, that you know
 * it knows -- this move is now disabled": the human picks ONE move name off
 * the target's own `.moves` list (status-picker.js's `pickOneMoveName`,
 * same dynamic-list-picker shape Psycho Shift/Searing Flame's
 * `pickOneStatus` already uses for a participant's live STATUSES -- here
 * it's a participant's known MOVE NAMES instead, a different dynamic list
 * with no fixed vocabulary either way). Applies a plain `move_disabled`
 * condition carrying the chosen name as `value` -- `disabled_moves()`
 * (conditions.py) already reads any status shaped this way, Disable just
 * needed a way to pick WHICH name. */
async function _handleDisableMove({ targetId, moveName, ends, sourceId, sourceName, dc }) {
  const target = session?.participants?.[targetId];
  if (!target) return;
  const moves = target.moves || [];
  if (!moves.length) {
    showCombatAlert(`${target.name} has no known moves to disable.`, { title: moveName });
    return;
  }
  const chosen = await pickOneMoveName(moves, {
    title: `${moveName} — choose a move to disable`,
    message: `Pick one of ${target.name}'s known moves.`,
  });
  if (!chosen) return;
  try {
    await CombatAPI.applyStatus(targetId, { kind: 'condition', apply: 'move_disabled', value: chosen, sourceId, sourceName, moveName, dc, ends });
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
  }
}

/** Imprison's own "unable to use any Move it knows that is the same as
 * yours, for the duration" -- fully computable with no human picker at all
 * (unlike Disable, which needs a free choice): disables EVERY move name in
 * the overlap of the caster's own `.moves` and the target's `.moves`, each
 * as its own separate `move_disabled` status sharing the same duration --
 * `disabled_moves()` just unions whatever's live, so N statuses works the
 * same as one. */
async function _handleDisableOverlappingMoves({ attackerId, targetId, moveName, ends, dc }) {
  const attacker = session?.participants?.[attackerId];
  const target = session?.participants?.[targetId];
  if (!attacker || !target) return;
  const mine = new Set(attacker.moves || []);
  const overlap = (target.moves || []).filter((m) => mine.has(m));
  if (!overlap.length) {
    showCombatAlert(`${target.name} doesn't know any of the same moves as ${attacker.name} -- nothing for ${moveName} to disable.`, { title: moveName });
    return;
  }
  for (const m of overlap) {
    try {
      await CombatAPI.applyStatus(targetId, { kind: 'condition', apply: 'move_disabled', value: m, sourceId: attackerId, sourceName: attacker.name, moveName, dc, ends });
    } catch (err) {
      showCombatAlert(err.message, { title: 'Error' });
      return;
    }
  }
  CombatAPI.logEvent({
    type: 'save', actorId: attackerId, actorName: attacker.name, targetId, targetName: target.name,
    text: `${attacker.name} used ${moveName} -- disabled ${target.name}'s shared move${overlap.length === 1 ? '' : 's'}: ${overlap.join(', ')}`,
  }).catch(() => {});
}

/** Oblivion Ink's own "the last move used by the creature is disabled" --
 * reads the target's own most recent 'move-used' log entry (`_lastMoveUsedBy`)
 * rather than offering a picker, since the move's own text leaves no choice
 * to make. No log entry found (target hasn't acted yet this encounter) just
 * tells the table to apply it by hand, same fallback tone as every other
 * "can't auto-detect" spot in this app. */
async function _handleDisableLastUsedMove({ attackerId, targetId, moveName, ends, dc }) {
  const attacker = session?.participants?.[attackerId];
  const target = session?.participants?.[targetId];
  if (!attacker || !target) return;
  const lastMove = _lastMoveUsedBy(session, targetId);
  if (!lastMove) {
    showCombatAlert(`Couldn't find a move ${target.name} has used yet -- apply ${moveName}'s disable by hand.`, { title: moveName });
    return;
  }
  try {
    await CombatAPI.applyStatus(targetId, { kind: 'condition', apply: 'move_disabled', value: lastMove, sourceId: attackerId, sourceName: attacker.name, moveName, dc, ends });
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
  }
}

/** Strafe/Pasta Portal's own "reposition somewhere specific after/during
 * this move" -- a GRANTED reposition, explicitly OUTSIDE the normal
 * movement budget (Strafe's own "ignoring your flying speed", Pasta
 * Portal's own "disappear and reappear" -- neither is ordinary budgeted
 * movement), so this calls CombatAPI.setTokenPosition directly (the SAME
 * unrestricted DM/setup action Ally Switch's own teleport_swap already
 * reuses) via reposition-picker.js's own click-a-cell popup rather than
 * move-token/battle-map-popup.js's own ordinary movement flow. `anchorId`
 * is whoever the `maxFt` radius is measured from -- Strafe's own "within
 * 30ft of the TARGET" vs Pasta Portal's own "within range" of wherever
 * the caster currently stands (anchor = the caster themselves). Needs the
 * battle map actually set up with both tokens placed -- without it,
 * there's no board to pick a cell on at all, same "tell the table to do
 * it by hand" fallback every other map-dependent mechanic here already
 * has. */
async function _handleRepositionNear({ moverId, anchorId, maxFt, moveName }) {
  const mover = session?.participants?.[moverId];
  const anchorName = session?.participants?.[anchorId]?.name || 'the anchor point';
  const anchorPos = session?.board?.tokens?.[anchorId];
  if (!mover || !anchorPos) {
    showCombatAlert(`Couldn't find both tokens on the map -- reposition ${mover?.name || 'your token'} by hand.`, { title: moveName });
    return;
  }
  const result = await pickRepositionCell(session, moverId, anchorPos.col, anchorPos.row, maxFt, {
    title: `${moveName} — choose where to reposition`,
    hint: `Click an unoccupied cell within ${maxFt}ft of ${anchorName}.`,
  });
  if (!result) return;
  CombatAPI.logEvent({
    type: 'save', actorId: moverId, actorName: mover.name,
    text: `${mover.name} repositions with ${moveName}`,
  }).catch(() => {});
}

async function _offerMoveEffects({ attackerId, targetId = null, moveName, computedData, ctx, includeSelf = true }) {
  // Weather variants (Surface Glide's "if raining, all surfaces are water", Shore Up's "doubled in a Sandstorm") are
  // resolved against the weather the user stands in, once, as the effects are offered.
  const userWeathers = weathersAffecting(session, attackerId);
  // Thermal Shock: an effect with `env` only happens in that environment ('hot' / 'cold' / 'temperate').
  const envKind = _environmentKind(session);
  const effects = moveEffectsFor(moveName).map(e => applyWeatherVariants(e, userWeathers)).filter(e => !e.env || e.env.includes(envKind));
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
    if (effect.kind === 'undo_crit_damage') {
      // Lucky Chant -- not gated by a save at all (see _handleUndoCritDamage's
      // own docstring for why it needs no attackerId passed in here, unlike
      // reroll_damage just above). attackerId (closure) is the reactor
      // themselves, using the move -- same self-only-reaction convention as
      // block_attack/damage_multiplier.
      await _handleUndoCritDamage({ reactorId: attackerId, moveName });
      continue;
    }
    if (effect.kind === 'negate_damage') {
      // Spiky Shield's own "ignore damage" half -- same no-attackerId-needed
      // reasoning as undo_crit_damage above.
      await _handleNegateDamage({ reactorId: attackerId, moveName });
      continue;
    }
    if (effect.kind === 'cancel_switch') {
      // Block -- stops the switch-out the open `switch_out` window is holding.
      try {
        await CombatAPI.cancelPendingSwitch(attackerId);
      } catch (err) {
        showCombatAlert(err.message, { title: 'Block' });
      }
      continue;
    }
    if (effect.kind === 'switch_out') {
      // Baton Pass, and U-turn / Volt Switch's "your trainer switches you out": the bench picker, then the server swap.
      openSwitchPopup({ pass: !!effect.pass });
      continue;
    }
    if (effect.kind === 'faint_pass_heal') {
      // Lunar Dance / Healing Wish -- the user has fainted (the self_faint tag set its HP); the trainer's NEXT Pokemon out is healed.
      try {
        await CombatAPI.queueSwitchHeal(attackerId, effect.mode);
      } catch (err) {
        showCombatAlert(err.message, { title: 'Error' });
        continue;
      }
      openSwitchPopup({ pass: false });
      continue;
    }
    if (effect.kind === 'recoil') {
      // Volt Tackle, Brave Bird, Head Smash, ... -- typeless self-damage, a fraction of what the hit did.
      await _handleRecoil({ casterId: attackerId, effect, moveName, ctx, computedData });
      continue;
    }
    if (effect.kind === 'self_faint') {
      // Self-Destruct, Memento, Final Gambit: "you faint" / "drop to 0 hit points" once the move is done.
      const self = session?.participants?.[attackerId];
      if (self && self.currentHP > 0) {
        try {
          await CombatAPI.updateStats(attackerId, { currentHP: 0 });
          CombatAPI.logEvent({ type: 'faint', actorId: attackerId, actorName: self.name, text: `${self.name} faints after using ${moveName}` }).catch(() => {});
        } catch (err) {
          showCombatAlert(err.message, { title: 'Error' });
        }
      }
      continue;
    }
    if (effect.kind === 'hp_fraction_loss') {
      // Nature's Madness: "the target loses half their current HP (minimum of 1 damage)".
      const t = session?.participants?.[pick.targetId];
      if (t && t.currentHP > 0) {
        const lost = Math.max(effect.min || 1, Math.floor(t.currentHP * (effect.fraction || 0.5)));
        try {
          await CombatAPI.updateStats(pick.targetId, { currentHP: t.currentHP - lost });
          CombatAPI.logEvent({ type: 'damage', actorId: attackerId, actorName: session.participants[attackerId]?.name, targetId: t.id, targetName: t.name,
            amount: lost, move: moveName, text: `${t.name} loses ${lost} HP (half its current HP) -- ${moveName}` }).catch(() => {});
        } catch (err) {
          showCombatAlert(err.message, { title: 'Error' });
        }
      }
      continue;
    }
    if (effect.kind === 'hp_equalize') {
      // Endeavor / Pain Split -- sets HP from the caster's and the target's current values.
      await _handleHpEqualize({ casterId: attackerId, targetId: pick.targetId, effect, moveName });
      continue;
    }
    if (effect.kind === 'consume_item') {
      // Fling -- the caster's thrown item is gone. attackerId (closure) is the caster.
      await _handleConsumeItem({ casterId: attackerId, moveName });
      continue;
    }
    if (effect.kind === 'quash') {
      // Quash -- pick.targetId is the creature that failed the save.
      try {
        await CombatAPI.quash(pick.targetId);
      } catch (err) {
        showCombatAlert(err.message, { title: 'Quash' });
      }
      continue;
    }
    if (effect.kind === 'secondary_damage') {
      // Spud Bomb -- on a failed CON save, the target takes an equal amount of a second damage type.
      const amount = Number.isFinite(ctx?.rawDamage) ? ctx.rawDamage : null;
      if (amount === null) {
        showCombatAlert(`Couldn't find the damage from the hit -- deal ${moveName}'s second-type damage by hand.`, { title: moveName });
        continue;
      }
      try {
        await CombatAPI.applyDamage(attackerId, pick.targetId, amount, effect.damageType || '', attacker?.name || '', moveName);
      } catch (err) {
        showCombatAlert(err.message, { title: 'Error' });
      }
      continue;
    }
    if (effect.kind === 'counter_attack') {
      // Revenge -- an attack roll back at whoever just hit the reactor, dealing the damage they took on a hit.
      await _handleCounterAttack({ reactorId: attackerId, effect, moveName, computedData });
      continue;
    }
    if (effect.kind === 'reduce_damage') {
      // Mirror Coat -- reduces the hit the reactor just took; if that wipes it out, an attack back at the attacker.
      await _handleReduceDamage({ reactorId: attackerId, effect, moveName, computedData });
      continue;
    }
    if (effect.kind === 'extra_turn') {
      // Tragic Hero -- the ally this window is about (the anchor) takes the floor once the caster ends the reaction.
      const anchorId = session?.pendingReaction?.anchorId;
      if (!anchorId) {
        showCombatAlert(`${moveName} needs a live reaction window to know who to grant the turn to.`, { title: moveName });
        continue;
      }
      try {
        await CombatAPI.grantExtraTurn(attackerId, anchorId, moveName);
      } catch (err) {
        showCombatAlert(err.message, { title: 'Error' });
      }
      continue;
    }
    if (effect.kind === 'deal_damage') {
      // Spiky Shield's own "...dealing grass damage instead" half -- a flat
      // guaranteed counter-hit, same no-attackerId-needed reasoning as the
      // other log-reading handlers above.
      await _handleDealDamageToAttacker({ reactorId: attackerId, effect, moveName });
      continue;
    }
    if (effect.kind === 'redirect_avoided_damage') {
      // Nature's Embrace -- discounts a vulnerability hit's own "extra" and
      // (on a hit) redirects it into a fresh ranged attack against a freely
      // chosen target. attackerId (closure) is the reactor themselves.
      await _handleRedirectAvoidedDamage({ reactorId: attackerId, moveName });
      continue;
    }
    if (effect.kind === 'retype_damage') {
      // Electrify -- retroactively recomputes the reactor's own most recent
      // hit as if it had been effect.newType all along. attackerId (closure)
      // is the reactor themselves.
      await _handleRetypeDamage({ reactorId: attackerId, newType: effect.newType, moveName });
      continue;
    }
    if (effect.kind === 'steal_buff') {
      // Spectral Surge/Snatch -- blocks the caster's own stat buff (fired
      // from a 'beneficial' window, see _handleEffectsOnly) and reapplies
      // it to the reactor instead. attackerId (closure) is the reactor
      // themselves.
      await _handleStealBuff({ reactorId: attackerId, moveName });
      continue;
    }
    if (effect.kind === 'drain_attacker_vp') {
      // Grudge/Spite -- pick.targetId is the original attacker (resolved by
      // _handleEffectsOnly's own pendingReaction-anchored auto-targeting,
      // same as Encore/Torment). attackerId (closure) is the reactor
      // themselves, using the move.
      await _handleDrainAttackerVp({
        reactorId: attackerId, originalAttackerId: pick.targetId, moveName, dc,
        dice: effect.dice, vpCostFromLog: !!effect.vpCostFromLog,
        healPool: effect.healPool, healFraction: effect.healFraction, requireZeroHp: !!effect.requireZeroHp,
        ability: effect.ability || 'WIS', vpCostMultiplierDice: effect.vpCostMultiplierDice || null,
      });
      continue;
    }
    if (effect.kind === 'steal_item') {
      // Covet/Thief -- a normal attack-flow effect (unlike every other
      // handler above), so pick.targetId here is the real target, same as
      // any other on-hit/save-gated effect.
      await _handleStealItem({ attackerId, targetId: pick.targetId, moveName });
      continue;
    }
    if (effect.kind === 'disable_sound_moves') {
      await _handleDisableSoundMoves({ targetId: pick.targetId, moveName, sourceId: attackerId, sourceName: attacker?.name, dc });
      continue;
    }
    if (effect.kind === 'ability_swap') {
      await _handleAbilitySwap({ mode: effect.mode, attackerId, targetId: pick.targetId, moveName, ends: pick.ends, dc, replacement: effect.replacement });
      continue;
    }
    if (effect.kind === 'faint_on_roll') {
      // Guillotine/Horn Drill/Explosion -- `ctx` is shared across every target of one use, so
      // the single d20 is only asked for once.
      await _handleFaintOnRoll({ attackerId, targetId: pick.targetId, moveName, effect, ctx });
      continue;
    }
    if (effect.kind === 'drop_item') {
      // Knock Off -- pick.targetId is the real target, same convention.
      await _handleDropItem({ targetId: pick.targetId, moveName });
      continue;
    }
    if (effect.kind === 'swap_item') {
      // Switcheroo/Trick -- attackerId (closure) is the caster, pick.targetId the real target.
      await _handleSwapItem({ attackerId, targetId: pick.targetId, moveName });
      continue;
    }
    if (effect.kind === 'ground_target') {
      await _handleGroundTarget({ casterId: attackerId, targetId: pick.targetId, effect, moveName });
      continue;
    }
    if (effect.kind === 'set_altitude') {
      // Skyward Soar: "you're now 60ft. up in the air".
      try {
        await CombatAPI.setTokenAltitude(pick.targetId, effect.z || 0);
      } catch (err) {
        showCombatAlert(err.message, { title: moveName });
      }
      continue;
    }
    if (effect.kind === 'push') {
      // Strength, Roar, Lava Cannon, Circle Throw, ... -- the caster moves the TARGET's token (forced movement: no movement spent,
      // no Pursuit window; a hazard on the landing tile still counts).
      await _handlePush({ casterId: attackerId, targetId: pick.targetId, effect, moveName });
      continue;
    }
    if (effect.kind === 'reposition_near') {
      // Strafe/Pasta Portal -- attackerId (closure) is always the mover;
      // `effect.anchor` picks whose position the radius is measured from
      // (closure's own targetId for Strafe's "near the target", attackerId
      // itself for Pasta Portal's "near where I currently stand").
      const anchorId = effect.anchor === 'target' ? targetId : attackerId;
      // U-turn/Volt Switch: "half your movement speed" instead of a fixed distance.
      const fastest = maxSpeed(session?.participants?.[attackerId]);
      const maxFt = effect.maxFtFractionOfSpeed ? Math.floor((fastest || 0) * effect.maxFtFractionOfSpeed) : effect.maxFt;
      if (!maxFt) {
        showCombatAlert(`Couldn't work out how far ${moveName} lets you move (no speed on record) -- reposition by hand.`, { title: moveName });
        continue;
      }
      await _handleRepositionNear({ moverId: attackerId, anchorId, maxFt, moveName });
      continue;
    }
    if (effect.kind === 'teleport_swap') {
      // Ally Switch -- swaps the caster's and the chosen ally's current
      // board positions. attackerId (closure) is the caster.
      await _handleTeleportSwap({ casterId: attackerId, targetId: pick.targetId, moveName });
      continue;
    }
    if (effect.kind === 'disable_move') {
      // Disable -- pick.targetId is the real target (this effect has no
      // target:'self', same convention as steal_item above).
      await _handleDisableMove({ targetId: pick.targetId, moveName, ends: pick.ends, sourceId: attackerId, sourceName: attacker?.name, dc });
      continue;
    }
    if (effect.kind === 'disable_overlapping_moves') {
      // Imprison -- attackerId (closure) is the caster, pick.targetId the real target.
      await _handleDisableOverlappingMoves({ attackerId, targetId: pick.targetId, moveName, ends: pick.ends, dc });
      continue;
    }
    if (effect.kind === 'disable_last_used_move') {
      // Oblivion Ink -- attackerId (closure) is the caster, pick.targetId the real target.
      await _handleDisableLastUsedMove({ attackerId, targetId: pick.targetId, moveName, ends: pick.ends, dc });
      continue;
    }
    if (effect.kind === 'clear_field') {
      // Defog's own "sweeps away ... any area of effect moves still active"
      // -- this app models weather/terrain as a single freeform {name,
      // effect} pair each (not a stack of named effects), so "clear every
      // active field effect" is just clearing both straight to null. Not a
      // status, no target -- weather/terrain are shared session fields, not
      // per-participant, so this ignores targetId entirely.
      try {
        await CombatAPI.setWeather('', '');
        await CombatAPI.setTerrain('', '');
        await CombatAPI.clearTerrainZones(); // also clears the weather zones
      } catch (err) {
        showCombatAlert(err.message, { title: 'Error' });
      }
      continue;
    }
    if (effect.kind === 'set_weather') {
      // Sunny Day / Rain Dance / Sandstorm / Hail -- sets the shared weather, over a marked area or the whole map
      // like a terrain move. Hail/Sandstorm's damage is server-side (routes_combat.py's _apply_weather_damage) and
      // reads the caster's level, passed here. attackerId (closure) is the caster.
      const caster = session?.participants?.[attackerId];
      try {
        const rangeText = String((findMoveRow(moveName) || [])[6] || '');
        const area = await pickTerrainArea({
          session, casterId: attackerId, title: effect.name || moveName, kind: weatherKindOf({ name: effect.name || moveName }),
          radiusFt: radiusFtFromRange(rangeText),
          // "Self, 50ft" is around the caster; "centered on a point in range" is placed by the caster instead.
          centeredOnCaster: /\bself\b/i.test(rangeText),
        });
        await CombatAPI.setWeather(effect.name || moveName, effect.description || '', {
          rounds: effect.rounds, sourceId: attackerId, sourceName: caster?.name, casterLevel: caster?.level,
          concentration: effect.concentration ? '1' : '', cells: area.cells,
        });
      } catch (err) {
        showCombatAlert(err.message, { title: 'Error' });
      }
      continue;
    }
    if (effect.kind === 'set_environment') {
      // Chill / Superheat / Stormwind -- the whole map turns cold / hot / windy.
      const caster = session?.participants?.[attackerId];
      try {
        await CombatAPI.setEnvironment(effect.name || moveName, effect.env, { rounds: effect.rounds || '', sourceId: attackerId, sourceName: caster?.name || '' });
      } catch (err) {
        showCombatAlert(err.message, { title: 'Error' });
      }
      continue;
    }
    if (effect.kind === 'force_switch') {
      await _handleForceSwitch({ casterId: attackerId, targetId: pick.targetId, effect, moveName });
      continue;
    }
    if (effect.kind === 'sleep_pool') {
      await _handleSleepPool({ casterId: attackerId, effect, moveName });
      continue;
    }
    if (effect.kind === 'trick_room') {
      // Trick Room -- the server flips the initiative order at the start of the next round (used again, it flips back).
      try {
        await CombatAPI.trickRoom();
      } catch (err) {
        showCombatAlert(err.message, { title: 'Error' });
      }
      continue;
    }
    if (effect.kind === 'set_terrain') {
      // Electric/Grassy/Misty/Psychic Terrain -- sets the shared session terrain (like Defog's
      // clear_field, not a status and no target), scheduled to expire after `effect.rounds`.
      // Grassy Terrain's heal dice are scaled to the caster's level here, once, and stored on the
      // terrain for _promptTurnHeals to roll at each creature's turn end. attackerId (closure) is the caster.
      const caster = session?.participants?.[attackerId];
      try {
        // Where does it go? The caster marks tiles on the map (pre-filled with the move's own radius around
        // them) or takes the whole map; only creatures standing on marked tiles are affected.
        const moveRow = findMoveRow(moveName) || [];
        const area = await pickTerrainArea({
          session, casterId: attackerId, title: effect.name || moveName, kind: zoneKind({ name: effect.name || moveName, rule: effect.rule }),
          // The move's own radius wins over parsing its range text ("60ft." is Spikes' reach, not its 15ft radius);
          // `center: 'point'` moves are placed by the caster, the rest are centered on them.
          radiusFt: effect.radiusFt ?? radiusFtFromRange(moveRow[6]),
          centeredOnCaster: effect.center !== 'point',
        });
        // What the zone does for whoever stands on it (routes_combat.py's _ZONE_PROPS), resolved at the caster's level now.
        const props = {};
        if (effect.rule) props.rule = effect.rule;
        if (effect.difficult) props.difficult = true;
        if (effect.concentration) props.concentration = true;
        if (effect.untilSourceTurn) props.untilSourceTurn = true;
        if (effect.height !== undefined) props.height = effect.height; // ft above the ground the zone reaches (0 = the floor only)
        if (effect.critTiers) props.critReduction = tierAt(effect.critTiers, caster?.level);
        if (effect.hazard) {
          const h = effect.hazard;
          props.hazard = {
            damageType: h.damageType, ability: h.ability, dice: tierAt(h.diceTiers, caster?.level) || h.dice,
            flat: h.addMove && caster ? bestMoveStatModifier(moveRow, caster) : 0, dc,
            // Uproar hits at the START of a turn only and never its caster -- the server reads these two off the zone.
            ...(h.only ? { only: h.only } : {}), ...(h.excludeSource ? { excludeSource: true } : {}),
            // Quicksand Trap / Poison Gas / Smog: what a failed save inflicts, and how a pass changes the damage.
            ...(h.onSave ? { onSave: h.onSave } : {}), ...(h.condition ? { condition: h.condition } : {}),
          };
          if (!props.hazard.dice) { delete props.hazard.dice; props.hazard.flat = 0; }
        }
        await CombatAPI.setTerrain(effect.name || moveName, effect.description || '', {
          rounds: effect.rounds, healDice: terrainHealDice(effect, caster?.level), sourceId: attackerId, sourceName: caster?.name,
          cells: area.cells, props: Object.keys(props).length ? props : undefined,
        });
      } catch (err) {
        showCombatAlert(err.message, { title: 'Error' });
      }
      continue;
    }
    if (effect.kind === 'block_attack') {
      // Not a status either -- a one-shot signal to the ATTACKER's own
      // client (mid waitForReactionWindow) that this attack is blocked
      // entirely (Protect, King's Shield, ...). attackerId (closure) is
      // the reactor themselves, using the move -- same as any other
      // self-only reaction effect.
      try {
        await CombatAPI.blockPendingAttack(attackerId, moveName);
      } catch (err) {
        showCombatAlert(err.message, { title: 'Error' });
      }
      continue;
    }
    if (effect.kind === 'damage_multiplier') {
      // Same shape as block_attack (a one-shot signal to the ATTACKER's own
      // client mid waitForReactionWindow), just scaling the damage that
      // still lands instead of cancelling it outright (Wide Guard).
      // attackerId (closure) is the reactor themselves, same convention.
      try {
        await CombatAPI.applyReactionDamageMultiplier(attackerId, effect.multiplier);
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
    if (effect.kind === 'stat_transfer') {
      // Not a status -- a one-shot bulk operation against whatever's
      // already active on one or two participants right now (see
      // _handleStatTransfer's own docstring). pick.targetId here (NOT the
      // closure's own targetId) -- it resolves to attackerId for a
      // target:'self' effect (Haze's own self-hit) and to the real target
      // otherwise, so a single-participant mode (dispel/dispel_all/copy/
      // steal) always operates on whoever this specific effect actually
      // means, self included. 'swap'/'swap_value' still reach both sides
      // regardless, since they read attackerId from the closure too.
      // field/ends/dc only matter for 'swap_value' (Guard/Power/Speed Swap);
      // names only for 'cure_named' (Refresh) -- harmless no-ops otherwise.
      await _handleStatTransfer({ mode: effect.mode, attackerId, targetId: pick.targetId, moveName, field: effect.field, ends: pick.ends, dc, names: effect.names });
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
          ? bestMoveStatModifier(findMoveRow(moveName) || [], attacker) * (effect.amount.moveModMultiplier || 1)
          : 0,
        damageDealt: ctx.damageDealt,
        casterLevel: attacker?.level,
      });
      continue;
    }
    if (effect.against) {
      // Study's "advantage on attack rolls against THAT target": held by the caster, scoped to
      // the picked target's id (see attackRollContext's `against`).
      const spec = buildStatusSpec(effect, { sourceId: attackerId, sourceName: attacker?.name, moveName, dc, ends: pick.ends });
      spec.against = pick.targetId;
      try {
        await CombatAPI.applyStatus(attackerId, spec);
      } catch (err) {
        showCombatAlert(err.message, { title: 'Error' });
      }
      continue;
    }
    if (effect.kind === 'heal' && effect.repeat && effect.target !== 'self') {
      // Wish's own "at the end of YOUR next turn, heal a target in range" --
      // the repeat-heal machinery (_promptTurnHeals/_applyRecurringHeal)
      // always fires at the STATUS HOLDER's own turn boundary, so the
      // status has to be held by the CASTER (attackerId) to fire at the
      // caster's own next turn end rather than the healed target's, with a
      // separate healTargetId saying who actually receives it. Every other
      // repeat heal (Aqua Ring, Ingrain) is self-only (target:'self',
      // caught by the branch above instead), so holder and recipient were
      // always the same participant until this.
      const spec = buildStatusSpec(effect, { sourceId: attackerId, sourceName: attacker?.name, moveName, dc, ends: pick.ends });
      spec.healTargetId = pick.targetId;
      try {
        await CombatAPI.applyStatus(attackerId, spec);
      } catch (err) {
        showCombatAlert(err.message, { title: 'Error' });
      }
      continue;
    }
    if (effect.value && typeof effect.value === 'object' && effect.value.dice) {
      // Harden's own "reduce incoming damage by 1d4 + MOVE" -- the damage-
      // reduction AMOUNT itself has to be rolled once at apply time (no
      // digital dice anywhere in this app), carried as a condition's own
      // `value` rather than a `heal`/`drain_attacker_vp` immediate change,
      // so neither promptHealRoll nor promptDrainRoll fits -- promptValueRoll
      // is the bare-number sibling. Same "mutate a clone, fall through"
      // shape every other dynamic-value resolution here already uses.
      const moveModBonus = effect.value.moveMod && attacker ? bestMoveStatModifier(findMoveRow(moveName) || [], attacker) : 0;
      const rolled = await promptValueRoll({ dice: effect.value.dice, moveModBonus, moveName });
      if (rolled === null) continue;
      effect = { ...effect, value: rolled };
    }
    if (effect.value && typeof effect.value === 'object' && effect.value.fromPendingReactionMove) {
      // Encore/Torment's own "the move that targeted/hit you" -- the move
      // NAME isn't knowable at authoring time, only at apply time, off the
      // SAME live reaction window that let the reactor act in the first
      // place (session.pendingReaction's own moveName -- see
      // _handleEffectsOnly's own pendingReaction-anchored auto-targeting,
      // which is what made pick.targetId the original attacker to begin
      // with). Resolved here, same "mutate a clone, fall through to the
      // normal apply-status path" shape _resolveSetValue's own caller
      // already uses for Guard Split's avgWithTarget.
      const moveFromWindow = session?.pendingReaction?.moveName;
      if (!moveFromWindow) {
        showCombatAlert(`Couldn't find which move targeted you -- apply ${moveName} by hand.`, { title: moveName });
        continue;
      }
      effect = { ...effect, value: moveFromWindow };
    }
    if (effect.set !== undefined && typeof effect.set === 'object') {
      const resolved = _resolveSetValue(effect.set, attacker, target);
      if (resolved === null) {
        showCombatAlert(`Couldn't resolve ${moveName}'s effect (missing stat data) -- skipped`, { title: 'Error' });
        continue;
      }
      effect = { ...effect, set: resolved };
    }
    if (effect.kind === 'temp_hp' && effect.amount && typeof effect.amount === 'object' && effect.amount.fractionOfMaxHP) {
      // Divine Noodle Form's own "half of your current max HP as temporary
      // bonus HP" -- a different temp_hp amount shape from Acupressure's
      // own flat rolled number (that one's already a concrete number by
      // the time it's offered, from a dice-table choice): this resolves a
      // {fractionOfMaxHP} sentinel against whoever's about to hold it,
      // same "mutate a clone, fall through to the normal apply-status
      // path" shape `_resolveSetValue`'s own caller just above uses for
      // Guard Split's avgWithTarget.
      const holder = session?.participants?.[pick.targetId];
      if (!Number.isFinite(holder?.maxHP)) {
        showCombatAlert(`Couldn't read max HP for ${moveName} -- apply its temporary HP by hand.`, { title: moveName });
        continue;
      }
      effect = { ...effect, amount: Math.floor(effect.amount.fractionOfMaxHP * holder.maxHP) };
    }
    if (effect.kind === 'stat' && effect.amount && typeof effect.amount === 'object' && effect.amount.rollOnApply) {
      // Close Combat / Twilight Rush: "your AC is reduced by 1d4" -- rolled once now, held as a flat number.
      const rolled = await promptValueRoll({ dice: effect.amount.rollOnApply, moveName,
        description: `${moveName}: roll ${effect.amount.rollOnApply} -- ${effect.amount.sign < 0 ? 'subtracted from' : 'added to'} ${String(effect.stat).replace(/_/g, ' ')}` });
      if (rolled === null) continue;
      effect = { ...effect, amount: (effect.amount.sign < 0 ? -1 : 1) * rolled };
    }
    if (effect.tick) {
      // Leech Seed / Infestation / Fire Spin: a damage tick the server queues at the holder's turn boundary (routes_combat.py's
      // _queue_status_ticks) -- its dice, MOVE bonus and save DC are fixed now, from the caster.
      const t = effect.tick;
      const moveRow = findMoveRow(moveName) || [];
      effect = { ...effect, tick: {
        timing: t.timing || 'end', damageType: t.damageType || '', dice: tierAt(t.diceTiers, attacker?.level) || t.dice || '',
        flat: t.addMove && attacker ? bestMoveStatModifier(moveRow, attacker) : (t.flat || 0),
        ...(t.ability ? { ability: t.ability, dc } : {}), ...(t.onSave ? { onSave: t.onSave } : {}),
        ...(t.pool ? { pool: t.pool } : {}), ...(t.drain ? { drain: t.drain } : {}),
      } };
    }
    if (effect.stacks?.max === 'proficiency') {
      // Power-Up Punch: "max stacks = proficiency bonus", read from the caster now.
      effect = { ...effect, stacks: { max: Math.max(1, Number(attacker?.proficiency) || 1) } };
    }
    if (effect.kind === 'stat' && effect.amount && typeof effect.amount === 'object' && effect.amount.dice && effect.amount.moveMod && attacker) {
      // Wing Command's "1d6 + your Charisma modifier": a dice bonus the player rolls later (see
      // diceBonusOptionsFor); the move's own modifier is folded into the dice label so the total
      // they type already includes it.
      const mod = bestMoveStatModifier(findMoveRow(moveName) || [], attacker);
      effect = { ...effect, amount: { dice: mod ? `${effect.amount.dice}${mod > 0 ? '+' : ''}${mod}` : effect.amount.dice } };
    }
    if (effect.kind === 'stat' && effect.amount && typeof effect.amount === 'object' && effect.amount.moveModifier) {
      // Fell Stinger's "double your ability modifier": one more copy of the move's own best
      // modifier (the same number a heal's `moveMod` adds), resolved to a flat number now.
      const bonus = attacker ? bestMoveStatModifier(findMoveRow(moveName) || [], attacker) : 0;
      effect = { ...effect, amount: bonus };
    }
    if (effect.kind === 'temp_hp' && effect.amount && typeof effect.amount === 'object' && effect.amount.meleeDamageSinceLastTurn) {
      // Blood Shield: re-applying replaces the pool (see _apply_status), which
      // already covers "will not stack if used consecutively".
      effect = { ...effect, amount: _meleeDamageSinceLastTurn(session, attackerId) };
    }
    const spec = buildStatusSpec(effect, { sourceId: attackerId, sourceName: attacker?.name, moveName, dc, ends: pick.ends });
    if (spec.kind === 'condition' && !(await _confirmNotImmune(pick.targetId, spec.apply))) continue;
    try {
      await CombatAPI.applyStatus(pick.targetId, spec);
    } catch (err) {
      if (/\(Ink Veil\)/.test(err.message)) {
        await _inkVeilRegen(pick.targetId);
      } else {
        showCombatAlert(err.message, { title: 'Error' });
      }
    }
  }
}

/** Ink Veil: the server blocked a condition (see conditions.py's blocking_shield), so per the
 * move "instead roll 3d10, regenerating that much HP and VP". One roll, applied to both pools. */
async function _inkVeilRegen(holderId) {
  const holder = session?.participants?.[holderId];
  if (!holder) return;
  const rolled = await promptValueRoll({
    dice: '3d10', moveName: 'Ink Veil',
    description: `${holder.name}'s Ink Veil blocked a condition -- enter the 3d10 roll (regained as HP and VP)`,
  });
  if (rolled === null || rolled <= 0) return;
  const cap = (cur, max) => Math.min(Number.isFinite(max) ? max : Infinity, cur + rolled);
  const hp = cap(holder.currentHP, holder.maxHP);
  const vp = cap(holder.currentVP, holder.maxVP);
  try {
    await CombatAPI.updateStats(holderId, { currentHP: hp, currentVP: vp });
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
    return;
  }
  CombatAPI.logEvent({
    type: 'heal', actorId: holderId, actorName: holder.name, targetId: holderId, targetName: holder.name,
    text: `${holder.name}'s Ink Veil blocked a condition and regenerated ${hp - holder.currentHP} HP and ${vp - holder.currentVP} VP (3d10 = ${rolled})`,
  }).catch(() => {});
}

/** Advisory-only type-immunity check (Fire/Burning, Ice/Frozen, Electric/
 * Paralyzed, Poison+Steel/Poisoned -- see condition-rules.js's
 * `immuneTypes`) -- never a hard block, matching this app's consistent
 * "surface the info, trust the human" philosophy elsewhere (a 0x type
 * matchup is never blocked either, a damage_note is a reminder not a
 * refusal). Returns true (proceed) when the condition has no immunity rule,
 * the recipient's types aren't known, or the human confirms anyway; false
 * only when the human explicitly cancels. */
async function _confirmNotImmune(targetId, apply) {
  const immuneTypes = CONDITION_RULES[apply]?.immuneTypes;
  if (!immuneTypes?.length) return true;
  const recipient = session?.participants?.[targetId];
  const types = [recipient?.type1, recipient?.type2].filter(Boolean).map(t => t.toLowerCase());
  const matched = immuneTypes.find(t => types.includes(t.toLowerCase()));
  if (!matched) return true;
  return showCombatConfirm(
    `${recipient.name} is ${matched}-type — ${matched} types are immune to ${statusLabel({ kind: 'condition', apply })}. Apply it anyway?`,
    { title: 'Type immunity', yesLabel: 'Apply anyway', noLabel: 'Cancel' },
  );
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

/** Most recent `damage` log entry against `reactorId` (from ANY attacker),
 * or null -- shared by every 'damaged'-family handler that needs to know
 * what just happened to the reactor without a pre-supplied attacker id.
 * Needed because these are all offered through _handleEffectsOnly's plain
 * self-only path (see its own docstring), which never supplies a targetId
 * at all -- Lucky Chant's own undo, and Spiky Shield's own negate/counter
 * pair, all resolve "who hit me" from the log itself instead. */
function _lastDamageAgainst(reactorId) {
  const log = session?.log || [];
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (entry.type === 'damage' && entry.targetId === reactorId) return entry;
  }
  return null;
}

/** Lucky Chant's own mechanism -- "treats the attack like a normal hit,
 * preventing the extra damage" from a crit, a retroactive HP refund against
 * an already-applied damage entry same shape as _handleRerollDamage's own,
 * just computing the refund differently: this app has no digital dice, so
 * there's no real "what a non-crit roll would have been" to recompute from
 * -- only the crit's own final total to work backward from -- so it halves
 * that total, same approximation Wide Guard/Nature's Embrace's own rules
 * text already leans on for "half the damage" in this schema. Deterministic,
 * not a human judgment call (`when: "always"`, unlike Parry/Captivate's own
 * "special"): the most recent damage entry against `reactorId` either says
 * `crit: true` (see _resolveOneHit's own new pre-damage crit computation,
 * threaded into CombatAPI.applyDamage) or it doesn't, so this checks that
 * directly instead of asking the reactor to self-report it. */
async function _handleUndoCritDamage({ reactorId, moveName }) {
  const reactor = session?.participants?.[reactorId];
  if (!reactor) return;

  const original = _lastDamageAgainst(reactorId);
  if (!original || !Number.isFinite(original.amount)) {
    showCombatAlert(`Couldn't find the damage roll to check -- compare it with the table by hand.`, { title: moveName });
    return;
  }
  const attackerName = original.actorName || '?';
  if (!original.crit) {
    showCombatAlert(`${attackerName}'s last hit on ${reactor.name} wasn't a critical hit -- nothing for ${moveName} to undo.`, { title: moveName });
    return;
  }

  const refund = Math.floor(original.amount / 2);
  CombatAPI.logEvent({
    type: 'save', actorId: reactorId, actorName: reactor.name, targetId: original.actorId, targetName: attackerName,
    text: `${reactor.name} used ${moveName} -- ${attackerName}'s critical hit is treated as a normal hit, refunding ${refund} HP`,
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

/** Spiky Shield's own "ignore damage" half -- a full (100%) retroactive
 * refund against the most recent damage entry against the reactor, same
 * shape as _handleUndoCritDamage's own halving just without the crit
 * gate or the fraction. The escalating "roll over 15 after the first use"
 * cost and its own "drains your VP for half the damage amount" rider are
 * deliberately NOT modeled -- same manual-after-first-use precedent every
 * other Protect-family move in this schema already gets (no resource-
 * tracking mechanism for "which use number is this" exists anywhere). */
async function _handleNegateDamage({ reactorId, moveName }) {
  const reactor = session?.participants?.[reactorId];
  if (!reactor) return;

  const original = _lastDamageAgainst(reactorId);
  if (!original || !Number.isFinite(original.amount)) {
    showCombatAlert(`Couldn't find the damage roll to ignore -- refund it by hand if needed.`, { title: moveName });
    return;
  }
  const refund = original.amount;
  CombatAPI.logEvent({
    type: 'save', actorId: reactorId, actorName: reactor.name, targetId: original.actorId, targetName: original.actorName || '?',
    text: `${reactor.name} used ${moveName} -- ignores the ${refund} damage, refunding it in full`,
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

/** Wing Buffer's own "on a successful [reactive] save, you take half
 * damage" -- the SAME retroactive-correction shape as _handleUndoCritDamage
 * just above, minus the crit gate (any successful reactive save halves the
 * hit, crit or not) and reading attackerId directly from the caller
 * (_handleReactiveSave already knows exactly who it reacted to, same
 * `actorId`/`targetId` precision _handleRerollDamage's own log filter uses)
 * rather than falling back to "whoever hit the reactor most recently". */
async function _handleHalveDamage({ reactorId, attackerId, moveName }) {
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
    showCombatAlert(`Couldn't find ${attacker.name}'s damage roll to halve -- refund it by hand if needed.`, { title: moveName });
    return;
  }

  const refund = Math.floor(original.amount / 2);
  CombatAPI.logEvent({
    type: 'save', actorId: reactorId, actorName: reactor.name, targetId: attackerId, targetName: attacker.name,
    text: `${reactor.name} used ${moveName} -- takes half damage from ${attacker.name}'s hit, refunding ${refund} HP`,
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

/** Spiky Shield's own "dealing grass damage equal to your proficiency
 * modifier to the attacker instead" half -- a flat, guaranteed counter-hit
 * against whoever's own damage entry `_lastDamageAgainst` finds (same
 * "read it off the log, no id passed in" reasoning as every handler above).
 * `effect.amount` is `'proficiency'` (Spiky Shield's own case) or a plain
 * number -- no dice shape needed yet, so unlike a `heal` effect's own
 * amount this doesn't try to support one. Reuses the ordinary
 * CombatAPI.applyDamage primitive with the reactor and the original
 * attacker's roles swapped -- nothing new needed there, it already applies
 * type effectiveness and logs a normal 'damage' entry regardless of which
 * "direction" it's called in. */
async function _handleDealDamageToAttacker({ reactorId, effect, moveName }) {
  const reactor = session?.participants?.[reactorId];
  if (!reactor) return;

  const original = _lastDamageAgainst(reactorId);
  if (!original) {
    showCombatAlert(`Couldn't find who hit ${reactor.name} -- deal ${moveName}'s counter-damage by hand.`, { title: moveName });
    return;
  }
  const amount = effect.amount === 'proficiency' ? (Number(reactor.proficiency) || 0) : (Number(effect.amount) || 0);
  if (!amount) return;
  try {
    await CombatAPI.applyDamage(reactorId, original.actorId, amount, effect.damageType || '', reactor.name, moveName);
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
  }
}

/** Recoil -- "you take a quarter/half of the damage dealt in typeless recoil, rounded down". `basis: 'damage_dealt'` reads what the
 * hit just did (the same number a drain heal uses); `'damage_rolled'` (Light of Ruin: an area move with a per-target save, so
 * there's no single dealt number) asks the table for the rolled total. Applied through the ordinary damage path against the user
 * themself with no damage type (so no type-chart multiplier, and temp HP absorbs first). */
async function _handleRecoil({ casterId, effect, moveName, ctx, computedData }) {
  const caster = session?.participants?.[casterId];
  if (!caster) return;
  let base = Number.isFinite(ctx?.damageDealt) ? ctx.damageDealt : null;
  let fraction = effect.fraction || 0;
  if (effect.basis === 'max_hp') {
    // Belly Drum: "take damage equal to half your maximum".
    base = Number(caster.maxHP) || 0;
  } else if (effect.basis === 'dice') {
    // Dawn Dance: "using this move drains 2d12 of the user's hit points".
    base = await promptValueRoll({ dice: effect.dice, moveName, description: `${moveName}: roll ${effect.dice} -- ${caster.name} loses that much HP` });
    if (base === null) return;
    fraction = 1;
  } else if (effect.basis === 'max_damage') {
    // High Jump Kick / Jump Kick: "on a miss, you take damage equal to half the maximum damage of this move".
    const m = /^(\d+)d(\d+)$/i.exec(String(computedData?.damageDice || ''));
    if (!m) {
      showCombatAlert(`${moveName}: couldn't read the move's damage dice -- apply the miss damage by hand.`, { title: moveName });
      return;
    }
    base = Number(m[1]) * Number(m[2]) + (Number(computedData?.damageBonus) || 0);
  } else if (effect.basis === 'heal_rolled') {
    // Radiant Hope: "damaging it by the same amount it heals others".
    const typed = await showCombatPrompt(`${moveName}: how much did it heal each ally? ${caster.name} takes the same amount.`, { title: 'Recoil', min: 0 });
    if (typed === null || typed === undefined || typed === '') return;
    base = parseInt(typed, 10);
    fraction = 1;
  } else if (effect.basis === 'damage_rolled' || base === null) {
    const typed = await showCombatPrompt(`${moveName}: what was the damage rolled? ${caster.name} takes ${fraction === 0.5 ? 'half' : 'a quarter'} of it as recoil.`, { title: 'Recoil', min: 0 });
    if (typed === null || typed === undefined || typed === '') return;
    base = parseInt(typed, 10);
  }
  const recoil = Math.floor((Number(base) || 0) * fraction);
  if (!(recoil > 0)) return;
  try {
    await CombatAPI.applyDamage(casterId, casterId, recoil, effect.damageType || '', caster.name, moveName);
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
  }
}

/** Endeavor ("the target's current HP is reduced to be equal to your own") and Pain Split ("both of you change your current
 * HP to the average of the two, nobody above their max") -- run once the save has failed. HP is the client-authoritative
 * `update-stats` correction every other HP change here uses. */
async function _handleHpEqualize({ casterId, targetId, effect, moveName }) {
  const caster = session?.participants?.[casterId];
  const target = session?.participants?.[targetId];
  if (!caster || !target) return;
  const capped = (p, hp) => Math.min(Number.isFinite(p.maxHP) ? p.maxHP : Infinity, hp);
  try {
    if (effect.mode === 'average') {
      const avg = Math.floor((caster.currentHP + target.currentHP) / 2);
      await CombatAPI.updateStats(casterId, { currentHP: capped(caster, avg) });
      await CombatAPI.updateStats(targetId, { currentHP: capped(target, avg) });
      CombatAPI.logEvent({ type: 'save', actorId: casterId, actorName: caster.name, targetId, targetName: target.name,
        text: `${caster.name} and ${target.name} both go to ${avg} HP -- ${moveName}` }).catch(() => {});
    } else {
      if (target.currentHP <= caster.currentHP) {
        showCombatAlert(`${target.name} (${target.currentHP} HP) isn't above ${caster.name} (${caster.currentHP} HP) -- nothing for ${moveName} to bring down.`, { title: moveName });
        return;
      }
      await CombatAPI.updateStats(targetId, { currentHP: caster.currentHP });
      CombatAPI.logEvent({ type: 'save', actorId: casterId, actorName: caster.name, targetId, targetName: target.name,
        text: `${target.name}'s HP is brought down to ${caster.currentHP} -- ${moveName}` }).catch(() => {});
    }
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
  }
}

/** Fling's "the item is consumed": the caster's first-listed held item is removed (same first-listed convention as
 * steal_item). The thrown item's own extra effects are the GM's call, per the move text. */
async function _handleConsumeItem({ casterId, moveName }) {
  const caster = session?.participants?.[casterId];
  if (!caster) return;
  const items = String(caster.item || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!items.length) {
    showCombatAlert(`${caster.name} isn't holding an item to throw with ${moveName}.`, { title: moveName });
    return;
  }
  try {
    await CombatAPI.updateItem(casterId, items.slice(1).join(', '));
    CombatAPI.logEvent({ type: 'save', actorId: casterId, actorName: caster.name,
      text: `${caster.name} flings ${items[0]} -- consumed (the GM may rule extra effects)` }).catch(() => {});
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
  }
}

/** Revenge's own mechanism -- "make a melee attack roll against your attacker, with disadvantage. On a hit, deal the same
 * amount of fighting type damage back." The attacker and the amount both come off the shared log (the hit that opened this
 * reaction); the attack roll runs through target-picker's normal step against that attacker with the damage pre-filled (still
 * editable) and the move's own roll mode forced on top of whatever the statuses say. */
async function _handleCounterAttack({ reactorId, effect, moveName, computedData }) {
  const reactor = session?.participants?.[reactorId];
  const original = _lastDamageAgainst(reactorId);
  if (!reactor || !original || !Number.isFinite(original.amount) || !original.actorId) {
    showCombatAlert(`Couldn't find the hit to answer -- make ${moveName}'s attack by hand.`, { title: moveName });
    return;
  }
  const attacker = session?.participants?.[original.actorId];
  if (!attacker) return;
  const name = visibleToViewer(attacker, 'name') ? attacker.name : '???';
  // Static Shield: "half of the damage you would have sustained", and "if the attack you're reflecting is ranged, you roll
  // with disadvantage" -- `fraction` and the `disadvantage_if_ranged` roll mode.
  const amount = Math.floor(original.amount * (Number(effect.fraction) || 1));
  const rollMode = effect.rollMode === 'disadvantage_if_ranged'
    ? (original.move && !isMeleeMoveRow(findMoveRow(original.move)) ? 'disadvantage' : null)
    : (effect.rollMode || null);
  const picked = await pickTargetAgain(attacker, name, {
    attackModifier: computedData?.attackBonus || 0, speciesName: reactor.name, attacker: reactor, moveName,
    damageDice: '', presetRoll: amount,
    forcedRollMode: rollMode, forcedRollNote: rollMode ? `${moveName}: ${rollMode} on the attack roll` : '',
  });
  if (!picked || picked.blocked) return;
  if (!picked.hit) {
    CombatAPI.logEvent({
      type: 'miss', actorId: reactorId, actorName: reactor.name, targetId: original.actorId, targetName: attacker.name,
      text: `${reactor.name} used ${moveName} on ${attacker.name} -- Miss`,
    }).catch(() => {});
    return;
  }
  try {
    await CombatAPI.applyDamage(reactorId, original.actorId, picked.rawRoll, effect.damageType || '', reactor.name, moveName);
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
  }
}

/** Mirror Coat's own mechanism -- "the damage is decreased by 1d6 + MOVE. If this causes the damage to fall below zero, the
 * attack is deflected and you may make a ranged attack roll to send it back at the attacker for 1d6 + MOVE psychic damage."
 * A retroactive correction against the hit that opened this reaction (same family as _handleNegateDamage): the reduction is
 * rolled by hand and refunded as HP, capped at the hit; wiping it out entirely offers the attack back. */
async function _handleReduceDamage({ reactorId, effect, moveName, computedData }) {
  const reactor = session?.participants?.[reactorId];
  const original = _lastDamageAgainst(reactorId);
  if (!reactor || !original || !Number.isFinite(original.amount)) {
    showCombatAlert(`Couldn't find the damage roll to reduce -- refund it by hand if needed.`, { title: moveName });
    return;
  }
  const row = findMoveRow(moveName) || [];
  const dice = tierAt(effect.diceTiers, reactor.level) || '1d6';
  const moveMod = effect.addMove ? bestMoveStatModifier(row, reactor) : 0;
  const reduction = await promptValueRoll({
    dice, moveModBonus: moveMod, moveName,
    description: `${moveName} -- roll ${dice}${moveMod ? ` + ${moveMod}` : ''} to reduce the ${original.amount} damage you took.`,
  });
  if (reduction === null) return; // closed without entering one
  const refund = Math.min(original.amount, Math.max(0, reduction));
  if (refund > 0) {
    const maxHp = Number.isFinite(reactor.maxHP) ? reactor.maxHP : Infinity;
    try {
      await CombatAPI.updateStats(reactorId, { currentHP: Math.min(maxHp, reactor.currentHP + refund) });
    } catch (err) {
      showCombatAlert(err.message, { title: 'Error' });
      return;
    }
  }
  const deflected = reduction > original.amount;
  CombatAPI.logEvent({
    type: 'save', actorId: reactorId, actorName: reactor.name, targetId: original.actorId, targetName: original.actorName || '?',
    text: `${reactor.name} used ${moveName} -- the hit is reduced by ${refund}${deflected ? ' and deflected entirely' : ''}`,
  }).catch(() => {});
  if (!deflected || !effect.reflect || !original.actorId) return;

  const attacker = session?.participants?.[original.actorId];
  if (!attacker) return;
  const name = visibleToViewer(attacker, 'name') ? attacker.name : '???';
  const returnDice = tierAt(effect.reflect.diceTiers, reactor.level) || dice;
  const returnMod = effect.reflect.addMove ? moveMod : 0;
  const picked = await pickTargetAgain(attacker, name, {
    attackModifier: computedData?.attackBonus || 0, damageModifier: returnMod, speciesName: reactor.name, attacker: reactor, moveName,
    damageDice: returnDice, moveModValue: computedData?.highestMod || 0,
  });
  if (!picked || picked.blocked) return;
  if (!picked.hit) {
    CombatAPI.logEvent({
      type: 'miss', actorId: reactorId, actorName: reactor.name, targetId: original.actorId, targetName: attacker.name,
      text: `${reactor.name} sent the deflected attack back at ${attacker.name} with ${moveName} -- Miss`,
    }).catch(() => {});
    return;
  }
  try {
    await CombatAPI.applyDamage(reactorId, original.actorId, picked.rawRoll + returnMod, effect.reflect.damageType || '', reactor.name, moveName);
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
  }
}

/** Nature's Embrace's own mechanism -- "whenever you sustain damage of a
 * type you are vulnerable to, you may discount the extra damage. Make a
 * ranged attack roll, redirecting the damage you avoided to a creature in
 * range on a hit." Unlike Lucky Chant/Wide Guard's own "halve it" (an
 * approximation this app leans on because there's no cleaner number to
 * recompute from), this is an EXACT figure: the damage log already records
 * the type multiplier that applied (`_apply_damage_to_target`'s own
 * `multiplier` field), so "discount the extra" is simply "reduce the total
 * back down to what a 1x hit would have been" -- `amount - floor(amount /
 * multiplier)` -- correct for a 2x vulnerability same as a stacked 4x one
 * (two type weaknesses), not just the common case.
 *
 * The redirect itself reuses `_handleBideResolve`'s own established
 * pattern exactly: `pickTarget`'s `presetRoll` pre-fills a KNOWN damage
 * amount (still editable) while still running the normal attack-roll step
 * against a freely chosen target -- this app already proved this shape
 * works, nothing new needed for it. */
async function _handleRedirectAvoidedDamage({ reactorId, moveName }) {
  const reactor = session?.participants?.[reactorId];
  if (!reactor) return;

  const original = _lastDamageAgainst(reactorId);
  if (!original || !Number.isFinite(original.amount)) {
    showCombatAlert(`Couldn't find the damage roll to check -- compare it with the table by hand.`, { title: moveName });
    return;
  }
  if (!(original.multiplier > 1)) {
    showCombatAlert(`${reactor.name} wasn't vulnerable to that hit -- nothing for ${moveName} to discount.`, { title: moveName });
    return;
  }
  const avoided = original.amount - Math.floor(original.amount / original.multiplier);
  if (avoided > 0) {
    const maxHp = Number.isFinite(reactor.maxHP) ? reactor.maxHP : Infinity;
    const newHp = Math.min(maxHp, reactor.currentHP + avoided);
    try {
      await CombatAPI.updateStats(reactorId, { currentHP: newHp });
    } catch (err) {
      showCombatAlert(err.message, { title: 'Error' });
      return;
    }
  }
  CombatAPI.logEvent({
    type: 'save', actorId: reactorId, actorName: reactor.name,
    text: `${reactor.name} used ${moveName} -- discounts ${avoided} damage from the vulnerability${avoided > 0 ? ', then redirects it into a ranged attack' : ''}`,
  }).catch(() => {});
  if (avoided <= 0) return; // vulnerable but rounded down to nothing avoided -- no redirect to make

  const picked = await pickTarget(reactorId, { moveName, damageDice: '', damageNotes: [], damageModifier: 0, presetRoll: avoided });
  if (!picked || picked.blocked) return;
  if (!picked.hit) {
    const targetName = session?.participants?.[picked.targetId]?.name || '?';
    CombatAPI.logEvent({
      type: 'miss', actorId: reactorId, actorName: reactor.name, targetId: picked.targetId, targetName,
      text: `${reactor.name} redirected the avoided damage at ${targetName} with ${moveName} -- Miss`,
    }).catch(() => {});
    return;
  }
  try {
    await CombatAPI.applyDamage(reactorId, picked.targetId, picked.rawRoll, '', reactor.name, moveName);
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
  }
}

/** Electrify's own mechanism -- "the attacking move's type is changed to
 * electric". By the time this 'damaged' reaction can even fire, the hit
 * already landed using its own type's multiplier, so this is a RETROACTIVE
 * correction against the log entry (routes_combat.py's own
 * _retype_last_damage reverses the original multiplier to recover the raw
 * roll, recomputes with the new type, and adjusts HP by the difference) --
 * same family as _handleUndoCritDamage/_handleNegateDamage, avoiding any
 * need to thread a type override through target-picker.js's own multi-step
 * attack-roll/damage-roll flow. The server already logs the before/after
 * numbers clearly, so this handler is thin -- just the call and error
 * surfacing. */
async function _handleRetypeDamage({ reactorId, newType, moveName }) {
  try {
    await CombatAPI.retypeLastDamage(reactorId, newType);
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
  }
}

/** Spectral Surge/Snatch's own shared mechanism -- "steal the stat bonus"/
 * "you gain the positive effect and the target's move fails", fired from a
 * `beneficial`-trigger window (see waitForBeneficialReactions) BEFORE the
 * caster's own buff has ever actually applied. `when:"special"` on both
 * (not the usual auto-evaluated save_fail/attack-roll machinery): Spectral
 * Surge's own trigger is a fresh ranged attack roll against the caster,
 * Snatch's is a forced WIS save against the caster -- either way it's a
 * contested/conditional outcome involving a THIRD PARTY (the caster, not
 * the reactor), which `_handleEffectsOnly`'s own self-only architecture
 * has nowhere to run (see its own docstring note on exactly this shape for
 * Guard Split). Reusing Parry/Captivate/Hover's own "the human judges it
 * and ticks the box after confirming" pattern sidesteps needing a new
 * third-party save/attack sub-flow entirely.
 *
 * `session.pendingReaction` is still the live window at this point (the
 * reactor only reaches their own move-use while holding the floor for it),
 * so its own `moveName`/`attackerId` fields -- recorded when the window
 * opened -- say exactly which move and which caster this reacts to. Reads
 * that move's own authored `kind:'stat', target:'self'` effects (the ones
 * it would have granted ITS OWN user) and reapplies them to the REACTOR
 * instead, scoped to stat buffs only -- same "steal only the stat changes"
 * precedent Spectral Thief's own stat_transfer `steal` mode already uses;
 * a healing/condition-curing "positive effect" (Snatch's own broader
 * wording) isn't covered. Blocks the caster's own buff first via the same
 * `block-pending-attack` action block_attack itself uses (trigger-agnostic
 * -- it only cares about the live pendingReaction, not which trigger
 * opened it), so the caster never also gets a copy. */
async function _handleStealBuff({ reactorId, moveName }) {
  const pr = session?.pendingReaction;
  const casterId = pr?.attackerId;
  const casterMoveName = pr?.moveName;
  if (!casterId || !casterMoveName) {
    showCombatAlert(`Couldn't tell which move ${moveName} is reacting to -- apply its effect by hand.`, { title: moveName });
    return;
  }
  // set === undefined excludes a set-override buff (Guard Split-style) --
  // those resolve against live attacker/target context (_resolveSetValue)
  // that doesn't carry over to a stolen copy; no move needing THIS kind so
  // far has one, but scoping it explicitly avoids silently sending a raw
  // sentinel object as a status's `set` value if one ever does.
  const buffs = moveEffectsFor(casterMoveName).filter(e => e.kind === 'stat' && e.target === 'self' && e.set === undefined);
  if (!buffs.length) {
    showCombatAlert(`Couldn't find ${casterMoveName}'s own stat buff to steal -- apply it by hand.`, { title: moveName });
    return;
  }
  try {
    await CombatAPI.blockPendingAttack(reactorId, moveName);
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
    return;
  }
  const caster = session?.participants?.[casterId];
  for (const effect of buffs) {
    const spec = buildStatusSpec(effect, { sourceId: casterId, sourceName: caster?.name, moveName: casterMoveName, dc: 0, ends: effect.ends });
    try {
      await CombatAPI.applyStatus(reactorId, spec);
    } catch (err) {
      showCombatAlert(err.message, { title: 'Error' });
    }
  }
}

/** Spite's own "the target loses the amount of VP it SPENT ON THE MOVE" --
 * unlike Grudge's own flat dice amount, this needs no roll at all: the
 * exact figure was already deducted and logged when the attacker used
 * that move (routes_combat.py's own _apply_move logs `vpCost` on every
 * 'move-used' entry, see _applyPrimaryDamage's own docstring on this
 * category's other already-logged numbers). Walks the log backward for
 * `pid`'s own most recent 'move-used' entry matching `moveName` exactly
 * (not just "their last move", in case something else interleaved) --
 * same backward-walk convention as _lastMoveUsedBy. null if no matching
 * entry is found (predates this session, or vpCost wasn't recorded for
 * some other reason). */
function _vpCostOfMoveUsed(pid, moveName) {
  const log = session?.log || [];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.type === 'move-used' && e.actorId === pid && e.move === moveName) {
      return Number.isFinite(e.vpCost) ? e.vpCost : null;
    }
  }
  return null;
}

/** Grudge/Spite's own "force the attacker who just hit you to make a WIS
 * save against your Move DC... on a fail, drain its VP, and you gain [some
 * of] it back" -- `when:"special"` (not the usual auto-prompted save_fail
 * flow) for the same reason _handleStealBuff is: Grudge's own extra "only
 * if this hit reduced YOU to zero HP" gate has to be checked BEFORE any
 * save is even offered, something _offerMoveEffects's generic flow has no
 * vocabulary for -- a self-contained handler that does its own gate, save
 * prompt, drain-amount lookup, and apply, same shape as every other
 * `special` kind here. `originalAttackerId` is whoever _handleEffectsOnly's
 * own pendingReaction-anchored auto-targeting resolved (see its own
 * docstring) -- the creature that just targeted/hit the reactor, read off
 * the SAME still-live window (the reactor only reaches their own move-use
 * while holding the floor for it). `requireZeroHp` is Grudge's own extra
 * gate (false for Spite, which has none); `healPool`/`healFraction` cover
 * Grudge's own "regain it as HP" (1.0x, 'HP') vs Spite's "gain an equal
 * amount" (1.0x, 'VP'). `dice` (Grudge's own flat "3d10 VP", a genuinely
 * un-rollable-elsewhere amount -- promptDrainRoll, same "no digital dice"
 * situation as any other roll in this app) and `vpCostFromLog` (Spite's
 * own "whatever the attacking move actually cost", read off the shared log
 * instead -- _vpCostOfMoveUsed) are mutually exclusive amount sources, only
 * one set per move. Grudge's own "subsequent uses this encounter need a
 * DC15 d20 roll for the healing to land" escalating cost is left manual,
 * same precedent as the whole Protect family's own escalating cost. */
async function _handleDrainAttackerVp({ reactorId, originalAttackerId, moveName, dc, dice, vpCostFromLog, healPool, healFraction, requireZeroHp, ability = 'WIS', vpCostMultiplierDice = null }) {
  const reactor = session?.participants?.[reactorId];
  const originalAttacker = session?.participants?.[originalAttackerId];
  if (!reactor || !originalAttacker) return;
  if (requireZeroHp && !(Number.isFinite(reactor.currentHP) && reactor.currentHP <= 0)) {
    showCombatAlert(`${moveName} only triggers when that hit reduces you to 0 HP -- this one didn't.`, { title: moveName });
    return;
  }
  const outcome = await confirmSecondarySave(originalAttacker, originalAttacker.name, {
    dc, ability, title: 'Saving Throw', moveUser: reactor,
  });
  if (!outcome) return;
  CombatAPI.logEvent({
    type: 'save', actorId: reactorId, actorName: reactor.name, targetId: originalAttackerId, targetName: originalAttacker.name,
    text: `${originalAttacker.name} ${outcome.passed ? 'succeeded' : 'failed'} the saving throw against ${reactor.name}'s ${moveName}${_saveRollNote(outcome)}`,
  }).catch(() => {});
  if (outcome.passed) return;

  let drained;
  if (vpCostFromLog) {
    const attackingMoveName = session?.pendingReaction?.moveName;
    drained = attackingMoveName ? _vpCostOfMoveUsed(originalAttackerId, attackingMoveName) : null;
    if (!Number.isFinite(drained)) {
      showCombatAlert(`Couldn't find how much VP ${originalAttacker.name}'s move cost -- apply ${moveName}'s drain by hand.`, { title: moveName });
      return;
    }
    if (vpCostMultiplierDice) {
      // Etheric Discharge: "the VP cost is multiplied by 1d4" -- it already paid the cost once, so it loses the rest of
      // cost x roll (a 1 changes nothing).
      const multiplier = await promptValueRoll({ dice: vpCostMultiplierDice, moveName, description: `${moveName} -- roll ${vpCostMultiplierDice}: ${originalAttacker.name}'s move VP cost is multiplied by it (it already paid once).` });
      if (multiplier === null) return; // closed without entering one
      drained = drained * Math.max(0, multiplier - 1);
    }
  } else {
    const rolled = await promptDrainRoll({ dice, targetName: originalAttacker.name, moveName });
    if (rolled === null) return; // closed without entering one
    drained = Math.max(0, rolled);
  }
  if (drained <= 0) return;
  try {
    await CombatAPI.updateStats(originalAttackerId, { currentVP: originalAttacker.currentVP - drained });
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
    return;
  }
  const healAmount = Math.floor(drained * healFraction);
  if (healAmount > 0) {
    const healField = healPool === 'HP' ? 'currentHP' : 'currentVP';
    const maxField = healPool === 'HP' ? 'maxHP' : 'maxVP';
    const maxVal = Number.isFinite(reactor[maxField]) ? reactor[maxField] : Infinity;
    const newVal = Math.min(maxVal, reactor[healField] + healAmount);
    try {
      await CombatAPI.updateStats(reactorId, { [healField]: newVal });
    } catch (err) {
      showCombatAlert(err.message, { title: 'Error' });
    }
  }
  CombatAPI.logEvent({
    type: 'heal', actorId: reactorId, actorName: reactor.name, targetId: originalAttackerId, targetName: originalAttacker.name,
    text: `${reactor.name}'s ${moveName} drains ${drained} VP from ${originalAttacker.name}${healAmount ? `, regaining ${healAmount} ${healPool}` : ''}`,
  }).catch(() => {});
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
    const rolled = await promptHealRoll({ dice: effect.amount.dice, moveModBonus, targetName: target.name, moveName, pool });
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
/** The battle animation always comes last: after the effects popup, any area placement and every target. */
async function _handleEffectsOnly(args) {
  if ((await _runEffectsOnly(args)) !== false) playBattleAnimationFloating(args.speciesName);
}

async function _runEffectsOnly({ combatantId, moveName, computedData }) {
  const ctx = { hit: true, guaranteedHit: true, attackRoll: null, crit: false, save: null };
  // A 'beneficial' reaction (Heal Block/Strength Sap/Spectral Surge/Snatch)
  // can cancel this move's own effects entirely before they're ever
  // offered -- see waitForBeneficialReactions's own docstring for why this
  // handler specifically never opened any reaction window before. A block
  // cancels the WHOLE move, including any ally-targeting half below (e.g.
  // Tailwind-style "you and all allies"), not just the caster's own slice
  // -- a documented simplification, same "cancels the whole attack"
  // precedent block_attack already has elsewhere (Crafty Shield), since
  // this app has no mechanism to selectively cancel just one target's own
  // share of a shared effect.
  const reaction = await waitForBeneficialReactions(combatantId, moveName);
  if (reaction?.blocked) return false;
  await _offerMoveEffects({ attackerId: combatantId, moveName, computedData, ctx });
  if (!moveEffectsFor(moveName).some(e => e.target !== 'self')) return;
  // Encore/Torment's own "force the creature that just targeted/hit you" --
  // a reaction move's non-self effect has no free target to pick when it's
  // still riding the SAME window that let the reactor act in the first
  // place (session.pendingReaction's own attackerId IS the only sensible
  // "a creature" these moves ever mean) -- pickMultipleTargets's free
  // choice is for every OTHER non-self effects-only move, which never has
  // a live window anchored on this combatant to read instead.
  const pr = session?.pendingReaction;
  const targetIds = (pr && pr.anchorId === combatantId && pr.attackerId)
    ? [pr.attackerId]
    : await pickMultipleTargets(combatantId, { moveName, area: _aoeAreaFor(moveName) });
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
/** Magnitude's "creatures that are burrowed or in the invulnerable stage of Dig take double damage":
 * x2 when `moveName` lists (`doubleDamageVsStates`) a semi-invulnerable state the target currently holds. */
function _stateDamageMultiplier(moveName, targetId) {
  const states = moveFlagsFor(moveName).doubleDamageVsStates || [];
  const target = session?.participants?.[targetId];
  if ((target?.statuses || []).some((s) => s.kind === 'condition' && states.includes(s.apply))) return 2;
  // Cyclone Charge: "creatures in range that are not grounded ... take double damage".
  if (target && moveFlagsFor(moveName).doubleDamageVsAirborne && !_groundedNow(targetId)) return 2;
  return 1;
}

/** Grounded right now: no way to fly (or standing in a Gravity field) and not up in the air on the map. */
function _groundedNow(pid) {
  const p = session?.participants?.[pid];
  if (!p) return true;
  if ((session?.board?.tokens?.[pid]?.z || 0) > 0) return false;
  return isGroundedIn(p, terrainsAffecting(session, pid));
}

/** Smack Down / Thousand Arrows / Graviton Beam / Roost (`ground_target`): the creature comes down to the ground; with
 * `fallDice` it takes "1d6 fall damage per 10 feet fallen" (capped at `fallMax` dice), rolled by the table. */
async function _handleGroundTarget({ casterId, targetId, effect, moveName }) {
  const target = session?.participants?.[targetId];
  const z = session?.board?.tokens?.[targetId]?.z || 0;
  if (!target || !z) return; // already on the ground (or not on the map) -- nothing to fall from
  try {
    await CombatAPI.setTokenAltitude(targetId, 0);
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
    return;
  }
  const n = Math.min(effect.fallMax || 20, Math.floor(z / 10));
  if (!effect.fallDice || n < 1) return;
  const die = String(effect.fallDice).replace(/^1d/, 'd');
  const rolled = await promptValueRoll({ dice: `${n}${die}`, moveName, description: `${target.name} falls ${z}ft -- enter the ${n}${die} fall damage` });
  if (rolled === null || rolled <= 0) return;
  try {
    await CombatAPI.applyDamage(casterId, targetId, rolled, '', session?.participants?.[casterId]?.name || '', moveName);
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
  }
}

async function _resolveOneHit(combatantId, moveName, move, computedData, speciesName, picked, { damageMultiplier = 1 } = {}) {
  if (picked) damageMultiplier *= _stateDamageMultiplier(moveName, picked.targetId);
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
      type: 'miss', actorId: combatantId, actorName: attackerName, targetId: picked.targetId, targetName, move: moveName,
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

  // What the recorded rolls say this hit triggered: natural-roll thresholds, a crit,
  // the secondary save's failure margin, plain on-hit effects. Computed BEFORE
  // applyDamage below (this used to run after it, purely for _offerMoveEffects's
  // own ctx) so a definite crit can be recorded on the damage log entry itself --
  // Lucky Chant's own 'damaged' reaction needs to read it back from there, since
  // the REACTOR's own client has no other way to know whether the hit that just
  // landed on THEM was a crit (that's only ever computed on the ATTACKER's device).
  const categories = moveCategoriesFor(moveName);
  const attackRoll = picked.attackRoll ?? null;
  // Not just the fixed category -- a status-granted guarantee (Laser
  // Focus/Lock-On/Mind Reader) skips the attack-roll step exactly the same
  // way (see _guaranteedHitFor), and this value feeds evaluateEffect's own
  // natural_roll/crit checks below (`ctx.guaranteedHit`) -- reading only
  // the category here left those checks falling through to 'manual' for a
  // status-guaranteed hit instead of the correct 'no' (there was never a
  // roll to have crossed a threshold or crit on).
  const guaranteedHit = _guaranteedHitFor(combatantId, categories, moveName);
  const attacker = session?.participants?.[combatantId];
  let crit = false; // a guaranteed hit has no roll to crit on
  if (!guaranteedHit) {
    // undefined (not false) when the roll wasn't entered, so a crit-only effect asks a human.
    // effectiveStats, not the raw record -- a live crit-range status (Focus Energy) has to
    // actually change whether this roll counts, not just show up as a number on the card.
    // Fortune Ring: a move used from inside one lowers the crit DC by its level-scaled amount.
    // Limit Break's own "scores a critical hit on 18-20" (critBonus) widens it for this attack only.
    crit = attackRoll === null ? undefined : attackRoll >= critThreshold(effectiveStats(attacker).critMod + critReductionFrom(terrainsAffecting(session, combatantId)) + (Number(moveFlagsFor(moveName).critBonus) || 0), categories.includes('base_crit'));
  }
  // Laser Focus overrides whatever the roll says (there may be no roll at all, see
  // guaranteedHit above) -- computed here too (consumed further down, only once the
  // hit's actually resolved) since it also affects the `crit` this damage log gets.
  const laserFocusId = guaranteedCritStatusId(attacker);
  if (laserFocusId) crit = true;

  let damageDealt, targetFainted, rawDamageDealt;
  try {
    // No "N damage applied" popup -- it's already in the shared battle log
    // (routes_combat.py's _apply_damage_to_target logs it server-side, same as
    // every damage application here); see the user's own "less tooltip noise" call.
    // damageApplied (post type-multiplier) is captured for a `heal` effect's own
    // fractionOfDamage amount (Absorb, Drain Punch, ...) -- see _offerMoveEffects's
    // own apply loop. damageMultiplier (Wide Guard's own reaction, see
    // _handleMultiHitAoe) scales the raw total BEFORE type-effectiveness --
    // multiplication commutes, so this is equivalent to scaling the server's
    // own post-type-multiplier result, just one round trip cheaper.
    const rawTotal = rawRoll + damageModifier;
    const finalDamage = damageMultiplier !== 1 ? Math.floor(rawTotal * damageMultiplier) : rawTotal;
    const dmgResult = await CombatAPI.applyDamage(combatantId, targetId, finalDamage, moveType, speciesName, moveName, !!crit);
    damageDealt = dmgResult?.damageApplied;
    targetFainted = dmgResult?.targetFainted;
    rawDamageDealt = finalDamage; // before the type chart -- Spud Bomb's "an equal amount" of fire damage
  } catch (err) {
    showCombatAlert(err.message, { title: 'Error' });
    return null;
  }
  // 'damaged'-family reactions (Attract, Conversion 2, Lucky Chant, ...) fire
  // right here -- after damage lands, before anything else about this hit is
  // resolved.
  await waitForDamagedReactions(targetId, combatantId, moveName);
  await _maybeMeleeRetaliate(combatantId, targetId, moveName);

  // Some moves land a hit AND separately make the hit creature save against
  // a secondary consequence (e.g. Temporal Fang: damage on the attack roll,
  // then the hit target saves against being slowed) -- distinct from a pure
  // save move (no attack roll at all, see _handleSaveTriggered), per the
  // user's own explicit correction that "trigger saving throw" can't be
  // assumed to skip the attack roll. Only reachable once the attack already
  // landed, since a Miss never applies damage in the first place.
  let save = null;
  if (categories.includes('trigger_saving_throw_on_hit')) {
    const outcome = await _handleSecondarySave(combatantId, targetId, moveName, computedData);
    // Closed without declaring = no save result (nothing that hinges on one gets offered).
    save = { passed: outcome ? outcome.passed : true, failBy: outcome?.failBy ?? null };
  }

  // Laser Focus/Lock-On/Mind Reader are spent the moment this attack actually
  // resolves -- hit or miss was never in question, but the crit/guaranteed-hit
  // itself only happens once. Consumption deliberately stays here (after
  // damage/the secondary save, not up where `crit` itself was computed) --
  // only a hit that actually went through should spend either status.
  if (laserFocusId) {
    CombatAPI.useStatus(combatantId, laserFocusId).catch(() => {});
  }
  const guaranteedHitId = guaranteedHitStatusId(attacker);
  if (guaranteedHitId) {
    CombatAPI.useStatus(combatantId, guaranteedHitId).catch(() => {});
  }
  await _offerMoveEffects({
    attackerId: combatantId, targetId, moveName, computedData,
    ctx: { hit: true, attackRoll, guaranteedHit, crit, save, damageDealt, targetFainted, rawDamage: rawDamageDealt },
  });
  return targetId;
}

/** Energize/Enervation Ray's own `damage_vp` tag ("this move's damage
 * drains VP, not HP") -- a thin wrapper around CombatAPI.applyDamage that
 * reads the tag and threads the right pool through, so every EXISTING
 * save-triggered damage call site (_handleSaveTriggered's single target,
 * _handleMultiHitAoe's own loop) gets VP-pool support for free instead of
 * needing its own branch. The tag survives migration untouched (nothing in
 * `tag_for` derives it from any effect kind, so rebuild_categories never
 * retires it) -- already-reliable, already-present data, not something
 * this pass had to add. */
async function _applyPrimaryDamage(casterId, targetId, diceRoll, moveType, speciesName, moveName, crit = false) {
  const pool = moveCategoriesFor(moveName).includes('damage_vp') ? 'vp' : 'hp';
  return CombatAPI.applyDamage(casterId, targetId, diceRoll, moveType, speciesName, moveName, crit, pool);
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
/** The battle animation plays once, after the area is placed and every target is resolved -- not inside each target's
 * damage popup. */
async function _handleMultiHitAoe(args) {
  if ((await _runMultiHitAoe(args)) !== false) playBattleAnimationFloating(args.speciesName);
}

async function _runMultiHitAoe({ combatantId, moveName, move, computedData, speciesName }) {
  let targetIds = await pickMultipleTargets(combatantId, { moveName, area: _aoeAreaFor(moveName) });
  if (!targetIds || !targetIds.length) return false; // closed / nobody picked -- move's own cost still applied

  // Wide Guard's own reaction: this app has no real blast-center/positional-
  // radius concept, so the first target actually picked stands in for "is
  // the reactor in range of the blast" (see waitForTargetedAoeReactions's
  // own note). A `damage_multiplier` effect (Wide Guard) scales every
  // target's own damage below; a `block_attack` effect (Protect et al, also
  // eligible here since this reuses the same 'targeted' family) only ever
  // protects its OWN user -- filtered out of this AoE's target list rather
  // than aborting the whole thing, since nothing about blocking one
  // participant's share says anything about anyone else's.
  const anchorId = targetIds[0];
  const aoeReaction = await waitForTargetedAoeReactions(anchorId, combatantId, moveName);
  if (aoeReaction?.blocked) {
    targetIds = targetIds.filter((id) => id !== anchorId);
    if (!targetIds.length) return false; // that was the only target -- nothing left to resolve
  }
  const damageMultiplier = aoeReaction?.multiplier || 1;

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
      // damageOnPass: Self-Destruct's own "half as much on a success" --
      // every other save-triggered move here deals zero damage on a pass,
      // same as confirmSecondarySave's own default (see save-picker.js).
      // speciesName '' -- no clip inside each target's damage popup; it plays once at the end (_handleMultiHitAoe).
      const outcome = await confirmSecondarySave(target, target.name, {
        dc, hasDamage, damageModifier, speciesName: '', ability: _saveAbilityFor(moveName), moveUser: session?.participants?.[combatantId],
        damageOnPass: moveName === 'Self-Destruct',
      });
      if (!outcome) continue; // closed for this target -- move on to the next one
      const applyHint = moveEffectsFor(moveName).length ? '' : ' -- apply its effect';
      // rawRoll checked FIRST, not outcome.passed -- a passed save can still
      // carry a damage roll now (damageOnPass above), which used to be
      // impossible (passed and rawRoll were mutually exclusive before this),
      // so passed alone can no longer stand in for "no damage this target".
      if (outcome.rawRoll !== undefined) {
        try {
          // No "N damage applied" popup here either -- see _resolveOneHit's own note;
          // doubly true in a loop over several AoE targets, one popup per target.
          // damageMultiplier: see this function's own Wide Guard note above.
          const rawTotal = outcome.rawRoll + damageModifier;
          const targetMultiplier = damageMultiplier * _stateDamageMultiplier(moveName, targetId);
          const finalDamage = targetMultiplier !== 1 ? Math.floor(rawTotal * targetMultiplier) : rawTotal;
          const dmgResult = await _applyPrimaryDamage(combatantId, targetId, finalDamage, moveType, speciesName, moveName);
          if (Number.isFinite(dmgResult?.damageApplied)) totalDamageDealt += dmgResult.damageApplied;
          await waitForDamagedReactions(targetId, combatantId, moveName);
          await _maybeMeleeRetaliate(combatantId, targetId, moveName);
          if (outcome.passed) {
            CombatAPI.logEvent({
              type: 'save', actorId: combatantId, actorName: attackerName, targetId, targetName: target.name,
              text: `${target.name} succeeded the saving throw against ${attackerName}'s ${moveName}${_saveRollNote(outcome)}, but still takes reduced damage`,
            }).catch(() => {});
          }
        } catch (err) {
          showCombatAlert(err.message, { title: 'Error' });
        }
      } else if (outcome.passed) {
        CombatAPI.logEvent({
          type: 'save', actorId: combatantId, actorName: attackerName, targetId, targetName: target.name,
          text: `${target.name} succeeded the saving throw against ${attackerName}'s ${moveName}${_saveRollNote(outcome)}`,
        }).catch(() => {});
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
      const picked = await pickTargetAgain(target, target.name, { attackModifier, damageModifier, speciesName: '', guaranteedHit, attacker: session?.participants?.[combatantId], moveName, damageDice: computedData.damageDice, damageNotes, moveModValue: computedData.highestMod, nextTierDice: computedData.nextTierDice });
      await _resolveOneHit(combatantId, moveName, move, computedData, speciesName, picked, { damageMultiplier });
    }
  }

  if (isSaveTriggered && moveEffectsFor(moveName).some(e => e.target === 'self')) {
    await _offerMoveEffects({
      attackerId: combatantId, moveName, computedData,
      ctx: { hit: true, guaranteedHit: true, attackRoll: null, crit: false, save: null, damageDealt: totalDamageDealt },
    });
  }
  // Harmony Breath's own "allied creatures caught in the blast heal for
  // half the amount rolled" -- a SEPARATE multi-target picker for whichever
  // allies were ALSO in the cone (this app has no team/faction concept, so
  // a human picks, same as every other AoE-membership case here), healed
  // off the SAME totalDamageDealt the hostile loop above already summed --
  // one shared roll resolved once for the whole blast, not a second roll
  // just for allies. Gated on the move actually having a non-self heal
  // effect, so this extra prompt never shows for any other AoE move.
  if (isSaveTriggered && moveEffectsFor(moveName).some((e) => e.kind === 'heal' && e.target !== 'self')) {
    const allyIds = await pickMultipleTargets(combatantId, { moveName, area: _aoeAreaFor(moveName) });
    if (allyIds && allyIds.length) {
      for (const allyId of allyIds) {
        await _offerMoveEffects({
          attackerId: combatantId, targetId: allyId, moveName, computedData,
          ctx: { hit: true, guaranteedHit: true, attackRoll: null, crit: false, save: null, damageDealt: totalDamageDealt },
          includeSelf: false,
        });
      }
    }
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
 * freeform enemy), or the attacking move isn't in the moves dataset.
 * Wing Buffer's own effect (`kind:"halve_damage"`) fires here directly on
 * a PASS, not through _offerMoveEffects's generic save_fail flow -- see
 * the inline comment at its own call below. */
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
  // Wing Buffer's own "on a SUCCESSFUL save, you take half damage" -- the
  // one existing move with this shape, inverted from every other
  // save-triggered move's own convention (effect on a FAIL): handled here
  // directly rather than through _offerMoveEffects's generic save_fail
  // flow, which has no "on success" case at all. Gated on the move
  // actually carrying this kind so a future differently-shaped
  // reactive_save move doesn't silently get it too.
  if (outcome.passed && moveEffectsFor(moveName).some((e) => e.kind === 'halve_damage')) {
    await _handleHalveDamage({ reactorId: combatantId, attackerId: outcome.targetId, moveName });
  }
  const text = outcome.passed
    ? `${reactorName} succeeded a reactive saving throw (DC ${outcome.dc}) against ${attackerName}'s attack using ${moveName}`
    : `${reactorName} failed a reactive saving throw (DC ${outcome.dc}) against ${attackerName}'s attack using ${moveName}`;
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
  const picked = await pickSaveTarget(combatantId, { dc, damageModifier, speciesName, hasDamage, ability: _saveAbilityFor(moveName), moveName });
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
    const dmgResult = await _applyPrimaryDamage(combatantId, picked.targetId, picked.rawRoll + damageModifier, moveType, speciesName, moveName);
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

/** Paralyzed/Confused/Asleep's own escape/failure rolls: a plain d20/d4 vs a
 * flat threshold, no ability or DC involved at all -- a genuinely different
 * shape from a `save` end (see _rollStatusSave above), so these are three
 * bespoke functions rather than forced into one generic mechanism (matches
 * this app's own "give each condition its own flow wrinkle" precedent).
 * Driven purely by the condition's IDENTITY (does the holder carry
 * 'paralyzed'/'confused'/'asleep'), not an authored `ends` entry -- unlike a
 * move-granted status, these checks are a fixed, unconditional part of what
 * these three conditions ARE, the same way their advantage/disadvantage
 * comes from condition-rules.js rather than a per-move `roll` effect. */

/** Paralyzed's own start-of-turn d4 check: on a 1, the holder is locked out
 * for the rest of this turn AND their entire next turn (a transient
 * 'incapacitated' status lasting until the START of their own next turn --
 * "forfeits their remaining action and bonus action to their trainer").
 * Returns true when the lock triggered, so the caller can skip the
 * confusion check this turn -- the rulebook's own explicit ordering: "the
 * paralysis roll comes first... if it fails, it does not roll to wake or be
 * confused." */
async function _promptParalysisCheck(holderId) {
  const holder = session?.participants?.[holderId];
  if (!holder || !(holder.statuses || []).some(s => s.kind === 'condition' && s.apply === 'paralyzed')) return false;
  const roll = await showCombatPrompt(`${holder.name} is Paralyzed — roll a d4 at the start of their turn.`, { title: 'Paralysis check' });
  if (roll === null) return false;
  if (roll !== 1) return false;
  try {
    await CombatAPI.applyStatus(holderId, buildStatusSpec(
      { kind: 'condition', apply: 'incapacitated', ends: [{ type: 'until_turn', whose: 'holder', point: 'start', count: 1 }] },
      { sourceId: holderId, sourceName: holder.name, moveName: 'Paralysis' },
    ));
  } catch (err) {
    // The lock never actually landed server-side -- don't log it as if it
    // did, and don't tell the caller to skip this turn's confusion check
    // over a lock that isn't real.
    showCombatAlert(err.message, { title: 'Error' });
    return false;
  }
  CombatAPI.logEvent({
    type: 'status', actorId: holderId, actorName: holder.name,
    text: `${holder.name} rolled a 1 on their paralysis check — incapacitated until the start of their next turn`,
  }).catch(() => {});
  return true;
}

/** Confused's own "attempting an action" d20 check, prompted once at the
 * start of its turn (before it acts): 10 or lower hurts itself for typeless
 * damage equal to its proficiency modifier and forfeits the rest of THIS
 * turn's action/bonus action (a transient 'incapacitated' status lasting
 * until the END of this same turn -- not the next one, unlike Paralyzed's
 * own lock); 16 or higher ends Confused immediately; 11-15 does nothing. */
async function _promptConfusionCheck(holderId) {
  const holder = session?.participants?.[holderId];
  const status = (holder?.statuses || []).find(s => s.kind === 'condition' && s.apply === 'confused');
  if (!status) return;
  const roll = await showCombatPrompt(`${holder.name} is Confused — roll a d20 before acting this turn.`, { title: 'Confusion check' });
  if (roll === null) return;
  if (roll <= 10) {
    // Re-fetch fresh -- `holder` was captured before the human answered the
    // prompt above, and currentHP may have moved in the meantime (another
    // player's hit landing, a DM edit). Computing the self-damage off the
    // stale snapshot would silently discard whatever changed while this was
    // open.
    const current = session?.participants?.[holderId] || holder;
    const dmg = Number(current.proficiency) || 0;
    if (dmg) await CombatAPI.updateStats(holderId, { currentHP: current.currentHP - dmg }).catch((err) => showCombatAlert(err.message, { title: 'Error' }));
    try {
      await CombatAPI.applyStatus(holderId, buildStatusSpec(
        { kind: 'condition', apply: 'incapacitated', ends: [{ type: 'until_turn', whose: 'holder', point: 'end', count: 1, noSkip: true }] },
        { sourceId: holderId, sourceName: holder.name, moveName: 'Confusion' },
      ));
    } catch (err) {
      // The self-damage above already landed regardless -- that part of the
      // roll's outcome is real either way -- but don't claim the forfeiture
      // took effect if it didn't actually reach the server.
      showCombatAlert(err.message, { title: 'Error' });
      return;
    }
    CombatAPI.logEvent({
      type: 'status', actorId: holderId, actorName: holder.name,
      text: `${holder.name} rolled ${roll} on their confusion check — hurts itself for ${dmg} and forfeits the rest of the turn`,
    }).catch(() => {});
  } else if (roll >= 16) {
    await CombatAPI.removeStatus(holderId, status.id, `rolled ${roll} on the confusion check`).catch((err) => showCombatAlert(err.message, { title: 'Error' }));
  }
}

/** Asleep's own end-of-turn d20 wake-up check: 11 or higher ends it
 * immediately. The rulebook's other trigger ("when subject to a move")
 * isn't covered here -- deliberately deferred, see the status-conditions
 * plan; it would need a hook into every attack-resolution path, not just
 * this turn boundary. Also deliberately not modeled: the 3-round fixed
 * duration pausing while the Pokemon is in its ball (no in-app concept of
 * "currently benched mid-combat" to hook into) -- handle by hand. */
async function _promptSleepCheck(holderId) {
  const holder = session?.participants?.[holderId];
  const status = (holder?.statuses || []).find(s => s.kind === 'condition' && s.apply === 'asleep');
  if (!status) return;
  const roll = await showCombatPrompt(`${holder.name} is Asleep — roll a d20 to see if it wakes up.`, { title: 'Wake-up check' });
  if (roll === null) return;
  // Caught, not left to reject up the chain -- this runs as one step of the
  // End Turn button's own .then(...).then(() => CombatAPI.advanceTurn())
  // sequence (see its own call site), and an uncaught rejection here would
  // silently skip advanceTurn() too, making End Turn appear to do nothing.
  if (roll >= 11) await CombatAPI.removeStatus(holderId, status.id, `rolled ${roll} on the wake-up check`).catch((err) => showCombatAlert(err.message, { title: 'Error' }));
}

/** A `heal` status's own repeat trigger (Aqua Ring/Ingrain -- see move-effects-
 * schema.md's `repeat` field and pendingTurnHeals's own docstring): rolls (or
 * computes) this turn's amount and applies it, same client-authoritative
 * update-stats correction every other heal in this app uses. The status
 * itself is never touched here -- its own `ends` (concentration, a rounds/
 * until_turn count) is what eventually removes it; this just fires again
 * every time it's still around at the right turn boundary.
 *
 * `holderId` is always the status HOLDER (whoever `_promptTurnHeals` found
 * it on, and so whose OWN turn boundary just triggered this) -- for Aqua
 * Ring/Ingrain that's also who gets healed, but Wish's own `healTargetId`
 * (see _offerMoveEffects's own special case) can redirect the heal to a
 * DIFFERENT participant while still computing "+MOVE"/the caster-level
 * scaling off the HOLDER's own stats, since it's the holder's move, not the
 * recipient's. */
async function _applyRecurringHeal(holderId, status) {
  const holder = session?.participants?.[holderId];
  const recipientId = status.healTargetId || holderId;
  const recipient = session?.participants?.[recipientId];
  if (!recipient) return;
  const moveModBonus = status.amount?.moveMod
    ? bestMoveStatModifier(findMoveRow(status.moveName) || [], holder || recipient)
    : 0;
  await _handleApplyHeal({
    targetId: recipientId, effect: status, moveName: status.moveName || statusLabel(status),
    casterId: status.sourceId || holderId, casterName: status.sourceName || holder?.name,
    moveModBonus, damageDealt: undefined, casterLevel: holder?.level,
  });
}

/** Prompts `participantId`'s repeat heal for every `heal` status due at `timing`
 * (start_of_turn / end_of_turn), same "one after the other" pattern as
 * _promptTurnSaves right above -- run alongside it at both this file's turn-
 * boundary hooks. */
async function _promptTurnHeals(participantId, timing) {
  const holder = session?.participants?.[participantId];
  if (!holder) return;
  // Grassy Terrain: "all creatures in the affected area heal ... at the end of their turn" (field-wide -- no area tracking).
  const terrain = terrainsAffecting(session, participantId).find(t => terrainKindOf(t) === 'grassy' && t.healDice);
  if (timing === 'end_of_turn' && terrain && holder.status === 'participating') {
    try {
      await _handleApplyHeal({
        targetId: participantId, effect: { amount: { dice: terrain.healDice, pool: 'HP' } }, moveName: terrain.name,
        casterId: terrain.sourceId || participantId, casterName: terrain.sourceName || holder.name,
        moveModBonus: 0, damageDealt: undefined, casterLevel: holder.level,
      });
    } catch (err) {
      showCombatAlert(err.message, { title: 'Error' });
    }
  }
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
/** A blast move's area for the multi-target picker's "select from the map": radius from its range text ("Self (20ft. radius)",
 * "50ft., 10ft. radius"), height from its description ("40ft. high cylinder"), and whether it's centered on the caster or
 * on a point the caster places. null for moves with no circular area (lines and cones aren't supported yet). */
function _aoeAreaFor(moveName) {
  const row = findMoveRow(moveName) || [];
  const range = String(row[6] || '');
  if (!/radius|circle|cylinder/i.test(range)) return null;
  const radiusFt = radiusFtFromRange(range);
  if (!radiusFt) return null;
  const high = /(\d+)\s*(?:ft|feet|foot)\.?\s*high/i.exec(String(row[7] || ''));
  return { radiusFt, heightFt: high ? Number(high[1]) : null, centeredOnCaster: /\bself\b/i.test(range) };
}

const _hazardsPrompted = new Set();

/** Spikes-style hits the server queued (see routes_combat.py's _queue_hazards): the creature's owner is asked for the damage
 * roll and the save. A creature nobody owns (a DM's enemy) is asked on whichever device is looking -- the first to answer
 * resolves it and the rest are taken down by the next push. */
function _maybePromptHazards(state) {
  const pending = state?.pendingHazards || [];
  const liveIds = new Set(pending.map(h => h.id));
  for (const id of [..._hazardsPrompted]) {
    if (!liveIds.has(id)) { closeHazardPopup(id); _hazardsPrompted.delete(id); }
  }
  const me = _currentTrainerName();
  for (const h of pending) {
    if (_hazardsPrompted.has(h.id) || isHazardPopupOpen(h.id)) continue;
    const p = state.participants?.[h.participantId];
    if (!p || (p.owner && p.owner !== me)) continue;
    _hazardsPrompted.add(h.id);
    promptHazard(h).then(res => {
      if (res) return CombatAPI.resolveHazard(h.id, res.roll, res.saved, res.failedBy);
    }).catch(err => showCombatAlert(err.message, { title: 'Error' }));
  }
}

async function _maybePromptStartOfTurnSaves(state) {
  if (_promptingSaves || !state?.active || !state.started) return;
  const activeId = state.turnOrder?.[state.turnIndex];
  const p = activeId ? state.participants?.[activeId] : null;
  if (!p || !p.owner || p.owner !== _currentTrainerName()) return;
  const key = `${state.logFile}:${state.round}:${state.turnIndex}:${activeId}`;
  if (sessionStorage.getItem(WIP_SAVE_PROMPT_KEY) === key) return;
  sessionStorage.setItem(WIP_SAVE_PROMPT_KEY, key);
  const hasParalyzed = (p.statuses || []).some(s => s.kind === 'condition' && s.apply === 'paralyzed');
  const hasConfused = (p.statuses || []).some(s => s.kind === 'condition' && s.apply === 'confused');
  if (!pendingTurnSaves(p, 'start_of_turn').length && !pendingTurnHeals(p, 'start_of_turn').length && !hasParalyzed && !hasConfused) return;
  _promptingSaves = true;
  try {
    await _promptTurnSaves(activeId, 'start_of_turn');
    await _promptTurnHeals(activeId, 'start_of_turn');
    // Paralysis is checked first and, on a failed roll, suppresses the
    // confusion check entirely for this turn -- see _promptParalysisCheck's
    // own docstring for the rulebook's explicit ordering.
    const locked = await _promptParalysisCheck(activeId);
    if (!locked) await _promptConfusionCheck(activeId);
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
    else if (action === 'stand-up') await CombatAPI.standUp(holderId);
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
