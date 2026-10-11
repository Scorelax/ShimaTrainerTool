// DM console -- battle setup: the NPC trainers and Pokemon the players will face, prepared before the battle starts.
// A Pokemon is built from the full encyclopedia at the level, nature and abilities the DM picks (routes_dm.py's
// build-pokemon, the same maths a player's Pokemon gets) and the DM can override any of its numbers; an NPC trainer is
// typed in. Each is saved with a ready battle participant (setup-store.js), so Start battle only has to send them in.
import { DmAPI } from '../api.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import { escapeHtml, typeBadges, getSpecies, newId, participantFromPokemonRow, participantFromTrainer, abilityMod } from './dm-common.js';
import { getSetup, updateSetup, flushSetup } from './setup-store.js';

const STATS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SLOT_NAMES = ['Primary', 'Secondary', 'Hidden'];

let _root = null;
let _onDone = null;
let _species = [];
let _portraits = [];
let _editing = null; // null | {mode: 'new-pokemon', species?} | {mode: 'pokemon', id} | {mode: 'new-trainer'} | {mode: 'trainer', id}
let _busy = false;

export async function renderCreatureSetup(root, { onDone }) {
  _root = root;
  _onDone = onDone;
  root.innerHTML = `
    <div class="dm-editor">
      <aside class="dm-editor-tools">
        <div class="dm-editor-head">
          <button class="dm-btn small" id="csBack">← Setup</button>
          <h2>Battle</h2>
        </div>
        <div class="dm-row">
          <button class="dm-btn primary" id="csAddPokemon">+ Pokémon</button>
          <button class="dm-btn" id="csAddTrainer">+ NPC trainer</button>
        </div>
        <div id="csList" class="dm-cs-list"></div>
      </aside>
      <section class="dm-editor-canvas dm-cs-editor" id="csEditor"></section>
    </div>`;
  document.getElementById('csBack').addEventListener('click', leave);
  document.getElementById('csAddPokemon').addEventListener('click', () => edit({ mode: 'new-pokemon' }));
  document.getElementById('csAddTrainer').addEventListener('click', () => edit({ mode: 'new-trainer' }));
  document.getElementById('csList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-creature]');
    if (!row) return;
    const c = getSetup().creatures.find(x => x.id === row.dataset.creature);
    if (c) edit({ mode: c.kind, id: c.id });
  });
  renderList();
  edit(_editing && (!_editing.id || getSetup().creatures.some(c => c.id === _editing.id)) ? _editing : null);
  [_species] = await Promise.all([
    getSpecies().catch(() => []),
    DmAPI.mapAssets().then(r => { _portraits = r.data?.portraits || []; }).catch(() => {}),
  ]);
  // The open form needed these (a Pokemon's abilities, the portrait list) -- draw it again now they're here.
  if (!document.body.contains(root) || !_editing) return;
  if (_editing.mode === 'new-pokemon' && !_editing.species) renderSpeciesResults(); else edit(_editing);
}

async function leave() {
  try { await flushSetup(); } catch (err) { showCombatAlert(err.message, { title: "Couldn't save the battle" }); }
  _onDone?.();
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
    const flags = [c.heldBack ? 'held back' : '', c.position ? 'on the map' : ''].filter(Boolean).join(' · ');
    return `
      <button class="dm-cs-row${nested ? ' nested' : ''}${_editing?.id === c.id ? ' selected' : ''}" data-creature="${c.id}">
        <span class="dm-cs-thumb" data-img="${escapeHtml(p.image || '')}"></span>
        <span class="dm-cs-main">
          <span class="dm-cs-name">${escapeHtml(c.name)}</span>
          <span class="dm-cs-sub">Lv ${p.level ?? '?'} · HP ${p.maxHP ?? '?'} · VP ${p.maxVP ?? '?'}${flags ? ` · ${flags}` : ''}</span>
        </span>
      </button>`;
  };
  if (!all.length) {
    el.innerHTML = '<div class="dm-hint">Nothing here yet. Add the Pokémon and NPC trainers the players will face.</div>';
    return;
  }
  el.innerHTML = [
    ...trainers.map(t => `<div class="dm-cs-group">${row(t)}${all.filter(c => c.kind === 'pokemon' && c.trainerId === t.id).map(c => row(c, true)).join('')}</div>`),
    wild.length ? `<div class="dm-cs-group"><div class="dm-cs-group-title">Wild Pokémon</div>${wild.map(c => row(c)).join('')}</div>` : '',
  ].join('');
  el.querySelectorAll('[data-img]').forEach(x => { if (x.dataset.img) patchPortraitMedia(x, x.dataset.img, ''); else x.innerHTML = '<img src="assets/Pokeball.png" alt="" style="opacity:.35">'; });
}

