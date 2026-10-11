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
