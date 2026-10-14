// The shared battle pays for a move (VP, the "used X" log line, a recharge charge, the round's bonus action) only once
// something has actually happened: an attack roll was entered, a save was resolved, an effect, zone or heal was applied.
// Closing the popups before that costs nothing.
//
// combat.js hands the payment over with beginMove() when Use Move is pressed; the rolls and the server calls that count
// as "something happened" call commitMove() (target-picker.js, save-picker.js, heal-popup.js, and the outcome calls in
// api.js's CombatAPI); combat-wip.js calls abandonMove() once the move's whole flow is over, so a move left unfinished
// is dropped instead of being paid later by some unrelated roll. The legacy combat page never calls beginMove, so
// every function here is a no-op there.

let _pending = null; // { combatantId, moveName, pay }
let _onPaid = null;

/** Called with ({combatantId, moveName}) right after a move is paid for -- combat-wip.js starts its concentration then. */
export function setOnMovePaid(fn) {
  _onPaid = typeof fn === 'function' ? fn : null;
}

/** A move was just used; `pay` spends it. A move still waiting from before is dropped (never paid). */
export function beginMove(combatantId, moveName, pay) {
  _pending = { combatantId, moveName, pay };
}

/** Something happened: the pending move is paid for now (once). */
export function commitMove() {
  const p = _pending;
  if (!p) return;
  _pending = null;
  try { p.pay(); } catch (err) { console.error('[move-commit] paying for the move failed', err); }
  try { _onPaid?.({ combatantId: p.combatantId, moveName: p.moveName }); } catch (err) { console.error('[move-commit]', err); }
}

/** The move's flow is over. Unpaid -> nothing happened, nothing is spent. Returns true when a move was dropped. */
export function abandonMove(combatantId = null) {
  if (!_pending || (combatantId && _pending.combatantId !== combatantId)) return false;
  _pending = null;
  return true;
}

/** The move waiting to be paid for, or null. */
export function pendingMove() {
  return _pending ? { combatantId: _pending.combatantId, moveName: _pending.moveName } : null;
}
