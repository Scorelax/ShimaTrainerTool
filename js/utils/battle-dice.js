// Ace Trainer's Battle Dice in the shared battle: "add 1d6 to your next attack or damage roll". Offered as a button in
// the attack-roll and damage-roll windows (target-picker.js, save-picker.js) so the d6 is added straight into the roll it
// was spent on. Charges live on the logged-in trainer like before (battleDice = {max, current}, for trainerPath 'Ace
// Trainer') -- the same storage move-popup.js's own Battle Dice button (still used outside the shared battle) reads.
import { TrainerAPI } from '../api.js';
import { loadTrainer, storeTrainer } from './trainer-data.js';

/** { max, current } for an Ace Trainer, or null for any other trainer path (no button at all). */
export function battleDiceState() {
  const td = loadTrainer();
  if ((td.trainerPath || '') !== 'Ace Trainer') return null;
  return { max: Number(td.battleDice?.max) || 0, current: Number(td.battleDice?.current) || 0 };
}

/** Spends one charge (saved locally and to the server). Returns the charges left, or null if there were none. */
export function spendBattleDie() {
  const td = loadTrainer();
  const state = battleDiceState();
  if (!state || state.current <= 0) return null;
  const left = state.current - 1;
  td.battleDice = { max: state.max, current: left };
  storeTrainer(td);
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
