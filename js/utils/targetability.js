// Which participants a move can currently be aimed at. A participant in a semi-invulnerable state
// (underground, underwater, airborne, vanished -- see move-effects.js's UNTARGETABLE_STATES) is hidden
// from every target picker unless the move lists that state in its own `hitsStates` (Earthquake ->
// underground). A creature beyond the move's range (move-range.js) stays in the list but is drawn greyed
// out and can't be picked (markOutOfRange). So does one in reach but behind full cover from the DM's map objects
// (cover.js); one behind partial cover can be picked, and its attack roll has disadvantage (moveCover). Cover counts
// for moves aimed at a creature within a reach, and for lines and cones -- measured from the caster, where they start
// (the line/cone aimers leave out whoever is behind full cover). Not for Self moves or other areas. The picker modules
// don't know about move data, so combat-wip.js injects the rules.
import { showCombatAlert } from './combat-alert.js';
import { moveReachFt, creatureDistanceFt } from './move-range.js';
import { coverBetween, coverText } from './cover.js';

// "Self (15ft. cone)", "50ft. line": aimed from the caster, so cover from the caster counts for them too.
const LINE_OR_CONE = /\d+\s*(?:ft|feet|foot)\.?\s*(?:line|cone)/i;

let _resolver = () => null;
let _rangeResolver = () => '';
let _noTargetHandler = null;

/** `fn(casterId, moveName, found)` -- runs each time a picker checks a move's targets: found = false when nobody can be
 * aimed at (all out of reach or hidden) -- the move's VP was already paid, so the shared battle refunds it -- and true
 * once somebody could, which ends that chance (a later pick in the same move, e.g. a multi-hit's next target, never
 * refunds a move that already went off). See combat-wip.js's _onTargetCheck. */
export function setNoTargetHandler(fn) {
  _noTargetHandler = typeof fn === 'function' ? fn : null;
}

/** `fn(participant, moveName)` -> the state hiding the participant from that move, or null. */
export function setTargetabilityResolver(fn) {
  _resolver = typeof fn === 'function' ? fn : () => null;
}

/** `fn(moveName)` -> the move's range text ("30ft.", "Melee", "Self (15ft. cone)"...). */
export function setMoveRangeResolver(fn) {
  _rangeResolver = typeof fn === 'function' ? fn : () => '';
}

/** `participants` minus anyone `moveName` can't target right now. With the `session` and the caster, the ones beyond
 * the move's reach are kept but listed in the returned array's `outOfRange` (id -> "45ft away"), the ones behind full
 * cover in `noSight` and the ones behind partial cover in `partialCover` (id -> "Full cover (Tree)"), for
 * markOutOfRange. When that leaves nobody to pick (but there was somebody), says why, since the picker would otherwise
 * just refuse to open -- and returns an empty list. */
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
    if (casterId) _noTargetHandler?.(casterId, moveName, false);
  }
  list.outOfRange = new Map();
  list.noSight = new Map();
  list.partialCover = new Map();
  const caster = session?.participants?.[casterId];
  const rangeText = _rangeResolver(moveName);
  const reach = caster ? moveReachFt(rangeText, caster.size) : null;
  if (reach == null && !(caster && LINE_OR_CONE.test(rangeText))) {
    if (list.length && casterId) _noTargetHandler?.(casterId, moveName, true);
    return list;
  }
  list.forEach((p) => {
    const ft = reach == null ? null : creatureDistanceFt(session.board, caster, p);
    if (ft != null && ft > reach) { list.outOfRange.set(p.id, `${ft}ft away`); return; }
    const cover = coverBetween(session, casterId, p.id);
    if (cover.level === 'full') list.noSight.set(p.id, coverText(cover));
    else if (cover.level === 'partial') list.partialCover.set(p.id, coverText(cover));
  });
  if (list.length && list.outOfRange.size + list.noSight.size === list.length) {
    if (list.noSight.size) {
      showCombatAlert(`Everyone within ${moveName}'s reach is behind full cover -- move to where you can see them first.`, { title: 'No line of sight' });
    } else {
      showCombatAlert(`Nobody is within ${moveName}'s reach (${reach}ft) -- move closer first.`, { title: 'Out of range' });
    }
    _noTargetHandler?.(casterId, moveName, false);
    const none = [];
    none.outOfRange = new Map();
    none.noSight = new Map();
    none.partialCover = new Map();
    return none;
  }
  if (list.length) _noTargetHandler?.(casterId, moveName, true);
  if (list.outOfRange.size) list.reachFt = reach;
  return list;
}

/** The cover creature `targetId` has from `attackerId` against `moveName` ({level: 'partial' | 'full', by, hidden},
 * see cover.js), or null when there's none or the move is neither aimed at a creature within a reach nor a line or
 * cone (Self, other areas). */
export function moveCover(session, attackerId, targetId, moveName) {
  const attacker = session?.participants?.[attackerId];
  const rangeText = _rangeResolver(moveName);
  if (!attacker || !targetId || (moveReachFt(rangeText, attacker.size) == null && !LINE_OR_CONE.test(rangeText))) return null;
  const cover = coverBetween(session, attackerId, targetId);
  return cover.level === 'none' ? null : cover;
}

/** Greys out (and disables) the picker cards of creatures beyond the move's reach, with how far away they are, and
 * of creatures behind full cover. Ones behind partial cover get a note but stay pickable -- unless `partial` is false
 * (a saving-throw move, where partial cover changes nothing). */
export function markOutOfRange(grid, list, { partial = true } = {}) {
  if (!grid) return;
  const disable = (id, note, title) => {
    const card = grid.querySelector(`[data-target-id="${id}"]`);
    if (!card) return;
    card.disabled = true;
    card.classList.add('out-of-range');
    card.style.opacity = '0.4';
    card.style.cursor = 'not-allowed';
    card.title = title;
    card.insertAdjacentHTML('beforeend', `<div class="target-range-note" style="font-size:0.7rem;color:#e74c3c;font-weight:700;">${note}</div>`);
  };
  list?.outOfRange?.forEach((note, id) => disable(id, note, `Out of range -- ${note} (reach ${list.reachFt}ft)`));
  list?.noSight?.forEach((note, id) => disable(id, note, `${note} -- no line of sight. Move to where you can see it first.`));
  if (!partial) return;
  list?.partialCover?.forEach((note, id) => {
    const card = grid.querySelector(`[data-target-id="${id}"]`);
    if (!card) return;
    card.title = `${note} -- attack rolls against it have disadvantage`;
    card.insertAdjacentHTML('beforeend', `<div class="target-cover-note" style="font-size:0.7rem;color:#f0b232;font-weight:700;">${note}</div>`);
  });
}
