// XP -- only the DM sees it. Kept on the trainers' and Pokemon's own records on the Pi (the dm_xp column, which is never
// part of what the players' app gets), given out from the Party module (a trainer's page) and the aftermath. Levels use
// the old DM tool's table (encounter-rules.js's XP_TO_LEVEL), the same for trainers and Pokemon. XP never changes a
// level by itself: levelling up has choices the player makes in their app, so the console shows who is ready for it.
import { DmAPI } from '../api.js';
import { XP_TO_LEVEL, levelFromXp } from './encounter-rules.js';
import { escapeHtml, openDmModal, toast } from './dm-common.js';

const QUICK = [50, 100, 250, 500, 1000];

const clampLevel = level => Math.max(1, Math.min(20, Number(level) || 1));

/** A record's XP: what's stored, or (none yet) the XP its current level starts at. */
export function xpOrStart(stored, level) {
  return Number.isFinite(stored) ? stored : XP_TO_LEVEL[clampLevel(level)];
}

/** {xp, level, xpLevel, ready, next, toGo, pct} -- `ready` when the XP has reached a level above the current one. */
export function xpStatus(xp, level) {
  const lvl = clampLevel(level);
  const xpLevel = levelFromXp(xp);
  const next = lvl < 20 ? XP_TO_LEVEL[lvl + 1] : null;
  const from = XP_TO_LEVEL[lvl];
  return {
    xp, level: lvl, xpLevel, ready: xpLevel > lvl, next,
    toGo: next === null ? 0 : Math.max(0, next - xp),
    pct: next === null ? 100 : Math.max(0, Math.min(100, ((xp - from) / (next - from)) * 100)),
  };
}

/** The small XP button (Party module): "⭐ 6,500 XP", marked when a level up is due. */
export function xpButtonHtml(xp, level, attrs = '') {
  const st = xpStatus(xp, level);
  return `<button class="dm-xp-btn${st.ready ? ' ready' : ''}" ${attrs}
    title="${st.ready ? `Ready for level ${st.xpLevel} -- they level up in their app. ` : ''}Give XP (only you see it)">
    ⭐ ${xp.toLocaleString()} XP${st.ready ? ` <span class="dm-xp-up">⬆ ${st.xpLevel}</span>` : ''}</button>`;
}

function statusLine(st) {
  if (st.ready) return `<span class="dm-xp-ready">⬆ Ready for level ${st.xpLevel}</span> -- they level up in their app`;
  return st.next === null ? 'Level 20 -- the top' : `Level ${st.level} · ${st.toGo.toLocaleString()} to level ${st.level + 1} (${st.next.toLocaleString()})`;
}

/** The XP line on a trainer's page: the total, a bar to the next level and the Give XP button. */
export function xpPanelHtml(xp, level, attrs = '') {
  const st = xpStatus(xp, level);
  return `
    <div class="dm-xp-panel">
      <div class="dm-xp-panel-top">
        <span class="dm-xp-total">⭐ ${xp.toLocaleString()} XP</span>
        <button class="dm-btn small primary" ${attrs}>Give XP</button>
      </div>
      <div class="dm-bar xp"><i style="width:${st.pct}%"></i></div>
      <div class="dm-hint">${statusLine(st)}</div>
      <div class="dm-hint dm-xp-private">Only you see XP -- the players never do.</div>
    </div>`;
}

/** The Give XP popup for one trainer or one of their Pokemon (`pokemon` = its species name). Give, take or set it
 * exactly; saved straight away. Resolves to the new XP, or null when cancelled. */
export function giveXpPopup({ label, trainer, pokemon = null, xp, level }) {
  const st = xpStatus(xp, level);
  let saved = null;
  return openDmModal({
    title: `XP -- ${label}`,
    html: `
      <div class="dm-xp-pop">
        <div class="dm-xp-now"><strong>${xp.toLocaleString()} XP</strong> · ${statusLine(st)}</div>
        <div class="dm-bar xp"><i style="width:${st.pct}%"></i></div>
        <div class="dm-xp-modes">
          <label class="dm-check"><input type="radio" name="xpMode" value="add" checked><span>Give</span></label>
          <label class="dm-check"><input type="radio" name="xpMode" value="take"><span>Take away</span></label>
          <label class="dm-check"><input type="radio" name="xpMode" value="set"><span>Set it to exactly</span></label>
        </div>
        <input class="dm-input dm-xp-amount" id="xpAmount" type="number" min="0" placeholder="XP" autofocus>
        <div class="dm-xp-quick">${QUICK.map(q => `<button class="dm-btn small" data-quick="${q}">+${q.toLocaleString()}</button>`).join('')}</div>
        <div class="dm-xp-after" id="xpAfter"></div>
      </div>`,
    buttons: [
      { label: 'Cancel', value: null },
      {
        label: 'Save', kind: 'primary', keepOpen: true,
        onClick: async (body) => {
          const change = read(body);
          if (!change) return false;
          try {
            const [res] = await DmAPI.changeXp([{ trainer, ...(pokemon ? { pokemon } : {}), ...change }]);
            saved = res.xp;
            toast(res.xpLevel > res.level
              ? `${label}: ${res.xp.toLocaleString()} XP -- ready for level ${res.xpLevel} (they level up in their app).`
              : `${label}: ${res.xp.toLocaleString()} XP.`);
            return true;
          } catch (err) {
            body.querySelector('#xpAfter').innerHTML = `<span class="dm-warn">${escapeHtml(err.message)}</span>`;
            return false;
          }
        },
      },
    ],
    onOpen: (body) => {
      const amount = body.querySelector('#xpAmount');
      const update = () => {
        const change = read(body);
        const after = !change ? null : change.set !== undefined ? change.set : Math.max(0, xp + change.add);
        const st2 = after === null ? null : xpStatus(after, level);
        body.querySelector('#xpAfter').innerHTML = after === null ? '' : `→ <strong>${after.toLocaleString()} XP</strong>${st2.ready ? ` · <span class="dm-xp-ready">⬆ ready for level ${st2.xpLevel}</span>` : ''}`;
      };
      body.addEventListener('input', update);
      body.addEventListener('change', update);
      body.querySelector('.dm-xp-quick').addEventListener('click', (e) => {
        const q = Number(e.target.closest('[data-quick]')?.dataset.quick);
        if (!q) return;
        amount.value = (Number(amount.value) || 0) + q;
        update();
      });
      amount.addEventListener('keydown', (e) => { if (e.key === 'Enter') body.closest('.dm-modal').querySelector('.dm-btn.primary').click(); });
      setTimeout(() => amount.focus(), 0);
    },
  }).then(() => saved);

  function read(body) {
    const n = Math.floor(Number(body.querySelector('#xpAmount').value));
    if (!Number.isFinite(n) || body.querySelector('#xpAmount').value === '') return null;
    const mode = body.querySelector('input[name="xpMode"]:checked').value;
    if (mode === 'set') return { set: Math.max(0, n) };
    return { add: mode === 'take' ? -Math.abs(n) : Math.abs(n) };
  }
}
