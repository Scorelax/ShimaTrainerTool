// Small helpers shared by the DM console's modules (see dm-console.js).
import { DmAPI } from '../api.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { getMoveTypeColor } from '../utils/pokemon-types.js';
import { buildPokemonCombatant } from '../pages/combat.js';
import { dmEnemyParticipant } from '../pages/combat-wip.js';

export const DM = 'DM'; // routes_combat.py's DM_OWNER -- the owner of everything the DM controls

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** The <option>s of a portrait picker (map-assets' portraits): the NPC pictures, then the players' own portraits, each
 * group labelled (a group with nothing in it is left out). */
export function portraitOptionsHtml(portraits, selected) {
  const opts = list => list.map(p => `<option value="${escapeHtml(p.url)}" ${p.url === selected ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
  const npcs = portraits.filter(p => !p.own);
  const own = portraits.filter(p => p.own);
  return (npcs.length ? `<optgroup label="NPCs">${opts(npcs)}</optgroup>` : '')
    + (own.length ? `<optgroup label="Player trainers">${opts(own)}</optgroup>` : '');
}

export function typeBadges(t1, t2) {
  return [t1, t2].filter(Boolean).map(t => `<span class="dm-type" style="background:${getMoveTypeColor(t)}">${escapeHtml(t)}</span>`).join('');
}

/** "Hasty (+2 DEX, −2 CON)" -- a nature with the stats it changes (the natures game data: boostStat/nerfStat are full
 * stat names). */
export function natureLabel(n) {
  const abbr = s => String(s || '').slice(0, 3).toUpperCase();
  const parts = [n.boostStat && `+${n.boostAmount} ${abbr(n.boostStat)}`, n.nerfStat && `−${n.nerfAmount} ${abbr(n.nerfStat)}`].filter(Boolean);
  return parts.length ? `${n.name} (${parts.join(', ')})` : n.name;
}

export function natureOptions(selected) {
  const natures = JSON.parse(sessionStorage.getItem('natures') || '[]');
  return natures.map(n => `<option value="${escapeHtml(n.name)}" ${n.name === selected ? 'selected' : ''}>${escapeHtml(natureLabel(n))}</option>`).join('');
}

// The same words the trainer and Pokemon records use (comma-separated full names), so the battle card reads them as-is.
export const SAVING_THROWS = ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'];
export const SKILLS = ['Acrobatics', 'Animal Handling', 'Arcana', 'Athletics', 'Deception', 'History', 'Insight', 'Intimidation',
  'Investigation', 'Medicine', 'Nature', 'Perception', 'Performance', 'Persuasion', 'Religion', 'Sleight of Hand', 'Stealth', 'Survival'];

/** Splits a "Athletics, stealth" style list into names, matched to `known` spellings where possible. */
export function splitList(text, known = []) {
  return String(text || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(s => known.find(k => k.toLowerCase() === s.toLowerCase()) || s);
}

/** A dropdown with a checkbox per option, for picking several (saving throws, skills). `locked` options show ticked
 * and can't be changed (a Pokemon's own species skills). Wire with bindMultiSelects, read with readMultiSelect. */
/**
 * A search-as-you-type list under a text input -- the DM console's own instead of the browser's <datalist>, which Chrome
 * draws beside the field. It opens in place under the input (like the multi-select's list), filtered by what's typed;
 * `options()` gives [{value, label, sub, image}] (image: a species picture, shown small). Picking one fills the input and
 * fires its input/change events, so the form's own listeners run as if it had been typed. `after`: the element the list
 * opens under, when the input shares a row with other fields.
 */
export function attachSuggest(input, options, { max = 40, imageFallback = '', after = null } = {}) {
  const pop = document.createElement('div');
  pop.className = 'dm-suggest-pop';
  pop.hidden = true;
  (after || input).insertAdjacentElement('afterend', pop); // `after`: a whole row the list opens under (input + buttons)
  input.setAttribute('autocomplete', 'off');
  let shown = [];
  let active = -1;
  const close = () => { pop.hidden = true; active = -1; };
  const highlight = () => pop.querySelectorAll('.dm-suggest-opt').forEach((el, i) => el.classList.toggle('active', i === active));
  const render = () => {
    const q = input.value.trim().toLowerCase();
    const all = options();
    // Starts-with first, then contains -- typing "pi" puts Pidgey before Spinarak.
    const starts = all.filter(o => o.label.toLowerCase().startsWith(q));
    const rest = q ? all.filter(o => !o.label.toLowerCase().startsWith(q) && `${o.label} ${o.sub || ''}`.toLowerCase().includes(q)) : [];
    shown = [...starts, ...rest].slice(0, max);
    if (!shown.length || (shown.length === 1 && shown[0].value.toLowerCase() === q)) { close(); return; }
    pop.innerHTML = shown.map((o, i) => `
      <button type="button" class="dm-suggest-opt" data-i="${i}" tabindex="-1">
        ${o.image !== undefined ? `<span class="dm-suggest-thumb" data-img="${escapeHtml(o.image || '')}"></span>` : ''}
        <span class="dm-suggest-label">${escapeHtml(o.label)}</span>${o.sub ? `<small>${escapeHtml(o.sub)}</small>` : ''}
      </button>`).join('');
    pop.querySelectorAll('[data-img]').forEach((el) => {
      if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, '', { small: true });
      else if (imageFallback) el.innerHTML = `<img src="${imageFallback}" alt="" style="opacity:0.35">`;
    });
    active = -1;
    pop.hidden = false;
  };
  const pick = (i) => {
    const o = shown[i];
    if (!o) return;
    input.value = o.value;
    close();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  input.addEventListener('input', (e) => { if (e.isTrusted) render(); });
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', (e) => {
    if (pop.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(shown.length - 1, active + 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); highlight(); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(active); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
  pop.addEventListener('mousedown', (e) => e.preventDefault()); // keep the focus in the input while picking
  pop.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) pick(Number(b.dataset.i)); });
  return { close };
}

export function multiSelectHtml(id, options, selected = [], { locked = [], placeholder = 'None' } = {}) {
  const sel = new Set(selected.map(s => s.toLowerCase()));
  const lock = new Set(locked.map(s => s.toLowerCase()));
  return `
    <div class="dm-multi" id="${id}" data-placeholder="${escapeHtml(placeholder)}">
      <button type="button" class="dm-multi-btn"><span class="dm-multi-text"></span><span class="dm-multi-caret">▾</span></button>
      <div class="dm-multi-pop" hidden>
        ${options.map(o => `
          <label class="dm-multi-opt${lock.has(o.toLowerCase()) ? ' locked' : ''}">
            <input type="checkbox" value="${escapeHtml(o)}" ${sel.has(o.toLowerCase()) || lock.has(o.toLowerCase()) ? 'checked' : ''} ${lock.has(o.toLowerCase()) ? 'disabled' : ''}>
            <span>${escapeHtml(o)}${lock.has(o.toLowerCase()) ? ' <small>(species)</small>' : ''}</span>
          </label>`).join('')}
      </div>
    </div>`;
}

function _syncMultiText(el) {
  const picked = [...el.querySelectorAll('input:checked')].map(i => i.value);
  el.querySelector('.dm-multi-text').textContent = picked.length ? picked.join(', ') : el.dataset.placeholder;
  el.classList.toggle('empty', !picked.length);
}

export function bindMultiSelects(root) {
  root.querySelectorAll('.dm-multi').forEach(el => {
    _syncMultiText(el);
    const pop = el.querySelector('.dm-multi-pop');
    el.querySelector('.dm-multi-btn').addEventListener('click', () => {
      document.querySelectorAll('.dm-multi-pop').forEach(p => { if (p !== pop) p.hidden = true; });
      pop.hidden = !pop.hidden;
    });
    pop.addEventListener('change', () => _syncMultiText(el));
  });
  if (!bindMultiSelects.outsideBound) {
    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.dm-multi')) document.querySelectorAll('.dm-multi-pop').forEach(p => { p.hidden = true; });
    });
    bindMultiSelects.outsideBound = true;
  }
}

/** The ticked options of a multi-select, without the locked ones. */
export function readMultiSelect(id) {
  return [...document.querySelectorAll(`#${id} input:checked:not(:disabled)`)].map(i => i.value);
}

export function rollD20() {
  return Math.floor(Math.random() * 20) + 1;
}

export function newId(prefix = 'dm') {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

export function toast(text) {
  let box = document.getElementById('dmToast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'dmToast';
    box.className = 'dm-toast';
    document.body.appendChild(box);
  }
  box.textContent = text;
  box.style.opacity = '1';
  clearTimeout(box._timer);
  box._timer = setTimeout(() => { box.style.opacity = '0'; }, 4000);
}

/** A popup over the console: `title`, the body's HTML, and `buttons` ([{label, value, kind: 'primary'|'danger'|''}]).
 * Resolves to the clicked button's value (null when closed with × or Escape); `onOpen(body)` wires the body first.
 * A button with `keepOpen` calls `onClick(body)` instead of closing -- return true from it to close after all. */
export function openDmModal({ title, html, buttons = [{ label: 'Close', value: null }], wide = false, onOpen = null }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dm-modal-overlay';
    overlay.innerHTML = `
      <div class="dm-modal${wide ? ' wide' : ''}" role="dialog">
        <div class="dm-modal-head"><h3>${escapeHtml(title)}</h3><button class="dm-icon-btn" data-close title="Close">✕</button></div>
        <div class="dm-modal-body">${html}</div>
        <div class="dm-modal-foot">${buttons.map((b, i) => `<button class="dm-btn ${b.kind || ''}" data-btn="${i}">${escapeHtml(b.label)}</button>`).join('')}</div>
      </div>`;
    document.body.appendChild(overlay);
    const body = overlay.querySelector('.dm-modal-body');
    const close = (value) => { document.removeEventListener('keydown', onKey); overlay.remove(); resolve(value); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('[data-close]').addEventListener('click', () => close(null));
    overlay.querySelector('.dm-modal-foot').addEventListener('click', async (e) => {
      const b = buttons[e.target.closest('[data-btn]')?.dataset.btn];
      if (!b) return;
      if (b.keepOpen) { if (await b.onClick?.(body)) close(b.value); return; }
      close(b.value);
    });
    onOpen?.(body, close);
  });
}

let _species = null;
let _speciesLoading = null;

/** Every species (DmAPI.speciesList), fetched once per page. */
export function getSpecies() {
  if (_species) return Promise.resolve(_species);
  if (!_speciesLoading) {
    _speciesLoading = DmAPI.speciesList().then(r => { _species = r.data || []; return _species; })
      .finally(() => { _speciesLoading = null; });
  }
  return _speciesLoading;
}

/** A Pokemon row from DmAPI.buildPokemon as an enemy participant the DM owns -- built with the very same function a
 * player's own Pokemon is (combat.js's buildPokemonCombatant reads the row from sessionStorage), then the key is
 * removed again so nothing of the DM's lingers there. Returns { combatant, participant }. */
export function participantFromPokemonRow(row) {
  const key = 'pokemon__dm_build';
  sessionStorage.setItem(key, JSON.stringify(row));
  let combatant;
  try { combatant = buildPokemonCombatant(key); } finally { sessionStorage.removeItem(key); }
  return { combatant, participant: dmEnemyParticipant(combatant) };
}

export function abilityMod(score) {
  return Math.floor(((Number(score) || 10) - 10) / 2);
}

/** A trainer's HP at a level -- a d8 hit die: 8 + CON at 1st level, then 5 + CON per level. */
export function trainerHp(level, con) {
  const mod = abilityMod(con);
  return Math.max(1, 8 + mod + (Math.max(1, level) - 1) * (5 + mod));
}

export function proficiencyForLevel(level) {
  return 2 + Math.floor((Math.max(1, Number(level) || 1) - 1) / 4);
}

/** An NPC trainer the DM typed in, in combat.js's buildTrainerCombatant shape, as an enemy participant. */
export function participantFromTrainer(t) {
  const stats = Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(k => [k, Number(t[k]) || 10]));
  const mods = Object.fromEntries(Object.entries(stats).map(([k, v]) => [`${k}Mod`, abilityMod(v)]));
  const level = Math.max(1, Math.min(20, Number(t.level) || 1));
  const combatant = {
    type: 'trainer', name: t.name || 'Trainer', speciesName: '', image: t.image || 'assets/Pokeball.png',
    level, initiativeTotal: mods.dexMod,
    ac: Number(t.ac) || 10, baseAc: Number(t.ac) || 10, critMod: 0,
    maxHp: Number(t.maxHP) || 1, currentHp: Number(t.maxHP) || 1, maxVp: Number(t.maxVP) || 0, currentVp: Number(t.maxVP) || 0,
    proficiency: proficiencyForLevel(level),
    savingThrows: t.savingThrows || '', skills: t.skills || '',
    ...stats, ...mods,
    moves: [], types: [], size: '', speeds: [{ type: 'Walking', ft: Number(t.speed) || 30 }],
  };
  return { combatant, participant: dmEnemyParticipant(combatant) };
}
