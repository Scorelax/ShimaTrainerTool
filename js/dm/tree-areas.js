// DM console -- the tree areas (the user's call, 2026-11-04: "different trees in different places, like snow in the
// mountains"). The Locations tab's 🌲 Tree areas: the DM marks areas on the map (the location editor's area tools) and
// picks which of their own models ("mapobject-<kind>.glb", uploaded here) the trees in each are drawn with. Outside every
// area the trees are as before: the models named tree / tree_pine / tree_leafy, or the ones made in code. Where two
// overlap, the smaller wins. Only the DM sees the areas -- the players see the trees.
// Kept in the 'region-map' state's treeAreas, in the first map's pixels (map-version.js treeAreasOn), so they stay put
// whichever map is in use; the 3D map (region-map.js, map-objects.js) reads them when it's made.
import { DmAPI } from '../api.js';
import { escapeHtml, toast, newId } from './dm-common.js';
import * as F from '../region-map/map-features.js';
import { makePane } from './map-upload.js';
import { loadPainting, editLocationShape, drawShape } from './location-map.js';
import { currentMap, loadMapState, treeAreasOn, transformShape } from '../region-map/map-version.js';
import { MODEL_KINDS, MAX_TRIANGLES } from '../region-map/map-objects.js';

// the models the map uses everywhere (map-objects.js MODEL_KINDS): the trees' are shown, the rocks' and summits' aren't
// offered for an area
const EVERYWHERE = new Set([...MODEL_KINDS.pine, ...MODEL_KINDS.leafy]);
const NOT_TREES = new Set([...MODEL_KINDS.rock, ...MODEL_KINDS.searock, ...MODEL_KINDS.peak]);
const LIMIT = MAX_TRIANGLES.small;

const triangleCache = {};

/** A .glb's triangles (from its URL or its bytes). */
function trianglesOf(src) {
  const key = typeof src === 'string' ? src : null;
  if (key && triangleCache[key]) return triangleCache[key];
  const p = import('../vendor/three/GLTFLoader.js').then(({ GLTFLoader }) => (typeof src === 'string'
    ? new GLTFLoader().loadAsync(src)
    : new Promise((resolve, reject) => new GLTFLoader().parse(src, '', resolve, reject))))
    .then((gltf) => {
      let n = 0;
      gltf.scene.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
      return Math.round(n);
    });
  if (key) { triangleCache[key] = p; p.catch(() => { delete triangleCache[key]; }); }
  return p;
}

