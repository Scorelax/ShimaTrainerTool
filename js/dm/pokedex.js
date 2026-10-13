// DM console -- the Pokedex module: every species with everything the encyclopedia knows about it, and next to each
// piece a checkbox for whether the PLAYERS get to see it. That's the players' pokedex config (pokedex_config.json --
// `registered`: the species in the players' Pokedex at all; `visibility`: per-species switches; `defaults`: the switches
// for a species without its own), the same file the registration / evolution pages read (js/utils/visibility.js) and
// Benjakronk's player Pokedex is built from. Saved to the Pi a moment after each change and live-pushed to every
// device; once saved from here, the Pi's copy is the real one (upstream.store_local_pokedex_config).
import { DmAPI } from '../api.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { showCombatAlert, showCombatConfirm } from '../utils/combat-alert.js';
import { escapeHtml, typeBadges, getSpecies } from './dm-common.js';

const DEFAULTS = '__defaults';
// The page for moves the players can look up on their own (extraSearchableMoves -- the old site's "Move Search" tab).
const MOVES = '__moves';

// Every switch the config has, grouped the way the detail page shows them. [key, label, value(detail) -> text]
const GROUPS = [
  ['Basics', [
    ['primaryType', 'Primary type', d => d.type1],
    ['secondaryType', 'Secondary type', d => d.type2 || '—'],
    ['description', 'Pokédex entry', d => d.description],
  ]],
  ['Characteristics', [
    ['charSize', 'Size', d => d.size], ['charRarity', 'Rarity', d => d.rarity], ['charBehavior', 'Behaviour', d => d.behavior],
    ['charHabitat', 'Habitat', d => d.habitat], ['charActivity', 'Active', d => d.activity],
  ]],
  ['Stats', [
    ['statAC', 'AC', d => d.ac], ['statHD', 'Hit die', d => (d.hitDice ? `d${d.hitDice}` : '—')], ['statVD', 'Vitality die', d => (d.vitalityDice ? `d${d.vitalityDice}` : '—')],
    ['statSpeed', 'Speed', d => d.speed],
    ['statSTR', 'STR', d => d.stats.str], ['statDEX', 'DEX', d => d.stats.dex], ['statCON', 'CON', d => d.stats.con],
    ['statINT', 'INT', d => d.stats.int], ['statWIS', 'WIS', d => d.stats.wis], ['statCHA', 'CHA', d => d.stats.cha],
    ['statSaves', 'Saving throws', d => d.savingThrows || '—'], ['statSkills', 'Skills', d => d.skills || '—'],
  ]],
  ['Abilities', [
    // (a 4th entry `true` = the value is already HTML)
    ['primaryAbility', 'Primary', d => abilityText(d, 0), true], ['secondaryAbility', 'Secondary', d => abilityText(d, 1), true],
    ['hiddenAbility', 'Hidden', d => abilityText(d, 2), true],
  ]],
  ['Senses', [
    ['senseSight', 'Sight', d => d.senses.sight], ['senseHearing', 'Hearing', d => d.senses.hearing], ['senseSmell', 'Smell', d => d.senses.smell],
    ['senseTremorsense', 'Tremorsense', d => d.senses.tremorsense], ['senseEcholocation', 'Echolocation', d => d.senses.echolocation],
    ['senseTelepathy', 'Telepathy', d => d.senses.telepathy], ['senseBlindsight', 'Blindsight', d => d.senses.blindsight],
    ['senseDarkvision', 'Darkvision', d => d.senses.darkvision], ['senseTruesight', 'Truesight', d => d.senses.truesight],
  ]],
  ['Evolution', [
    ['evoFrom', 'Evolves from', d => d.evolvesFrom || '—'],
    ['evoTo', 'Evolves into', d => (d.evolvesTo.length ? d.evolvesTo.join(', ') : '—')],
  ]],
];
const BOOL_KEYS = GROUPS.flatMap(([, rows]) => rows.map(r => r[0])).concat('moves');

/** What a species gets when there's nothing at all to go on -- the same fallback js/utils/visibility.js uses. */
function fallbackSettings() {
  return { ...Object.fromEntries(BOOL_KEYS.map(k => [k, false])), description: true, evoToTargets: {}, movesMaxLevel: 1, extraVisibleMoves: [] };
}

