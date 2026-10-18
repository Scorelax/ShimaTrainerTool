// Everything the encyclopedia knows about a species, for the DM -- its behaviour, habitat, rarity, when it's active, its
// senses, numbers, abilities, evolution and moves -- plus how hard it is to catch (the capture rules from
// encounter-rules.js, worked out for the species). Opened from the Encounters module (flavour for an encounter, or how a
// Pokemon might react) and the Adventure module's capture guide. DM-only: the players see their own Pokedex instead.
import { DmAPI } from '../api.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { showCombatAlert } from '../utils/combat-alert.js';
import { escapeHtml, typeBadges, openDmModal, abilityMod } from './dm-common.js';
import { captureDc, STATUS_CAPTURE_BONUS, WEATHER_ROLL_MOD, TERRAIN } from './encounter-rules.js';
import { WEATHER } from './world-clock.js';

const SLOT_NAMES = ['Primary', 'Secondary', 'Hidden'];
const sign = n => (n >= 0 ? `+${n}` : `${n}`);

export async function speciesDetail(name) {
  return (await DmAPI.speciesDetail(name)).data;
}

function rows(pairs) {
  return pairs.filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => `<div class="dm-sp-row"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`).join('');
}

/** How the capture works for this species, with the numbers that depend on it: the capture DC at full, half and a
 * quarter of its HP (the health part of the DC), and the throw's accuracy DC on each terrain. `terrainKey` / `weatherKey`
 * (optional) mark the current ones. */
export function captureRulesHtml(d, { terrainKey = null, weatherKey = null } = {}) {
  const base = { type1: d.type1, type2: d.type2, size: d.size, maxHP: 100 };
  const at = hp => captureDc({ ...base, currentHP: hp }, d);
  const full = at(100);
  const dexMod = abilityMod(d.stats?.dex ?? 10);
  const row = (label, value, cls = '') => `<div class="dm-cap-row ${cls}"><span>${label}</span><span>${value}</span></div>`;
  return `
    <div class="dm-cap-cols">
      <div>
        <div class="dm-card-title">1 · The throw</div>
        <div class="dm-hint">d20 + Animal Handling or Athletics, + the weather (below). Meet the accuracy DC to hit. A natural 20 adds +20 to the capture roll.</div>
        ${row('Base', 10)}${row(`DEX (${d.stats?.dex ?? 10})`, sign(dexMod))}
        ${row('Accuracy DC', `${10 + dexMod} + terrain`, 'total')}
        <div class="dm-sp-terrains">${Object.entries(TERRAIN).map(([k, t]) => `<span class="${k === terrainKey ? 'on' : ''}" title="${escapeHtml(t.name)}">${escapeHtml(t.name)} <b>${10 + dexMod + t.mod}</b></span>`).join('')}</div>
        <div class="dm-card-title" style="margin-top:0.6rem">Weather on the throw</div>
        <div class="dm-cap-bonus">${Object.entries(WEATHER_ROLL_MOD).map(([k, m]) => `<span class="${k === weatherKey ? 'on' : ''}">${escapeHtml(WEATHER[k]?.name || k)} ${sign(m)}</span>`).join('')}</div>
      </div>
      <div>
        <div class="dm-card-title">2 · The capture roll</div>
        <div class="dm-hint">d100 + the ball's bonus + the bonuses below; meet or beat the capture DC.</div>
        ${row('Base', 50)}${row(`Type (${escapeHtml([d.type1, d.type2].filter(Boolean).join('/'))})`, sign(full.types))}${row(`Size (${escapeHtml(d.size || '?')})`, sign(full.size))}
        ${row(`Rarity (${escapeHtml(d.rarity || '?')})`, sign(full.rarity))}${row(`Behaviour (${escapeHtml(d.behavior || '?')})`, sign(full.behavior))}
        ${row('Health: more than half its HP', '+20')}${row('Health: more than a quarter', '+10')}
        ${row('Capture DC at full HP', at(100).total, 'total')}
        ${row('… below half HP', at(50).total)}${row('… at a quarter or less', at(25).total)}
        ${d.catchDifficulty ? row('Catch difficulty (encyclopedia)', escapeHtml(d.catchDifficulty)) : ''}
        <div class="dm-hint" style="margin-top:0.4rem">Your call on top: in its lair +10 to +20; weather it likes +10, weather it hates −10.</div>
      </div>
    </div>
    <div class="dm-card-title" style="margin-top:0.8rem">Bonuses to the capture roll (its condition)</div>
    <div class="dm-cap-bonus">${Object.entries(STATUS_CAPTURE_BONUS).map(([n, b]) => `<span>${n} +${b}</span>`).join('')}</div>`;
}

