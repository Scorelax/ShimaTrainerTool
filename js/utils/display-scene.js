// What the table TV shows: a background picture of wherever the players are and pictures placed on it (Pokemon, NPCs,
// the players' trainers, uploads) -- set up in the DM console's Display module (js/dm/display.js), stored on the Pi
// (dm_state 'display-scene') and drawn by the TV (display.js). Both draw it with renderScene below, so what the DM
// arranges is exactly what the TV shows. During a battle the background stays and the battle (turn order, whoever's
// turn it is) goes on top; the placed pictures are put away until it ends unless `battlePictures` is 'keep'.
//
// Scene: { background: {url, name} | null, items: [Item], battlePictures: 'away' | 'keep' }
// Item:  { id, kind: 'pokemon' | 'npc' | 'trainer' | 'image', label, src, still, animated, x, y, size, flip, hidden }
//   x, y = the picture's middle, as a share of the screen's width / height (0..1); size = its side as a share of the
//   screen's height -- pictures are always square (the picture itself fits inside, never stretched). The TV is 16:9.
//   Later items are drawn on top. `still` / `animated` are the Pokemon's two pictures (`src` is the one in use).

export const SCREEN_RATIO = 16 / 9;
export const BATTLE_PICTURES = { away: 'Put the pictures away', keep: 'Keep the pictures on' };

export function normaliseScene(s) {
  const out = {
    background: s?.background?.url ? { url: String(s.background.url), name: String(s.background.name || '') } : null,
    items: Array.isArray(s?.items) ? s.items.filter(i => i && i.id && i.src) : [],
    battlePictures: BATTLE_PICTURES[s?.battlePictures] ? s.battlePictures : 'away',
  };
  return out;
}

/** The scene as the TV draws it right now -- during a battle without the placed pictures, unless they're kept on. */
export function sceneOnScreen(scene, battleActive) {
  if (!battleActive || scene.battlePictures === 'keep') return scene;
  return { ...scene, items: [] };
}

/** Anything to show at all (a background, or a picture that isn't hidden)? */
export function sceneHasContent(scene) {
  return !!scene?.background || (scene?.items || []).some(i => !i.hidden);
}

const IS_VIDEO = /\.mp4(\?|$)/i;

function mediaHtml(src) {
  return IS_VIDEO.test(src)
    ? `<video class="scene-media" src="${src}" autoplay muted loop playsinline disablepictureinpicture disableremoteplayback></video>`
    : `<img class="scene-media" src="${src}" alt="" draggable="false">`;
}

/** Draws `scene` into `stage` (an element the size of the screen, see injectSceneStyles), changing only what changed --
 * a picture's <video>/<img> is only rebuilt when its source does, so animated sprites don't restart on every update.
 * `editing` (the DM's editor): hidden pictures are drawn faded, and the `selectedId` one gets corner handles. */
export function renderScene(stage, scene, { editing = false, selectedId = null } = {}) {
  if (!stage) return;
  injectSceneStyles();
  stage.classList.add('scene-stage');
  stage.classList.toggle('editing', editing);
  let bg = stage.querySelector(':scope > .scene-bg');
  if (!bg) {
    bg = document.createElement('div');
    bg.className = 'scene-bg';
    stage.prepend(bg);
  }
  const bgUrl = scene?.background?.url || '';
  if (bg.dataset.url !== bgUrl) {
    bg.dataset.url = bgUrl;
    bg.style.backgroundImage = bgUrl ? `url("${bgUrl.replace(/"/g, '%22')}")` : '';
  }

  const items = (scene?.items || []).filter(i => editing || !i.hidden);
  const keep = new Set(items.map(i => i.id));
  stage.querySelectorAll(':scope > .scene-item').forEach(el => { if (!keep.has(el.dataset.id)) el.remove(); });
  items.forEach((it, index) => {
    let el = stage.querySelector(`:scope > .scene-item[data-id="${CSS.escape(it.id)}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'scene-item';
      el.dataset.id = it.id;
      stage.appendChild(el);
    }
    if (el.dataset.src !== it.src) {
      el.dataset.src = it.src;
      el.innerHTML = mediaHtml(it.src);
      const media = el.querySelector('.scene-media');
      media.addEventListener('error', () => el.classList.add('broken'));
    }
    const size = Math.max(0.01, Number(it.size) || 0.3);
    el.style.left = `${(Number(it.x) || 0) * 100}%`;
    el.style.top = `${(Number(it.y) || 0) * 100}%`;
    el.style.height = `${size * 100}%`;
    el.style.width = `${(size * 100) / SCREEN_RATIO}%`;
    el.style.zIndex = String(index + 1);
    el.classList.toggle('flip', !!it.flip);
    el.classList.toggle('is-hidden', !!it.hidden);
    el.classList.toggle('selected', editing && it.id === selectedId);
    el.title = editing ? `${it.label || ''}${it.hidden ? ' (hidden -- not on the TV)' : ''}` : '';
    const wantHandles = editing && it.id === selectedId;
    const hasHandles = !!el.querySelector('.scene-handle');
    if (wantHandles && !hasHandles) {
      el.insertAdjacentHTML('beforeend', ['nw', 'ne', 'sw', 'se'].map(h => `<span class="scene-handle ${h}" data-handle="${h}"></span>`).join(''));
    } else if (!wantHandles && hasHandles) {
      el.querySelectorAll('.scene-handle').forEach(h => h.remove());
    }
  });
  // Keep the DOM order the drawing order too (z-index already does it) -- only moved when it differs.
  const order = [...stage.querySelectorAll(':scope > .scene-item')].map(el => el.dataset.id);
  if (order.join('|') !== items.map(i => i.id).join('|')) {
    items.forEach((it) => {
      const el = stage.querySelector(`:scope > .scene-item[data-id="${CSS.escape(it.id)}"]`);
      if (el) stage.appendChild(el);
    });
  }
}

let _styled = false;
export function injectSceneStyles() {
  if (_styled) return;
  _styled = true;
  const css = document.createElement('style');
  css.textContent = `
    .scene-stage { position: relative; overflow: hidden; background: #0a0a12; }
    .scene-bg { position: absolute; inset: 0; background-size: cover; background-position: center; background-repeat: no-repeat; }
    .scene-item { position: absolute; transform: translate(-50%, -50%); box-sizing: border-box; }
    .scene-media { width: 100%; height: 100%; object-fit: contain; display: block; pointer-events: none; user-select: none; }
    .scene-item.flip .scene-media { transform: scaleX(-1); }
    .scene-item.broken .scene-media { opacity: 0; }
    .scene-stage.editing .scene-item { cursor: move; touch-action: none; }
    .scene-stage.editing .scene-item:hover { outline: 1px dashed rgba(255, 215, 0, 0.55); }
    .scene-stage.editing .scene-item.selected { outline: 2px solid #ffd700; }
    .scene-stage.editing .scene-item.is-hidden { opacity: 0.35; outline: 1px dashed rgba(255, 255, 255, 0.6); }
    .scene-stage.editing .scene-item.broken { background: rgba(255, 255, 255, 0.08); }
    .scene-handle { position: absolute; width: 14px; height: 14px; background: #ffd700; border: 2px solid #0a0a12; border-radius: 3px; touch-action: none; }
    .scene-handle.nw { left: -8px; top: -8px; cursor: nwse-resize; }
    .scene-handle.se { right: -8px; bottom: -8px; cursor: nwse-resize; }
    .scene-handle.ne { right: -8px; top: -8px; cursor: nesw-resize; }
    .scene-handle.sw { left: -8px; bottom: -8px; cursor: nesw-resize; }
  `;
  document.head.appendChild(css);
}