function abilityText(d, slot) {
  const a = d.abilities.find(x => x.slot === slot);
  return a ? `<strong>${escapeHtml(a.name)}</strong> -- ${escapeHtml(a.description)}` : '—';
}

let _root = null;
let _config = null;
let _species = [];
let _selected = null;
let _filter = 'all';
let _saveTimer = null;
let _saveState = 'saved';
const _details = new Map();

export async function renderPokedex(root) {
  _root = root;
  root.innerHTML = '<div class="dm-loading">Loading the Pokédex…</div>';
  try {
    const [cfg, species] = await Promise.all([DmAPI.pokedexConfig(), getSpecies()]);
    _config = cfg.data || {};
    _species = species;
  } catch (err) {
    root.innerHTML = `<div class="dm-loading">Couldn't load the Pokédex: ${escapeHtml(err.message)}</div>`;
    return;
  }
  _config.registered = _config.registered || [];
  _config.visibility = _config.visibility || {};

  root.innerHTML = `
    <div class="dm-editor">
      <aside class="dm-editor-tools">
        <div class="dm-editor-head"><h2>Pokédex</h2><span class="dm-pill ok" id="pdxSave">All saved</span></div>
        <div class="dm-hint">Tick what the players get to see. Changes save on their own and reach the players straight away.</div>
        <input class="dm-input" id="pdxSearch" placeholder="Search name, type or habitat…" autocomplete="off">
        <div class="dm-seg" id="pdxFilter">
          <button data-f="all" class="active">All</button><button data-f="in">In players' Pokédex</button><button data-f="out">Not yet</button>
        </div>
        <div class="dm-pdx-bulk"><button class="dm-btn small" id="pdxAddListed">Add all listed</button><button class="dm-btn small" id="pdxRemoveListed">Remove all listed</button></div>
        <button class="dm-pdx-row dm-pdx-defaults" data-name="${DEFAULTS}"><span>⚙</span><span><strong>Default settings</strong><small>For every Pokémon without its own</small></span></button>
        <button class="dm-pdx-row dm-pdx-defaults" data-name="${MOVES}"><span>🔍</span><span><strong>Searchable moves</strong><small>Moves the players can look up</small></span></button>
        <div class="dm-pdx-list" id="pdxList"></div>
      </aside>
      <section class="dm-editor-canvas" id="pdxDetail"><div class="dm-cs-empty">Pick a Pokémon on the left.</div></section>
    </div>`;

  renderList();
  document.getElementById('pdxSearch').addEventListener('input', applyFilter);
  document.getElementById('pdxFilter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    _filter = b.dataset.f;
    document.querySelectorAll('#pdxFilter [data-f]').forEach(x => x.classList.toggle('active', x === b));
    applyFilter();
  });
  root.querySelector('.dm-editor-tools').addEventListener('click', (e) => {
    const row = e.target.closest('[data-name]');
    if (row) select(row.dataset.name);
  });
  document.getElementById('pdxAddListed').addEventListener('click', () => setListedRegistered(true));
  document.getElementById('pdxRemoveListed').addEventListener('click', () => setListedRegistered(false));
  if (_selected) select(_selected);
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

function isRegistered(name) {
  const lower = name.toLowerCase();
  return _config.registered.some(n => String(n).toLowerCase() === lower);
}

function ownSettings(name) {
  return _config.visibility[name.toLowerCase()] || null;
}

function renderList() {
  const box = document.getElementById('pdxList');
  box.innerHTML = _species.map(s => `
    <button class="dm-pdx-row" data-name="${escapeHtml(s.name)}" data-search="${escapeHtml(`${s.name} ${s.type1} ${s.type2} ${s.habitat}`.toLowerCase())}">
      <span class="dm-pdx-thumb" data-img="${escapeHtml(s.image)}"></span>
      <span class="dm-pdx-main"><strong>#${escapeHtml(s.dex)} ${escapeHtml(s.name)}</strong><small>${typeBadges(s.type1, s.type2)}</small></span>
      <span class="dm-pdx-flags"></span>
    </button>`).join('');
  box.querySelectorAll('[data-img]').forEach(el => { if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); else el.innerHTML = '<img src="assets/Pokeball.png" alt="" style="opacity:.3">'; });
  refreshListFlags();
  applyFilter();
}

