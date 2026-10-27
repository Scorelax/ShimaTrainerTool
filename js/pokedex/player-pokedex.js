// The players' Pokedex -- Benjakronk's Shima Pokedex site, built into the app: search and filter the Pokemon in the
// shared pokedex, open a card's Info / Stats / Abilities / Senses / Evolution / Moves, and look up moves by name, type
// or Pokemon. What a player gets to see is decided in the DM console's Pokedex module; the Pi only ever sends what's
// switched on (pi-server/app/player_pokedex.py), and every change the DM saves re-renders this at once
// ('app:pokedex-config', from the live-update stream), keeping the search, the page and the open tabs.
//
// Self-contained so it can live in its own page (pokedex.html) or be mounted inside the player app later:
// mountPlayerPokedex(root, { onBack }) -- onBack adds a back button to the header. Styles: css/pokedex.css (.pdx-*).
import { GameDataAPI } from '../api.js';
import { dexQuery } from '../utils/dex-search.js';
import { lazySprites } from '../utils/sprite-media.js';

const TYPE_COLORS = {
  normal: '#A8A878', fire: '#F08030', water: '#6890F0', electric: '#F8D030', grass: '#78C850', ice: '#98D8D8',
  fighting: '#C03028', poison: '#A040A0', ground: '#E0C068', flying: '#A890F0', psychic: '#F85888', bug: '#A8B820',
  rock: '#B8A038', ghost: '#705898', dragon: '#7038F8', dark: '#705848', steel: '#B8B8D0', fairy: '#EE99AC',
  cosmic: '#2E1F5E',
};
// The Moves view's order: by type (this order, unlisted types after), then by name.
const TYPE_ORDER = ['grass', 'fire', 'water', 'normal', 'electric', 'ice', 'fighting', 'poison', 'ground', 'flying',
  'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy', 'cosmic'];
const RESULTS_PER_PAGE = 10;
// A search that leaves this many moves or fewer shows them opened.
const MOVES_OPEN_MAX = 3;
const LEVEL_TITLES = { 1: 'Starting Moves', 2: 'Level 2', 6: 'Level 6', 10: 'Level 10', 14: 'Level 14', 18: 'Level 18' };
// [filter id, label, where the value is, the "any" option]
const FILTERS = [
  ['type', 'Type', s => [s.primaryType, s.secondaryType], 'All Types'],
  ['size', 'Size', s => [infoValue(s, 'charSize')], 'All Sizes'],
  ['rarity', 'Rarity', s => [infoValue(s, 'charRarity')], 'All Rarities'],
  ['behavior', 'Behavior', s => [infoValue(s, 'charBehavior')], 'All Behaviors'],
  ['habitat', 'Habitat', s => [infoValue(s, 'charHabitat')], 'All Habitats'],
  ['activity', 'Activity', s => [infoValue(s, 'charActivity')], 'All Activities'],
];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const typeColor = t => TYPE_COLORS[String(t || '').toLowerCase()] || '#68A090';
const typeKey = t => String(t || '').toLowerCase();
const typeRank = (t) => { const i = TYPE_ORDER.indexOf(typeKey(t)); return i < 0 ? TYPE_ORDER.length : i; };
const byTypeThenName = (a, b) => typeRank(a.type) - typeRank(b.type) || typeKey(a.type).localeCompare(typeKey(b.type))
  || String(a.name).localeCompare(String(b.name));
