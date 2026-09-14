// Single source of truth for "can this viewer see this participant's X" --
// shared by every read-only combat-tool UI (display.js, target-picker.js)
// so the "allies always visible, enemies respect the DM's per-field
// visibility toggle" rule (see pi-server/app/routes_combat.py) can't drift
// between them.
export function visibleToViewer(participant, field) {
  return participant.side === 'player' || participant.visibility[field];
}