export async function openTreeAreas(locations = []) {
  let P, map, st, models;
  try {
    [P, map, st, models] = await Promise.all([loadPainting(), currentMap({ fresh: true }), loadMapState({ fresh: true }), DmAPI.mapObjectModels()]);
  } catch (err) {
    toast(`Couldn't load the map: ${err.message}`);
    return;
  }
  const { W, H } = P;
  // in this map's pixels while here (saved in the first map's)
  let areas = treeAreasOn(st, map).map(a => ({ id: a.id, name: a.name || '', models: a.models || [], shape: { kind: 'area', rings: a.rings } }));
  let selected = areas[0]?.id || null;
  const regions = locations.filter(l => l.type === 'region' && l.shape?.kind === 'area');

  const overlay = document.createElement('div');
  overlay.className = 'dm-lme-overlay';
  overlay.innerHTML = `
    <div class="dm-lme-head"><h3>🌲 Tree areas</h3><span class="dm-lme-spacer"></span>
      <button class="dm-btn" data-ta="close">Close</button></div>
    <div class="dm-lme-body">
      <aside class="dm-lme-tools dm-ta-side" id="taSide"></aside>
      <div class="dm-lme-stage" id="taStage"></div>
    </div>`;
  document.body.appendChild(overlay);
  const side = overlay.querySelector('#taSide');

  const pane = makePane(overlay.querySelector('#taStage'), {
    W, H,
    draw: (ctx, v) => {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(P.shown, v.ox, v.oy, W * v.s, H * v.s);
      regions.forEach(l => drawShape(ctx, { kind: 'area', rings: l.shape.rings }, v, { faint: true }));
      areas.filter(a => a.shape.rings.length).forEach(a => drawShape(ctx, a.shape, v, { faint: a.id !== selected, name: a.name || 'An area' }));
    },
    onClick: ([x, y]) => {
      const hit = areas.filter(a => F.pointInRings(a.shape.rings, x, y))
        .sort((a, b) => size(a) - size(b))[0];
      if (hit) { selected = hit.id; render(); }
    },
  });
  const size = a => Math.abs(a.shape.rings.reduce((n, r) => n + F.ringArea(r), 0));

  async function save() {
    try {
      const now = await loadMapState({ fresh: true });
      await DmAPI.saveState('region-map', {
        ...now,
        treeAreas: areas.map(a => ({ id: a.id, name: a.name, models: a.models, rings: transformShape(a.shape, map.toBase || [1, 0, 0, 0, 1, 0]).rings })),
      });
    } catch (err) {
      toast(`Couldn't save the tree areas: ${err.message}`);
    }
  }

  const treeKinds = () => [...new Set(models.map(m => m.kind).filter(k => !NOT_TREES.has(k)))].sort();

  function render() {
    const kinds = treeKinds();
    const byKind = k => models.filter(m => m.kind === k);
    side.innerHTML = `
      <div class="dm-hint">Mark where the trees on the map use <b>your own models</b> -- snowy pines in the mountains, say.
        Outside every area the trees are as before${kinds.some(k => EVERYWHERE.has(k)) ? ' (your <i>tree</i> models)' : ''}; where two overlap, the smaller wins.
        The players never see the areas, only the trees.</div>
      <button class="dm-btn primary" data-ta="new">＋ New area</button>
      ${areas.map(a => `
        <div class="dm-ta-area${a.id === selected ? ' active' : ''}" data-id="${escapeHtml(a.id)}">
          <div class="dm-row"><input class="dm-input" data-ta-name value="${escapeHtml(a.name)}" placeholder="e.g. The snowy peaks" maxlength="60">
            <button class="dm-icon-btn danger" data-ta="delete" title="Delete this area">🗑</button></div>
          <button class="dm-btn small" data-ta="mark">✏️ ${a.shape.rings.length ? 'Change it on the map' : 'Mark it on the map'}</button>
          <div class="dm-ta-label">Its trees</div>
          ${kinds.length ? `<div class="dm-ta-models">${kinds.map(k => `<label class="dm-ta-model"><input type="checkbox" data-ta-model="${escapeHtml(k)}"${a.models.includes(k) ? ' checked' : ''}>
            ${escapeHtml(k.replace(/_/g, ' '))}${byKind(k).length > 1 ? ` <small>×${byKind(k).length}</small>` : ''}</label>`).join('')}</div>
            ${a.models.length ? '' : '<div class="dm-hint">None picked: its trees are as anywhere else.</div>'}`
          : '<div class="dm-hint">Upload a model below first.</div>'}
        </div>`).join('')}
      <div class="dm-card-title">🌳 Your models</div>
      <div class="dm-hint">A light <b>.glb</b> (${LIMIT.toLocaleString()} triangles at most -- thousands are drawn at once). Two under one name are mixed in.
        Named <i>tree</i>, <i>tree_pine</i> or <i>tree_leafy</i>: used for the trees everywhere outside the areas.</div>
      <button class="dm-btn" data-ta="upload">⬆ Upload a model</button>
      <div class="dm-ta-files">${models.filter(m => !NOT_TREES.has(m.kind)).map(m => `
        <div class="dm-ta-file" data-file="${escapeHtml(m.file)}"><span>${escapeHtml(m.file.replace(/^mapobject-/i, ''))}${EVERYWHERE.has(m.kind) ? ' <small>(everywhere)</small>' : ''}</span>
          <small class="dm-ta-tris" data-url="${escapeHtml(m.url)}">…</small>
          <button class="dm-icon-btn danger" data-ta="drop" title="Delete this model">🗑</button></div>`).join('') || '<div class="dm-hint">None yet.</div>'}</div>`;
    side.querySelectorAll('.dm-ta-tris').forEach((el) => {
      trianglesOf(el.dataset.url).then((n) => {
        el.textContent = `${n.toLocaleString()} triangles`;
        el.classList.toggle('over', n > LIMIT);
        if (n > LIMIT) el.title = `Over ${LIMIT.toLocaleString()}: too heavy, the map leaves it out`;
      }).catch(() => { el.textContent = "won't load"; el.classList.add('over'); });
    });
    pane.redraw();
  }

  const areaOf = el => areas.find(a => a.id === el.closest('[data-id]')?.dataset.id);

  side.addEventListener('click', async (e) => {
    const card = e.target.closest('.dm-ta-area');
    if (card && card.dataset.id !== selected && !e.target.closest('input')) { selected = card.dataset.id; render(); }
    const act = e.target.closest('[data-ta]')?.dataset.ta;
    if (act === 'new') {
      const a = { id: newId('trees'), name: '', models: [], shape: { kind: 'area', rings: [] } };
      if (!(await mark(a))) return;
      areas.push(a);
      selected = a.id;
      render();
      save();
      side.querySelector(`[data-id="${a.id}"] [data-ta-name]`)?.focus();
    } else if (act === 'mark') {
      const a = areaOf(e.target);
      if (a && await mark(a)) { render(); save(); }
    } else if (act === 'delete') {
      const a = areaOf(e.target);
      if (!a || !confirm(`Delete the tree area${a.name ? ` "${a.name}"` : ''}? Its trees go back to the ones used everywhere.`)) return;
      areas = areas.filter(x => x !== a);
      render();
      save();
    } else if (act === 'upload') {
      upload();
    } else if (act === 'drop') {
      const file = e.target.closest('[data-file]').dataset.file;
      if (!confirm(`Delete the model ${file}? The trees it's used for go back to the others.`)) return;
      try {
        await DmAPI.deleteMapObjectModel(file);
        models = models.filter(m => m.file !== file);
        render();
        save();   // (the map made again without it)
      } catch (err) { toast(err.message); }
    }
  });
  side.addEventListener('change', (e) => {
    const a = areaOf(e.target);
    if (!a) return;
    if (e.target.matches('[data-ta-name]')) { a.name = e.target.value.trim(); pane.redraw(); save(); }
    const k = e.target.dataset.taModel;
    if (k) {
      a.models = e.target.checked ? [...a.models, k] : a.models.filter(x => x !== k);
      render();
      save();
    }
  });

  /** The area marked on the map (the location editor's area tools) -> whether it was. */
  async function mark(a) {
    const shape = await editLocationShape({ name: a.name || 'A tree area', type: 'forest', shape: a.shape.rings.length ? a.shape : null }, [], { kinds: ['area'] });
    if (!shape?.rings?.length) return false;
    a.shape = { kind: 'area', rings: shape.rings };
    return true;
  }

  async function upload() {
    const file = await new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.glb,model/gltf-binary';
      input.onchange = () => resolve(input.files[0] || null);
      input.click();
    });
    if (!file) return;
    if (!/\.glb$/i.test(file.name)) { toast('That isn\'t a .glb model.'); return; }
    let tris;
    try {
      tris = await trianglesOf(await file.arrayBuffer());
    } catch (err) {
      toast(`That model won't load: ${err.message}`);
      return;
    }
    if (tris > LIMIT) {
      toast(`It has ${tris.toLocaleString()} triangles -- ${LIMIT.toLocaleString()} at most for a tree. Lower its poly count (in Meshy, or Blender's Decimate) and try again.`);
      return;
    }
    const guess = file.name.replace(/\.glb$/i, '').replace(/^mapobject-/i, '').replace(/[-_\s]*\d+$/, '').replace(/[-_]+/g, ' ');
    const name = prompt(`A name for it (${tris.toLocaleString()} triangles) -- e.g. "snowy pine". One with the same name already: this one is mixed in with it.`, guess);
    if (!name?.trim()) return;
    try {
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error("Couldn't read the file"));
        r.readAsDataURL(file);
      });
      const got = await DmAPI.saveMapObjectModel({ name, data });
      models = [...models.filter(m => m.file !== got.file), got];
      toast(`Uploaded as ${got.file}.`);
      render();
      if (areas.some(a => a.models.includes(got.kind)) || EVERYWHERE.has(got.kind)) save();   // (the map made again with it)
    } catch (err) { toast(err.message); }
  }

  render();
  await new Promise((resolve) => {
    const close = () => { pane.destroy(); document.removeEventListener('keydown', onKey); overlay.remove(); resolve(); };
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.dm-lme-overlay ~ .dm-lme-overlay')) close(); };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('[data-ta="close"]').addEventListener('click', close);
  });
}
