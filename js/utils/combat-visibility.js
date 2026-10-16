// Single source of truth for "can this viewer see this participant's X" --
// shared by every read-only combat-tool UI (display.js, target-picker.js, the
// battle screen's info panel...) so the "allies always visible, enemies respect
// the DM's per-field visibility toggle" rule (see pi-server/app/routes_combat.py)
// can't drift between them.

// Where each field starts for an enemy, and the fallback for a participant whose record predates a field -- mirrors
// routes_combat.py's VISIBILITY_DEFAULTS. `stats` covers all six ability scores together. Everything starts hidden but the
// picture (the user's call, 2026-10-15; the HP / VP bars too since 2026-10-16): `hpBar` / `vpBar` show how full the bars
// are, `hp` / `vp` the numbers -- which give away much more.
export const VISIBILITY_DEFAULTS = {
  name: false, type: false, level: false, hpBar: false, hp: false, vpBar: false, vp: false, size: false,
  ac: false, stats: false, abilities: false,
};

// The DM console sees everything of everyone -- the toggles are about what the PLAYERS see (combat-wip.js's
// enableDmMode turns this on; the table screens and players' devices never do).
let _seesEverything = false;

export function setViewerSeesEverything(on) {
  _seesEverything = !!on;
}

/** True on the DM console: it also sees what is hidden from the players on the map (hidden objects, unrevealed traps). */
export function viewerSeesEverything() {
  return _seesEverything;
}

export function visibleToViewer(participant, field) {
  if (_seesEverything || participant.side === 'player') return true;
  return participant.visibility?.[field] ?? VISIBILITY_DEFAULTS[field] ?? false;
}

/** One of the DM's creatures in a PvE battle (owned by the DM console, or a freeform enemy with no owner). */
function _isDmCreature(session, p) {
  return session?.battleType !== 'pvp' && (!p.owner || p.owner === 'DM');
}

/** A DM creature the DM has hidden (held back / 🙈 in the DM console): on no screen but the DM's. */
export function hiddenFromPlayers(session, p) {
  return !!p && p.status === 'spectating' && _isDmCreature(session, p);
}

/**
 * The battle as this screen may see it -- everything, on the DM console; for the players' devices and the table screens,
 * without what the DM keeps to itself (the user's ask, 2026-10-16): the DM's hidden creatures (not in the participants,
 * the turn order or on the map), log entries hidden from the battle log (the DM's "Hide from the battle log", and
 * anything about a hidden creature), hidden map objects and unrevealed traps. Done in place, where the battle reaches
 * the page (api.js for every combat answer, live-updates.js for every push), so every screen and popup reads the same.
 */
export function redactForViewer(session) {
  if (_seesEverything || !session?.participants) return session;
  const hidden = new Set(Object.values(session.participants).filter(p => hiddenFromPlayers(session, p)).map(p => p.id));
  hidden.forEach((id) => {
    delete session.participants[id];
    if (session.board?.tokens) delete session.board.tokens[id];
  });
  if (Array.isArray(session.turnOrder) && hidden.size) {
    const current = session.turnOrder[session.turnIndex];
    session.turnOrder = session.turnOrder.filter(id => !hidden.has(id));
    const at = session.turnOrder.indexOf(current);
    if (at >= 0) session.turnIndex = at;
  }
  if (Array.isArray(session.log)) {
    session.log = session.log.filter(e => !e.hidden && !hidden.has(e.actorId) && !hidden.has(e.targetId));
  }
  if (session.board) {
    if (Array.isArray(session.board.objects)) session.board.objects = session.board.objects.filter(o => !o.hidden);
    if (Array.isArray(session.board.traps)) session.board.traps = session.board.traps.filter(t => t.revealed);
  }
  return session;
}
