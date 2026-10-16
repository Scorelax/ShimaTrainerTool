// DM console -- Map setup's "Place on the map": where on the map (set up first, in map-editor.js) each NPC trainer and
// Pokemon of the next battle starts. Who's in it comes from Encounter setup (encounters.js puts the encounter in play
// here) or the NPC module; this screen doesn't add anyone. A Pokemon is built from the full encyclopedia at its level,
// nature and abilities (routes_dm.py's build-pokemon, the same maths a player's Pokemon gets) and the DM can still
// fine-tune it here -- override any of its numbers, give it extra skills; an NPC trainer's numbers likewise. Each is
// saved with a ready battle participant (setup-store.js), so Start battle only has to send them in.
//
// The map sits above the form: pick someone (from the list or by clicking their token) and click a square to stand
// them there.
import { DmAPI } from '../api.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { footprintForSize, footprintCells } from '../utils/battle-map-grid.js';
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import {
  escapeHtml, typeBadges, getSpecies, newId, participantFromPokemonRow, participantFromTrainer, trainerHp,
  natureOptions, SAVING_THROWS, SKILLS, splitList, multiSelectHtml, bindMultiSelects, readMultiSelect, portraitOptionsHtml, toast,
} from './dm-common.js';
import { getSetup, updateSetup, flushSetup, onSetupChange } from './setup-store.js';
import { mapStageHtml, tokenScreenRect, creatureSpotProblem } from './map-view.js';

const STATS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SLOT_NAMES = ['Primary', 'Secondary', 'Hidden'];
// Which encounter (and which of its entries) a creature came from, and which NPC -- kept when the DM fine-tunes it here.
const ORIGIN_KEYS = ['encId', 'encKey', 'encSig', 'npcId'];
const originOf = c => Object.fromEntries(ORIGIN_KEYS.filter(k => c?.[k] !== undefined).map(k => [k, c[k]]));

let _root = null;
let _onDone = null;
let _species = [];
let _portraits = [];
let _editing = null; // null | {mode: 'pokemon', id} | {mode: 'trainer', id}
let _busy = false;
let _hover = null;
let _unsub = null;
let _previewTimer = null;
let _previewSeq = 0;

export async function renderCreatureSetup(root, { onDone }) {
  _root = root;
  _onDone = onDone;
  root.innerHTML = `
    <div class="dm-editor">
      <aside class="dm-editor-tools">
        <div class="dm-editor-head">
          <button class="dm-btn small" id="csBack">← Map setup</button>
          <h2>Place everyone</h2>
        </div>
        <button class="dm-btn wide" id="csToEnc" title="Who's in the battle is chosen in Encounter setup"><img class="dm-tab-icon" src="assets/VS.png" alt="">Change who's in it</button>
        <div id="csList" class="dm-cs-list"></div>
      </aside>
      <section class="dm-editor-canvas dm-cs-work">
        <div class="dm-cs-mapbox">
          <div class="dm-editor-hint" id="csMapHint"></div>
          <div class="dm-map-wrap" id="csMap"></div>
        </div>
        <div class="dm-cs-editor" id="csEditor"></div>
      </section>
    </div>`;
  document.getElementById('csBack').addEventListener('click', leave);
  document.getElementById('csToEnc').addEventListener('click', async () => {
    await leave();
    window.dispatchEvent(new CustomEvent('dm:battle-tab', { detail: { tab: 'library' } }));
  });
  document.getElementById('csList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-creature]');
    if (!row) return;
    const c = getSetup().creatures.find(x => x.id === row.dataset.creature);
    if (c) edit({ mode: c.kind, id: c.id });
  });
  _unsub?.();
  _unsub = onSetupChange(() => { if (document.body.contains(_root)) { renderList(); renderMap(); } });
  renderList();
  renderMap();
  edit(_editing && getSetup().creatures.some(c => c.id === _editing.id) ? _editing : null);
  [_species] = await Promise.all([
    getSpecies().catch(() => []),
    DmAPI.mapAssets().then(r => { _portraits = r.data?.portraits || []; }).catch(() => {}),
  ]);
  // The open form needed these (a Pokemon's abilities and base stats, the portrait list) -- draw it again now.
  if (!document.body.contains(root) || !_editing) return;
  edit(_editing);
}

async function leave() {
  _unsub?.();
  _unsub = null;
  try { await flushSetup(); } catch (err) { showCombatAlert(err.message, { title: "Couldn't save the battle" }); }
  _onDone?.();
}

