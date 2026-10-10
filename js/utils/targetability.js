// Which participants a move can currently be aimed at. A participant in a semi-invulnerable state
// (underground, underwater, airborne, vanished -- see move-effects.js's UNTARGETABLE_STATES) is hidden
// from every target picker unless the move lists that state in its own `hitsStates` (Earthquake ->
// underground). A creature beyond the move's range (move-range.js) stays in the list but is drawn greyed
// out and can't be picked (markOutOfRange). The picker modules don't know about move data, so
// combat-wip.js injects the rules.
import { showCombatAlert } from './combat-alert.js';
import { moveReachFt, creatureDistanceFt } from './move-range.js';

let _resolver = () => null;
let _rangeResolver = () => '';

/** `fn(participant, moveName)` -> the state hiding the participant from that move, or null. */
export function setTargetabilityResolver(fn) {
  _resolver = typeof fn === 'function' ? fn : () => null;
}

/** `fn(moveName)` -> the move's range text ("30ft.", "Melee", "Self (15ft. cone)"...). */
export function setMoveRangeResolver(fn) {
  _rangeResolver = typeof fn === 'function' ? fn : () => '';
}

/** `participants` minus anyone `moveName` can't target right now. With the `session` and the caster, the ones beyond
 * the move's reach are kept but listed in the returned array's `outOfRange` (id -> "45ft away") for markOutOfRange.
 * When that leaves nobody to pick (but there was somebody), says why, since the picker would otherwise just refuse
 * to open -- and returns an empty list. */
export function filterTargetable(participants, moveName, session = null, casterId = null) {
  if (!moveName) return participants;
  const hidden = [];
  const list = participants.filter((p) => {
    const state = _resolver(p, moveName);
    if (state) hidden.push(`${p.name} (${state.replace(/_/g, ' ')})`);
    return !state;
  });
  if (!list.length && hidden.length) {
    showCombatAlert(`${moveName} can't target ${hidden.join(', ')} right now.`, { title: 'No valid target' });
  }
  list.outOfRange = new Map();
  const caster = session?.participants?.[casterId];
  const reach = caster ? moveReachFt(_rangeResolver(moveName), caster.size) : null;
  if (reach == null) return list;
  list.forEach((p) => {
    const ft = creatureDistanceFt(session.board, caster, p);
    if (ft != null && ft > reach) list.outOfRange.set(p.id, `${ft}ft away`);
  });
  if (list.length && list.outOfRange.size === list.length) {
    showCombatAlert(`Nobody is within ${moveName}'s reach (${reach}ft) -- move closer first.`, { title: 'Out of range' });
    const none = [];
    none.outOfRange = new Map();
    return none;
  }
  if (list.outOfRange.size) list.reachFt = reach;
  return list;
}

/** Greys out (and disables) the picker cards of creatures beyond the move's reach, with how far away they are. */
export function markOutOfRange(grid, list) {
  if (!grid || !list?.outOfRange?.size) return;
  list.outOfRange.forEach((note, id) => {
    const card = grid.querySelector(`[data-target-id="${id}"]`);
    if (!card) return;
    card.disabled = true;
    card.classList.add('out-of-range');
    card.style.opacity = '0.4';
    card.style.cursor = 'not-allowed';
    card.title = `Out of range -- ${note} (reach ${list.reachFt}ft)`;
    card.insertAdjacentHTML('beforeend', `<div class="target-range-note" style="font-size:0.7rem;color:#e74c3c;font-weight:700;">${note}</div>`);
  });
}
