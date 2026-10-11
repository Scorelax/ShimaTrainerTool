// Single source of truth for "can this viewer see this participant's X" --
// shared by every read-only combat-tool UI (display.js, target-picker.js, the
// battle screen's info panel...) so the "allies always visible, enemies respect
// the DM's per-field visibility toggle" rule (see pi-server/app/routes_combat.py)
// can't drift between them.

// Where each field starts for an enemy, and the fallback for a participant whose record predates a field -- mirrors
// routes_combat.py's VISIBILITY_DEFAULTS. `stats` covers all six ability scores together.
export const VISIBILITY_DEFAULTS = {
  name: true, type: true, level: true, hp: true, vp: true, size: true,
  ac: false, stats: false, abilities: false,
};

// The DM console sees everything of everyone -- the toggles are about what the PLAYERS see (combat-wip.js's
// enableDmMode turns this on; the table screens and players' devices never do).
let _seesEverything = false;

export function setViewerSeesEverything(on) {
  _seesEverything = !!on;
}

export function visibleToViewer(participant, field) {
  if (_seesEverything || participant.side === 'player') return true;
  return participant.visibility?.[field] ?? VISIBILITY_DEFAULTS[field] ?? false;
}
