// Moves for the DM to hand out (the user's call, 2026-10-19): pick one or several from the whole move list -- the DM's own
// custom moves too -- or make a custom move on the spot (a name, a type, how it's used and what it does; kept on the Pi
// with the move list, admin.py's save_move, so every device knows it). Used by the Party module (teach a player's Pokemon
// a move for good) and the Battle module's Edit (a move for anyone in the battle).
import { DmAPI } from '../api.js';
import { showCombatAlert } from '../utils/combat-alert.js';
import { escapeHtml, openDmModal } from './dm-common.js';
import { openPicker } from './picker.js';
import { refreshCombatMoves } from '../pages/combat.js';

const TYPES = ['Normal', 'Fire', 'Water', 'Grass', 'Electric', 'Ice', 'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic',
  'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy', 'Cosmic'];
const ACTIONS = ['1 action', '1 bonus action', '1 reaction'];
const MOVE_STATS = ['None', 'STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA', 'STR/DEX', 'INT/WIS', 'WIS/CHA'];

/** The move list as the Pi has it now (a custom move just made is on it) -- the console's copy is refreshed with it. */
export async function loadMoves() {
  try {
    const res = await DmAPI.allMoves();
    if (Array.isArray(res?.data)) {
      sessionStorage.setItem('moves', JSON.stringify(res.data));
      refreshCombatMoves();
      return res.data;
    }
  } catch { /* the copy the console has */ }
  return JSON.parse(sessionStorage.getItem('moves') || '[]');
}

/** Pick moves -> their names ([] / null: nothing picked). `exclude`: names it already has (left out). */
export async function pickMoves({ title = '✨ Add a move', exclude = [], multi = true, hint = '' } = {}) {
  const moves = await loadMoves();
  const have = new Set(exclude.map(m => String(m).toLowerCase()));
  const res = await openPicker({
    title, multi, compact: true, confirmLabel: 'Add',
    hint: hint || 'Pick from the move list -- or make a move of your own with "Create a custom move".',
    extraAction: { label: '＋ Create a custom move…' },
    items: moves.filter(m => !have.has(String(m.name).toLowerCase())).map(m => ({
      key: m.name, label: m.name, sub: `${m.type || ''} · ${m.action || ''}${m.custom ? ' · custom' : ''}`,
      search: `${m.type} ${m.custom ? 'custom' : ''}`,
    })),
  });
  if (!res) return null;
  if (res.extra) {
    const made = await customMoveForm();
    return made ? [made.name] : null;
  }
  return res.keys;
}

/** The form for a custom move (a new one, or `start` to change) -> the move as saved, or null. */
export async function customMoveForm(start = null) {
  const m = start || {};
  const duration = typeof m.duration === 'object' ? m.duration?.raw : m.duration;
  let saved = null;
  await openDmModal({
    title: start ? `✨ ${start.name}` : '✨ A custom move',
    wide: true,
    html: `
      <div class="dm-edit-form">
        <div class="dm-row">
          <div class="dm-field"><label for="cmName">Name</label><input class="dm-input" id="cmName" maxlength="60" value="${escapeHtml(m.name || '')}" ${start ? 'readonly' : ''}></div>
          <div class="dm-field"><label for="cmType">Type</label><select class="dm-select" id="cmType">${TYPES.map(t => `<option ${t === (m.type || 'Normal') ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        </div>
        <div class="dm-row">
          <div class="dm-field"><label for="cmAction">Takes</label><select class="dm-select" id="cmAction">${ACTIONS.map(a => `<option ${a === (m.action || '1 action') ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
          <div class="dm-field"><label for="cmRange">Range</label><input class="dm-input" id="cmRange" value="${escapeHtml(m.range || '')}" placeholder="e.g. 60ft., Self, Melee"></div>
          <div class="dm-field"><label for="cmDuration">Duration</label><input class="dm-input" id="cmDuration" value="${escapeHtml(duration || 'Instantaneous')}"></div>
        </div>
        <div class="dm-row">
          <div class="dm-field"><label for="cmStat">Move stat</label><select class="dm-select" id="cmStat">${MOVE_STATS.map(x => `<option ${x === (m.moveStat || 'None') ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
          <div class="dm-field"><label for="cmVp">VP cost</label><input class="dm-input" id="cmVp" type="number" min="0" value="${escapeHtml(m.vpCost ?? 0)}"></div>
          <label class="dm-check" style="align-self:end"><input type="checkbox" id="cmAttack" ${m.attackRoll ? 'checked' : ''}><span>Attack roll</span></label>
        </div>
        <div class="dm-field"><label for="cmDesc">What it does</label>
          <textarea class="dm-input" id="cmDesc" rows="4" placeholder="e.g. Make a melee attack, doing 1d8 + Move fire damage on a hit.">${escapeHtml(m.description || '')}</textarea></div>
        <div class="dm-field"><label for="cmScaling">At higher levels <small>(optional)</small></label>
          <input class="dm-input" id="cmScaling" value="${escapeHtml(m.scaling || '')}"></div>
        <div class="dm-hint">Written like the move list's moves -- the battle rolls the dice its text names; anything else it does is your call at the table.</div>
      </div>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save the move', kind: 'primary', keepOpen: true, value: 'ok', onClick: async (body) => {
      const v = id => body.querySelector(`#${id}`).value.trim();
      if (!v('cmName')) { showCombatAlert('The move needs a name.', { title: 'Custom move' }); return false; }
      try {
        saved = await DmAPI.adminSaveMove({
          name: v('cmName'), type: v('cmType'), action: v('cmAction'), range: v('cmRange'), duration: v('cmDuration'),
          moveStat: v('cmStat'), vpCost: v('cmVp'), description: v('cmDesc'), scaling: v('cmScaling'),
          attackRoll: body.querySelector('#cmAttack').checked,
        });
      } catch (err) {
        showCombatAlert(err.message, { title: 'Custom move' });
        return false;
      }
      await loadMoves();
      return true;
    } }],
  });
  return saved;
}
