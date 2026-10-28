// The regions' own paintings on the 3D map up close (the user's call, 2026-10-28): a map built from regions
// (js/dm/map-upload.js's buildRegions) keeps each region's whole painting on the Pi -- up to 4096 pixels for one region,
// where the map's painted picture has twice the map's pixels for the whole island. Zoomed in far enough that the
// painted picture would start to blur, the regions in view are drawn over the land in the Painted style from their own
// paintings, shaded the way the painted picture is (the map's `shade` picture: the light on the land, as paintTexture
// laid it on). The Topographic style keeps its own picture.
//
// Only what's needed is loaded: a region's painting once it's in view while zoomed in, a few at most (each is ~90 MB of
// graphics memory at 4096 -- a phone takes two, at 2048), the one used longest ago let go first. region-map.js puts it
// on the land's material (addRegionDetail) and asks it every frame drawn (update) -- just sums, unless a painting has
// to be fetched; when one's ready it's told (onReady) to draw again.
import * as THREE from '../vendor/three/three.module.min.js';

const SLOTS = 4;            // regions drawn at once (the shader has this many)
const NEED_SPP = 1.2;       // screen pixels a map pixel covers before the regions' own paintings come in

const GLSL = /* glsl */ `
uniform sampler2D rdTex0;
uniform sampler2D rdTex1;
uniform sampler2D rdTex2;
uniform sampler2D rdTex3;
uniform mat3 rdMat[4];
uniform float rdOn[4];
uniform sampler2D rdShade;
uniform float rdUse;
uniform vec2 rdSize;
varying vec3 vRdPos;

// one region's painting (premultiplied) laid over what's under it
vec4 rdOver(vec4 under, sampler2D tex, mat3 m, float on, vec2 px) {
  if (on <= 0.0) return under;
  vec2 uv = (m * vec3(px, 1.0)).xy;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return under;
  vec4 d = texture2D(tex, uv) * on;
  return d + under * (1.0 - d.a);
}

vec3 regionDetail(vec3 colour) {
  if (rdUse <= 0.0) return colour;
  vec2 px = vRdPos.xz + rdSize * 0.5;   // the map's pixels
  vec4 d = vec4(0.0);
  d = rdOver(d, rdTex0, rdMat[0], rdOn[0], px);
  d = rdOver(d, rdTex1, rdMat[1], rdOn[1], px);
  d = rdOver(d, rdTex2, rdMat[2], rdOn[2], px);
  d = rdOver(d, rdTex3, rdMat[3], rdOn[3], px);
  if (d.a <= 0.0) return colour;
  // the painted picture's light on the land (0.8 to 1.15 times the painting's colour; 1 on the water) -- applied to the
  // painting's sRGB colour, so ~ to the 2.2 here
  float k = 0.7 + texture2D(rdShade, px / max(rdSize - 1.0, vec2(1.0))).r * 0.5;
  return mix(colour, (d.rgb / d.a) * pow(k, 2.2), d.a);
}
`;

const blank = () => {
  const t = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  t.needsUpdate = true;
  return t;
};

/** A region's painting (or the shade picture) from the Pi as a texture: `maxSide` caps it (a phone's), `srgb` for
 * colours (the shade is plain numbers). */
