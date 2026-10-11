// Blaze / Torrent / Overgrow / Swarm's "50% more dice", rolled on its own: one extra input per ability under a damage
// step's normal damage roll (target-picker.js, save-picker.js). `abilityDice` is computedData.abilityDice from the move
// popup -- [{ label: 'Blaze', dice: '1d8', hint }] (ability-mods.js's abilityExtraDice).

/** Draws the inputs into `container` (empty when there are none); `onInput` runs on every keystroke. */
export function renderAbilityDiceInputs(container, abilityDice, { labelClass, inputClass, onInput, onEnter }) {
  if (!container) return;
  container.innerHTML = (abilityDice || []).map((a, i) => `
    <label class="${labelClass}" for="abilityDiceInput${i}">${a.label}: ${a.dice}${a.hint ? `<span style="opacity:0.75;font-weight:400;"> (${a.hint})</span>` : ''}</label>
    <input type="number" id="abilityDiceInput${i}" class="${inputClass}" data-ability-dice placeholder="Enter the ${a.label} roll…">`).join('');
  container.querySelectorAll('[data-ability-dice]').forEach((el) => {
    el.addEventListener('input', onInput);
    if (onEnter) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') onEnter(); });
  });
}

/** The ability rolls added together -- NaN while one of them is still empty (the damage can't be confirmed yet). */
export function abilityDiceSum(container) {
  let sum = 0;
  for (const el of container?.querySelectorAll('[data-ability-dice]') || []) {
    const v = parseInt(el.value, 10);
    if (Number.isNaN(v)) return NaN;
    sum += v;
  }
  return sum;
}
