// DM console -- the Admin module's Moves tab (the user's call, 2026-10-25): every move, changed or added here -- its
// dice at each level and VP cost most of all, its description, action, range and the rest too. Saved on the Pi
// (pi-server/app/admin.py save_move) over the move file, so the app, the battles and the Pokedex have it at once.
//
// A move that's new, or whose text the automation reads changed (the description beyond its dice, the higher levels'
// text, its action, range, duration or attack roll), is marked 🔍 Needs a look in the list -- its effects may no longer
// do what it says -- until the DM marks it checked. Its dice and VP cost are read as they are: changing those marks
// nothing.
//
// The dice aren't fields of their own on a move: the battle reads the first dice in the description as level 1's, and
// "3d8 at level 5" in the higher levels' text for the levels after (utils/pokemon-types.js parseDamageDice). So the dice
// boxes here write straight into those two texts, and read back from them.
import { DmAPI } from '../api.js';
import { showCombatAlert } from '../utils/combat-alert.js';
import { POKEMON_TYPES } from '../utils/pokemon-types.js';
import { escapeHtml, toast, typeBadges } from './dm-common.js';
import { loadMoves } from './move-picker.js';

const LIST_MAX = 250; // rows drawn at once -- the search narrows it down
const FILTER_KEY = 'dmAdminMoveFilter';
// What a mark says changed (admin.py _REVIEWED)
const WHY = { new: 'New move', description: 'Description', scaling: 'Higher levels text', action: 'Action', range: 'Range',
  duration: 'Duration', attackRoll: 'Attack roll' };
const ACTIONS = ['1 action', '1 bonus action', '1 reaction', '1 action, recharge (5-6)', '1 action, recharge (short rest)',
  '1 action, recharge (long rest)', '1 action, charge'];
const STATS = ['None', 'STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA', 'STR/DEX', 'WIS/CHA', 'DEX/WIS', 'DEX/CHA', 'STR/WIS', 'WIS/INT'];
const DURATIONS = ['Instantaneous', '1 round', '1 minute', '1 minute, concentration', '10 minutes', '1 hour', 'Varies'];

const DICE = /\d+d\d+/i;                                    // the first dice in a description: level 1's
const TIER = /(\d+d\d+)\s+at\s+level\s+(\d+)/gi;            // "3d8 at level 5"
const TIER_RUN = /\d+d\d+\s+at\s+level\s+\d+(?:\s*,?\s*(?:and\s+)?\d+d\d+\s+at\s+level\s+\d+)*/i;  // ...all of them in a row

let _moves = null;   // the Admin answer: every move (admin.py move_list)
let _move = null;    // the move on the form ({...}, `isNew` while it hasn't been saved)
let _onCount = null; // told how many moves need a look (the tab's button)

const val = id => document.getElementById(id)?.value ?? '';

/** The Moves tab's button is told how many moves wait for a look (`fn(count)`), now and after every change. */
export function onReviewCount(fn) {
  _onCount = fn;
  if (_moves) fn(reviewCount());
  else DmAPI.adminMoves().then((m) => { _moves = _moves || m; fn(reviewCount()); }).catch(() => {});
}
const reviewCount = () => (_moves || []).filter(m => m.review).length;

// ---------------------------------------------------------------------------
// The dice in the texts
// ---------------------------------------------------------------------------

/** The higher levels' dice: [{ level, dice }] by level. */
function tiersOf(scaling) {
  return [...String(scaling || '').matchAll(TIER)].map(m => ({ dice: m[1], level: Number(m[2]) })).sort((a, b) => a.level - b.level);
}

