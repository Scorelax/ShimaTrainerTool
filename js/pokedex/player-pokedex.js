// The players' Pokedex -- Benjakronk's Shima Pokedex site, built into the app: search and filter the Pokemon in the
// shared pokedex, open a card's Info / Stats / Abilities / Senses / Evolution / Moves, and look up moves by name, type
// or Pokemon. What a player gets to see is decided in the DM console's Pokedex module; the Pi only ever sends what's
// switched on (pi-server/app/player_pokedex.py), and every change the DM saves re-renders this at once
// ('app:pokedex-config', from the live-update stream), keeping the search, the page and the open tabs.
//
// Self-contained so it can live in its own page (pokedex.html) or be mounted inside the player app later:
// mountPlayerPokedex(root, { onBack }) -- onBack adds a back button to the header. Styles: css/pokedex.css (.pdx-*).
import { GameDataAPI } from '../api.js';

const TYPE_COLORS = {
  normal: '#A8A878', fire: '#F08030', water: '#6890F0', electric: '#F8D030', grass: '#78C850', ice: '#98D8D8',
  fighting: '#C03028', poison: '#A040A0', ground: '#E0C068', flying: '#A890F0', psychic: '#F85888', bug: '#A8B820',
  rock: '#B8A038', ghost: '#705898', dragon: '#7038F8', dark: '#705848', steel: '#B8B8D0', fairy: '#EE99AC',
  cosmic: '#2E1F5E',
};
const UNKNOWN_COLOR = '#555555';
const RESULTS_PER_PAGE = 10;
const MOVE_RESULTS_MAX = 50;
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
function infoValue(s, key) { return s.info.find(i => i.key === key)?.value || ''; }

