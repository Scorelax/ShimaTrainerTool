// Keeps the other players' copy of a combatant's MANUAL stat edits (AC, ability scores
// and modifiers, crit modifier -- the Modify Stats buttons on the card) up to date.
// Those edits only ever touch the local card, but everyone else's popups read the
// participant record on the server (a target's AC for the hit/miss hint, a saver's
// modifier, an attacker's Move DC and crit range), so without this they'd all be working
// from the values the combatant joined with.
//
// What's sent is the BASE (move-effects.js's baseStats: the card's values minus the live
// status deltas) because every other client adds the live statuses on top itself.
//
// Same shape as combat-wip.js's HP/VP push: only a changed value goes out, at most one
// request per combatant is in flight, and whatever changed meanwhile goes out right after
// it -- so the server always ends on what this device actually holds. A failed request
// forgets what it "sent", so the next save retries.
import { baseStats } from './move-effects.js';

/** `send(id, stats)` performs the request (returns a promise). */
export function createBaseStatSync(send) {
  const last = {};      // id -> JSON of the last stats handed to `send`
  const inFlight = {};  // id -> true while its request is out
  const pending = {};   // id -> newest stats waiting behind it

  function push(id, stats) {
    if (inFlight[id]) { pending[id] = stats; return; }
    inFlight[id] = true;
    Promise.resolve()
      .then(() => send(id, stats))
      .catch(() => { delete last[id]; }) // let the next save retry
      .then(() => {
        inFlight[id] = false;
        const next = pending[id];
        if (next) { delete pending[id]; push(id, next); }
      });
  }

  return {
    /** `combatants`: the local combat state's list; `isMine(id)`: only this device's own are sent. */
    onSave(combatants, isMine) {
      for (const c of combatants) {
        if (!isMine(c.id) || c.hasStatBlock === false) continue;
        const stats = baseStats(c);
        const key = JSON.stringify(stats);
        if (last[c.id] === key) continue;
        last[c.id] = key;
        push(c.id, stats);
      }
    },
    reset() {
      for (const o of [last, inFlight, pending]) for (const k of Object.keys(o)) delete o[k];
    },
  };
}
