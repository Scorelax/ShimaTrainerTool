// One popup at a time on a screen (the user's call after the 2026-11-12 playtest: the DM got a Vulpix's save with two
// more boxes behind it -- a reaction offer and a concentration check had opened on top of each other).
//
// The popups that open by themselves on a live update -- another player asking this one for a save, a reaction offer, a
// concentration check, start-of-turn saves, a hazard, a forced switch, the DM's status notices -- wait their turn here,
// in the order they came (a reaction offer first: it runs on a clock, and the attacker's move waits on it), and each
// opens only once nothing else is up and the screen has stayed clear for a moment. One that stopped mattering while it
// waited (the window closed, the asker entered the save themselves) is dropped without showing.
//
// A move being played on this screen comes first: queued popups wait until it's done -- except while it waits on someone
// else (reactions, another player's save: whileWaitingOnOthers), and then the move carries on only once the popup that
// got in meanwhile has been answered, so the two never stack.

const SETTLE_MS = 350; // the screen has to stay clear this long: a move's next popup opens a beat after its last closes
const POLL_MS = 150;

const _queue = []; // { key, show, stillWanted, urgent }
const _seen = new Set(); // keys ever queued -- each question is asked once
let _showing = false;
let _pumping = false;
let _busyCheck = () => false;
let _waiting = 0;
const _settledWaiters = [];

/** combat-wip.js tells whether a move of this screen's is under way (and not just waiting on others). */
export function setPopupBusyCheck(fn) { _busyCheck = typeof fn === 'function' ? fn : () => false; }

/** How many of this screen's waits on other screens are going on right now (see whileWaitingOnOthers). */
export function waitingOnOthersCount() { return _waiting; }

/**
 * Queues a popup. `show()` opens it and resolves once it's closed. `stillWanted()` is asked right before it opens (and
 * while it waits); false drops it. `urgent` puts it ahead of the others still waiting (never over the one showing).
 * A key already queued once is ignored -- returns false then.
 */
export function enqueuePopup(key, show, { stillWanted = () => true, urgent = false } = {}) {
  if (key) {
    if (_seen.has(key)) return false;
    _seen.add(key);
  }
  const job = { key, show, stillWanted, urgent };
  if (urgent) {
    const at = _queue.findIndex(j => !j.urgent);
    _queue.splice(at < 0 ? _queue.length : at, 0, job);
  } else {
    _queue.push(job);
  }
  _pump();
  return true;
}

/** Resolves once no queued popup is open (ones still waiting their turn don't count). */
export function popupQueueSettled() {
  if (!_showing) return Promise.resolve();
  return new Promise(r => _settledWaiters.push(r));
}

/** Awaits `promise` -- a wait on other screens (a reaction window, another player's save) -- letting queued popups open
 * meanwhile; once it's over, waits for the one that may be open to be answered before handing back. */
export async function whileWaitingOnOthers(promise) {
  _waiting++;
  _pump();
  try {
    return await promise;
  } finally {
    _waiting--;
    await popupQueueSettled();
  }
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function _wanted(job) {
  try { return job.stillWanted() !== false; } catch { return false; }
}

// Full-screen layers that aren't questions: the battle map / log a player keeps open, a move's own reaction wait, the
// PokéNav and the adventure page -- a queued popup opens over them.
const _NOT_BLOCKING = '#battleMapPopup, #battleLogPopup, .reaction-wait-overlay, .rw-aside, .popup-waiting, .pnav-page, .wip-adv-page';
const _CANDIDATES = '[id$="Popup"], [id$="Overlay"], [id$="popup"], [id$="overlay"], [class*="overlay"], [class*="popup"], [class*="Popup"], [class*="picker"], [class*="modal"]';

/** The popups up on this screen right now: visible fixed layers covering most of the window. */
export function blockingPopups() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return [...document.querySelectorAll(_CANDIDATES)].filter((el) => {
    if (el.closest(_NOT_BLOCKING)) return false; // one of those layers, or something inside it
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width >= vw * 0.7 && r.height >= vh * 0.7;
  });
}

function _screenBusy() {
  let moveUnderWay = false;
  try { moveUnderWay = !!_busyCheck(); } catch { /* treated as free */ }
  return moveUnderWay || blockingPopups().length > 0;
}

async function _pump() {
  if (_pumping) return;
  _pumping = true;
  try {
    let clearSince = null;
    while (_queue.length) {
      // Dropped while waiting: the question went away
      for (let i = _queue.length - 1; i >= 0; i--) {
        if (!_wanted(_queue[i])) _queue.splice(i, 1);
      }
      if (!_queue.length) break;
      if (_screenBusy()) {
        clearSince = null;
      } else {
        clearSince ??= Date.now();
        if (Date.now() - clearSince >= SETTLE_MS) {
          const job = _queue.shift();
          clearSince = null;
          if (_wanted(job)) {
            _showing = true;
            try { await job.show(); } catch { /* a popup that failed never holds the rest up */ }
            _showing = false;
            _settledWaiters.splice(0).forEach(r => r());
          }
          continue;
        }
      }
      await _sleep(POLL_MS);
    }
  } finally {
    _pumping = false;
  }
}
