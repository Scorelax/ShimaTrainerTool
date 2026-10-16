// Type Calculator -- pick one or two defending types and see which move types are super effective, neutral, not very
// effective or have no effect on that combination. The numbers come from the server's type chart (game-data
// type-effectiveness -- the same chart a Pokemon's damage calculator is built from), folded into this game's four
// outcomes the way the battle does (routes_combat.py's _clamp_type_multiplier): a double weakness is still x2, a double
// resistance still x1/2. Used by the shared battle card (player app and DM console alike).
import { GameDataAPI } from '../api.js';
import { getMoveTypeColor, getTextColorForBackground } from './pokemon-types.js';

// The chart's own order (type_chart_attack / type_chart_defend). Cosmic has no chart entries, so it isn't offered.
const TYPES = ['Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel', 'Fire', 'Water', 'Grass',
  'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark', 'Fairy'];

const GROUPS = [
  { key: 'super', label: 'Super effective', mult: '×2', test: (v) => v > 1 },
  { key: 'neutral', label: 'Neutral', mult: '×1', test: (v) => v === 1 },
  { key: 'resist', label: 'Not very effective', mult: '×½', test: (v) => v > 0 && v < 1 },
  { key: 'immune', label: 'No effect', mult: '×0', test: (v) => v <= 0 },
];

const CSS = `
  .tcalc-overlay { position: fixed; inset: 0; z-index: 2600; display: none; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.7); backdrop-filter: blur(3px); padding: 16px; box-sizing: border-box; }
  .tcalc-overlay.open { display: flex; }
  .tcalc-box { width: min(520px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; box-sizing: border-box;
    background: linear-gradient(160deg, #262640, #16162a); border: 1px solid rgba(140,170,255,0.35); border-radius: 18px;
    padding: 1rem 1.1rem 1.2rem; color: #e8ecff; box-shadow: 0 15px 40px rgba(0,0,0,0.8); font-family: inherit; }
  .tcalc-head { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; margin-bottom: 0.7rem; }
  .tcalc-title { font-size: 1.15rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.06em; color: #FFDE00; }
  .tcalc-close { background: linear-gradient(135deg,#EE1515,#C91010); color: #fff; border: 2px solid #333; border-radius: 50%;
    width: 36px; height: 36px; font-size: 1.2rem; font-weight: bold; cursor: pointer; flex-shrink: 0; line-height: 1; }
  .tcalc-hint { font-size: 0.78rem; color: #a9b0d6; margin: 0 0 0.45rem; text-align: center; }
  .tcalc-picked { display: flex; justify-content: center; align-items: center; gap: 0.4rem; min-height: 1.9rem; margin-bottom: 0.55rem; }
  .tcalc-picked-empty { color: #8a8fb0; font-size: 0.85rem; }
  .tcalc-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 0.3rem; margin-bottom: 0.9rem; }
  @media (max-width: 480px) { .tcalc-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  .tcalc-type { font-family: inherit; font-size: 0.74rem; font-weight: 800; padding: 0.38rem 0.2rem; border-radius: 10px; cursor: pointer;
    border: 2px solid rgba(255,255,255,0.14); opacity: 0.6; transition: opacity 0.12s, transform 0.08s, box-shadow 0.12s; }
  .tcalc-type:hover { opacity: 0.85; }
  .tcalc-type.on { opacity: 1; border-color: #fff; box-shadow: 0 0 8px rgba(255,255,255,0.5); }
  .tcalc-badge { display: inline-block; font-size: 0.78rem; font-weight: 800; padding: 0.22rem 0.65rem; border-radius: 999px; }
  .tcalc-groups { display: flex; flex-direction: column; gap: 0.55rem; }
  .tcalc-group { border-radius: 12px; padding: 0.5rem 0.6rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); }
  .tcalc-group-label { font-size: 0.74rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.35rem; }
  .tcalc-group--super { border-color: rgba(255,100,100,0.55); background: rgba(255,80,80,0.1); } .tcalc-group--super .tcalc-group-label { color: #ff8888; }
  .tcalc-group--neutral .tcalc-group-label { color: #ccc; }
  .tcalc-group--resist { border-color: rgba(100,150,255,0.5); background: rgba(100,150,255,0.09); } .tcalc-group--resist .tcalc-group-label { color: #88aaff; }
  .tcalc-group--immune { border-color: rgba(150,150,150,0.45); background: rgba(150,150,150,0.08); } .tcalc-group--immune .tcalc-group-label { color: #bbb; }
  .tcalc-group-types { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .tcalc-none { color: #8a8fb0; font-size: 0.8rem; }
  .tcalc-note { font-size: 0.72rem; color: #8a8fb0; margin-top: 0.7rem; text-align: center; }
`;

