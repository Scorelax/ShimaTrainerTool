// Read-only popup showing the shared battle log (routes_combat.py's 'log' --
// one chronological record of everything that's happened this session:
// joins/leaves, moves used, damage dealt, misses, status effects, heals,
// turn advances, reactions). Every viewer sees the same log; nothing here
// is per-trainer. Mirrors battle-map-popup.js's show/update pattern and
// move-popup.js's shared .combat-popup-* base styles.
function _injectStyles() {
  if (document.getElementById('battle-log-popup-styles')) return;
  const style = document.createElement('style');
  style.id = 'battle-log-popup-styles';
  style.textContent = `
    .combat-popup-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.75); z-index: 1000; justify-content: center; align-items: center; backdrop-filter: blur(3px); }
    .combat-popup-content { background: #1e1e34; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; max-width: 520px; width: 92%; max-height: 90vh; overflow-y: auto; position: relative; box-shadow: 0 10px 40px rgba(0,0,0,0.6); color: #e0e0e0; }
    .combat-move-popup-header { padding: 1.1rem 1.2rem; border-radius: 16px 16px 0 0; border-bottom: 2px solid rgba(0,0,0,0.3); display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; position: relative; background: rgba(255,255,255,0.05); }
    .combat-move-popup-header h2 { margin: 0; font-size: 1.4rem; font-weight: 900; text-transform: uppercase; }
    .combat-popup-close { position: absolute; top: 0.8rem; right: 0.8rem; background: rgba(0,0,0,0.3); border: none; border-radius: 50%; width: 32px; height: 32px; font-size: 1.2rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; color: inherit; }
    .combat-move-popup-body { padding: 0.6rem 1.2rem 1.2rem; }
    .blog-empty { text-align: center; color: #a0a0c0; padding: 2rem 1rem; }
    .blog-round-header { font-size: 0.75rem; font-weight: 700; color: #FFD700; text-transform: uppercase; letter-spacing: 0.5px; margin: 1rem 0 0.4rem; opacity: 0.85; }
    .blog-round-header:first-child { margin-top: 0.4rem; }
    .blog-entry { display: flex; gap: 0.6rem; align-items: baseline; padding: 0.3rem 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 0.88rem; line-height: 1.4; }
    .blog-entry:last-child { border-bottom: none; }
    .blog-icon { flex-shrink: 0; width: 1.3em; text-align: center; }
    .blog-text { flex: 1; }
    .blog-entry.type-damage .blog-text { color: #ff8a8a; }
    .blog-entry.type-miss .blog-text { color: #a0a0c0; font-style: italic; }
    .blog-entry.type-heal .blog-text { color: #7ee787; }
    .blog-entry.type-status-applied .blog-text { color: #d9a4ff; }
    .blog-entry.type-status-removed .blog-text { color: #a0a0c0; }
    .blog-entry.type-turn-advance .blog-text { color: #ffd76b; font-weight: 600; }
    .blog-entry.type-join .blog-text, .blog-entry.type-leave .blog-text, .blog-entry.type-session-start .blog-text { color: #6bb8ff; }
  `;
  document.head.appendChild(style);
}

const _ICONS = {
  'session-start': '⚔️', 'session-end': '🏁', join: '➕', leave: '➖',
  'move-used': '✨', damage: '💥', miss: '💨', heal: '💚',
  'status-applied': '🌀', 'status-removed': '✅',
  'turn-advance': '🔄', 'reaction-start': '⚡', 'reaction-end': '⚡',
};

let _overlay = null;
let _session = null;

function _ensureDom() {
  if (_overlay) return;
  _injectStyles();
  _overlay = document.createElement('div');
  _overlay.className = 'combat-popup-overlay';
  _overlay.id = 'battleLogPopup';
  _overlay.style.display = 'none';
  _overlay.innerHTML = `
    <div class="combat-popup-content">
      <div class="combat-move-popup-header">
        <button id="battleLogClose" class="combat-popup-close">×</button>
        <h2>📜 Battle Log</h2>
      </div>
      <div class="combat-move-popup-body" id="battleLogBody"></div>
    </div>
  `;
  document.body.appendChild(_overlay);
  document.getElementById('battleLogClose').addEventListener('click', _close);
  _overlay.addEventListener('click', (e) => { if (e.target === _overlay) _close(); });
}

function _close() {
  if (_overlay) _overlay.style.display = 'none';
}

/** Opens the popup showing `session`'s log. Re-openable/re-callable freely. */
export function showBattleLog(session) {
  _session = session;
  _ensureDom();
  _render();
  _overlay.style.display = 'flex';
}

/** Call on every live session push so the popup stays current while open;
 * no-ops (and doesn't re-render) when the popup isn't showing. */
export function updateBattleLog(session) {
  _session = session;
  if (_overlay && _overlay.style.display !== 'none') _render();
}

function _render() {
  const body = document.getElementById('battleLogBody');
  if (!body) return;
  const log = _session?.log || [];
  if (!log.length) {
    body.innerHTML = '<div class="blog-empty">Nothing has happened yet.</div>';
    return;
  }
  // Newest first, grouped under a round header -- the log array itself is
  // stored oldest-first (append-only), so both the grouping and the
  // reversal happen here at render time rather than changing storage order.
  let html = '';
  let lastRound = null;
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (entry.round !== lastRound) {
      html += `<div class="blog-round-header">Round ${entry.round}</div>`;
      lastRound = entry.round;
    }
    const icon = _ICONS[entry.type] || '•';
    html += `<div class="blog-entry type-${entry.type}"><span class="blog-icon">${icon}</span><span class="blog-text">${entry.text}</span></div>`;
  }
  body.innerHTML = html;
}