export function mountPlayerPokedex(root, { onBack } = {}) {
  const state = {
    data: { species: [], moves: [] },
    moveByName: new Map(),
    view: 'pokedex',
    page: 1,
    openTabs: new Map(),        // species name -> open card tab
    expandedMoves: new Set(),   // `${species}|${move}` opened in a card's Moves tab
  };

  root.classList.add('pdx');
  root.innerHTML = `
    <header class="pdx-header">
      <div class="pdx-header-row">
        ${onBack ? '<button class="pdx-btn pdx-btn-ghost pdx-back" data-act="back" aria-label="Back">←</button>' : ''}
        <h1 class="pdx-title">Shima Pokédex</h1>
      </div>
      <nav class="pdx-nav">
        <button class="pdx-nav-tab active" data-view="pokedex">📖 Pokédex</button>
        <button class="pdx-nav-tab" data-view="moves">⚔️ Moves</button>
      </nav>
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
        <div class="pdx-results" id="pdxMoveResults"></div>
      </div>
    </main>
    <div class="pdx-toast" id="pdxToast"></div>`;

  const $ = sel => root.querySelector(sel);

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------

  async function load() {
    const res = await GameDataAPI.getPlayerPokedex();
    if (res?.status !== 'success' || !res.data) throw new Error(res?.error || res?.message || 'No data');
    state.data = res.data;
    state.moveByName = new Map(res.data.moves.map(m => [String(m.name).toLowerCase(), m]));
    fillFilters();
    renderPokemon();
    renderMoves();
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
    if (/^#?\d+$/.test(term)) return Number(term.replace('#', '')) === Number(s.dex);
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
      <p class="pdx-results-info">Showing ${start + 1}-${start + shown.length} of ${results.length} results</p>
      ${shown.map(cardHtml).join('')}
      ${pages > 1 ? `
        <div class="pdx-pagination">
          <button class="pdx-btn pdx-btn-secondary" data-page="prev" ${state.page === 1 ? 'disabled' : ''}>← Prev</button>
          <span>Page ${state.page} of ${pages}</span>
          <button class="pdx-btn pdx-btn-secondary" data-page="next" ${state.page === pages ? 'disabled' : ''}>Next →</button>
        </div>` : ''}`;
  }

  function imageHtml(s) {
    if (!s.image) return '<div class="pdx-no-image">?</div>';
    if (/\.mp4(\?|$)/i.test(s.image)) return `<video class="pdx-header-image" src="${esc(s.image)}" autoplay loop muted playsinline></video>`;
    return `<img class="pdx-header-image" src="${esc(s.image)}" alt="${esc(s.name)}" loading="lazy">`;
  }

  function cardHtml(s) {
    const left = s.primaryType ? typeColor(s.primaryType) : UNKNOWN_COLOR;
    const right = s.secondaryType ? typeColor(s.secondaryType) : UNKNOWN_COLOR;
    const headerBg = s.dualType ? `linear-gradient(135deg, ${left} 50%, ${right} 50%)` : left;
    const types = [s.primaryType, s.secondaryType].filter(Boolean)
      .map(t => `<span class="pdx-type-pill" style="background:${typeColor(t)}">${esc(t)}</span>`).join('')
      || '<span class="pdx-type-pill unknown">Unknown</span>';

    const tabs = cardTabs(s);
    const open = tabs.some(t => t.id === state.openTabs.get(s.name)) ? state.openTabs.get(s.name) : null;
    return `
      <div class="pdx-card" data-species="${esc(s.name)}">
        <div class="pdx-card-header" style="background:${headerBg}">
          <div class="pdx-card-image">${imageHtml(s)}</div>
          <div class="pdx-card-info">
            <span class="pdx-card-number">#${esc(s.dex)}</span>
            <h2 class="pdx-card-name">${esc(s.name)}</h2>
            <div class="pdx-card-types">${types}</div>
            ${s.classification ? `<p class="pdx-card-classification">${esc(s.classification)}</p>` : ''}
          </div>
        </div>
        ${s.flavor ? `<p class="pdx-card-flavor">${esc(s.flavor)}</p>` : ''}
        ${tabs.length ? `
          <div class="pdx-card-tabs">
            <div class="pdx-tab-bar">${tabs.map(t => `<button class="pdx-tab-btn${t.id === open ? ' active' : ''}" data-tab="${t.id}"><span class="pdx-tab-icon">${t.icon}</span><span class="pdx-tab-label">${t.label}</span></button>`).join('')}</div>
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
      tabs.push({ id: 'abilities', label: 'Abilities', icon: '✨', html: `<div class="pdx-ability-list">${s.abilities.map(a => `
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
        ${evo.to.map(t => `<div class="pdx-evo-item evo-to"><span class="pdx-evo-label">Evolves to</span><span class="pdx-evo-name">${esc(t)}</span></div>`).join('')}
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

  function moveCardHtml(m) {
    return `
      <div class="pdx-move-card">
        <div class="pdx-move-card-header" style="background:${typeColor(m.type)}"><span class="pdx-move-card-name">${esc(m.name)}</span><span class="pdx-move-card-type">${esc(m.type)}</span></div>
        <div class="pdx-move-card-body">
          <div class="pdx-move-card-stats">
            <div class="pdx-move-card-stat"><span>VP</span><span>${esc(m.vp || '-')}</span></div>
            <div class="pdx-move-card-stat"><span>Power</span><span>${esc(m.power || '-')}</span></div>
            <div class="pdx-move-card-stat"><span>Time</span><span>${esc(m.time || '-')}</span></div>
            <div class="pdx-move-card-stat"><span>Range</span><span>${esc(m.range || '-')}</span></div>
          </div>
          <div class="pdx-move-card-desc">${esc(m.description)}</div>
          ${m.higher ? `<div class="pdx-move-card-higher"><strong>Higher:</strong> ${esc(m.higher)}</div>` : ''}
        </div>
      </div>`;
  }

  function renderMoves() {
    const box = $('#pdxMoveResults');
    const term = $('#pdxMoveSearch').value.trim().toLowerCase();
    const level = Math.max(1, Math.min(20, parseInt($('#pdxMoveLevel').value, 10) || 20));
    if (!term) {
      box.innerHTML = '<p class="pdx-placeholder">Search for moves or enter a Pokémon name</p>';
      return;
    }
    const species = state.data.species.find(s => s.name.toLowerCase() === term);
    if (species) {
      if (!species.movesShown) {
        box.innerHTML = `<p class="pdx-placeholder">Move data for <strong>${esc(species.name)}</strong> has not been discovered yet.</p>`;
        return;
      }
      const upTo = Math.min(level, species.movesMaxLevel || 1);
      const names = new Set(species.moves.filter(m => m.extra || m.level <= upTo).map(m => m.name.toLowerCase()));
      const results = state.data.moves.filter(m => names.has(String(m.name).toLowerCase()));
      box.innerHTML = `<h3 class="pdx-results-title">Moves for ${esc(species.name)} (up to Level ${upTo})</h3>
        ${results.length ? `<div class="pdx-move-grid">${results.map(moveCardHtml).join('')}</div>` : '<p class="pdx-placeholder">No moves available at this level.</p>'}`;
      return;
    }
    const results = state.data.moves.filter(m => String(m.name).toLowerCase().includes(term) || String(m.type).toLowerCase().includes(term));
    box.innerHTML = results.length
      ? `<p class="pdx-results-info">${results.length} move(s) found</p><div class="pdx-move-grid">${results.slice(0, MOVE_RESULTS_MAX).map(moveCardHtml).join('')}</div>`
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

    const pager = t.closest('[data-page]');
    if (pager && !pager.disabled) {
      state.page += pager.dataset.page === 'next' ? 1 : -1;
      renderPokemon();
      $('#pdxResults').scrollIntoView({ behavior: 'smooth' });
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