let _picked = [];
let _request = 0;

function _badge(type) {
  const bg = getMoveTypeColor(type);
  return `<span class="tcalc-badge" style="background:${bg};color:${getTextColorForBackground(bg)}">${type}</span>`;
}

function _ensureDom() {
  let overlay = document.getElementById('typeCalculatorPopup');
  if (overlay) return overlay;
  if (!document.getElementById('type-calculator-styles')) {
    const style = document.createElement('style');
    style.id = 'type-calculator-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  overlay = document.createElement('div');
  overlay.id = 'typeCalculatorPopup';
  overlay.className = 'tcalc-overlay';
  overlay.innerHTML = `
    <div class="tcalc-box" role="dialog" aria-label="Type Calculator">
      <div class="tcalc-head"><div class="tcalc-title">Type Calculator</div><button type="button" class="tcalc-close" aria-label="Close">×</button></div>
      <p class="tcalc-hint">Pick one or two types to defend with</p>
      <div class="tcalc-picked"></div>
      <div class="tcalc-grid">${TYPES.map((t) => {
        const bg = getMoveTypeColor(t);
        return `<button type="button" class="tcalc-type" data-type="${t}" style="background:${bg};color:${getTextColorForBackground(bg)}">${t}</button>`;
      }).join('')}</div>
      <div class="tcalc-groups"></div>
      <div class="tcalc-note">Moves of these types against that typing. A double weakness is still ×2 and a double resistance ×½, as in battle. Abilities aren't counted.</div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('.tcalc-close')) { overlay.classList.remove('open'); return; }
    const btn = e.target.closest('.tcalc-type');
    if (!btn) return;
    const t = btn.dataset.type;
    // Tap to add, tap again to take off; a third pick replaces the older of the two.
    _picked = _picked.includes(t) ? _picked.filter((x) => x !== t) : [..._picked, t].slice(-2);
    _render(overlay);
  });
  return overlay;
}

async function _render(overlay) {
  overlay.querySelectorAll('.tcalc-type').forEach((b) => b.classList.toggle('on', _picked.includes(b.dataset.type)));
  overlay.querySelector('.tcalc-picked').innerHTML = _picked.length
    ? _picked.map(_badge).join('<span style="color:#8a8fb0">/</span>')
    : '<span class="tcalc-picked-empty">No type picked</span>';
  const groupsEl = overlay.querySelector('.tcalc-groups');
  if (!_picked.length) { groupsEl.innerHTML = ''; return; }

  const request = ++_request;
  groupsEl.innerHTML = '<div class="tcalc-none" style="text-align:center">Working it out…</div>';
  let values;
  try {
    const res = await GameDataAPI.getTypeEffectiveness(_picked[0], _picked[1] || null);
    values = res?.data || res?.effectiveness;
  } catch {
    values = null;
  }
  if (request !== _request) return; // a newer pick is on its way
  if (!Array.isArray(values) || !values.length) {
    groupsEl.innerHTML = '<div class="tcalc-none" style="text-align:center">Couldn\'t load the type chart -- check the connection and try again.</div>';
    return;
  }
  groupsEl.innerHTML = GROUPS.map((g) => {
    const types = TYPES.filter((t, i) => g.test(Number.isFinite(Number(values[i])) ? Number(values[i]) : 1));
    return `<div class="tcalc-group tcalc-group--${g.key}">
        <div class="tcalc-group-label">${g.label} (${g.mult})</div>
        <div class="tcalc-group-types">${types.length ? types.map(_badge).join('') : '<span class="tcalc-none">None</span>'}</div>
      </div>`;
  }).join('');
}

/** Opens the Type Calculator, starting from `types` (a creature's own types, say) when given. */
export function showTypeCalculator(types = []) {
  const overlay = _ensureDom();
  const known = (types || []).map((t) => TYPES.find((x) => x.toLowerCase() === String(t || '').trim().toLowerCase())).filter(Boolean);
  _picked = [...new Set(known)].slice(0, 2);
  overlay.classList.add('open');
  _render(overlay);
}
