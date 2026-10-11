// Small helpers shared by the DM console's modules (see dm-console.js).
import { DmAPI } from '../api.js';
import { getMoveTypeColor } from '../utils/pokemon-types.js';
import { buildPokemonCombatant } from '../pages/combat.js';
import { dmEnemyParticipant } from '../pages/combat-wip.js';

export const DM = 'DM'; // routes_combat.py's DM_OWNER -- the owner of everything the DM controls

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