/** The little markers on each row -- in the players' Pokedex (👁) and has its own settings (✎) -- updated in place. */
function refreshListFlags() {
  document.querySelectorAll('#pdxList [data-name]').forEach(row => {
    const name = row.dataset.name;
    const reg = isRegistered(name);
    row.classList.toggle('registered', reg);
    row.querySelector('.dm-pdx-flags').innerHTML = `${reg ? '<span title="In the players\' Pokédex">👁</span>' : ''}${ownSettings(name) ? '<span title="Has its own settings">✎</span>' : ''}`;
  });
}

function applyFilter() {
  const q = (document.getElementById('pdxSearch')?.value || '').trim().toLowerCase();
  document.querySelectorAll('#pdxList [data-name]').forEach(row => {
    const reg = row.classList.contains('registered');
    const show = (!q || row.dataset.search.includes(q)) && (_filter === 'all' || (_filter === 'in' ? reg : !reg));
    row.hidden = !show;
  });
}

/** Puts every Pokemon the list shows right now (search + filter) into the players' Pokedex, or takes them all out. */
async function setListedRegistered(on) {
  const names = [...document.querySelectorAll('#pdxList [data-name]')].filter(r => !r.hidden && r.classList.contains('registered') !== on).map(r => r.dataset.name);
  if (!names.length) return;
  const text = on ? `Add ${names.length} Pokémon to the players' Pokédex?` : `Take ${names.length} Pokémon out of the players' Pokédex?`;
  if (!await showCombatConfirm(text, { title: on ? 'Add all listed' : 'Remove all listed', yesLabel: on ? 'Add' : 'Remove', noLabel: 'Cancel' })) return;
  const lower = new Set(names.map(n => n.toLowerCase()));
  _config.registered = _config.registered.filter(n => !lower.has(String(n).toLowerCase()));
  if (on) _config.registered.push(...names);
  scheduleSave();
  refreshListFlags();
  applyFilter();
  if (_selected && lower.has(_selected.toLowerCase())) renderDetail();
}

// ---------------------------------------------------------------------------
// The detail page
// ---------------------------------------------------------------------------

async function select(name) {
  _selected = name;
  document.querySelectorAll('.dm-editor-tools [data-name]').forEach(r => r.classList.toggle('selected', r.dataset.name === name));
  const box = document.getElementById('pdxDetail');
  if (name === DEFAULTS) { renderDetail(); return; }
  if (name === MOVES) { renderMovesPage(); return; }
  if (!_details.has(name)) {
    box.innerHTML = '<div class="dm-loading">Loading…</div>';
    try {
      _details.set(name, (await DmAPI.speciesDetail(name)).data);
    } catch (err) {
      box.innerHTML = `<div class="dm-loading">Couldn't load ${escapeHtml(name)}: ${escapeHtml(err.message)}</div>`;
      return;
    }
    if (_selected !== name) return;
  }
  renderDetail();
}

/** The switches in force for `name`: its own, or the defaults (or the fallback when there are no defaults either). */
function effectiveSettings(name) {
  if (name === DEFAULTS) return { ...fallbackSettings(), ...(_config.defaults || {}) };
  return { ...fallbackSettings(), ...(ownSettings(name) || _config.defaults || {}) };
}

/** Changes `name`'s switches -- a species without its own settings gets a copy of the defaults first. */
function editSettings(name, fn) {
  if (name === DEFAULTS) {
    _config.defaults = { ...fallbackSettings(), ...(_config.defaults || {}) };
    fn(_config.defaults);
  } else {
    const key = name.toLowerCase();
    if (!_config.visibility[key]) {
      // A copy of what it showed until now -- except evolution targets, which are its own (the defaults carry other
      // species' targets): each of its targets starts as "Evolves into" itself was.
      const copy = JSON.parse(JSON.stringify(effectiveSettings(name)));
      copy.evoToTargets = Object.fromEntries((_details.get(name)?.evolvesTo || []).map(t => [t, !!copy.evoTo]));
      _config.visibility[key] = copy;
    }
    fn(_config.visibility[key]);
  }
  scheduleSave();
  refreshListFlags();
}

