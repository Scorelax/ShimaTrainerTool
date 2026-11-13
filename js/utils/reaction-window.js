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
import { whileWaitingOnOthers } from './popup-queue.js';

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
      : !e.responded && e.queuedAt && !e.shownAt ? ['deciding', '… offer waiting on their screen'] // (their clock holds)
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
export function waitForOpenWindow(onStatus, windowId = null) {
  // A wait on other screens: the popups queued on this one (a reaction offer for a creature played here too) may open
  // meanwhile, and the move carries on only once they're answered (popup-queue.js)
  return whileWaitingOnOthers(_waitForOpenWindow(onStatus, windowId));
}

/** What window `windowId`'s reactions did so far, read off `session` into `out`: a block (Protect -- unless the attacker
 * bypassed it with Feint) and a damage multiplier (Wide Guard, Protect used again). */
function _readOutcome(session, windowId, out) {
  const rb = session?.reactionBlock;
  if (rb?.windowId && rb.windowId === windowId) {
    out.blocked = !rb.negated;
    out.blockerName = rb.blockerName;
  }
  // Every block of the window -- an area move's may have several, each protecting the creatures in `anchors`
  const blocks = (session?.reactionBlocks || []).filter(b => b.windowId && b.windowId === windowId);
  if (blocks.length) out.blocks = blocks.map(b => ({ blockerId: b.blockerId, blockerName: b.blockerName, anchors: b.anchors || [b.anchorId] }));
  const rm = session?.reactionDamageMultiplier;
  if (rm?.windowId && rm.windowId === windowId) {
    Object.assign(out, { multiplier: rm.multiplier, reactorName: rm.reactorName, reactorId: rm.reactorId,
      anchors: rm.anchors || [rm.anchorId], ...(rm.pool ? { pool: rm.pool } : {}) });
  }
  return out;
}

/**
 * A 'targeted' window opened as the attacker starts rolling (the user's call, 2026-11-13): it stays open through the
 * attack roll and the damage roll, so the target -- or anyone else who may -- can react while the attack is being
 * prepared (some reactions only work before an attack lands), and the attack waits for the reaction to be over. Resolves
 * to null when nobody may react (nothing to watch), else a handle:
 *  - `onChange({pendingReaction, session, reacting})` is called on every poll while the attacker prepares; `reacting`
 *    while one of the creatures the window was offered to is reacting right now (the attacker's popup pauses then);
 *  - `outcome()`: what the reactions did so far -- {blocked, blockerName, blocks, multiplier, pool, anchors, reactorIds};
 *  - `finish(onStatus)`: the attacker is done rolling -- waits out whoever is still deciding (as waitForOpenWindow, with
 *    `onStatus` the same) and resolves to outcome();
 *  - `abandon()`: the attack was dropped -- stops watching and closes the window (once a reaction under way is over);
 *    resolves once the server has it.
 */
export async function openPreparationWindow(anchorId, attackerId, moveName, onChange) {
  // (an array: an area move's creatures, all in the one window)
  const anchorIds = Array.isArray(anchorId) ? anchorId : null;
  let opened;
  try {
    opened = await CombatAPI.openReactionWindow('targeted', anchorIds ? anchorIds[0] : anchorId, attackerId, moveName, { preparing: true, anchorIds });
  } catch {
    return null;
  }
  if (!opened?.opened || !opened.windowId) return null;
  const windowId = opened.windowId;
  const out = { blocked: false };
  const reactorIds = new Set();
  let stopped = false;
  let finishing = false;
  const seeReactor = (session) => {
    const pr = session?.pendingReaction?.id === windowId ? session.pendingReaction : null;
    const rid = session?.reactingParticipantId;
    const reacting = !!(pr && rid && pr.eligible?.[rid]);
    if (reacting) reactorIds.add(rid);
    return { pr, reacting };
  };
  (async () => {
    while (!stopped && !finishing) {
      let session = null;
      try {
        const res = await CombatAPI.getState();
        session = res?.status === 'success' ? res.data : null;
      } catch { /* transient -- poll again */ }
      if (stopped || finishing) break;
      if (session) {
        _readOutcome(session, windowId, out);
        const { pr, reacting } = seeReactor(session);
        try { onChange?.({ pendingReaction: pr, session, reacting }); } catch (err) { console.error('[reaction-window]', err); }
        if (!pr) break; // closed: everyone answered (a reaction that just ended was reported above)
      }
      await _sleep(POLL_MS);
    }
  })();
  const outcome = () => ({ ...out, reactorIds: [...reactorIds] });
  return {
    windowId,
    outcome,
    async finish(onStatus) {
      finishing = true;
      try { await CombatAPI.reactionWindowReady(windowId); } catch { /* the window runs out by its own clock anyway */ }
      const res = await waitForOpenWindow((status) => {
        seeReactor(status.session);
        onStatus?.(status);
      }, windowId);
      Object.assign(out, res);
      return outcome();
    },
    abandon() {
      if (stopped || finishing) return Promise.resolve(); // (finish() closes it itself)
      stopped = true;
      return CombatAPI.reactionWindowReady(windowId, { dropped: true }).catch(() => {});
    },
  };
}

async function _waitForOpenWindow(onStatus, knownWindowId = null) {
  // Captured from the first poll that sees the window at all, so an outcome
  // reported later (session.reactionBlock / session.reactionDamageMultiplier,
  // each set by a separate call the reactor's own move triggers -- see
  // routes_combat.py) can be confirmed as belonging to THIS window and not
  // some earlier one that already closed. Neither ever closes the window
  // itself (reaction-end still does, same as any other reaction), so either
  // can be visible on a poll well before pendingReaction goes null -- checked
  // opportunistically every iteration rather than only once at the end, so a
  // late/slow final poll can't miss it.
  let windowId = knownWindowId;
  const result = { blocked: false };
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let session = null;
    try {
      const apiResult = await CombatAPI.getState();
      session = apiResult?.status === 'success' ? apiResult.data : null;
    } catch {
      // transient -- fall through and poll again rather than giving up on the wait
    }
    if (!session) { await _sleep(POLL_MS); continue; }
    let pr = session.pendingReaction;
    if (!windowId && pr) windowId = pr.id;
    if (pr && pr.id !== windowId) pr = null; // ours already closed (another one is open now)
    _readOutcome(session, windowId, result);
    if (!pr) return result; // closed -- everyone answered, or someone's client already timed it out

    // The clock is held (null) while a reactor's offer waits behind another popup on their screen -- or, at the latest,
    // until its hard limit (staleAt) -- see routes_combat.py's _refresh_window_clock.
    const msLeft = pr.expiresAt != null ? pr.expiresAt - Date.now() : null;
    const due = pr.expiresAt != null ? pr.expiresAt : pr.staleAt;
    onStatus?.({ opened: true, msLeft: msLeft === null ? null : Math.max(0, msLeft), pendingReaction: pr, session });
    if (due != null && due - Date.now() <= 0) {
      try { await CombatAPI.closeReactionWindow(); } catch { /* someone's still reacting, or not quite time -- retry shortly */ }
      await _sleep(RETRY_CLOSE_MS);
      continue;
    }
    await _sleep(msLeft === null ? POLL_MS : Math.min(POLL_MS, Math.max(200, msLeft)));
  }
}
