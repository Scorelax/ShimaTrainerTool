// A tiny, non-interactive "Waiting for possible reactions..." overlay for a
// reaction wait that has no existing popup step of its own to show it in.
// The 'damaged' family (see reaction-window.js) is always like this -- a
// damage-based wait happens after every popup involved has already closed.
// The 'targeted' family usually pauses INSIDE an already-open popup instead
// (target-picker.js's own step) and so doesn't need this, EXCEPT
// combat-wip.js's own AoE flow (_handleMultiHitAoe, Wide Guard's own
// reaction window), which has no popup step at all to pause inside of --
// same "nothing to show it in" situation as 'damaged', just a different
// trigger. Just a small blocking indicator with a live countdown; nothing to
// click, it closes itself once the wait resolves.
import { waitForReactionWindow } from './reaction-window.js';

function _injectStyles() {
  if (document.getElementById('reaction-wait-overlay-styles')) return;
  const style = document.createElement('style');
  style.id = 'reaction-wait-overlay-styles';
  style.textContent = `
    .reaction-wait-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.55); z-index: 1250; display: none; justify-content: center; align-items: center; }
    .reaction-wait-box { background: #1e1e34; border: 1px solid rgba(255,255,255,0.15); border-radius: 14px; padding: 1.2rem 1.6rem; text-align: center; color: #e0e0e0; box-shadow: 0 10px 40px rgba(0,0,0,0.6); }
    .reaction-wait-box .msg { font-size: 0.95rem; margin-bottom: 0.4rem; }
    .reaction-wait-box .timer { font-size: 0.82rem; color: #a0a0c0; }
  `;
  document.head.appendChild(style);
}

let _overlay = null;

function _ensureDom() {
  if (_overlay) return;
  _injectStyles();
  _overlay = document.createElement('div');
  _overlay.className = 'reaction-wait-overlay';
  _overlay.id = 'reactionWaitOverlay';
  _overlay.innerHTML = `
    <div class="reaction-wait-box">
      <div class="msg">Waiting for possible reactions…</div>
      <div class="timer" id="reactionWaitOverlayTimer"></div>
    </div>`;
  document.body.appendChild(_overlay);
}

/** Opens a reaction window of `trigger` ('damaged' or 'targeted') anchored on
 * `anchorId` and shows this overlay only for as long as it's genuinely
 * waiting on someone -- no-ops visibly (never shown at all) when nobody's
 * eligible. Returns whatever waitForReactionWindow itself resolves to
 * (`{blocked}` or, for Wide Guard's own `damage_multiplier` effect,
 * `{blocked: false, multiplier, reactorName}`) -- this overlay is purely
 * cosmetic, it doesn't interpret the result. */
async function _waitForReactions(trigger, anchorId, attackerId, moveName) {
  _ensureDom();
  let shown = false;
  const result = await waitForReactionWindow(trigger, anchorId, attackerId, moveName, (status) => {
    if (!status.opened) return;
    if (!shown) { shown = true; _overlay.style.display = 'flex'; }
    const secs = Math.ceil(status.msLeft / 1000);
    document.getElementById('reactionWaitOverlayTimer').textContent = `${secs}s`;
  });
  if (shown) _overlay.style.display = 'none';
  return result;
}

export async function waitForDamagedReactions(anchorId, attackerId, moveName) {
  return _waitForReactions('damaged', anchorId, attackerId, moveName);
}

/** combat-wip.js's own _handleMultiHitAoe -- the ONE 'targeted'-family
 * caller with no existing popup step of its own (see this module's header
 * comment). `anchorId` is the first target actually picked for the AoE, the
 * closest stand-in this app has for "is the reactor in range of the blast"
 * (there's no real blast-center/positional-radius concept anywhere here). */
export async function waitForTargetedAoeReactions(anchorId, attackerId, moveName) {
  return _waitForReactions('targeted', anchorId, attackerId, moveName);
}

/** combat-wip.js's own _handleEffectsOnly -- opened right before a self-
 * only move's own effects are offered, so a Heal Block/Strength Sap/
 * Spectral Surge/Snatch-style reactor can interject before a self-buff or
 * self-heal actually lands. Anchored on the CASTER themselves (both
 * anchorId and attackerId -- there's no separate "target" here, the caster
 * IS who the reaction concerns), same generic trigger-name-agnostic
 * eligibility `_eligible_reactors` already uses for every other trigger. */
export async function waitForBeneficialReactions(casterId, moveName) {
  return _waitForReactions('beneficial', casterId, casterId, moveName);
}