/** "3d8 at level 5, 4d8 at level 10, and 6d8 at level 17" */
function tierPhrase(tiers) {
  const parts = tiers.map(t => `${t.dice} at level ${t.level}`);
  return parts.length < 3 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/** The higher levels' text with these levels' dice: put where the old ones were, a sentence of their own when there
 * were none, and that sentence gone with the last of them. */
function withTiers(scaling, tiers, healing) {
  const s = String(scaling || '');
  const sorted = [...tiers].sort((a, b) => a.level - b.level);
  if (sorted.length) {
    if (TIER_RUN.test(s)) return s.replace(TIER_RUN, tierPhrase(sorted));
    return `${s.trim() ? `${s.trim()} ` : ''}The ${healing ? 'healing' : 'damage'} dice for this move changes to ${tierPhrase(sorted)}.`;
  }
  return s.replace(new RegExp(`[^.]*${TIER_RUN.source}[^.]*\\.?`, 'i'), '').replace(/\s+/g, ' ').trim();
}

const isDice = s => /^\d+d\d+$/i.test(String(s).trim());

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

export async function drawMoves(body) {
  try {
    _moves = await DmAPI.adminMoves();
  } catch (err) {
    body.innerHTML = `<div class="dm-loading">Couldn't load the moves: ${escapeHtml(err.message)}</div>`;
    return;
  }
  _onCount?.(reviewCount());
  const types = [...new Set([...POKEMON_TYPES, ..._moves.map(m => m.type)].filter(Boolean))].sort();
  let filter = '';
  try { filter = localStorage.getItem(FILTER_KEY) || ''; } catch (e) { /* every move */ }
  body.innerHTML = `
    <div class="dm-editor">
      <aside class="dm-editor-tools">
        <div class="dm-editor-head"><h2>💥 Moves</h2><span class="dm-pill ok">${_moves.length}</span></div>
        <input class="dm-input" id="admMoveSearch" placeholder="Search a move…" autocomplete="off">
        <select class="dm-select" id="admMoveFilter">
          <option value="">Every move</option>
          <option value="review">🔍 Needs a look</option>
          <option value="edited">✎ Changed or added here</option>
          <optgroup label="Type">${types.map(t => `<option value="type:${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}</optgroup>
        </select>
        <button class="dm-btn primary" id="admMoveNew">＋ New move</button>
        <div class="dm-pdx-list" id="admMoveList"></div>
      </aside>
      <section class="dm-editor-canvas" id="admMoveForm"><div class="dm-cs-empty">Pick a move on the left, or make a new one.</div></section>
    </div>
    <datalist id="admMoveActions">${ACTIONS.map(a => `<option value="${escapeHtml(a)}">`).join('')}</datalist>
    <datalist id="admMoveStats">${STATS.map(a => `<option value="${escapeHtml(a)}">`).join('')}</datalist>
    <datalist id="admMoveDurations">${DURATIONS.map(a => `<option value="${escapeHtml(a)}">`).join('')}</datalist>`;
  const filterEl = document.getElementById('admMoveFilter');
  if ([...filterEl.options].some(o => o.value === filter)) filterEl.value = filter;
  const list = () => {
    const q = val('admMoveSearch').trim().toLowerCase(), f = val('admMoveFilter');
    const hits = _moves.filter(m => (!q || m.name.toLowerCase().includes(q))
      && (!f || (f === 'review' ? m.review : f === 'edited' ? m.edited || m.added : m.type === f.slice(5))));
    // the ones waiting for a look first
    if (!f) hits.sort((a, b) => (b.review ? 1 : 0) - (a.review ? 1 : 0));
    document.getElementById('admMoveList').innerHTML = hits.slice(0, LIST_MAX).map(m => `
      <button class="dm-pdx-row dm-mv-row${_move && !_move.isNew && _move.name === m.name ? ' selected' : ''}" data-move="${escapeHtml(m.name)}">
        <span class="dm-pdx-main"><strong>${escapeHtml(m.name)}</strong><small>${typeBadges(m.type)} ${escapeHtml(m.action || '')}${m.vpCost !== '' ? ` · ${escapeHtml(m.vpCost)} VP` : ''}</small></span>
        <span class="dm-mv-marks">${m.review ? `<span class="dm-pill todo" title="Needs a look: ${escapeHtml(m.review.why.map(w => WHY[w] || w).join(', '))}">🔍</span>` : ''}${m.added ? '<span class="dm-pill ok" title="Added here">New</span>' : m.edited ? '<span class="dm-pill ok" title="Changed here">✎</span>' : ''}</span>
      </button>`).join('')
      + (hits.length > LIST_MAX ? `<div class="dm-hint" style="padding:0.4rem">…and ${hits.length - LIST_MAX} more -- search to narrow it down.</div>` : '')
      + (hits.length ? '' : `<div class="dm-hint" style="padding:0.4rem">${f === 'review' ? 'No move is waiting for a look.' : 'No move matches.'}</div>`);
  };
  list();
  document.getElementById('admMoveSearch').addEventListener('input', list);
  filterEl.addEventListener('change', () => {
    try { localStorage.setItem(FILTER_KEY, filterEl.value); } catch (e) { /* not kept */ }
    list();
  });
  document.getElementById('admMoveList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-move]');
    if (!b) return;
    _move = { ..._moves.find(m => m.name === b.dataset.move) };
    list();
    drawMoveForm(list);
  });
  document.getElementById('admMoveNew').addEventListener('click', () => {
    const f = val('admMoveFilter');
    _move = { isNew: true, name: '', type: f.startsWith('type:') ? f.slice(5) : 'Normal', action: '1 action', range: '',
      duration: 'Instantaneous', moveStat: 'None', vpCost: '', description: '', scaling: '', attackRoll: false, categories: [], effects: 0 };
    list();
    drawMoveForm(list);
  });
  if (_move) {
    if (!_move.isNew) _move = { ...(_moves.find(m => m.name === _move.name) || _move) };
    drawMoveForm(list);
  }
}

function drawMoveForm(redrawList) {
  const mv = _move;
  const box = document.getElementById('admMoveForm');
  const types = [...new Set([...POKEMON_TYPES, ...(_moves || []).map(m => m.type), mv.type].filter(Boolean))].sort();
  const auto = mv.categories?.length || mv.effects
    ? `${(mv.categories || []).map(c => `<span class="dm-mv-cat">${escapeHtml(c.replace(/_/g, ' '))}</span>`).join('')}
       <span class="dm-hint">${mv.effects ? `${mv.effects} effect${mv.effects === 1 ? '' : 's'}` : 'no effects'}</span>`
    : '<span class="dm-hint">Nothing automated yet -- the battle uses its dice, VP, range and attack roll only.</span>';
  box.innerHTML = `
    <div class="dm-adm-form">
      <div class="dm-adm-head">
        <div>
          <h3 class="dm-cs-title">${mv.isNew ? 'New move' : escapeHtml(mv.name)} ${mv.isNew ? '' : typeBadges(mv.type)}</h3>
          <div class="dm-hint">${mv.isNew ? 'A new move is marked 🔍 Needs a look until its automation has been set up and checked.'
            : 'Changing its dice or VP cost is safe; changing what its text says marks it 🔍 Needs a look.'}</div>
        </div>
      </div>
      ${mv.review ? `<div class="dm-card dm-mv-review">
        <div><strong>🔍 Needs a look</strong> -- ${escapeHtml(mv.review.why.map(w => WHY[w] || w).join(', '))}${mv.review.at ? ` <span class="dm-hint">(${escapeHtml(new Date(mv.review.at).toLocaleDateString())})</span>` : ''}
          <div class="dm-hint">Check that the battle does what the move now says, then mark it checked.</div></div>
        <button class="dm-btn small" id="admMoveChecked">✓ Checked</button>
      </div>` : ''}
      <div class="dm-card">
        <div class="dm-row">
          <div class="dm-field"><label for="admMoveName">Name</label><input class="dm-input" id="admMoveName" value="${escapeHtml(mv.name)}" ${mv.isNew ? '' : 'disabled title="A move keeps its name -- the Pokémon know their moves by name"'} maxlength="60"></div>
          <div class="dm-field"><label for="admMoveType">Type</label><select class="dm-select" id="admMoveType">${types.map(t => `<option${t === mv.type ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select></div>
          <div class="dm-field dm-mv-vp"><label for="admMoveVp">VP cost</label><input class="dm-input" id="admMoveVp" value="${escapeHtml(mv.vpCost ?? '')}" placeholder="5, or Varies" maxlength="20"></div>
        </div>
        <div class="dm-field"><label>Dice at each level</label><div id="admMoveDice"></div></div>
      </div>
      <div class="dm-card">
        <div class="dm-row">
          <div class="dm-field"><label for="admMoveAction">Action</label><input class="dm-input" id="admMoveAction" list="admMoveActions" value="${escapeHtml(mv.action || '')}" maxlength="60"></div>
          <div class="dm-field"><label for="admMoveRange">Range</label><input class="dm-input" id="admMoveRange" value="${escapeHtml(mv.range || '')}" placeholder="40ft., Self, 20ft. cone" maxlength="60"></div>
        </div>
        <div class="dm-row">
          <div class="dm-field"><label for="admMoveDuration">Duration</label><input class="dm-input" id="admMoveDuration" list="admMoveDurations" value="${escapeHtml(mv.duration || '')}" maxlength="60"></div>
          <div class="dm-field"><label for="admMoveStat">Move stat</label><input class="dm-input" id="admMoveStat" list="admMoveStats" value="${escapeHtml(mv.moveStat || '')}" maxlength="20"></div>
        </div>
        <label class="dm-check"><input type="checkbox" id="admMoveAttack" ${mv.attackRoll ? 'checked' : ''}><span>Makes an attack roll<small>Off: it hits without one (a saving throw, or no roll at all).</small></span></label>
        <div class="dm-field"><label for="admMoveDesc">Description</label><textarea class="dm-input dm-adm-text" id="admMoveDesc" rows="5">${escapeHtml(mv.description || '')}</textarea></div>
        <div class="dm-field"><label for="admMoveScaling">At higher levels</label><textarea class="dm-input dm-adm-text" id="admMoveScaling" rows="2" placeholder="The damage dice for this move changes to 3d8 at level 5, 4d8 at level 10, and 6d8 at level 17.">${escapeHtml(mv.scaling || '')}</textarea></div>
        <div class="dm-field"><label>Automation</label><div class="dm-mv-auto">${auto}</div></div>
        <div class="dm-adm-actions"><button class="dm-btn primary" id="admMoveSave">💾 Save move</button></div>
      </div>
    </div>`;

  const desc = document.getElementById('admMoveDesc'), scaling = document.getElementById('admMoveScaling');
  const healing = () => /\bheal|recover/i.test(desc.value) && !/damage/i.test(desc.value);
  /** The dice boxes, read from the two texts as they are now. */
  const drawDice = () => {
    const base = desc.value.match(DICE)?.[0] || '';
    const tiers = tiersOf(scaling.value);
    const el = document.getElementById('admMoveDice');
    if (!base && !tiers.length) {
      el.innerHTML = '<div class="dm-hint">No dice in its description -- write them there ("2d8 + MOVE fire damage") and they show up here.</div>';
      return;
    }
    el.innerHTML = `<div class="dm-mv-tiers">
      <div class="dm-mv-tier"><span>Level 1</span><input class="dm-input" data-dice="base" value="${escapeHtml(base)}" ${base ? '' : 'disabled'} maxlength="8"></div>
      ${tiers.map((t, i) => `<div class="dm-mv-tier"><span>Level</span><input class="dm-input dm-mv-lvl" type="number" min="2" max="20" data-level="${i}" value="${t.level}">
        <input class="dm-input" data-dice="${i}" value="${escapeHtml(t.dice)}" maxlength="8">
        <button class="dm-btn small" data-untier="${i}" title="No dice change at this level">✕</button></div>`).join('')}
      <button class="dm-btn small" id="admMoveAddTier">＋ Add a level</button>
    </div>`;
  };
  /** The higher levels' text written again from the boxes. */
  const writeTiers = (tiers) => {
    scaling.value = withTiers(scaling.value, tiers, healing());
    drawDice();
  };
  const boxTiers = () => {
    const el = document.getElementById('admMoveDice');
    return tiersOf(scaling.value).map((t, i) => ({
      level: Number(el.querySelector(`[data-level="${i}"]`)?.value) || t.level,
      dice: el.querySelector(`[data-dice="${i}"]`)?.value.trim() || t.dice,
    }));
  };
  drawDice();
  desc.addEventListener('input', drawDice);
  scaling.addEventListener('input', drawDice);
  const diceBox = document.getElementById('admMoveDice');
  diceBox.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.dice === 'base') {
      if (!isDice(t.value)) { showCombatAlert('Write the dice like 2d8.', { title: 'Not dice' }); drawDice(); return; }
      desc.value = desc.value.replace(DICE, t.value.trim().toLowerCase());
      drawDice();
    } else if (t.dataset.dice != null || t.dataset.level != null) {
      const tiers = boxTiers();
      if (tiers.some(x => !isDice(x.dice) || x.level < 2 || x.level > 20)) {
        showCombatAlert('Each level needs dice like 3d8 and a level from 2 to 20.', { title: 'Not dice' });
        drawDice();
        return;
      }
      writeTiers(tiers.map(x => ({ ...x, dice: x.dice.toLowerCase() })));
    }
  });
  diceBox.addEventListener('click', (e) => {
    const un = e.target.closest('[data-untier]');
    if (un) { writeTiers(boxTiers().filter((_, i) => i !== Number(un.dataset.untier))); return; }
    if (e.target.closest('#admMoveAddTier')) {
      const tiers = boxTiers();
      const last = tiers[tiers.length - 1];
      const level = Math.min(20, last ? last.level + 5 : 5);
      if (tiers.some(t => t.level === level)) return;
      writeTiers([...tiers, { level, dice: last?.dice || desc.value.match(DICE)?.[0] || '1d6' }]);
    }
  });

  document.getElementById('admMoveSave').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const saved = await DmAPI.adminSaveMove({
        name: val('admMoveName'), type: val('admMoveType'), vpCost: val('admMoveVp'), action: val('admMoveAction'),
        range: val('admMoveRange'), duration: val('admMoveDuration'), moveStat: val('admMoveStat'),
        attackRoll: document.getElementById('admMoveAttack').checked, description: desc.value, scaling: scaling.value,
      }, !!mv.isNew);
      afterSave(saved, redrawList);
      toast(saved.review && (!mv.review || saved.review.why.length > mv.review.why.length)
        ? `${saved.name} is saved -- marked 🔍 Needs a look.` : `${saved.name} is saved.`);
    } catch (err) {
      showCombatAlert(err.message, { title: "Couldn't save the move" });
      btn.disabled = false;
    }
  });
  document.getElementById('admMoveChecked')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      // only the mark goes -- what's typed on the form and not saved yet stays
      const checked = await DmAPI.adminMoveChecked(mv.name);
      const i = _moves.findIndex(m => m.name === checked.name);
      if (i >= 0) _moves[i] = checked;
      mv.review = null;
      btn.closest('.dm-mv-review')?.remove();
      _onCount?.(reviewCount());
      redrawList();
      toast(`${mv.name} is checked.`);
    } catch (err) {
      showCombatAlert(err.message, { title: "Couldn't mark it checked" });
      btn.disabled = false;
    }
  });
}

/** A move saved: the list, the form and the tab's count show it, and the console's own move list (the pickers, the
 * battle) is read again. */
function afterSave(saved, redrawList) {
  const i = _moves.findIndex(m => m.name.toLowerCase() === saved.name.toLowerCase());
  if (i >= 0) _moves[i] = saved; else _moves.push(saved);
  _move = { ...saved };
  DmAPI.forgetCachedData();
  loadMoves();
  _onCount?.(reviewCount());
  redrawList();
  drawMoveForm(redrawList);
}