function edit(target) {
  _editing = target;
  renderList();
  const box = document.getElementById('csEditor');
  if (!box) return;
  if (!target) {
    box.innerHTML = '<div class="dm-cs-empty">Pick something on the left to change it, or add a Pokémon or NPC trainer.</div>';
    return;
  }
  if (target.mode === 'new-pokemon' && !target.species) return renderSpeciesPicker(box);
  if (target.mode === 'new-pokemon' || target.mode === 'pokemon') return renderPokemonForm(box);
  return renderTrainerForm(box);
}

// ---------------------------------------------------------------------------
// Pokemon
// ---------------------------------------------------------------------------

function renderSpeciesPicker(box) {
  box.innerHTML = `
    <h3 class="dm-cs-title">Add a Pokémon</h3>
    <input class="dm-input" id="csSearch" placeholder="Search name, type or habitat…" autocomplete="off">
    <div class="dm-cs-species" id="csSpecies"><div class="dm-species-empty">Loading the Pokédex…</div></div>`;
  const input = document.getElementById('csSearch');
  input.addEventListener('input', renderSpeciesResults);
  input.focus();
  document.getElementById('csSpecies').addEventListener('click', (e) => {
    const item = e.target.closest('[data-species]');
    if (item) edit({ mode: 'new-pokemon', species: item.dataset.species });
  });
  renderSpeciesResults();
}

function renderSpeciesResults() {
  const box = document.getElementById('csSpecies');
  if (!box || !_species.length) return;
  const q = (document.getElementById('csSearch')?.value || '').trim().toLowerCase();
  const matches = _species.filter(s => !q || s.name.toLowerCase().includes(q)
    || String(s.type1).toLowerCase() === q || String(s.type2).toLowerCase() === q || String(s.habitat).toLowerCase().includes(q)).slice(0, 80);
  box.innerHTML = matches.length ? matches.map(s => `
    <button type="button" class="dm-species-item" data-species="${escapeHtml(s.name)}">
      <span class="dm-species-thumb" data-img="${escapeHtml(s.image)}"></span>
      <span>
        <span class="dm-species-name">#${escapeHtml(s.dex)} ${escapeHtml(s.name)}</span>
        <span class="dm-species-meta">${typeBadges(s.type1, s.type2)} ${escapeHtml(s.rarity || '')}${s.habitat ? ` · ${escapeHtml(s.habitat)}` : ''} · base Lv ${s.level}</span>
      </span>
    </button>`).join('') : '<div class="dm-species-empty">No Pokémon match that.</div>';
  box.querySelectorAll('[data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); else el.innerHTML = '<img src="assets/Pokeball.png" alt="" style="opacity:.35">'; });
}

function trainerOptions(selected) {
  const trainers = getSetup().creatures.filter(c => c.kind === 'trainer');
  return `<option value="">Wild (no trainer)</option>${trainers.map(t => `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}>${escapeHtml(t.name)}'s Pokémon</option>`).join('')}`;
}

