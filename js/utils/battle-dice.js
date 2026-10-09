// Ace Trainer's Battle Dice in the shared battle: "add 1d6 to your next attack or damage roll". Offered as a button in
// the attack-roll and damage-roll windows (target-picker.js, save-picker.js) so the d6 is added straight into the roll it
// was spent on. Charges live on the logged-in trainer's row like before (trainerData[45] = "max - current", path at
// trainerData[25]) -- the same storage move-popup.js's own Battle Dice button (still used outside the shared battle) reads.
import { TrainerAPI } from '../api.js';

function _trainerData() {
  try { return JSON.parse(sessionStorage.getItem('trainerData') || '[]'); } catch { return []; }
}

/** { max, current } for an Ace Trainer, or null for any other trainer path (no button at all). */
export function battleDiceState() {
  const td = _trainerData();
  if ((td[25] || '') !== 'Ace Trainer') return null;
  const [max, current] = String(td[45] || '').split('-').map(p => parseInt(p.trim(), 10));
  return { max: max || 0, current: current || 0 };
}

/** Spends one charge (saved locally and to the server). Returns the charges left, or null if there were none. */
export function spendBattleDie() {
  const td = _trainerData();
  const state = battleDiceState();
  if (!state || state.current <= 0) return null;
  const left = state.current - 1;
  td[45] = `${state.max} - ${left}`;
  sessionStorage.setItem('trainerData', JSON.stringify(td));
  TrainerAPI.update(td).catch(e => console.error('Battle dice sync:', e));
  return left;
}

/** The button for a roll window's dice row, or '' when this trainer has no Battle Dice (or none left). `pending` = dice
 * already added earlier in this same attack but not yet spent (they're spent when the roll is confirmed). */
export function battleDieButtonHtml(extraClass = '', pending = 0) {
  const s = battleDiceState();
  const left = s ? s.current - pending : 0;
  if (left <= 0) return '';
  return `<button type="button" class="combat-use-move-btn ${extraClass}" data-battle-die="1">Add Battle Dice (+1d6, ${left} left)</button>`;
}