function selectedCreature() {
  return _editing?.id ? getSetup().creatures.find(x => x.id === _editing.id) : null;
}

// ---------------------------------------------------------------------------
// The list on the left: each NPC trainer with their Pokemon under them, then the wild ones.
// ---------------------------------------------------------------------------

function renderList() {
  const el = document.getElementById('csList');
  if (!el) return;
  const all = getSetup().creatures;
  const trainers = all.filter(c => c.kind === 'trainer');
  const wild = all.filter(c => c.kind === 'pokemon' && !trainers.some(t => t.id === c.trainerId));
  const row = (c, nested = false) => {
    const p = c.participant || {};
    const where = c.heldBack ? '🙈 hidden' : c.position ? '📍 placed' : '⚠ not placed';
    return `
      <button class="dm-cs-row${nested ? ' nested' : ''}${_editing?.id === c.id ? ' selected' : ''}" data-creature="${c.id}">
        <span class="dm-cs-thumb" data-img="${escapeHtml(p.image || '')}"></span>
        <span class="dm-cs-main">
          <span class="dm-cs-name">${escapeHtml(c.name)}</span>
          <span class="dm-cs-sub">Lv ${p.level ?? '?'} · HP ${p.maxHP ?? '?'} · <span class="${!c.heldBack && !c.position ? 'dm-warn-text' : ''}">${where}</span></span>
        </span>
      </button>`;
  };
  if (!all.length) {
    el.innerHTML = '<div class="dm-hint">Nobody yet -- put an encounter in play under Encounter setup.</div>';
    return;
  }
  el.innerHTML = [
    ...trainers.map(t => `<div class="dm-cs-group">${row(t)}${all.filter(c => c.kind === 'pokemon' && c.trainerId === t.id).map(c => row(c, true)).join('')}</div>`),
    wild.length ? `<div class="dm-cs-group"><div class="dm-cs-group-title">Wild Pokémon</div>${wild.map(c => row(c)).join('')}</div>` : '',
  ].join('');
  el.querySelectorAll('[data-img]').forEach(x => { if (x.dataset.img) patchPortraitMedia(x, x.dataset.img, ''); else x.innerHTML = '<span style="font-size:1.5rem">👤</span>'; });
}

// ---------------------------------------------------------------------------
// The map: click a square to stand the selected creature there; click someone's token to pick them.
// ---------------------------------------------------------------------------

function renderMap() {
  const wrap = document.getElementById('csMap');
  if (!wrap) return;
  const s = getSetup();
  const m = s.map;
  const sel = selectedCreature();
  wrap.innerHTML = mapStageHtml(s, { interactive: true, selectedId: sel?.id });
  const stage = wrap.querySelector('.dm-map-stage');
  stage.style.width = `min(100%, calc(34vh * ${m.rows / m.cols}))`;
  stage.querySelectorAll('[data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); else el.innerHTML = '<span class="dm-token-emoji">👤</span>'; });

  const hint = document.getElementById('csMapHint');
  if (hint) {
    hint.textContent = !sel
      ? 'Pick someone on the left (or click a token) to place them on the map.'
      : sel.heldBack ? `${sel.name} is hidden -- it joins later (only you see it until then) and doesn't start on the map.`
        : `Click a square to place ${sel.name}${sel.position ? ' somewhere else' : ''}.`;
  }

  const grid = stage.querySelector('.dm-map-grid');
  grid.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-cell]');
    if (cell) onMapClick(...cell.dataset.cell.split(',').map(Number));
  });
  grid.addEventListener('mouseover', (e) => {
    const cell = e.target.closest('[data-cell]');
    if (!cell) return;
    const [col, row] = cell.dataset.cell.split(',').map(Number);
    _hover = { col, row };
    renderGhost();
  });
  grid.addEventListener('mouseleave', () => { _hover = null; renderGhost(); });
  renderGhost();
}

function creatureAt(col, row) {
  return getSetup().creatures.find(c => c.position && !c.heldBack
    && footprintCells(c.position.col, c.position.row, footprintForSize(c.participant?.size)).some(p => p.col === col && p.row === row));
}

function renderGhost() {
  const ghost = document.querySelector('#csMap .dm-map-ghost');
  if (!ghost) return;
  const sel = selectedCreature();
  if (!_hover || !sel || sel.heldBack || creatureAt(_hover.col, _hover.row)) { ghost.innerHTML = ''; return; }
  const s = getSetup();
  const r = tokenScreenRect(s.map, _hover.col, _hover.row, footprintForSize(sel.participant?.size));
  ghost.innerHTML = `<div class="${creatureSpotProblem(s, sel, _hover.col, _hover.row) ? 'dm-ghost-bad' : 'dm-ghost-good'}" style="left:${r.left};top:${r.top};width:${r.width};height:${r.height}"></div>`;
}

