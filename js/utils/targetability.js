// Which participants a move can currently be aimed at. A participant in a semi-invulnerable state
// (underground, underwater, airborne, vanished -- see move-effects.js's UNTARGETABLE_STATES) is hidden
// from every target picker unless the move lists that state in its own `hitsStates` (Earthquake ->
// underground). The picker modules don't know about move data, so combat-wip.js injects the rule.
import { showCombatAlert } from './combat-alert.js';

let _resolver = () => null;

/** `fn(participant, moveName)` -> the state hiding the participant from that move, or null. */
export function setTargetabilityResolver(fn) {
  _resolver = typeof fn === 'function' ? fn : () => null;
}

/** `participants` minus anyone `moveName` can't target right now. When that leaves nobody (but there
 * was somebody), says why, since the picker would otherwise just refuse to open. */
export function filterTargetable(participants, moveName) {
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
  return list;
}