function renderPokemonForm(box) {
  const isNew = _editing.mode === 'new-pokemon';
  const c = isNew ? null : getSetup().creatures.find(x => x.id === _editing.id);
  const speciesName = isNew ? _editing.species : c.config.species;
  const s = _species.find(x => x.name === speciesName) || { name: speciesName, abilities: [], level: c?.config.level || 1 };
  const cfg = c?.config || { species: s.name, level: s.level || 1, nature: '', abilities: [0], item: '', shiny: false, stats: {}, overrides: {} };
  const p = c?.participant || {};
  const natures = JSON.parse(sessionStorage.getItem('natures') || '[]');
  const statInput = (key, label, current, override) => `
    <div class="dm-stat"><label>${label}</label>
      <input class="dm-input" data-stat="${key}" type="number" value="${override ?? ''}" placeholder="${current ?? '?'}"></div>`;

  box.innerHTML = `
    <div class="dm-cs-head">
      <span class="dm-cs-head-thumb" data-img="${escapeHtml(p.image || s.image || '')}"></span>
      <div>
        <h3 class="dm-cs-title">${isNew ? `New ${escapeHtml(s.name)}` : escapeHtml(c.name)}</h3>
        <div class="dm-species-meta">${typeBadges(s.type1 || p.type1, s.type2 || p.type2)} ${escapeHtml(s.size || p.size || '')}${s.behavior ? ` · ${escapeHtml(s.behavior)}` : ''}</div>
      </div>
    </div>
    <form id="csPokemonForm" class="dm-cs-form">
      <div class="dm-cs-cols">
        <div>
          <div class="dm-row">
            <div class="dm-field"><label for="csName">Name</label><input class="dm-input" id="csName" value="${escapeHtml(c?.name || '')}" placeholder="${escapeHtml(s.name)} (letters added for several)"></div>
            ${isNew ? '<div class="dm-field" style="max-width:110px"><label for="csCount">How many</label><input class="dm-input" id="csCount" type="number" min="1" max="12" value="1"></div>' : ''}
          </div>
          <div class="dm-row">
            <div class="dm-field"><label for="csLevel">Level</label><input class="dm-input" id="csLevel" type="number" min="1" max="20" value="${cfg.level}"></div>
            <div class="dm-field"><label for="csNature">Nature</label>
              <select class="dm-select" id="csNature"><option value="">None</option>
                ${natures.map(n => `<option value="${escapeHtml(n.name)}" ${n.name === cfg.nature ? 'selected' : ''}>${escapeHtml(n.name)}</option>`).join('')}
              </select></div>
          </div>
          <div class="dm-field"><label>Abilities</label>
            ${(s.abilities || []).map(a => `
              <label class="dm-check"><input type="checkbox" name="csAbility" value="${a.slot}" ${(cfg.abilities || []).includes(a.slot) ? 'checked' : ''}>
                <span>${escapeHtml(a.name)} <small>${SLOT_NAMES[a.slot] || ''} -- ${escapeHtml(a.description)}</small></span></label>`).join('') || '<div class="dm-hint">No abilities listed.</div>'}
          </div>
          <div class="dm-row">
            <div class="dm-field"><label for="csItem">Held item</label><input class="dm-input" id="csItem" value="${escapeHtml(cfg.item || '')}" placeholder="None"></div>
            <div class="dm-field"><label for="csTrainer">Belongs to</label><select class="dm-select" id="csTrainer">${trainerOptions(c?.trainerId)}</select></div>
          </div>
          <div class="dm-row">
            <div class="dm-field"><label for="csInit">Initiative</label><input class="dm-input" id="csInit" type="number" value="${cfg.initiative ?? ''}" placeholder="Rolled at the start"></div>
            <div class="dm-field dm-field-checks">
              <label class="dm-check"><input type="checkbox" id="csShiny" ${cfg.shiny ? 'checked' : ''}>Shiny</label>
              <label class="dm-check"><input type="checkbox" id="csHeld" ${c?.heldBack ? 'checked' : ''}>Held back (joins later)</label>
            </div>
          </div>
        </div>
        <div>
          <div class="dm-field"><label>Stats <small class="dm-label-note">${isNew ? 'Calculated when it\'s added -- change them afterwards.' : 'Grey = calculated. Type a number to change it.'}</small></label>
            <div class="dm-stat-grid">
              ${STATS.map(k => statInput(k, k.toUpperCase(), p[k], cfg.stats?.[k])).join('')}
              ${statInput('ac', 'AC', p.ac, cfg.overrides?.ac)}
              ${statInput('maxHP', 'Max HP', p.maxHP, cfg.overrides?.maxHP)}
              ${statInput('maxVP', 'Max VP', p.maxVP, cfg.overrides?.maxVP)}
            </div>
            ${!isNew ? '<button type="button" class="dm-btn small" id="csResetStats">↺ Back to calculated</button>' : ''}
          </div>
          ${!isNew && (p.moves || []).length ? `<div class="dm-field"><label>Moves at this level</label><div class="dm-move-chips">${p.moves.map(mv => `<span>${escapeHtml(mv)}</span>`).join('')}</div></div>` : ''}
        </div>
      </div>
      <div class="dm-cs-actions">
        ${!isNew ? '<button type="button" class="dm-btn" id="csDuplicate">Duplicate</button><button type="button" class="dm-btn danger" id="csRemove">Remove</button>' : '<button type="button" class="dm-btn" id="csCancel">Back</button>'}
        <button type="submit" class="dm-btn primary" id="csSave">${isNew ? 'Add to battle' : 'Save changes'}</button>
      </div>
    </form>`;
  box.querySelectorAll('[data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); });
  document.getElementById('csPokemonForm').addEventListener('submit', (e) => { e.preventDefault(); savePokemon(); });
  document.getElementById('csCancel')?.addEventListener('click', () => edit({ mode: 'new-pokemon' }));
  document.getElementById('csResetStats')?.addEventListener('click', () => {
    box.querySelectorAll('[data-stat]').forEach(i => { i.value = ''; });
  });
  document.getElementById('csRemove')?.addEventListener('click', () => removeCreature(c));
  document.getElementById('csDuplicate')?.addEventListener('click', () => duplicatePokemon(c));
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
    count: Math.max(1, Math.min(12, parseInt(document.getElementById('csCount')?.value, 10) || 1)),
    config: {
      level: Math.max(1, Math.min(20, parseInt(document.getElementById('csLevel').value, 10) || 1)),
      nature: document.getElementById('csNature').value,
      abilities: [...document.querySelectorAll('input[name="csAbility"]:checked')].map(cb => Number(cb.value)),
      item: document.getElementById('csItem').value.trim(),
      shiny: document.getElementById('csShiny').checked,
      initiative: init === '' ? null : parseInt(init, 10),
      stats: statsIn, overrides,
    },
    trainerId: document.getElementById('csTrainer').value || null,
    heldBack: document.getElementById('csHeld').checked,
  };
}