function onMapClick(col, row) {
  const other = creatureAt(col, row);
  const sel = selectedCreature();
  if (other && other.id !== sel?.id) { edit({ mode: other.kind, id: other.id }); return; }
  if (!sel || sel.heldBack || other) return;
  const problem = creatureSpotProblem(getSetup(), sel, col, row);
  if (problem) { showCombatAlert(problem, { title: sel.name }); return; }
  updateSetup(s => { s.creatures.find(x => x.id === sel.id).position = { col, row, facing: 0 }; });
  renderPlacementLine();
}

const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gigantic'];
const SQUARES = { Large: '2×2', Huge: '3×3', Gigantic: '4×4' };

/** The form's own line about where the selected creature starts -- and, for a Pokemon, its size on the map: its
 * species' own by default (Large 2x2, Huge 3x3, Gigantic 4x4), or the DM's override (config.size, kept on rebuilds). */
function renderPlacementLine() {
  const el = document.getElementById('csPlacement');
  const c = selectedCreature();
  if (!el || !c) return;
  const own = c.naturalSize ?? c.participant?.size ?? '';
  const sizeRow = c.kind === 'pokemon' ? `
    <div class="dm-field" style="margin-top:0.4rem"><label for="csSize">Size on the map</label>
      <select class="dm-select" id="csSize">
        <option value="" ${!c.config?.size ? 'selected' : ''}>Its own${own ? ` -- ${escapeHtml(own)}${SQUARES[own] ? ` (${SQUARES[own]})` : ''}` : ''}</option>
        ${SIZES.map(z => `<option value="${z}" ${c.config?.size === z ? 'selected' : ''}>${z} (${SQUARES[z] || '1 square'})</option>`).join('')}
      </select></div>` : '';
  el.innerHTML = (c.heldBack ? '<span class="dm-hint">Hidden -- not on the map at the start.</span>'
    : c.position ? `<span>📍 On the map.</span> <button type="button" class="dm-btn small" id="csUnplace">Take off the map</button>`
      : '<span class="dm-warn-text">⚠ Not on the map yet -- click a square on the map above.</span>') + sizeRow;
  document.getElementById('csUnplace')?.addEventListener('click', () => {
    updateSetup(s => { s.creatures.find(x => x.id === c.id).position = null; });
    renderPlacementLine();
  });
  document.getElementById('csSize')?.addEventListener('change', (e) => {
    const size = e.target.value;
    let lifted = false;
    updateSetup(s => {
      const x = s.creatures.find(y => y.id === c.id);
      x.naturalSize = x.naturalSize ?? x.participant.size ?? '';
      x.config = { ...x.config, size };
      x.participant = { ...x.participant, size: size || x.naturalSize };
      // Bigger now and no longer fits where it stood: off the map until it's placed again.
      if (x.position && creatureSpotProblem(s, x, x.position.col, x.position.row)) { x.position = null; lifted = true; }
    });
    if (lifted) toast(`${c.name} doesn't fit where it stood at that size -- place it again.`);
    renderMap();
    renderPlacementLine();
  });
}

function edit(target) {
  _editing = target;
  renderList();
  renderMap();
  const box = document.getElementById('csEditor');
  if (!box) return;
  if (!target) {
    box.innerHTML = '<div class="dm-cs-empty">Pick someone on the left to place them, or to fine-tune them for this battle.</div>';
    return;
  }
  if (target.mode === 'pokemon') return renderPokemonForm(box);
  return renderTrainerForm(box);
}

// ---------------------------------------------------------------------------
// Pokemon
// ---------------------------------------------------------------------------

function trainerOptions(selected) {
  const trainers = getSetup().creatures.filter(c => c.kind === 'trainer');
  return `<option value="">Wild (no trainer)</option>${trainers.map(t => `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}>${escapeHtml(t.name)}'s Pokémon</option>`).join('')}`;
}

function speciesSkills(s) {
  return splitList(s?.base?.skills, SKILLS);
}

