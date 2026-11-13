// Attacker-side half of the reaction-window system (see routes_combat.py's own
// module docstring on the mechanism, and move-effects-schema.md's reaction
// section) -- opens a "does anyone want to react?" window and waits for it to
// close, driving the client-side timeout itself (no server background timer,
// same reasoning as every other turn-timing thing in this app: the client
// that cares about the clock tracks it). Shared by target-picker.js (the
// 'targeted' family, right after a target is picked, before the attack roll)
// and combat-wip.js (the 'damaged' family, right after damage lands) so the
// polling/timeout logic exists in exactly one place.
import { CombatAPI } from '../api.js';
import { visibleToViewer } from './combat-visibility.js';

// --- What the wait is for (the user's call after the 2026-11-12 playtest): who may react, who has answered, who is reacting
// right now and whose screen that is -- so the table can see which player has to do something.

function _esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Who plays `p`: "the DM" for the DM's creatures, else the trainer's name ('' when nobody). */
export function playerOf(p) {
  const owner = p?.owner || '';
  return owner === 'DM' ? 'the DM' : owner;
}

function _injectWaitStyles() {
  if (document.getElementById('reaction-wait-detail-styles')) return;
  const style = document.createElement('style');
  style.id = 'reaction-wait-detail-styles';
  style.textContent = `
    .rw-detail { text-align: left; margin: 0.4rem auto 0; max-width: 340px; }
    .rw-head { font-size: 0.92rem; color: #ffe07a; font-weight: 700; margin-bottom: 0.45rem; text-align: center; }
    .rw-row { display: flex; justify-content: space-between; gap: 0.8rem; font-size: 0.85rem; padding: 0.3rem 0.55rem; border-radius: 8px; background: rgba(255,255,255,0.05); margin-bottom: 0.25rem; }
    .rw-row .who small { color: #a0a0c0; font-weight: 500; }
    .rw-row .st { white-space: nowrap; color: #a0a0c0; }
    .rw-row.deciding .st { color: #ffd166; }
    .rw-row.reacting { background: rgba(255,215,0,0.14); box-shadow: inset 0 0 0 1px rgba(255,215,0,0.5); }
    .rw-row.reacting .st { color: #ffd700; font-weight: 700; }
    .rw-row.done .st { color: #7bd88f; }
  `;
  document.head.appendChild(style);
}

/** Whether one of the creatures this window was offered to is reacting right now. The wait then steps aside (a banner
 * at the bottom, not a screen-wide cover): on a screen that also plays the reactor -- the DM's enemy reacting to the DM's
 * enemy's attack -- its card has to stay usable. */
export function reactingNow(status) {
  const id = status?.session?.reactingParticipantId;
  return !!id && !!status?.pendingReaction?.eligible?.[id];
}

/** The readout for a reaction wait (`status` as waitForReactionWindow's onStatus gives it): a headline saying who has to do
 * something, and a row per creature that may react -- deciding, no reaction, reacting now, reacted. '' when not waiting. */
export function reactionWaitHtml(status) {
  const pr = status?.pendingReaction;
  const s = status?.session;
  if (!pr || !s) return '';
  _injectWaitStyles();
  const nameOf = p => (p && visibleToViewer(p, 'name') ? p.name : '???');
  const reactingId = s.reactingParticipantId && pr.eligible?.[s.reactingParticipantId] ? s.reactingParticipantId : null;
  const rows = Object.entries(pr.eligible || {}).map(([id, e]) => {
    const p = s.participants?.[id];
    const player = playerOf(p);
    const [cls, st] = id === reactingId ? ['reacting', '⚡ reacting now']
      : !e.responded ? ['deciding', '… deciding']
      : p?.reactionUsed ? ['done', '✓ reacted'] : ['done', '– no reaction'];
    return { cls, html: `<div class="rw-row ${cls}"><span class="who">${_esc(nameOf(p))}${player ? ` <small>(${_esc(player)})</small>` : ''}</span><span class="st">${st}</span></div>` };
  });
  let head;
  if (reactingId) {
    const p = s.participants?.[reactingId];
    const player = playerOf(p);
    head = `⚡ ${_esc(nameOf(p))} is reacting${player ? ` -- waiting for ${_esc(player)} to finish (End Turn on its card)` : ''}`;
  } else {
    const deciding = [...new Set(Object.entries(pr.eligible || {}).filter(([, e]) => !e.responded)
      .map(([id]) => playerOf(s.participants?.[id]) || nameOf(s.participants?.[id])))];
    head = deciding.length ? `Waiting for ${_esc(deciding.join(', '))} to decide whether to react` : 'Everyone has answered -- carrying on…';
  }
  return `<div class="rw-detail"><div class="rw-head">${head}</div>${rows.map(r => r.html).join('')}</div>`;
}