/** Everything about the species, as one page. */
export function speciesInfoHtml(d) {
  const senses = Object.entries(d.senses || {}).filter(([, v]) => v && !/^(no|none|-|0)$/i.test(String(v).trim()));
  const movement = Object.entries(d.movement || {}).filter(([, v]) => v && !/^(-|0|none)?$/i.test(String(v).trim()));
  const moves = Object.entries(d.moves || {}).filter(([, list]) => list.length);
  return `
    <div class="dm-sp">
      <div class="dm-sp-head">
        <span class="dm-sp-img" data-img="${escapeHtml(d.image || '')}"></span>
        <div>
          <div class="dm-sp-name">#${escapeHtml(d.dex)} ${escapeHtml(d.name)}</div>
          <div class="dm-species-meta">${typeBadges(d.type1, d.type2)} ${escapeHtml(d.classification || '')}</div>
          ${d.description ? `<div class="dm-sp-desc">${escapeHtml(d.description)}</div>` : ''}
        </div>
      </div>
      <div class="dm-sp-grid">
        <div class="dm-sp-box"><div class="dm-card-title">Nature & territory</div>
          ${rows([['Behaviour', d.behavior], ['Habitat', d.habitat], ['Active', d.activity], ['Rarity', d.rarity], ['Size', d.size],
            ['Evolves from', d.evolvesFrom], ['Evolves into', (d.evolvesTo || []).join(', ')]])}</div>
        <div class="dm-sp-box"><div class="dm-card-title">Numbers</div>
          ${rows([['Base level', d.level], ['AC', d.ac], ['HP', d.hp], ['Hit die', d.hitDice ? `d${d.hitDice}` : ''], ['VP', d.vp],
            ['Vitality die', d.vitalityDice ? `d${d.vitalityDice}` : ''], ['Speed', d.speed],
            ...movement.map(([k, v]) => [k[0].toUpperCase() + k.slice(1), v]),
            ['Saving throws', d.savingThrows], ['Skills', d.skills]])}
          <div class="dm-sp-scores">${['str', 'dex', 'con', 'int', 'wis', 'cha'].map(k => `<span>${k.toUpperCase()} <b>${d.stats?.[k] ?? '?'}</b><small>${sign(abilityMod(d.stats?.[k] ?? 10))}</small></span>`).join('')}</div>
        </div>
        <div class="dm-sp-box"><div class="dm-card-title">Senses</div>
          ${senses.length ? rows(senses.map(([k, v]) => [k[0].toUpperCase() + k.slice(1), v])) : '<div class="dm-hint">Nothing out of the ordinary.</div>'}</div>
      </div>
      <div class="dm-sp-box"><div class="dm-card-title">Abilities</div>
        ${(d.abilities || []).map(a => `<div class="dm-sp-ability"><b>${escapeHtml(a.name)}</b> <small>${SLOT_NAMES[a.slot] || ''}</small><div>${escapeHtml(a.description || '')}</div></div>`).join('') || '<div class="dm-hint">None listed.</div>'}</div>
      ${moves.length ? `<div class="dm-sp-box"><div class="dm-card-title">Moves</div>
        ${moves.map(([lvl, list]) => `<div class="dm-sp-row"><span>${lvl === '1' ? 'Starting' : `Level ${lvl}`}</span><span>${list.map(escapeHtml).join(', ')}</span></div>`).join('')}</div>` : ''}
      <div class="dm-sp-box"><div class="dm-card-title">Catching it</div>${captureRulesHtml(d)}</div>
    </div>`;
}

/** Fills in the pictures in something speciesInfoHtml drew. */
export function paintSpeciesImages(root) {
  root.querySelectorAll('.dm-sp-img[data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); });
}

/** The species page in a window. */
export async function openSpeciesInfo(name) {
  let d;
  try {
    d = await speciesDetail(name);
  } catch (err) {
    showCombatAlert(err.message, { title: name });
    return;
  }
  await openDmModal({ title: `ℹ️ ${d.name}`, html: speciesInfoHtml(d), wide: true, onOpen: body => paintSpeciesImages(body) });
}
