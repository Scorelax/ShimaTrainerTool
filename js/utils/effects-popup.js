// "Apply these effects?" popup for the shared combat tool: after an attack or
// save resolves, lists every effect the move triggered (see move-effects.js's
// evaluateEffect) grouped by who it lands on, pre-selects the ones the recorded
// rolls say happened, and resolves to the ones the player confirms. Effects the
// recorded rolls can't decide (special conditions, a roll that wasn't entered)
// show unselected so a human makes the call. Random-table moves (Secret Power,
// Tri Attack...) ask for the die roll and pick the matching row; "chosen" ones
// (Spore Cloud) are a radio pick. A dice duration ("1d4 rounds") asks for the
// number rolled.
//
// Resolves to [{targetId, effect, ends}] (ends = the effect's ends with any rolled
// duration filled in as `n`), or null if cancelled. Only builds the payload --
// combat-wip.js does the apply-status calls.
import { statusLabel, describeEnds, groupEffects } from './move-effects.js';
import { POKEMON_TYPES } from './pokemon-types.js';

function _injectStyles() {
  if (document.getElementById('effects-popup-styles')) return;
  const style = document.createElement('style');
  style.id = 'effects-popup-styles';
  style.textContent = `
    .combat-popup-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.75); z-index: 1100; justify-content: center; align-items: center; backdrop-filter: blur(3px); }
    .combat-popup-content { background: #1e1e34; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; max-width: 560px; width: 92%; max-height: 85vh; overflow-y: auto; position: relative; box-shadow: 0 10px 40px rgba(0,0,0,0.6); color: #e0e0e0; }
    .combat-move-popup-header { padding: 1.1rem 1.2rem; border-radius: 16px 16px 0 0; border-bottom: 2px solid rgba(0,0,0,0.3); display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; position: relative; background: rgba(255,255,255,0.05); }
    .combat-move-popup-header h2 { margin: 0; font-size: 1.3rem; font-weight: 900; text-transform: uppercase; }
    .combat-popup-close { position: absolute; top: 0.8rem; right: 0.8rem; background: rgba(0,0,0,0.3); border: none; border-radius: 50%; width: 32px; height: 32px; font-size: 1.2rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; color: inherit; }
    .combat-move-popup-body { padding: 1rem 1.2rem; }
    .combat-use-move-btn { width: 100%; padding: 0.75rem; background: linear-gradient(135deg, #4CAF50, #45A049); color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 700; cursor: pointer; }
    .effects-popup-section { margin-bottom: 1rem; }
    .effects-popup-target { font-weight: 800; color: #FFD700; margin-bottom: 0.4rem; }
    .effects-popup-row, .effects-popup-group { background: rgba(255,255,255,0.05); border-radius: 8px; padding: 0.5rem 0.6rem; margin-bottom: 0.4rem; }
    .effects-popup-row label, .effects-popup-option { display: flex; gap: 0.6rem; align-items: flex-start; cursor: pointer; }
    .effects-popup-name { font-weight: 700; }
    .effects-popup-sub { font-size: 0.78rem; color: #a0a0c0; }
    .effects-popup-manual { font-size: 0.72rem; color: #f0b429; }
    .effects-popup-inline { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.4rem; font-size: 0.85rem; }
    .effects-popup-inline input[type=number] { width: 5rem; background: #1e1e2e; border: 1px solid rgba(255,255,255,0.2); color: #e0e0e0; border-radius: 6px; padding: 0.35rem 0.5rem; }
    .effects-popup-inline select { background: #1e1e2e; border: 1px solid rgba(255,255,255,0.2); color: #e0e0e0; border-radius: 6px; padding: 0.35rem 0.5rem; font-size: 0.85rem; }
    .effects-popup-actions { display: flex; gap: 0.6rem; margin-top: 0.8rem; }
    .effects-popup-actions .combat-use-move-btn { flex: 1; }
    .effects-popup-skip { background: rgba(255,255,255,0.1) !important; }
  `;
  document.head.appendChild(style);
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The dice-duration entry of an effect's ends, if any (needs a rolled number). */
function _diceEnd(effect) {
  return (effect.ends || []).find(e => e.type === 'rounds' && e.dice && !e.n);
}

function _diceInput(effect, id) {
  const d = _diceEnd(effect);
  if (!d) return '';
  return `<div class="effects-popup-inline">Rolled ${esc(d.dice)} ${d.unit ? esc(d.unit) + 's' : 'rounds'}:
    <input type="number" min="1" data-dice-for="${id}"></div>`;
}

/** True for a condition with no type baked into the move data -- type_changed
 * (Camouflage/Conversion/Reflect Type: the actual type depends on the terrain, the
 * mover's known moves, or a creature in range) or resistance_upgrade (Elemental
 * Surge: "roll a d20" with no table given for what each result means) -- none of
 * which this app can decide on its own. */
function _needsTypeChoice(effect) {
  return effect.kind === 'condition' && !effect.value
    && (effect.apply === 'type_changed' || effect.apply === 'resistance_upgrade');
}

/** A type dropdown for a type-choice effect, plus a second ("single type") ONLY for
 * type_changed -- the one case that can plausibly need two (Reflect Type copying a
 * dual-type creature); resistance_upgrade only ever grants against one type here. */
function _typeChoiceInput(effect, id) {
  if (!_needsTypeChoice(effect)) return '';
  const opts = POKEMON_TYPES.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  const second = effect.apply === 'type_changed'
    ? `<select data-type2-for="${id}"><option value="">(single type)</option>${opts}</select>` : '';
  return `<div class="effects-popup-inline">Type:
    <select data-type-for="${id}">${opts}</select>${second}
  </div>`;
}

function _optionHtml(entry, id, inputType, name, checked) {
  const e = entry.effect;
  const manual = entry.verdict === 'manual' ? '<div class="effects-popup-manual">Needs your call — the move text isn\'t decided by the rolls</div>' : '';
  const roll = e.choice?.roll != null ? `<span class="effects-popup-sub"> (rolled ${e.choice.roll})</span>` : '';
  return `
    <label class="effects-popup-option">
      <input type="${inputType}" name="${name}" data-eid="${id}" ${checked ? 'checked' : ''}>
      <span>
        <span class="effects-popup-name">${esc(statusLabel(e))}</span>${roll}
        <div class="effects-popup-sub">${esc(describeEnds(e.ends))}${e.note ? ' · ' + esc(e.note) : ''}</div>
        ${manual}
      </span>
    </label>`;
}

/**
 * sections: [{ targetId, targetName, entries: [{effect, verdict: 'yes'|'manual'}] }]
 * Each entry keeps a stable id ("s<section>e<entry>") so confirm can map DOM back to data.
 */
export function showEffectsPopup({ title, sections }) {
  _injectStyles();
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'combat-popup-overlay';
    overlay.style.display = 'flex';
    const byId = new Map();
    let gCount = 0;

    const sectionHtml = sections.map((sec, si) => {
      const rows = groupEffects(sec.entries).map((item, ii) => {
        const idOf = (entry) => {
          const id = `s${si}e${sec.entries.indexOf(entry)}`;
          byId.set(id, { targetId: sec.targetId, effect: entry.effect });
          return id;
        };
        if (item.type === 'row') {
          const id = idOf(item.entry);
          return `<div class="effects-popup-row">${_optionHtml(item.entry, id, 'checkbox', id, item.entry.verdict === 'yes')}${_diceInput(item.entry.effect, id)}${_typeChoiceInput(item.entry.effect, id)}</div>`;
        }
        const gname = `g${gCount++}`;
        const rollInput = item.type === 'random'
          ? `<div class="effects-popup-inline">Rolled ${esc(item.die)}: <input type="number" min="1" data-group-roll="${gname}"></div>`
          : '<div class="effects-popup-sub">Choose one</div>';
        const opts = item.entries.map(en => {
          const id = idOf(en);
          return _optionHtml(en, id, 'radio', gname, false) + _diceInput(en.effect, id) + _typeChoiceInput(en.effect, id);
        }).join('');
        return `<div class="effects-popup-group" data-group="${gname}" data-kind="${item.type}">${rollInput}${opts}</div>`;
      }).join('');
      return `<div class="effects-popup-section"><div class="effects-popup-target">${esc(sec.targetName)}</div>${rows}</div>`;
    }).join('');

    overlay.innerHTML = `
      <div class="combat-popup-content" style="max-width:460px;">
        <div class="combat-move-popup-header">
          <button class="combat-popup-close" data-act="close">×</button>
          <h2>${esc(title)}</h2>
        </div>
        <div class="combat-move-popup-body">
          ${sectionHtml}
          <div class="effects-popup-actions">
            <button class="combat-use-move-btn effects-popup-skip" data-act="skip">Apply none</button>
            <button class="combat-use-move-btn" data-act="apply">Apply selected</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const finish = (result) => { overlay.remove(); resolve(result); };

    // A rolled die on a random-table group selects the matching row.
    overlay.querySelectorAll('[data-group-roll]').forEach(input => {
      input.addEventListener('input', () => {
        const roll = parseInt(input.value, 10);
        const group = overlay.querySelector(`[data-group="${input.dataset.groupRoll}"]`);
        group.querySelectorAll('input[type=radio]').forEach(r => {
          r.checked = byId.get(r.dataset.eid)?.effect.choice?.roll === roll;
        });
      });
    });

    overlay.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (e.target === overlay || act === 'close') return finish(null);
      if (act === 'skip') return finish([]);
      if (act !== 'apply') return;
      const picks = [];
      overlay.querySelectorAll('input[data-eid]').forEach(input => {
        if (!input.checked) return;
        const { targetId, effect: original } = byId.get(input.dataset.eid);
        let effect = original;
        let ends = effect.ends;
        const dice = _diceEnd(effect);
        if (dice) {
          const n = parseInt(overlay.querySelector(`[data-dice-for="${input.dataset.eid}"]`)?.value, 10);
          // The server counts rounds: 1 minute = 10 rounds, 1 hour = 600.
          const perUnit = { minute: 10, hour: 600 }[dice.unit] || 1;
          if (n > 0) ends = effect.ends.map(x => (x === dice ? { type: 'rounds', n: n * perUnit } : x));
        }
        if (_needsTypeChoice(effect)) {
          const value = overlay.querySelector(`[data-type-for="${input.dataset.eid}"]`)?.value;
          const value2 = overlay.querySelector(`[data-type2-for="${input.dataset.eid}"]`)?.value;
          effect = { ...effect, value, ...(value2 ? { value2 } : {}) };
        }
        picks.push({ targetId, effect, ends });
      });
      finish(picks);
    });
  });
}