async function loadPicture(renderer, url, { maxSide = 4096, srgb = true } = {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The Pi didn't send a region's painting (${res.status})`);
  const blob = await res.blob();
  let bitmap = await createImageBitmap(blob, { premultiplyAlpha: srgb ? 'premultiply' : 'none', colorSpaceConversion: 'none', imageOrientation: 'none' });
  const side = Math.max(bitmap.width, bitmap.height);
  if (side > maxSide) {
    const f = maxSide / side;
    const smaller = await createImageBitmap(bitmap, { resizeWidth: Math.round(bitmap.width * f), resizeHeight: Math.round(bitmap.height * f), resizeQuality: 'high', premultiplyAlpha: srgb ? 'premultiply' : 'none' });
    bitmap.close();
    bitmap = smaller;
  }
  const tex = new THREE.Texture(bitmap);
  tex.flipY = false;   // (row 0 the picture's top: the shader works in the map's pixels, y down)
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.premultiplyAlpha = false;   // (it already is)
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  return tex;
}

/**
 * addRegionDetail(material, { renderer, regions, shadeUrl, size: [W, H], phone, onReady }) -> { update(camera, target,
 * viewHeight), setStyle(style), dispose() }. `regions`: the map's (map-version.js) -- each { id, file, W, H, toMap }.
 */
export function addRegionDetail(material, { renderer, regions, shadeUrl, size, phone = false, onReady }) {
  const [W, H] = size;
  const maxSide = Math.min(phone ? 2048 : 4096, renderer.capabilities.maxTextureSize || 4096);
  const keep = phone ? 2 : SLOTS;   // paintings held (the ones drawn among them)
  const empty = blank();
  const uniforms = {
    rdTex0: { value: empty }, rdTex1: { value: empty }, rdTex2: { value: empty }, rdTex3: { value: empty },
    rdMat: { value: Array.from({ length: SLOTS }, () => new THREE.Matrix3()) },
    rdOn: { value: new Array(SLOTS).fill(0) },
    rdShade: { value: empty },
    rdUse: { value: 0 },
    rdSize: { value: new THREE.Vector2(W, H) },
  };
  // each region: where it sits on the map (a box in the map's pixels) and the map's pixels -> its picture's (0..1)
  const list = regions.filter(r => r.file && Array.isArray(r.toMap)).map((r, order) => {
    const [a, b, c, d, e, f] = r.toMap;
    const corners = [[0, 0], [r.W, 0], [0, r.H], [r.W, r.H]].map(([x, y]) => [a * x + b * y + c, d * x + e * y + f]);
    const det = a * e - b * d;
    const inv = [e / det, -b / det, (b * f - c * e) / det, -d / det, a / det, (c * d - a * f) / det];
    return {
      order, url: r.file,
      box: [Math.min(...corners.map(p => p[0])), Math.min(...corners.map(p => p[1])), Math.max(...corners.map(p => p[0])), Math.max(...corners.map(p => p[1]))],
      uv: new THREE.Matrix3().set(inv[0] / r.W, inv[1] / r.W, inv[2] / r.W, inv[3] / r.H, inv[4] / r.H, inv[5] / r.H, 0, 0, 1),
      tex: null, loading: null, failed: false, used: 0,
    };
  });
  let style = 'topo';
  let shade = null;   // the shade picture's promise
  let shadeReady = false;
  let disposed = false;

  const before = material.onBeforeCompile;
  const beforeKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, r) => {
    before?.call(material, shader, r);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRdPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRdPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    // (first after the painted picture: the sea and the made-up detail go over the regions' paintings too)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL}`)
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = regionDetail(diffuseColor.rgb);');
  };
  material.customProgramCacheKey = () => `${beforeKey.call(material)}+regions`;
  material.needsUpdate = true;

  function fetchRegion(x) {
    x.loading = loadPicture(renderer, x.url, { maxSide }).then((tex) => {
      if (disposed) { tex.image?.close?.(); tex.dispose(); return; }
      x.tex = tex;
      onReady?.();
    }).catch(() => { x.failed = true; }).finally(() => { x.loading = null; });
  }

  function letGo(x) {
    x.tex.image?.close?.();
    x.tex.dispose();
    x.tex = null;
  }

  /** Which regions to draw for this view (the camera looking at `target`, the screen `viewHeight` pixels tall). */
  function update(camera, target, viewHeight) {
    if (disposed || !list.length) return;
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const dist = camera.position.distanceTo(target);
    const halfH = dist * Math.tan(fov / 2);                 // world units (map pixels) from the middle to the top
    const spp = viewHeight / (2 * halfH);
    const on = uniforms.rdOn.value;
    on.fill(0);
    // (a slot not drawn holds nothing: a painting let go mustn't be bound again)
    for (let i = 0; i < SLOTS; i++) uniforms[`rdTex${i}`].value = empty;
    if (style !== 'painted' || spp < NEED_SPP) return;
    if (!shade) {
      shade = loadPicture(renderer, shadeUrl, { srgb: false }).then((tex) => {
        if (disposed) { tex.dispose(); return; }
        uniforms.rdShade.value = tex;
        shadeReady = true;
        onReady?.();
      }).catch(() => {});
    }
    // what's in view: round the middle, out as far as the screen's long side and the tilt show (roughly, and generous)
    const tx = target.x + W / 2, ty = target.z + H / 2;
    const reach = halfH * Math.max(1, camera.aspect) * (1.2 + 2 * Math.sin(Math.min(1.2, Math.acos(Math.min(1, Math.max(-1, (camera.position.y - target.y) / dist))))));
    const gap = x => Math.hypot(Math.max(x.box[0] - tx, 0, tx - x.box[2]), Math.max(x.box[1] - ty, 0, ty - x.box[3]));
    const now = performance.now();
    const wanted = list.filter(x => !x.failed && gap(x) < reach).sort((p, q) => gap(p) - gap(q)).slice(0, keep);
    wanted.forEach((x) => {
      x.used = now;
      if (!x.tex && !x.loading) fetchRegion(x);
    });
    // no more held than `keep`: the ones used longest ago go
    const held = list.filter(x => x.tex).sort((p, q) => q.used - p.used);
    held.slice(keep).forEach(letGo);
    if (!shadeReady) return;
    // drawn in the order they were pasted onto the map (a later one over an earlier one where they meet)
    wanted.filter(x => x.tex).sort((p, q) => p.order - q.order).forEach((x, i) => {
      uniforms[`rdTex${i}`].value = x.tex;
      uniforms.rdMat.value[i].copy(x.uv);
      on[i] = 1;
    });
  }

  function setStyle(next) {
    style = next;
    uniforms.rdUse.value = next === 'painted' ? 1 : 0;
  }

  function dispose() {
    disposed = true;
    list.forEach((x) => { if (x.tex) letGo(x); });
    if (uniforms.rdShade.value !== empty) uniforms.rdShade.value.dispose();
    empty.dispose();
  }

  return { update, setStyle, dispose };
}
