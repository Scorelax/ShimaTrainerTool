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
