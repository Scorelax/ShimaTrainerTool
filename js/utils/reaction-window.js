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

const POLL_MS = 700;
const RETRY_CLOSE_MS = 500;

function _sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/**
 * Opens a reaction window and waits for it to close. `onStatus(status)` (optional)
 * is called so the caller can render its own "waiting for reactions..." UI --
 * once with `{opened: false}` if nobody was eligible (nothing to wait for, proceed
 * immediately), or repeatedly with `{opened: true, msLeft, pendingReaction}` while
 * genuinely waiting. Resolves to `{blocked: false}` normally, or `{blocked: true,
 * blockerName}` once a reactor's own `block_attack` effect (Protect, King's
 * Shield, ...) landed -- see move-effects-schema.md's own section; only
 * target-picker.js's 'targeted' caller actually acts on this, a 'damaged'
 * reaction is already too late to block anything. Never rejects, so a network
 * hiccup mid-wait costs the attacker a little extra delay rather than losing
 * their whole action, the same trust-the-flow-keeps-moving decision made
 * everywhere else in this app.
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

  // Captured from the first poll that sees the window at all, so a block
  // reported later (session.reactionBlock, set by a separate
  // block-pending-attack call the reactor's own move triggers -- see
  // routes_combat.py) can be confirmed as belonging to THIS window and not
  // some earlier one that already closed. block-pending-attack never closes
  // the window itself (reaction-end still does, same as any other reaction),
  // so a block can be visible on a poll well before pendingReaction goes
  // null -- checked opportunistically every iteration rather than only once
  // at the end, so a late/slow final poll can't miss it.
  let windowId = null;
  let blockResult = { blocked: false };
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let session = null;
    try {
      const result = await CombatAPI.getState();
      session = result?.status === 'success' ? result.data : null;
    } catch {
      // transient -- fall through and poll again rather than giving up on the wait
    }
    const pr = session?.pendingReaction;
    if (!windowId && pr) windowId = pr.id;
    if (session?.reactionBlock?.windowId && session.reactionBlock.windowId === windowId) {
      blockResult = { blocked: true, blockerName: session.reactionBlock.blockerName };
    }
    if (!pr) return blockResult; // closed -- everyone answered, or someone's client already timed it out

    const msLeft = pr.expiresAt - Date.now();
    onStatus?.({ opened: true, msLeft: Math.max(0, msLeft), pendingReaction: pr });
    if (msLeft <= 0) {
      try { await CombatAPI.closeReactionWindow(); } catch { /* someone's still reacting -- retry shortly */ }
      await _sleep(RETRY_CLOSE_MS);
      continue;
    }
    await _sleep(Math.min(POLL_MS, Math.max(200, msLeft)));
  }
}
