// Moves for the DM to teach (the user's call, 2026-10-19): any move from the move list -- one a Pokemon hasn't learned
// yet, or can't normally learn at all -- the same idea as Edit Pokemon's custom moves. Used by the Party module (a
// player's Pokemon, for good), the Battle module's Edit (the DM's own creatures) and its "Teach a move" for a player's
// Pokemon in the battle.
import { DmAPI } from '../api.js';
import { openPicker } from './picker.js';
import { refreshCombatMoves } from '../pages/combat.js';

/** The move list as the Pi has it now -- the console's copy is refreshed with it. */
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

/** Pick moves from the move list -> their names (null: nothing picked). `exclude`: names it already has (left out). */
export async function pickMoves({ title = '💥 Teach a move', exclude = [], multi = true, hint = '' } = {}) {
  const moves = await loadMoves();
  const have = new Set(exclude.map(m => String(m).toLowerCase()));
  const res = await openPicker({
    title, multi, compact: true, confirmLabel: 'Teach',
    hint: hint || 'Any move from the move list -- one it hasn\'t learned yet, or one it can\'t normally learn.',
    items: moves.filter(m => !have.has(String(m.name).toLowerCase())).map(m => ({
      key: m.name, label: m.name, sub: `${m.type || ''} · ${m.action || ''}`, search: String(m.type || ''),
    })),
  });
  return res?.keys?.length ? res.keys : null;
}
