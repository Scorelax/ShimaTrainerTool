// The DM's own status conditions (the Admin module's Status conditions tab, the user's call, 2026-10-20): when one goes
// off in a battle and what it does by itself. A status applied in a battle carries its definition in `custom`
// ({trigger, turns, recurring, effect, amount}); routes_combat.py's _custom_status_point runs it.
export const STATUS_TRIGGERS = {
  turn_start: 'At the start of your next turn',
  turn_end: 'At the end of your next turn',
  round_start: 'At the top of the initiative order',
  round_end: 'At the end of the initiative order',
  turns_start: 'At the start of X amount of turns',
  turns_end: 'At the end of X amount of turns',
};
export const STATUS_EFFECTS = { '': 'None (the table handles it)', damage: 'Damage', heal: 'Heal', vp_gain: 'VP gain', vp_drain: 'VP drain' };

/** When it goes off, in words ("At the start of 3 turns · recurring · Damage 4"). */
export function describeTrigger(d) {
  if (!d) return '';
  const t = String(STATUS_TRIGGERS[d.trigger] || '').replace('X amount of', `${Math.max(1, Number(d.turns) || 1)}`);
  const eff = d.effect && STATUS_EFFECTS[d.effect] ? ` · ${STATUS_EFFECTS[d.effect]} ${Number(d.amount) || 0}` : '';
  return `${t}${d.recurring ? ' · recurring' : ''}${eff}`;
}

/** A custom status in play (its stored `custom`, routes_combat.py's _prime_custom_status): when it goes off next and
 * what happens after -- for the creature card's badge and its detail popup, where "until removed" would be wrong. */
export function describeCustomInPlay(c) {
  if (!c || !STATUS_TRIGGERS[c.trigger]) return '';
  const left = Math.max(1, Number(c.left) || Number(c.turns) || 1);
  const when = {
    turn_start: 'at the start of its next turn',
    turn_end: 'at the end of its next turn',
    round_start: 'at the top of the initiative order',
    round_end: 'at the end of the initiative order',
    turns_start: `at the start of its turn ${left === 1 ? 'next time' : `in ${left} turns`}`,
    turns_end: `at the end of its turn ${left === 1 ? 'next time' : `in ${left} turns`}`,
  }[c.trigger];
  const eff = c.effect && STATUS_EFFECTS[c.effect] && Number(c.amount) > 0 ? ` (${STATUS_EFFECTS[c.effect]} ${Number(c.amount)})` : '';
  return `Goes off ${when}${eff}${c.recurring ? ', every time' : ', then wears off'}`;
}