function renderDetail() {
  const box = document.getElementById('pdxDetail');
  const name = _selected;
  const isDefaults = name === DEFAULTS;
  const d = isDefaults ? null : _details.get(name);
  const v = effectiveSettings(name);
  const own = !isDefaults && !!ownSettings(name);
  const check = (key, label, value) => `
    <label class="dm-pdx-field${v[key] ? ' on' : ''}">
      <input type="checkbox" data-key="${key}" ${v[key] ? 'checked' : ''}>
      <span class="dm-pdx-label">${label}</span>
      ${isDefaults ? '' : `<span class="dm-pdx-value">${value ?? '—'}</span>`}
    </label>`;
  const groupHtml = ([title, rows]) => `
    <div class="dm-pdx-group">
      <div class="dm-pdx-group-head"><span>${title}</span>
        <span><button class="dm-btn small" data-all="${rows.map(r => r[0]).join(',')}">All</button><button class="dm-btn small" data-none="${rows.map(r => r[0]).join(',')}">None</button></span></div>
      ${rows.map(([key, label, value, isHtml]) => check(key, label, isDefaults ? '' : (isHtml ? value(d) : escapeHtml(value(d))))).join('')}
      ${title === 'Evolution' ? evoTargetsHtml(d, v) : ''}
    </div>`;

  box.innerHTML = `
    <div class="dm-pdx-head">
      ${isDefaults ? '<span class="dm-pdx-big">⚙</span>' : '<span class="dm-pdx-big" id="pdxThumb"></span>'}
      <div class="dm-pdx-title">
        <h3 class="dm-cs-title">${isDefaults ? 'Default settings' : `#${escapeHtml(d.dex)} ${escapeHtml(d.name)}`}</h3>
        <div class="dm-species-meta">${isDefaults ? 'What the players see of a Pokémon that has no settings of its own.'
          : `${escapeHtml(d.classification || '')} · base level ${d.level} · HP ${escapeHtml(d.hp)} · VP ${escapeHtml(d.vp)} · catch difficulty ${escapeHtml(d.catchDifficulty || '—')} <small>(DM only)</small>`}</div>
        ${isDefaults ? '' : `
          <div class="dm-pdx-head-row">
            <label class="dm-pdx-reg"><input type="checkbox" id="pdxRegistered" ${isRegistered(name) ? 'checked' : ''}> In the players' Pokédex</label>
            <span class="dm-pill ${own ? 'ok' : 'todo'}">${own ? 'Own settings' : 'Using the defaults'}</span>
            ${own ? '<button class="dm-btn small" id="pdxBackToDefaults">Back to defaults</button>' : ''}
          </div>`}
      </div>
      <div class="dm-pdx-quick"><button class="dm-btn small" id="pdxShowAll">Show everything</button><button class="dm-btn small" id="pdxHideAll">Hide everything</button></div>
    </div>
    <div class="dm-pdx-groups">
      ${GROUPS.map(groupHtml).join('')}
      ${movesHtml(d, v, isDefaults)}
    </div>`;

  if (!isDefaults && d.image) patchPortraitMedia(document.getElementById('pdxThumb'), d.image, d.name);
  wireDetail(name, d);
}

/** The per-target switches under "Evolves into" -- the evolution page offers a target only when it's ticked here. */
function evoTargetsHtml(d, v) {
  if (!d) return ''; // the defaults: targets are always a species' own
  // Its own evolution targets, plus any its OWN settings already name (not the defaults', which are other species').
  const own = ownSettings(d.name)?.evoToTargets || {};
  const targets = [...new Set([...(d.evolvesTo || []), ...Object.keys(own)])];
  if (!targets.length) return '';
  v = { ...v, evoToTargets: ownSettings(d.name) ? own : Object.fromEntries(targets.map(t => [t, !!v.evoTo])) };
  return `<div class="dm-pdx-sub">Evolution targets the players can see
    ${targets.map(t => `<label class="dm-pdx-field small${v.evoToTargets?.[t] ? ' on' : ''}"><input type="checkbox" data-evo="${escapeHtml(t)}" ${v.evoToTargets?.[t] ? 'checked' : ''}><span class="dm-pdx-label">${escapeHtml(t)}</span></label>`).join('')}
  </div>`;
}

/** Moves: shown at all, up to which level, and extra ones beyond it (extraVisibleMoves). */
function movesHtml(d, v, isDefaults) {
  const extras = new Set(v.extraVisibleMoves || []);
  const levels = isDefaults ? [] : Object.entries(d.moves).filter(([, list]) => list.length);
  return `
    <div class="dm-pdx-group dm-pdx-moves">
      <div class="dm-pdx-group-head"><span>Moves</span></div>
      <label class="dm-pdx-field${v.moves ? ' on' : ''}"><input type="checkbox" data-key="moves" ${v.moves ? 'checked' : ''}><span class="dm-pdx-label">Show moves</span>
        <span class="dm-pdx-value">up to level <input class="dm-input dm-pdx-level" id="pdxMovesLevel" type="number" min="1" max="20" value="${v.movesMaxLevel ?? 1}"></span></label>
      ${levels.map(([lvl, list]) => {
        const shown = v.moves && Number(lvl) <= (v.movesMaxLevel ?? 1);
        return `<div class="dm-pdx-movelevel${shown ? ' on' : ''}"><span class="dm-pdx-lv">Lv ${lvl}</span>
          ${list.map(m => shown
            ? `<span class="dm-pdx-move on">✓ ${escapeHtml(m)}</span>`
            : `<label class="dm-pdx-move${extras.has(m) ? ' on' : ''}" title="Show this one anyway"><input type="checkbox" data-extra="${escapeHtml(m)}" ${extras.has(m) ? 'checked' : ''}>${escapeHtml(m)}</label>`).join('')}
        </div>`;
      }).join('')}
      ${isDefaults ? '' : '<div class="dm-hint">Moves above the level are hidden -- tick one to show it anyway.</div>'}
    </div>`;
}

function wireDetail(name, d) {
  const box = document.getElementById('pdxDetail');
  box.querySelectorAll('[data-key]').forEach(cb => cb.addEventListener('change', () => {
    editSettings(name, s => { s[cb.dataset.key] = cb.checked; });
    if (cb.dataset.key === 'moves') renderDetail(); else cb.closest('.dm-pdx-field')?.classList.toggle('on', cb.checked);
  }));
  box.querySelectorAll('[data-evo]').forEach(cb => cb.addEventListener('change', () => {
    editSettings(name, s => { s.evoToTargets = { ...(s.evoToTargets || {}), [cb.dataset.evo]: cb.checked }; });
    cb.closest('.dm-pdx-field')?.classList.toggle('on', cb.checked);
  }));
  box.querySelectorAll('[data-extra]').forEach(cb => cb.addEventListener('change', () => {
    editSettings(name, s => {
      const list = new Set(s.extraVisibleMoves || []);
      if (cb.checked) list.add(cb.dataset.extra); else list.delete(cb.dataset.extra);
      s.extraVisibleMoves = [...list];
    });
    cb.closest('.dm-pdx-move')?.classList.toggle('on', cb.checked);
  }));
  const setMany = (keys, on) => { editSettings(name, s => { keys.forEach(k => { s[k] = on; }); }); renderDetail(); };
  box.querySelectorAll('[data-all]').forEach(b => b.addEventListener('click', () => setMany(b.dataset.all.split(','), true)));
  box.querySelectorAll('[data-none]').forEach(b => b.addEventListener('click', () => setMany(b.dataset.none.split(','), false)));
  document.getElementById('pdxShowAll').addEventListener('click', () => {
    editSettings(name, s => {
      BOOL_KEYS.forEach(k => { s[k] = true; });
      s.movesMaxLevel = 20;
      if (d) s.evoToTargets = Object.fromEntries((d.evolvesTo || []).map(t => [t, true]));
    });
    renderDetail();
  });
  document.getElementById('pdxHideAll').addEventListener('click', () => {
    editSettings(name, s => {
      BOOL_KEYS.forEach(k => { s[k] = false; });
      s.extraVisibleMoves = [];
      s.evoToTargets = Object.fromEntries(Object.keys(s.evoToTargets || {}).map(t => [t, false]));
    });
    renderDetail();
  });
  document.getElementById('pdxMovesLevel').addEventListener('change', (e) => {
    const lvl = Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1));
    editSettings(name, s => { s.movesMaxLevel = lvl; });
    renderDetail();
  });
  document.getElementById('pdxRegistered')?.addEventListener('change', (e) => {
    const lower = name.toLowerCase();
    _config.registered = _config.registered.filter(n => String(n).toLowerCase() !== lower);
    if (e.target.checked) _config.registered.push(name);
    scheduleSave();
    refreshListFlags();
    applyFilter();
  });
  document.getElementById('pdxBackToDefaults')?.addEventListener('click', async () => {
    if (!await showCombatConfirm(`Drop ${name}'s own settings? It goes back to showing what the default settings show.`, { title: 'Back to defaults', yesLabel: 'Use defaults', noLabel: 'Cancel' })) return;
    delete _config.visibility[name.toLowerCase()];
    scheduleSave();
    refreshListFlags();
    renderDetail();
  });
}