const POLL_MS = 700;
const RETRY_CLOSE_MS = 500;

function _sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/**
 * Opens a reaction window and waits for it to close. `onStatus(status)` (optional)
 * is called so the caller can render its own "waiting for reactions..." UI --
 * once with `{opened: false}` if nobody was eligible (nothing to wait for, proceed
 * immediately), or repeatedly with `{opened: true, msLeft, pendingReaction}` while
 * genuinely waiting. Resolves to `{blocked: false}` normally, `{blocked: true,
 * blockerName}` once a reactor's own `block_attack` effect (Protect, King's
 * Shield, ...) landed, or `{blocked: false, multiplier, reactorName}` once a
 * reactor's own `damage_multiplier` effect (Wide Guard) landed instead -- see
 * move-effects-schema.md's own sections; a block and a multiplier are
 * mutually exclusive in practice (only one reactor's outcome is ever acted
 * on by a caller) but not structurally prevented from both being set if two
 * different eligible reactors each used one within the same window. Only
 * target-picker.js's 'targeted' caller and combat-wip.js's own AoE reaction
 * (_handleMultiHitAoe) act on either of these; a 'damaged' reaction is
 * already too late for both. Never rejects, so a network hiccup mid-wait
 * costs the attacker a little extra delay rather than losing their whole
 * action, the same trust-the-flow-keeps-moving decision made everywhere
 * else in this app.
 */
export async function waitForReactionWindow(trigger, anchorId, attackerId, moveName, onStatus) {
  let opened;
  try {
    opened = await CombatAPI.openReactionWindow(trigger, anchorId, attackerId, moveName);
  } catch {
    onStatus?.({ opened: false });
    return { blocked: false };
  }
  if (!opened?.opened) {
    onStatus?.({ opened: false });
    return { blocked: false };
  }
  return waitForOpenWindow(onStatus);
}

/**
 * Waits for the reaction window that is ALREADY open to close, driving its countdown the same way -- for a window the server
 * opened itself as part of another action (a creature walking away from a hostile one, a trainer switching a Pokemon out) rather
 * than the attacker's own client opening it. Without a client running the clock, a reactor nobody answers for (a DM's enemy) would
 * leave it open forever. Same resolve shape as waitForReactionWindow.
 */
export async function waitForOpenWindow(onStatus) {
  // Captured from the first poll that sees the window at all, so an outcome
  // reported later (session.reactionBlock / session.reactionDamageMultiplier,
  // each set by a separate call the reactor's own move triggers -- see
  // routes_combat.py) can be confirmed as belonging to THIS window and not
  // some earlier one that already closed. Neither ever closes the window
  // itself (reaction-end still does, same as any other reaction), so either
  // can be visible on a poll well before pendingReaction goes null -- checked
  // opportunistically every iteration rather than only once at the end, so a
  // late/slow final poll can't miss it.
  let windowId = null;
  let result = { blocked: false };
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let session = null;
    try {
      const apiResult = await CombatAPI.getState();
      session = apiResult?.status === 'success' ? apiResult.data : null;
    } catch {
      // transient -- fall through and poll again rather than giving up on the wait
    }
    const pr = session?.pendingReaction;
    if (!windowId && pr) windowId = pr.id;
    if (session?.reactionBlock?.windowId && session.reactionBlock.windowId === windowId) {
      result = { blocked: true, blockerName: session.reactionBlock.blockerName };
    }
    if (session?.reactionDamageMultiplier?.windowId && session.reactionDamageMultiplier.windowId === windowId) {
      result = { ...result, multiplier: session.reactionDamageMultiplier.multiplier, reactorName: session.reactionDamageMultiplier.reactorName,
        ...(session.reactionDamageMultiplier.pool ? { pool: session.reactionDamageMultiplier.pool } : {}) }; // Protect's repeat use: VP
    }
    if (!pr) return result; // closed -- everyone answered, or someone's client already timed it out

    const msLeft = pr.expiresAt - Date.now();
    onStatus?.({ opened: true, msLeft: Math.max(0, msLeft), pendingReaction: pr, session });
    if (msLeft <= 0) {
      try { await CombatAPI.closeReactionWindow(); } catch { /* someone's still reacting -- retry shortly */ }
      await _sleep(RETRY_CLOSE_MS);
      continue;
    }
    await _sleep(Math.min(POLL_MS, Math.max(200, msLeft)));
  }
}