function rgba(hex, alpha) {
  const n = parseInt(String(hex).slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
function infoValue(s, key) { return s.info.find(i => i.key === key)?.value || ''; }

export function mountPlayerPokedex(root, { onBack } = {}) {
  const state = {
    data: { species: [], moves: [] },
    moveByName: new Map(),
    view: 'pokedex',
    page: 1,
    openTabs: new Map(),        // species name -> open card tab
    expandedMoves: new Set(),   // `${species}|${move}` opened in a card's Moves tab
    moveType: '',               // the Moves view's type key ('' = every type)
    openMoves: new Set(),       // moves opened in the Moves view (lowercase names)
  };

  root.classList.add('pdx');
  root.innerHTML = `
    <header class="pdx-header">
      <div class="pdx-lid">
        <div class="pdx-header-row">
          ${onBack ? '<button class="pdx-back" data-act="back" aria-label="Back">←</button>' : ''}
          <span class="pdx-lens" aria-hidden="true"></span>
          <span class="pdx-lights" aria-hidden="true"><i></i><i></i><i></i></span>
          <h1 class="pdx-title">Shima Pokédex</h1>
        </div>
        <nav class="pdx-nav">
          <button class="pdx-nav-tab active" data-view="pokedex">Pokédex</button>
          <button class="pdx-nav-tab" data-view="moves">Moves</button>
        </nav>
      </div>
    </header>
    <main class="pdx-main">
      <div class="pdx-view active" data-view-panel="pokedex">
        <div class="pdx-search"><input type="text" id="pdxSearch" placeholder="Search by name, type, or #..." autocomplete="off"></div>
        <div class="pdx-filters">${FILTERS.map(([id, label]) => `<select data-filter="${id}"><option value="">${label}</option></select>`).join('')}</div>
        <div class="pdx-results" id="pdxResults"><p class="pdx-placeholder">Loading the Pokédex…</p></div>
      </div>
      <div class="pdx-view" data-view-panel="moves">
        <div class="pdx-search">
          <input type="text" id="pdxMoveSearch" placeholder="Search move or Pokémon name..." autocomplete="off">
          <label class="pdx-level"><span>Lv</span><input type="number" id="pdxMoveLevel" min="1" max="20" value="20"></label>
        </div>
        <div class="pdx-type-keys" id="pdxTypeKeys"></div>
        <div class="pdx-results" id="pdxMoveResults"></div>
      </div>
    </main>
    <div class="pdx-toast" id="pdxToast"></div>`;

  const $ = sel => root.querySelector(sel);

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------

  async function load() {
    root.classList.add('pdx-busy'); // the lens blinks while it fetches
    try {
      const res = await GameDataAPI.getPlayerPokedex();
      if (res?.status !== 'success' || !res.data) throw new Error(res?.error || res?.message || 'No data');
      state.data = res.data;
      state.moveByName = new Map(res.data.moves.map(m => [String(m.name).toLowerCase(), m]));
      fillFilters();
      renderPokemon();
      renderTypeKeys();
      renderMoves();
    } finally {
      root.classList.remove('pdx-busy');
    }
  }

  // One fetch at a time; a change that arrives while one is running gets one more fetch after it (that running one may
  // have been answered before the change was saved).
  let refreshing = null;
  let again = false;
  async function refresh() {
    if (refreshing) { again = true; return refreshing; }
    refreshing = (async () => {
      do {
        again = false;
        await load().catch((err) => toast(`Couldn't update the Pokédex: ${err.message}`, 'error'));
      } while (again);
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  // ---------------------------------------------------------------------------
  // Pokedex view
  // ---------------------------------------------------------------------------

  function fillFilters() {
    root.querySelectorAll('[data-filter]').forEach((select) => {
      const [, , values, anyLabel] = FILTERS.find(f => f[0] === select.dataset.filter);
      const options = [...new Set(state.data.species.flatMap(values).filter(Boolean))].sort();
      const current = select.value;
      select.innerHTML = `<option value="">${anyLabel}</option>`
        + options.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
      select.value = options.includes(current) ? current : '';
    });
  }

  function matches(s) {
    for (const select of root.querySelectorAll('[data-filter]')) {
      if (select.value && !FILTERS.find(f => f[0] === select.dataset.filter)[2](s).includes(select.value)) return false;
    }
    const term = $('#pdxSearch').value.trim().toLowerCase();
    if (!term) return true;
    const dex = dexQuery(term);
    if (dex) return dex.all || dex.number === Number(s.dex);
    return s.name.toLowerCase().includes(term)
      || String(s.primaryType || '').toLowerCase().includes(term)
      || String(s.secondaryType || '').toLowerCase().includes(term);
  }

  function renderPokemon() {
    const box = $('#pdxResults');
    const results = state.data.species.filter(matches);
    if (!state.data.species.length) {
      box.innerHTML = '<p class="pdx-placeholder">No Pokémon in the Pokédex yet.</p>';
      return;
    }
    if (!results.length) {
      box.innerHTML = '<p class="pdx-placeholder">No Pokémon found. Try different search terms or filters.</p>';
      return;
    }
    const pages = Math.ceil(results.length / RESULTS_PER_PAGE);
    state.page = Math.min(Math.max(1, state.page), pages);
    const start = (state.page - 1) * RESULTS_PER_PAGE;
    const shown = results.slice(start, start + RESULTS_PER_PAGE);
    box.innerHTML = `
      <p class="pdx-results-info">Showing ${start + 1}-${start + shown.length} of ${results.length}</p>
      ${shown.map(cardHtml).join('')}
      ${pages > 1 ? `
        <div class="pdx-pagination">
          <button class="pdx-pad" data-page="prev" aria-label="Previous page" ${state.page === 1 ? 'disabled' : ''}>◀</button>
          <span class="pdx-lcd">Page ${state.page} / ${pages}</span>
          <button class="pdx-pad" data-page="next" aria-label="Next page" ${state.page === pages ? 'disabled' : ''}>▶</button>
        </div>` : ''}`;
    // the pictures: each loaded as it scrolls into view, its sprite (the Pi's small copy) playing only while it's seen
    lazySprites(box, { empty: '<div class="pdx-no-image">?</div>', small: true });
  }


  // The picture's screen glows in the Pokemon's type colour(s).
  function screenBg(s) {
    const [first, second] = [s.primaryType, s.dualType ? s.secondaryType : ''].filter(Boolean).map(t => rgba(typeColor(t), 0.5));
    if (!first) return '';
    return second
      ? `background: radial-gradient(circle at 25% 30%, ${first}, transparent 65%), radial-gradient(circle at 75% 75%, ${second}, transparent 65%), var(--pdx-screen)`
      : `background: radial-gradient(circle at 50% 55%, ${first}, transparent 70%), var(--pdx-screen)`;
  }

  function cardHtml(s) {
    const dex = /^\d+$/.test(String(s.dex)) ? String(s.dex).padStart(3, '0') : s.dex;
    const types = [s.primaryType, s.secondaryType].filter(Boolean)
      .map(t => `<span class="pdx-type-pill" style="background:${typeColor(t)}">${esc(t)}</span>`).join('')
      || '<span class="pdx-type-pill unknown">Unknown</span>';

    const tabs = cardTabs(s);
    const open = tabs.some(t => t.id === state.openTabs.get(s.name)) ? state.openTabs.get(s.name) : null;
    return `
      <div class="pdx-card" data-species="${esc(s.name)}">
        <div class="pdx-card-header">
          <div class="pdx-bezel"><div class="pdx-card-image" style="${screenBg(s)}" data-img="${esc(s.image || '')}"></div></div>
          <div class="pdx-card-info">
            <span class="pdx-card-number">No. ${esc(dex)}</span>
            <h2 class="pdx-card-name">${esc(s.name)}${s.caught ? '<img class="pdx-caught-ball" src="assets/Pokeball.png" alt="Caught" title="Caught by the players">' : ''}</h2>
            <div class="pdx-card-types">${types}</div>
            ${s.classification ? `<p class="pdx-card-classification">${esc(s.classification)}</p>` : ''}
          </div>
        </div>
        ${s.flavor ? `<p class="pdx-card-flavor">${esc(s.flavor)}</p>` : ''}
        ${tabs.length ? `
          <div class="pdx-card-tabs">
            <div class="pdx-tab-bar" style="--keys:${tabs.length}">${tabs.map(t => `<button class="pdx-tab-btn${t.id === open ? ' active' : ''}" data-tab="${t.id}"><span class="pdx-tab-icon">${t.icon}</span><span class="pdx-tab-label">${t.label}</span></button>`).join('')}${'<span class="pdx-key-blank"></span>'.repeat((3 - (tabs.length % 3)) % 3)}</div>
            <div class="pdx-tab-panels${open ? ' open' : ''}">${tabs.map(t => `<div class="pdx-tab-panel${t.id === open ? ' active' : ''}" data-panel="${t.id}"><div class="pdx-tab-inner">${t.html}</div></div>`).join('')}</div>
          </div>` : ''}
      </div>`;
  }

  function cardTabs(s) {
    const tabs = [];
    if (s.info.length) {
      tabs.push({ id: 'info', label: 'Info', icon: '📋', html: `<div class="pdx-char-grid">${s.info.map(i => `<div class="pdx-char-item"><span class="pdx-char-label">${esc(i.label)}</span><span class="pdx-char-value">${esc(i.value)}</span></div>`).join('')}</div>` });
    }
    if (s.combat.length || s.scores.length || s.saves || s.skills) {
      tabs.push({ id: 'stats', label: 'Stats', icon: '📊', html: `
        ${s.combat.length ? `<div class="pdx-combat-stats">${s.combat.map(c => `<div class="pdx-combat-stat"><span class="pdx-combat-value">${esc(c.value)}</span><span class="pdx-combat-label">${esc(c.label)}</span></div>`).join('')}</div>` : ''}
        ${s.scores.length ? `<div class="pdx-scores">${s.scores.map(c => `<div class="pdx-score"><span class="pdx-score-value">${esc(c.value)}</span><span class="pdx-score-label">${esc(c.label)}</span></div>`).join('')}</div>` : ''}
        ${s.saves ? `<p class="pdx-stat-extra"><strong>Saves:</strong> ${esc(s.saves)}</p>` : ''}
        ${s.skills ? `<p class="pdx-stat-extra"><strong>Skills:</strong> ${esc(s.skills)}</p>` : ''}` });
    }
    if (s.abilities.length) {
      tabs.push({ id: 'abilities', label: 'Abilities', icon: '🌀', html: `<div class="pdx-ability-list">${s.abilities.map(a => `
        <div class="pdx-ability-card${a.hidden ? ' hidden-ability' : ''}">
          <div class="pdx-ability-header"><span class="pdx-ability-name">${esc(a.name)}</span>${a.hidden ? '<span class="pdx-ability-tag">Hidden</span>' : ''}</div>
          <p class="pdx-ability-desc">${esc(a.description)}</p>
        </div>`).join('')}</div>` });
    }
    if (s.senses.length) {
      tabs.push({ id: 'senses', label: 'Senses', icon: '👁️', html: `<div class="pdx-sense-list">${s.senses.map(x => `<div class="pdx-sense-row"><span class="pdx-sense-name">${esc(x.label)}</span><span class="pdx-sense-value">${esc(x.value)}</span></div>`).join('')}</div>` });
    }
    const evo = s.evolution;
    if (evo.from || evo.to.length) {
      tabs.push({ id: 'evo', label: 'Evolution', icon: '🔄', html: `<div class="pdx-evo-chain">
        ${evo.from ? `<div class="pdx-evo-item evo-from"><span class="pdx-evo-label">${evo.from.fusion ? 'Fusion from' : 'Evolves from'}</span><span class="pdx-evo-name">${esc(evo.from.name)}</span></div>` : ''}
        ${evo.to.map(t => `<div class="pdx-evo-item evo-to"><span class="pdx-evo-label">Evolves to</span><span class="pdx-evo-name">${esc(t.name)}</span>
          ${(t.requirements || []).length ? `<span class="pdx-evo-req"><span class="pdx-evo-req-label">${t.requirements.length > 1 ? 'Requirements' : 'Requirement'}</span>${t.requirements.map(line => `<span class="pdx-evo-req-line">${esc(line)}</span>`).join('')}</span>` : ''}</div>`).join('')}
      </div>` });
    }
    const movesHtml = s.movesShown ? cardMovesHtml(s) : '';
    if (movesHtml) tabs.push({ id: 'moves', label: 'Moves', icon: '⚔️', html: movesHtml });
    return tabs;
  }

  function cardMovesHtml(s) {
    const groups = Object.keys(LEVEL_TITLES).map((level) => {
      const shown = s.moves.filter(m => String(m.level) === level).map(m => state.moveByName.get(m.name.toLowerCase())).filter(Boolean);
      if (!shown.length) return '';
      const hidden = s.hiddenMoves[level] || 0;
      return `
        <div class="pdx-move-group">
          <div class="pdx-move-group-header">${LEVEL_TITLES[level]}${hidden ? ` <span class="pdx-move-hidden-count">+${hidden}</span>` : ''}</div>
          ${shown.map(m => `
            <div class="pdx-move-entry${state.expandedMoves.has(`${s.name}|${m.name}`) ? ' expanded' : ''}" data-move="${esc(m.name)}">
              <div class="pdx-move-summary">
                <span class="pdx-move-name">${esc(m.name)}</span>
                <span class="pdx-move-tags"><span class="pdx-move-type-tag" style="background:${typeColor(m.type)}">${esc(m.type)}</span><span class="pdx-move-vp-tag">${esc(m.vp)} VP</span></span>
              </div>
              <div class="pdx-move-expand">
                <div class="pdx-move-stats">
                  ${m.power ? `<span><b>Power:</b> ${esc(m.power)}</span>` : ''}
                  <span><b>Time:</b> ${esc(m.time)}</span><span><b>Range:</b> ${esc(m.range)}</span><span><b>Duration:</b> ${esc(m.duration)}</span>
                </div>
                <p class="pdx-move-description">${esc(m.description)}</p>
                ${m.higher ? `<p class="pdx-move-higher"><b>Higher Levels:</b> ${esc(m.higher)}</p>` : ''}
              </div>
            </div>`).join('')}
        </div>`;
    }).join('');
    return groups ? `<div class="pdx-moves-container">${groups}</div>` : '';
  }

  // ---------------------------------------------------------------------------
  // Moves view
  // ---------------------------------------------------------------------------

  function moveRowHtml(m, opened) {
    const open = opened || state.openMoves.has(String(m.name).toLowerCase());
    return `
      <div class="pdx-move-row${open ? ' expanded' : ''}" data-move-row="${esc(m.name)}">
        <button class="pdx-move-row-summary">
          <span class="pdx-move-row-name">${esc(m.name)}</span>
          <span class="pdx-move-vp-tag">${esc(m.vp || '-')} VP</span>
        </button>
        <div class="pdx-move-row-body">
          <div class="pdx-move-card-stats">
            <div class="pdx-move-card-stat"><span>Power</span><span>${esc(m.power || '-')}</span></div>
            <div class="pdx-move-card-stat"><span>Time</span><span>${esc(m.time || '-')}</span></div>
            <div class="pdx-move-card-stat"><span>Range</span><span>${esc(m.range || '-')}</span></div>
            <div class="pdx-move-card-stat"><span>Duration</span><span>${esc(m.duration || '-')}</span></div>
          </div>
          <div class="pdx-move-card-desc">${esc(m.description)}</div>
          ${m.higher ? `<div class="pdx-move-card-higher"><strong>Higher levels:</strong> ${esc(m.higher)}</div>` : ''}
        </div>
      </div>`;
  }

  /** The moves grouped by type (TYPE_ORDER), each group in alphabetical order. */
  function moveGroupsHtml(moves) {
    const opened = moves.length <= MOVES_OPEN_MAX;
    const groups = [];
    [...moves].sort(byTypeThenName).forEach((m) => {
      const last = groups[groups.length - 1];
      if (last && typeKey(last.type) === typeKey(m.type)) last.moves.push(m);
      else groups.push({ type: m.type, moves: [m] });
    });
    return groups.map(g => `
      <section class="pdx-move-type-group" style="--type:${typeColor(g.type)}">
        <h3 class="pdx-move-type-title"><span class="pdx-move-type-led"></span>${esc(g.type || 'Unknown')}<span class="pdx-move-type-count">${g.moves.length}</span></h3>
        <div class="pdx-move-list">${g.moves.map(m => moveRowHtml(m, opened)).join('')}</div>
      </section>`).join('');
  }

  /** The type keys over the move list: every type a move has, in TYPE_ORDER. */
  function renderTypeKeys() {
    const types = [...new Set(state.data.moves.map(m => typeKey(m.type)).filter(Boolean))]
      .sort((a, b) => typeRank(a) - typeRank(b) || a.localeCompare(b));
    if (state.moveType && !types.includes(state.moveType)) state.moveType = '';
    const label = t => esc(state.data.moves.find(m => typeKey(m.type) === t)?.type || t);
    $('#pdxTypeKeys').innerHTML = !types.length ? '' : [
      `<button class="pdx-type-key${state.moveType ? '' : ' active'}" data-move-type="">All</button>`,
      ...types.map(t => `<button class="pdx-type-key${state.moveType === t ? ' active' : ''}" data-move-type="${esc(t)}" style="--type:${typeColor(t)}"><span class="pdx-type-key-led"></span>${label(t)}</button>`),
    ].join('');
  }

  function renderMoves() {
    const box = $('#pdxMoveResults');
    const term = $('#pdxMoveSearch').value.trim().toLowerCase();
    const level = Math.max(1, Math.min(20, parseInt($('#pdxMoveLevel').value, 10) || 20));
    const ofType = list => (state.moveType ? list.filter(m => typeKey(m.type) === state.moveType) : list);
    if (!state.data.moves.length) {
      box.innerHTML = '<p class="pdx-placeholder">No moves to look up yet.</p>';
      return;
    }
    const species = term && state.data.species.find(s => s.name.toLowerCase() === term);
    if (species) {
      if (!species.movesShown) {
        box.innerHTML = `<p class="pdx-placeholder">Move data for <strong>${esc(species.name)}</strong> has not been discovered yet.</p>`;
        return;
      }
      const upTo = Math.min(level, species.movesMaxLevel || 1);
      const names = new Set(species.moves.filter(m => m.extra || m.level <= upTo).map(m => m.name.toLowerCase()));
      const results = ofType(state.data.moves.filter(m => names.has(String(m.name).toLowerCase())));
      box.innerHTML = `<p class="pdx-results-info">${esc(species.name)} · up to Lv ${upTo} · ${results.length} move${results.length === 1 ? '' : 's'}</p>
        ${results.length ? moveGroupsHtml(results) : '<p class="pdx-placeholder">No moves available at this level.</p>'}`;
      return;
    }
    const results = ofType(term
      ? state.data.moves.filter(m => String(m.name).toLowerCase().includes(term) || typeKey(m.type).includes(term))
      : state.data.moves);
    box.innerHTML = results.length
      ? `<p class="pdx-results-info">${results.length} move${results.length === 1 ? '' : 's'}</p>${moveGroupsHtml(results)}`
      : '<p class="pdx-placeholder">No moves found matching that search.</p>';
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  function showView(view) {
    state.view = view;
    root.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    root.querySelectorAll('[data-view-panel]').forEach(p => p.classList.toggle('active', p.dataset.viewPanel === view));
  }

  let toastTimer = null;
  function toast(message, type = 'info') {
    const el = $('#pdxToast');
    el.textContent = message;
    el.className = `pdx-toast ${type} visible`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 3500);
  }

  root.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-act="back"]')) { onBack?.(); return; }
    const nav = t.closest('[data-view]');
    if (nav) { showView(nav.dataset.view); return; }

    const tabBtn = t.closest('.pdx-tab-btn');
    if (tabBtn) {
      const card = tabBtn.closest('.pdx-card');
      const name = card.dataset.species;
      const wasOpen = tabBtn.classList.contains('active');
      card.querySelectorAll('.pdx-tab-btn').forEach(b => b.classList.remove('active'));
      card.querySelectorAll('.pdx-tab-panel').forEach(p => p.classList.remove('active'));
      const panels = card.querySelector('.pdx-tab-panels');
      if (wasOpen) {
        panels.classList.remove('open');
        state.openTabs.delete(name);
      } else {
        tabBtn.classList.add('active');
        card.querySelector(`.pdx-tab-panel[data-panel="${tabBtn.dataset.tab}"]`)?.classList.add('active');
        panels.classList.add('open');
        state.openTabs.set(name, tabBtn.dataset.tab);
      }
      return;
    }

    const summary = t.closest('.pdx-move-summary');
    if (summary) {
      const entry = summary.closest('.pdx-move-entry');
      const key = `${entry.closest('.pdx-card').dataset.species}|${entry.dataset.move}`;
      if (entry.classList.toggle('expanded')) state.expandedMoves.add(key); else state.expandedMoves.delete(key);
      return;
    }

    const typeBtn = t.closest('[data-move-type]');
    if (typeBtn) {
      state.moveType = typeBtn.dataset.moveType;
      root.querySelectorAll('[data-move-type]').forEach(b => b.classList.toggle('active', b === typeBtn));
      renderMoves();
      return;
    }

    const moveRow = t.closest('.pdx-move-row-summary');
    if (moveRow) {
      const row = moveRow.closest('.pdx-move-row');
      const key = row.dataset.moveRow.toLowerCase();
      if (row.classList.toggle('expanded')) state.openMoves.add(key); else state.openMoves.delete(key);
      return;
    }

    const pager = t.closest('[data-page]');
    if (pager && !pager.disabled) {
      state.page += pager.dataset.page === 'next' ? 1 : -1;
      renderPokemon();
      // the page's first entry just under the lid (sticky over the top), not hidden behind it
      const results = $('#pdxResults');
      results.style.scrollMarginTop = `${$('.pdx-header').offsetHeight + 10}px`;
      results.scrollIntoView({ behavior: 'smooth' });
    }
  });

  let searchTimer = null;
  const searchSoon = (fn) => { clearTimeout(searchTimer); searchTimer = setTimeout(fn, 150); };
  $('#pdxSearch').addEventListener('input', () => searchSoon(() => { state.page = 1; renderPokemon(); }));
  root.querySelectorAll('[data-filter]').forEach(s => s.addEventListener('change', () => { state.page = 1; renderPokemon(); }));
  $('#pdxMoveSearch').addEventListener('input', () => searchSoon(renderMoves));
  $('#pdxMoveLevel').addEventListener('input', () => searchSoon(renderMoves));
  root.querySelectorAll('input[type="text"]').forEach(i => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); }));

  // The DM changed what the players may see, or the live connection came back after a gap (whatever was pushed
  // meanwhile is lost): fetch it fresh.
  window.addEventListener('app:pokedex-config', refresh);
  window.addEventListener('app:live-resync', refresh);

  // destroy(): for when it's mounted inside the app and the player leaves it -- stops listening for changes.
  function destroy() {
    window.removeEventListener('app:pokedex-config', refresh);
    window.removeEventListener('app:live-resync', refresh);
    clearTimeout(searchTimer);
    clearTimeout(toastTimer);
  }

  return { ready: load(), refresh, destroy };
}