/** The encyclopedia's own numbers for a species -- before level, nature or anything the DM changes. */
function baseStatsHtml(s) {
  const b = s?.base;
  if (!b) return '';
  const cell = (label, v) => `<div class="dm-base-cell"><span>${label}</span><strong>${escapeHtml(v ?? '-')}</strong></div>`;
  return `
    <div class="dm-field"><label>Base stats <small class="dm-label-note">from the Pokédex, at base level ${s.level}</small></label>
      <div class="dm-base-grid">
        ${STATS.map(k => cell(k.toUpperCase(), b[k])).join('')}
        ${cell('AC', b.ac)}${cell('Hit die', b.hitDice ? `d${b.hitDice}` : '-')}${cell('Vitality die', b.vitalityDice ? `d${b.vitalityDice}` : '-')}
      </div>
      <div class="dm-base-line">Speed: ${escapeHtml(b.speed || '-')} · Saves: ${escapeHtml(b.savingThrows || '-')} · Skills: ${escapeHtml(b.skills || '-')}</div>
    </div>`;
}

function renderPokemonForm(box) {
  const c = selectedCreature();
  const speciesName = c.config.species;
  const s = _species.find(x => x.name === speciesName) || { name: speciesName, abilities: [], level: c?.config.level || 1 };
  const cfg = c?.config || { species: s.name, level: s.level || 1, nature: '', abilities: [0], item: '', shiny: false, stats: {}, overrides: {}, extraSkills: [] };
  const p = c?.participant || {};
  const statInput = (key, label, override) => `
    <div class="dm-stat"><label>${label}</label>
      <input class="dm-input" data-stat="${key}" type="number" value="${override ?? ''}" placeholder="…"></div>`;
  const ownSkills = speciesSkills(s);
  const skillOptions = [...SKILLS, ...ownSkills.filter(k => !SKILLS.includes(k))];

  box.innerHTML = `
    <div class="dm-cs-head">
      <span class="dm-cs-head-thumb" data-img="${escapeHtml(p.image || s.image || '')}"></span>
      <div>
        <h3 class="dm-cs-title">${escapeHtml(c.name)}</h3>
        <div class="dm-species-meta">${typeBadges(s.type1 || p.type1, s.type2 || p.type2)} ${escapeHtml(s.size || p.size || '')}${s.behavior ? ` · ${escapeHtml(s.behavior)}` : ''}</div>
      </div>
    </div>
    <form id="csPokemonForm" class="dm-cs-form">
      <div class="dm-cs-cols">
        <div>
          <div class="dm-row">
            <div class="dm-field"><label for="csName">Name</label><input class="dm-input" id="csName" value="${escapeHtml(c?.name || '')}" placeholder="${escapeHtml(s.name)} (letters added for several)"></div>
          </div>
          <div class="dm-row">
            <div class="dm-field" style="max-width:110px"><label for="csLevel">Level</label><input class="dm-input" id="csLevel" type="number" min="1" max="20" value="${cfg.level}"></div>
            <div class="dm-field"><label for="csNature">Nature</label>
              <select class="dm-select" id="csNature"><option value="">None</option>${natureOptions(cfg.nature)}</select></div>
          </div>
          <div class="dm-field"><label>Abilities</label>
            ${(s.abilities || []).map(a => `
              <label class="dm-check"><input type="checkbox" name="csAbility" value="${a.slot}" ${(cfg.abilities || []).includes(a.slot) ? 'checked' : ''}>
                <span>${escapeHtml(a.name)} <small>${SLOT_NAMES[a.slot] || ''} -- ${escapeHtml(a.description)}</small></span></label>`).join('') || '<div class="dm-hint">No abilities listed.</div>'}
          </div>
          <div class="dm-field"><label>Skills <small class="dm-label-note">its species' own are always on -- tick extra ones</small></label>
            ${multiSelectHtml('csSkills', skillOptions, cfg.extraSkills || [], { locked: ownSkills, placeholder: 'No skills' })}
          </div>
          <div class="dm-row">
            <div class="dm-field"><label for="csItem">Held item</label><input class="dm-input" id="csItem" value="${escapeHtml(cfg.item || '')}" placeholder="None"></div>
            <div class="dm-field"><label for="csTrainer">Belongs to</label><select class="dm-select" id="csTrainer">${trainerOptions(c?.trainerId)}</select></div>
          </div>
          <div class="dm-row">
            <div class="dm-field"><label for="csInit">Initiative</label><input class="dm-input" id="csInit" type="number" value="${cfg.initiative ?? ''}" placeholder="Rolled at the start"></div>
            <div class="dm-field dm-field-checks">
              <label class="dm-check"><input type="checkbox" id="csShiny" ${cfg.shiny ? 'checked' : ''}>Shiny</label>
              <label class="dm-check"><input type="checkbox" id="csHeld" ${c?.heldBack ? 'checked' : ''}>Hidden (joins later -- only you see it)</label>
            </div>
          </div>
          <div class="dm-cs-placement" id="csPlacement"></div>
        </div>
        <div>
          ${baseStatsHtml(s)}
          <div class="dm-field"><label>At this level <small class="dm-label-note">grey = worked out from level and nature -- type a number to change it</small></label>
            <div class="dm-stat-grid">
              ${STATS.map(k => statInput(k, k.toUpperCase(), cfg.stats?.[k])).join('')}
              ${statInput('ac', 'AC', cfg.overrides?.ac)}
              ${statInput('maxHP', 'Max HP', cfg.overrides?.maxHP)}
              ${statInput('maxVP', 'Max VP', cfg.overrides?.maxVP)}
            </div>
            <div class="dm-base-line" id="csDerived"></div>
            <button type="button" class="dm-btn small" id="csResetStats">↺ Back to calculated</button>
          </div>
          <div class="dm-field"><label>Moves at this level</label><div class="dm-move-chips" id="csMoves"></div></div>
        </div>
      </div>
      <div class="dm-cs-actions">
        <button type="button" class="dm-btn" id="csDuplicate">Duplicate</button><button type="button" class="dm-btn danger" id="csRemove">Remove</button>
        <button type="submit" class="dm-btn primary" id="csSave">Save changes</button>
      </div>
    </form>`;
  box.querySelectorAll('[data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); });
  bindMultiSelects(box);
  const form = document.getElementById('csPokemonForm');
  form.addEventListener('submit', (e) => { e.preventDefault(); savePokemon(); });
  // Every change that moves the numbers works them out again (a preview build -- nothing is saved until Add / Save).
  form.addEventListener('input', (e) => { if (!e.target.matches('#csName, #csInit, #csItem')) schedulePreview(); });
  form.addEventListener('change', (e) => { if (e.target.matches('select, input[type=checkbox]')) schedulePreview(); });
  document.getElementById('csResetStats').addEventListener('click', () => {
    box.querySelectorAll('[data-stat]').forEach(i => { i.value = ''; });
    schedulePreview();
  });
  document.getElementById('csRemove').addEventListener('click', () => removeCreature(c));
  document.getElementById('csDuplicate').addEventListener('click', () => duplicatePokemon(c));
  renderPlacementLine();
  previewNow();
}

function schedulePreview() {
  clearTimeout(_previewTimer);
  _previewTimer = setTimeout(previewNow, 300);
}

/** Builds the Pokemon as the form stands (never saved) and shows the result: the calculated stats as the grey numbers,
 * initiative / proficiency / STAB, and the moves it knows at this level. */
async function previewNow() {
  const form = document.getElementById('csPokemonForm');
  if (!form) return;
  const species = selectedCreature()?.config.species;
  if (!species) return;
  const seq = ++_previewSeq;
  const { config } = readPokemonForm();
  try {
    const res = await DmAPI.buildPokemon({ species, ...config, preview: true });
    if (seq !== _previewSeq || !document.body.contains(form)) return;
    const row = res.data;
    const { participant: p } = participantFromPokemonRow(row);
    form.querySelectorAll('[data-stat]').forEach(i => { i.placeholder = p[i.dataset.stat] ?? '?'; });
    const sign = n => (n >= 0 ? `+${n}` : `${n}`);
    document.getElementById('csDerived').textContent = `Initiative ${sign(Number(row[30]) || 0)} · Proficiency +${row[31]} · STAB +${row[34]} · Skills: ${row[22] || '-'}`;
    document.getElementById('csMoves').innerHTML = (p.moves || []).map(mv => `<span>${escapeHtml(mv)}</span>`).join('') || '<span class="dm-hint">None</span>';
  } catch (err) {
    if (seq === _previewSeq) document.getElementById('csDerived').textContent = `Couldn't work the numbers out: ${err.message}`;
  }
}

function readPokemonForm() {
  const statsIn = {};
  const overrides = {};
  document.querySelectorAll('#csPokemonForm [data-stat]').forEach(i => {
    if (i.value === '') return;
    const v = parseInt(i.value, 10);
    if (Number.isNaN(v)) return;
    if (STATS.includes(i.dataset.stat)) statsIn[i.dataset.stat] = v; else overrides[i.dataset.stat] = v;
  });
  const init = document.getElementById('csInit').value;
  return {
    name: document.getElementById('csName').value.trim(),
    config: {
      level: Math.max(1, Math.min(20, parseInt(document.getElementById('csLevel').value, 10) || 1)),
      nature: document.getElementById('csNature').value,
      abilities: [...document.querySelectorAll('input[name="csAbility"]:checked')].map(cb => Number(cb.value)),
      item: document.getElementById('csItem').value.trim(),
      shiny: document.getElementById('csShiny').checked,
      initiative: init === '' ? null : parseInt(init, 10),
      stats: statsIn, overrides,
      extraSkills: readMultiSelect('csSkills'),
      bonus: selectedCreature()?.config.bonus || {}, // Encounter setup's stat bonuses stay
      size: selectedCreature()?.config.size || '', // and the DM's size override (renderPlacementLine)
    },
    trainerId: document.getElementById('csTrainer').value || null,
    heldBack: document.getElementById('csHeld').checked,
  };
}

/** Builds one Pokemon creature (server maths + the player builder) from its config and display name. Also used by the
 * encounter builder (encounters.js) to load an encounter's Pokemon into the setup. */
export async function buildPokemonCreature(id, species, name, config, extra) {
  const res = await DmAPI.buildPokemon({ species, nickname: name === species ? '' : name, ...config });
  const { combatant, participant } = participantFromPokemonRow(res.data);
  participant.initiative = config.initiative ?? null;
  const naturalSize = participant.size || '';
  if (config.size) participant.size = config.size; // the DM's size override on the map
  return {
    id, kind: 'pokemon', name: participant.name, config: { ...config, species },
    participant, naturalSize, initiativeBonus: combatant.initiativeTotal || 0, ...extra,
  };
}

/** The next free letters for `count` more of `species`, among what's already set up ("Zubat A", "Zubat B"...). A
 * lone one gets no letter; adding more to a lone unlettered one makes it "A". */
function lettersFor(species, count) {
  const same = getSetup().creatures.filter(c => c.kind === 'pokemon' && c.config.species === species);
  if (count === 1 && !same.length) return { names: [species], renameLone: null };
  const used = new Set(same.map(c => (c.name.startsWith(`${species} `) ? c.name.slice(species.length + 1) : '')).filter(l => /^[A-Z]$/.test(l)));
  const lone = same.find(c => c.name === species);
  if (lone) used.add('A');
  const names = [];
  for (let i = 0; names.length < count && i < 26; i++) {
    const l = String.fromCharCode(65 + i);
    if (!used.has(l)) names.push(`${species} ${l}`);
  }
  return { names, renameLone: lone ? lone.id : null };
}

async function savePokemon() {
  if (_busy) return;
  const form = readPokemonForm();
  const c = selectedCreature();
  if (!c) return;
  const btn = document.getElementById('csSave');
  _busy = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Building…'; }
  try {
    const rebuilt = await buildPokemonCreature(c.id, c.config.species, form.name || c.name, form.config,
      { ...originOf(c), trainerId: form.trainerId, heldBack: form.heldBack, position: form.heldBack ? null : c.position });
    updateSetup(s => { s.creatures[s.creatures.findIndex(x => x.id === c.id)] = rebuilt; });
    edit({ mode: 'pokemon', id: c.id });
  } catch (err) {
    showCombatAlert(err.message, { title: "Couldn't build that Pokémon" });
    if (btn) { btn.disabled = false; btn.textContent = 'Save changes'; }
  } finally {
    _busy = false;
  }
}

async function duplicatePokemon(c) {
  if (_busy) return;
  _busy = true;
  try {
    const { names, renameLone } = lettersFor(c.config.species, 1);
    const copy = await buildPokemonCreature(newId(), c.config.species, names[0], c.config, { trainerId: c.trainerId, heldBack: c.heldBack, position: null });
    updateSetup(s => {
      if (renameLone) {
        const lone = s.creatures.find(x => x.id === renameLone);
        lone.name = lone.participant.name = `${c.config.species} A`;
      }
      s.creatures.push(copy);
    });
    edit({ mode: 'pokemon', id: copy.id });
  } catch (err) {
    showCombatAlert(err.message, { title: "Couldn't duplicate it" });
  } finally {
    _busy = false;
  }
}

async function removeCreature(c) {
  if (!await showCombatConfirm(`Remove ${c.name} from the next battle?`, { title: 'Remove', yesLabel: 'Remove', noLabel: 'Cancel' })) return;
  updateSetup(s => {
    s.creatures = s.creatures.filter(x => x.id !== c.id);
    if (c.kind === 'trainer') s.creatures.forEach(x => { if (x.trainerId === c.id) x.trainerId = null; }); // their Pokemon stay, as wild
  });
  edit(null);
}

// ---------------------------------------------------------------------------
// NPC trainers
// ---------------------------------------------------------------------------

function defaultTrainer() {
  return { name: '', image: '', level: 5, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ac: 10, maxHP: 0, maxVP: 10, speed: 30, savingThrows: '', skills: '', initiative: null };
}

function renderTrainerForm(box) {
  const c = selectedCreature();
  const t = { ...defaultTrainer(), ...(c?.config || {}) };
  if (!t.maxHP) t.maxHP = trainerHp(t.level, t.con);
  const portraitKnown = _portraits.some(pt => pt.url === t.image);
  box.innerHTML = `
    <div class="dm-cs-head">
      <span class="dm-cs-head-thumb" id="csTrainerThumb"></span>
      <div><h3 class="dm-cs-title">${escapeHtml(c.name)}</h3>
        <div class="dm-species-meta">Fights with the Attack action and commands the Pokémon that belong to them.</div></div>
    </div>
    <form id="csTrainerForm" class="dm-cs-form">
      <div class="dm-cs-cols">
        <div>
          <div class="dm-field"><label for="ctName">Name</label><input class="dm-input" id="ctName" value="${escapeHtml(t.name)}" required placeholder="e.g. Grunt, Ranger Kari"></div>
          <div class="dm-field"><label for="ctPortrait">Portrait</label>
            <select class="dm-select" id="ctPortrait">
              <option value="">None</option>
              ${portraitOptionsHtml(_portraits, t.image)}
              <option value="__url" ${t.image && !portraitKnown ? 'selected' : ''}>Picture from a link…</option>
            </select>
            <input class="dm-input" id="ctImageUrl" placeholder="https://…" value="${escapeHtml(t.image && !portraitKnown ? t.image : '')}" ${t.image && !portraitKnown ? '' : 'hidden'} style="margin-top:0.35rem">
          </div>
          <div class="dm-row">
            <div class="dm-field"><label for="ctLevel">Level</label><input class="dm-input" id="ctLevel" type="number" min="1" max="20" value="${t.level}"></div>
            <div class="dm-field"><label for="ctSpeed">Speed (ft)</label><input class="dm-input" id="ctSpeed" type="number" min="0" step="5" value="${t.speed}"></div>
            <div class="dm-field"><label for="ctInit">Initiative</label><input class="dm-input" id="ctInit" type="number" value="${t.initiative ?? ''}" placeholder="Rolled"></div>
          </div>
          <div class="dm-field"><label>Saving throws</label>${multiSelectHtml('ctSaves', SAVING_THROWS, splitList(t.savingThrows, SAVING_THROWS))}</div>
          <div class="dm-field"><label>Skills</label>${multiSelectHtml('ctSkills', SKILLS, splitList(t.skills, SKILLS))}</div>
          <label class="dm-check"><input type="checkbox" id="ctHeld" ${c?.heldBack ? 'checked' : ''}>Hidden (joins later -- only you see it)</label>
          <div class="dm-cs-placement" id="csPlacement"></div>
        </div>
        <div>
          <div class="dm-field"><label>Stats</label>
            <div class="dm-stat-grid">
              ${STATS.map(k => `<div class="dm-stat"><label>${k.toUpperCase()}</label><input class="dm-input" data-tstat="${k}" type="number" value="${t[k]}"></div>`).join('')}
              <div class="dm-stat"><label>AC</label><input class="dm-input" data-tstat="ac" type="number" value="${t.ac}"></div>
              <div class="dm-stat"><label>Max HP</label><input class="dm-input" data-tstat="maxHP" type="number" value="${t.maxHP}"></div>
              <div class="dm-stat"><label>Max VP</label><input class="dm-input" data-tstat="maxVP" type="number" value="${t.maxVP}"></div>
            </div>
            <button type="button" class="dm-btn small" id="ctHpCalc">↺ HP from level and CON</button>
          </div>
        </div>
      </div>
      <div class="dm-cs-actions">
        <button type="button" class="dm-btn danger" id="ctRemove">Remove</button>
        <button type="submit" class="dm-btn primary">Save changes</button>
      </div>
    </form>`;
  bindMultiSelects(box);
  const thumb = () => {
    const url = readTrainerImage();
    const el = document.getElementById('csTrainerThumb');
    if (url) patchPortraitMedia(el, url, ''); else el.innerHTML = '<span style="font-size:1.8rem">👤</span>';
  };
  thumb();
  document.getElementById('ctPortrait').addEventListener('change', (e) => {
    document.getElementById('ctImageUrl').hidden = e.target.value !== '__url';
    thumb();
  });
  document.getElementById('ctImageUrl').addEventListener('change', thumb);
  document.getElementById('ctHpCalc').addEventListener('click', () => {
    const level = parseInt(document.getElementById('ctLevel').value, 10) || 1;
    const con = parseInt(box.querySelector('[data-tstat="con"]').value, 10) || 10;
    box.querySelector('[data-tstat="maxHP"]').value = trainerHp(level, con);
  });
  document.getElementById('csTrainerForm').addEventListener('submit', (e) => { e.preventDefault(); saveTrainer(c); });
  document.getElementById('ctRemove').addEventListener('click', () => removeCreature(c));
  renderPlacementLine();
}

function readTrainerImage() {
  const sel = document.getElementById('ctPortrait').value;
  return sel === '__url' ? document.getElementById('ctImageUrl').value.trim() : sel;
}

function saveTrainer(existing) {
  const box = document.getElementById('csEditor');
  const stat = (k) => parseInt(box.querySelector(`[data-tstat="${k}"]`).value, 10);
  const init = document.getElementById('ctInit').value;
  const config = {
    name: document.getElementById('ctName').value.trim() || 'Trainer',
    image: readTrainerImage(),
    level: Math.max(1, Math.min(20, parseInt(document.getElementById('ctLevel').value, 10) || 1)),
    ...Object.fromEntries(STATS.map(k => [k, stat(k) || 10])),
    ac: stat('ac') || 10, maxHP: stat('maxHP') || 1, maxVP: Number.isNaN(stat('maxVP')) ? 0 : stat('maxVP'),
    speed: parseInt(document.getElementById('ctSpeed').value, 10) || 30,
    savingThrows: readMultiSelect('ctSaves').join(', '),
    skills: readMultiSelect('ctSkills').join(', '),
    initiative: init === '' ? null : parseInt(init, 10),
  };
  const { combatant, participant } = participantFromTrainer(config);
  participant.initiative = config.initiative;
  const heldBack = document.getElementById('ctHeld').checked;
  const creature = {
    ...originOf(existing), id: existing?.id || newId(), kind: 'trainer', name: config.name, config, participant,
    initiativeBonus: combatant.initiativeTotal || 0, heldBack, position: heldBack ? null : existing?.position || null,
  };
  updateSetup(s => {
    const i = s.creatures.findIndex(x => x.id === creature.id);
    if (i >= 0) s.creatures[i] = creature; else s.creatures.unshift(creature);
  });
  edit({ mode: 'trainer', id: creature.id });
}

/** Adds an NPC from the library to the battle setup: the NPC as an NPC trainer, each Pokemon of their team built at
 * its level, nature and abilities (with any stats the DM gave it) and belonging to them. Nobody is placed yet. */
export async function addNpcToSetup(npc) {
  const level = Math.max(1, Math.min(20, Number(npc.level) || 1));
  const config = {
    name: npc.name || 'Trainer', image: npc.image || '', level,
    ...Object.fromEntries(STATS.map(k => [k, Number(npc[k]) || 10])),
    ac: Number(npc.ac) || 10, maxHP: Number(npc.maxHP) || trainerHp(level, Number(npc.con) || 10),
    maxVP: Number(npc.maxVP) || 0, speed: Number(npc.speed) || 30,
    savingThrows: npc.savingThrows || '', skills: npc.skills || '', initiative: null,
  };
  const { combatant, participant } = participantFromTrainer(config);
  participant.initiative = null;
  const trainer = {
    id: newId(), kind: 'trainer', name: config.name, config, participant, npcId: npc.id,
    initiativeBonus: combatant.initiativeTotal || 0, heldBack: false, position: null,
  };
  const pokemon = [];
  for (const m of (npc.team || []).filter(x => x.species)) {
    const cfg = {
      level: Math.max(1, Math.min(20, Number(m.level) || 1)), nature: m.nature || '', abilities: m.abilities?.length ? m.abilities : [0],
      item: m.item || '', shiny: !!m.shiny, initiative: null, stats: m.stats || {}, overrides: {}, extraSkills: [],
    };
    pokemon.push(await buildPokemonCreature(newId(), m.species, m.nickname || m.species, cfg, { trainerId: trainer.id, heldBack: false, position: null }));
  }
  updateSetup(s => { s.creatures.unshift(trainer); s.creatures.push(...pokemon); });
  await flushSetup();
  return { trainer, pokemon };
}