/** Builds one Pokemon creature (server maths + the player builder) from its config and display name. */
async function buildPokemonCreature(id, species, name, config, extra) {
  const res = await DmAPI.buildPokemon({ species, nickname: name === species ? '' : name, ...config });
  const { combatant, participant } = participantFromPokemonRow(res.data);
  participant.initiative = config.initiative ?? null;
  return {
    id, kind: 'pokemon', name: participant.name, config: { ...config, species },
    participant, initiativeBonus: combatant.initiativeTotal || 0, ...extra,
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
  const isNew = _editing.mode === 'new-pokemon';
  const btn = document.getElementById('csSave');
  _busy = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Building…'; }
  try {
    if (isNew) {
      const species = _editing.species;
      const { names, renameLone } = form.name && form.count === 1 ? { names: [form.name], renameLone: null } : lettersFor(species, form.count);
      const built = [];
      for (const name of names) {
        built.push(await buildPokemonCreature(newId(), species, name, form.config, { trainerId: form.trainerId, heldBack: form.heldBack, position: null }));
      }
      updateSetup(s => {
        if (renameLone) {
          const lone = s.creatures.find(c => c.id === renameLone);
          lone.name = lone.participant.name = `${species} A`;
        }
        s.creatures.push(...built);
      });
      edit({ mode: 'pokemon', id: built[0].id });
    } else {
      const c = getSetup().creatures.find(x => x.id === _editing.id);
      const name = form.name || c.name;
      const rebuilt = await buildPokemonCreature(c.id, c.config.species, name, form.config,
        { trainerId: form.trainerId, heldBack: form.heldBack, position: form.heldBack ? null : c.position });
      updateSetup(s => { s.creatures[s.creatures.findIndex(x => x.id === c.id)] = rebuilt; });
      edit({ mode: 'pokemon', id: c.id });
    }
  } catch (err) {
    showCombatAlert(err.message, { title: "Couldn't build that Pokémon" });
    if (btn) { btn.disabled = false; btn.textContent = isNew ? 'Add to battle' : 'Save changes'; }
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
  if (!await showCombatConfirm(`Remove ${c.name} from the battle setup?`, { title: 'Remove', yesLabel: 'Remove', noLabel: 'Cancel' })) return;
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

/** A trainer's HP at a level -- a d8 hit die: 8 + CON at 1st level, then 5 + CON per level. */
function trainerHp(level, con) {
  const mod = abilityMod(con);
  return Math.max(1, 8 + mod + (Math.max(1, level) - 1) * (5 + mod));
}

function renderTrainerForm(box) {
  const isNew = _editing.mode === 'new-trainer';
  const c = isNew ? null : getSetup().creatures.find(x => x.id === _editing.id);
  const t = { ...defaultTrainer(), ...(c?.config || {}) };
  if (!t.maxHP) t.maxHP = trainerHp(t.level, t.con);
  const portraitKnown = _portraits.some(pt => pt.url === t.image);
  box.innerHTML = `
    <div class="dm-cs-head">
      <span class="dm-cs-head-thumb" id="csTrainerThumb"></span>
      <div><h3 class="dm-cs-title">${isNew ? 'New NPC trainer' : escapeHtml(c.name)}</h3>
        <div class="dm-species-meta">Fights with the Attack action and commands the Pokémon that belong to them.</div></div>
    </div>
    <form id="csTrainerForm" class="dm-cs-form">
      <div class="dm-cs-cols">
        <div>
          <div class="dm-field"><label for="ctName">Name</label><input class="dm-input" id="ctName" value="${escapeHtml(t.name)}" required placeholder="e.g. Grunt, Ranger Kari"></div>
          <div class="dm-field"><label for="ctPortrait">Portrait</label>
            <select class="dm-select" id="ctPortrait">
              <option value="">None</option>
              ${_portraits.map(pt => `<option value="${escapeHtml(pt.url)}" ${pt.url === t.image ? 'selected' : ''}>${escapeHtml(pt.name)}</option>`).join('')}
              <option value="__url" ${t.image && !portraitKnown ? 'selected' : ''}>Picture from a link…</option>
            </select>
            <input class="dm-input" id="ctImageUrl" placeholder="https://…" value="${escapeHtml(t.image && !portraitKnown ? t.image : '')}" ${t.image && !portraitKnown ? '' : 'hidden'} style="margin-top:0.35rem">
          </div>
          <div class="dm-row">
            <div class="dm-field"><label for="ctLevel">Level</label><input class="dm-input" id="ctLevel" type="number" min="1" max="20" value="${t.level}"></div>
            <div class="dm-field"><label for="ctSpeed">Speed (ft)</label><input class="dm-input" id="ctSpeed" type="number" min="0" step="5" value="${t.speed}"></div>
            <div class="dm-field"><label for="ctInit">Initiative</label><input class="dm-input" id="ctInit" type="number" value="${t.initiative ?? ''}" placeholder="Rolled"></div>
          </div>
          <div class="dm-row">
            <div class="dm-field"><label for="ctSaves">Saving throws</label><input class="dm-input" id="ctSaves" value="${escapeHtml(t.savingThrows)}" placeholder="e.g. STR, CHA"></div>
            <div class="dm-field"><label for="ctSkills">Skills</label><input class="dm-input" id="ctSkills" value="${escapeHtml(t.skills)}" placeholder="e.g. Athletics, Intimidation"></div>
          </div>
          <label class="dm-check"><input type="checkbox" id="ctHeld" ${c?.heldBack ? 'checked' : ''}>Held back (joins later)</label>
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
        ${!isNew ? '<button type="button" class="dm-btn danger" id="ctRemove">Remove</button>' : ''}
        <button type="submit" class="dm-btn primary">${isNew ? 'Add to battle' : 'Save changes'}</button>
      </div>
    </form>`;
  const thumb = () => {
    const url = readTrainerImage();
    const el = document.getElementById('csTrainerThumb');
    if (url) patchPortraitMedia(el, url, ''); else el.innerHTML = '<span style="font-size:1.8rem">🎭</span>';
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
  document.getElementById('ctRemove')?.addEventListener('click', () => removeCreature(c));
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
    savingThrows: document.getElementById('ctSaves').value.trim(),
    skills: document.getElementById('ctSkills').value.trim(),
    initiative: init === '' ? null : parseInt(init, 10),
  };
  const { combatant, participant } = participantFromTrainer(config);
  participant.initiative = config.initiative;
  const heldBack = document.getElementById('ctHeld').checked;
  const creature = {
    id: existing?.id || newId(), kind: 'trainer', name: config.name, config, participant,
    initiativeBonus: combatant.initiativeTotal || 0, heldBack, position: heldBack ? null : existing?.position || null,
  };
  updateSetup(s => {
    const i = s.creatures.findIndex(x => x.id === creature.id);
    if (i >= 0) s.creatures[i] = creature; else s.creatures.unshift(creature);
  });
  edit({ mode: 'trainer', id: creature.id });
}