// ---------------------------------------------------------------------------
// Searchable moves
// ---------------------------------------------------------------------------

/** Every move with a tick for "the players can look it up". The ones a species in their Pokedex already shows are
 * searchable anyway (ticked and greyed); the others are the DM's own picks (extraSearchableMoves). */
async function renderMovesPage() {
  const box = document.getElementById('pdxDetail');
  box.innerHTML = '<div class="dm-loading">Loading…</div>';
  let overview;
  try {
    if (pokedexHasUnsaved()) await saveNow(); // what the species show comes from the saved settings
    overview = (await DmAPI.pokedexSearchable()).data;
  } catch (err) {
    box.innerHTML = `<div class="dm-loading">Couldn't load the moves: ${escapeHtml(err.message)}</div>`;
    return;
  }
  if (_selected !== MOVES) return;
  const via = new Set(overview.viaPokemon.map(n => n.toLowerCase()));
  const picked = () => new Set((_config.extraSearchableMoves || []).map(n => String(n).toLowerCase()));
  const count = () => new Set([...via, ...picked()]).size;
  const extra = picked();
  box.innerHTML = `
    <div class="dm-pdx-head dm-pdx-head-plain">
      <span class="dm-pdx-big">🔍</span>
      <div class="dm-pdx-title">
        <h3 class="dm-cs-title">Searchable moves</h3>
        <div class="dm-species-meta">The players can look these up in their Pokédex. Moves a Pokémon in their Pokédex shows are always included. <strong id="pdxMoveCount">${count()}</strong> searchable.</div>
      </div>
    </div>
    <input class="dm-input" id="pdxMoveFilter" placeholder="Filter by name or type…" autocomplete="off">
    <div class="dm-pdx-movegrid" id="pdxMoveGrid">
      ${overview.moves.map((m) => {
        const lower = m.name.toLowerCase();
        const fromMon = via.has(lower);
        const on = fromMon || extra.has(lower);
        return `<label class="dm-pdx-move${on ? ' on' : ''}${fromMon ? ' via' : ''}" data-search="${escapeHtml(`${m.name} ${m.type}`.toLowerCase())}"${fromMon ? ' title="A Pokémon in their Pokédex shows it"' : ''}>
          <input type="checkbox" data-searchable="${escapeHtml(m.name)}" ${on ? 'checked' : ''} ${fromMon ? 'disabled' : ''}>${escapeHtml(m.name)}<small>${escapeHtml(m.type)}</small></label>`;
      }).join('')}
    </div>`;
  document.getElementById('pdxMoveFilter').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    box.querySelectorAll('#pdxMoveGrid [data-search]').forEach((el) => { el.hidden = !!q && !el.dataset.search.includes(q); });
  });
  box.querySelectorAll('[data-searchable]').forEach(cb => cb.addEventListener('change', () => {
    const name = cb.dataset.searchable;
    const rest = (_config.extraSearchableMoves || []).filter(n => String(n).toLowerCase() !== name.toLowerCase());
    _config.extraSearchableMoves = cb.checked ? [...rest, name] : rest;
    cb.closest('.dm-pdx-move').classList.toggle('on', cb.checked);
    document.getElementById('pdxMoveCount').textContent = count();
    scheduleSave();
  }));
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

function setSaveState(state) {
  _saveState = state;
  const pill = document.getElementById('pdxSave');
  if (!pill) return;
  pill.className = `dm-pill ${state === 'saved' ? 'ok' : 'todo'}`;
  pill.textContent = state === 'saved' ? 'All saved' : state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved!' : 'Unsaved changes';
}

function scheduleSave() {
  setSaveState('pending');
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveNow, 700);
}

async function saveNow() {
  clearTimeout(_saveTimer);
  setSaveState('saving');
  try {
    await DmAPI.savePokedexConfig(_config);
    setSaveState('saved');
  } catch (err) {
    setSaveState('error');
    showCombatAlert(err.message, { title: "Couldn't save the Pokédex settings" });
  }
}

/** True while there are changes not yet on the Pi (dm-console.js asks before leaving the page). */
export function pokedexHasUnsaved() {
  return _saveState === 'pending' || _saveState === 'saving';
}
