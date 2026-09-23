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
 * genuinely waiting. Resolves once the window closes (or couldn't be opened at
 * all) -- never rejects, so a network hiccup mid-wait costs the attacker a little
 * extra delay rather than losing their whole action, the same trust-the-flow-
 * keeps-moving decision made everywhere else in this app.
 */
export async function waitForReactionWindow(trigger, anchorId, attackerId, moveName, onStatus) {
  let opened;
  try {
    opened = await CombatAPI.openReactionWindow(trigger, anchorId, attackerId, moveName);
  } catch {
    onStatus?.({ opened: false });
    return;
  }
  if (!opened?.opened) {
    onStatus?.({ opened: false });
    return;
  }

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
    if (!pr) return; // closed -- everyone answered, or someone's client already timed it out

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
