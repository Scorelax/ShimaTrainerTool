// Texture on the 3D map's land up close (the user's call, 2026-10-22; reworked for the flat map, 2026-11-09): zoomed in,
// the painting blurs, so this makes up what it can't hold, in the land's shader -- no bigger picture to download. Each
// kind of ground has its own: ridges on rock, soft drifts and a sparkle on snow, clumps of leaves and patches of colour
// in the forests, a faint grain on the grass, lit from the north-west. The water is left alone.
//
// What's where comes from the land's own data (landInfoTexture: the sea, and the height the mountains were given) and
// from the painting's colour on the spot (snow, trees) -- not from the land's shape, which is flat now.
//
// Each layer comes in only once its grain is bigger than a few screen pixels, so from far out the map looks exactly as it
// did, and nothing shimmers while it moves. It never changes on its own, so it costs nothing while the map's left alone.
// region-map.js puts it on the land's material (addLandDetail); a device with no graphics card goes without (it costs a
// little on every pixel).
import * as THREE from '../vendor/three/three.module.min.js';

// The land's made-up heights (make-terrain.js) reach ~450 m at most away from the mountains: from the first of these
// it's mountain, and all mountain at the second.
const MOUNTAIN = [480, 850];
const LAYERS = 5;
const COARSEST = 0.4;   // the first layer's cells to a painting pixel (about 2.5 painting pixels across, ~300 m)

const GLSL = /* glsl */ `
uniform sampler2D ldInfo;
uniform vec2 ldSize;
varying vec3 vLandPos;

// value noise -- the cell wrapped every 289 so the hash stays exact however far out on the map
float ldHash(vec2 c) {
  c = mod(c, 289.0);
  vec3 p = fract(vec3(c.xyx) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float ldNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(ldHash(i), ldHash(i + vec2(1.0, 0.0)), u.x), mix(ldHash(i + vec2(0.0, 1.0)), ldHash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// The relief at p: the layers, each as strong as its weight w (faded out while it's too fine for the screen), each turned
// its own way so the noise's square grid doesn't line up and show. Rock is ridged -- crests, rounded a little (sharp ones
// drew a jigsaw of lines); the rest is soft.
const mat2 LD_TURN = mat2(0.737, 0.676, -0.676, 0.737);
float ldRelief(vec2 p, float rock, float w[${LAYERS}]) {
  float h = 0.0;
  vec2 q = p * ${COARSEST.toFixed(2)};
  float a = 1.0;
  for (int i = 0; i < ${LAYERS}; i++) {
    if (w[i] > 0.0) { // (a layer too fine to show costs nothing)
      vec2 at = q + float(i) * 17.3;
      float soft = ldNoise(at);
      float s = 2.0 * ldNoise(at * 1.6) - 1.0;
      h += w[i] * a * mix(soft, 1.0 - sqrt(s * s + 0.03), rock * 0.5);
    }
    q = LD_TURN * q * 2.31;
    a *= 0.45; // about 1 / f: every layer adds as much light and shade
  }
  return h;
}

// Clumps of leaves: a scattered set of soft round bumps overlapping (nothing with an edge -- a clump ending at a line drew
// a pattern of cracks), each bright on its north-west side, where the map's light comes from, and dark on the other.
// About -1 to 1.
float ldCrowns(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float light = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 r = g + vec2(ldHash(i + g), ldHash(i + g + 57.0)) - f;
      light += exp(-6.0 * dot(r, r)) * dot(r, vec2(0.75, 0.66));
    }
  }
  return light * 5.0;
}

vec3 landDetail(vec3 colour) {
  vec2 p = vLandPos.xz;
  // world units (painting pixels) a screen pixel covers here -- how fine a layer can be and still show
  float foot = max(fwidth(p.x), fwidth(p.y));
  float w[${LAYERS}];
  float f = ${COARSEST.toFixed(2)};
  float seen = 0.0;
  for (int i = 0; i < ${LAYERS}; i++) {
    // (x 1.6: the rock's grain is that much finer)
    w[i] = 1.0 - smoothstep(0.1, 0.35, foot * f * 1.6);
    seen = max(seen, w[i]);
    f *= 2.31;
  }
  if (seen <= 0.0) return colour;

  vec2 info = texture2D(ldInfo, (p + ldSize * 0.5) / ldSize).rg;
  float mountain = smoothstep(0.05, 0.6, info.g);
  // water: the sea (the land's data), and blue paint off the mountains (a snowfield's blue shadows aren't lakes)
  float water = max(1.0 - smoothstep(0.2, 0.8, info.r), smoothstep(0.04, 0.16, colour.b - max(colour.r, colour.g)) * (1.0 - mountain));
  if (water >= 1.0) return colour;

  // what's painted right here (the colours are light, not sRGB: a painted tree's green is well under 0.45)
  float snow = mountain * smoothstep(0.3, 0.65, min(colour.r, min(colour.g, colour.b)));
  float rock = mountain * (1.0 - snow);
  float trees = (1.0 - mountain) * (1.0 - smoothstep(0.38, 0.55, colour.r / max(colour.g, 0.001))) * (1.0 - smoothstep(0.3, 0.5, colour.g)) * step(colour.b, colour.g);

  float e = max(foot * 0.5, 0.002); // the step the relief's slope is measured over: about half a screen pixel
  float h0 = ldRelief(p, rock, w);
  float hx = ldRelief(p + vec2(e, 0.0), rock, w);
  float hz = ldRelief(p + vec2(0.0, e), rock, w);
  vec2 grad = vec2(hx - h0, hz - h0) / e;
  // lit from the north-west, like a shaded relief map
  float strength = (0.04 + rock * 0.08 + snow * 0.01) * (1.0 - water);
  float light = clamp(-(grad.x + grad.y) * strength, -0.38, 0.38);

  float g1 = 1.0 - smoothstep(0.1, 0.35, foot * 9.7), g2 = 1.0 - smoothstep(0.1, 0.35, foot * 23.1);
  float grain = ((ldNoise(p * 9.7) - 0.5) * g1 + (ldNoise(p * 23.1) - 0.5) * g2) * (0.05 + rock * 0.04) * (1.0 - water);
  vec3 c = colour * (1.0 + light + grain);

  // the forests: clumps of leaves in two sizes, and patches of darker and more yellow ones
  if (trees > 0.0) {
    float big = 1.0 - smoothstep(0.1, 0.35, foot * 0.9 * 1.6), small = 1.0 - smoothstep(0.1, 0.35, foot * 2.3 * 1.6);
    float leaves = (big > 0.0 ? ldCrowns(p * 0.9 + 3.0) * 0.2 * big : 0.0) + (small > 0.0 ? ldCrowns(LD_TURN * p * 2.3) * 0.12 * small : 0.0);
    float patches = ldNoise(p * 0.3 + 41.0) * 0.6 + ldNoise(p * 0.8 + 7.0) * 0.4;
    float fade = 1.0 - smoothstep(0.1, 0.35, foot * 0.3);
    c *= 1.0 + leaves * trees;
    c *= mix(vec3(1.0), mix(vec3(0.82, 0.88, 0.84), vec3(1.18, 1.08, 0.78), smoothstep(0.32, 0.68, patches)), trees * fade);
  }
  // the snow: a few glinting crystals, right up close
  if (snow > 0.0) {
    float fade = 1.0 - smoothstep(0.1, 0.35, foot * 3.7);
    if (fade > 0.0) c += vec3(0.9, 0.95, 1.0) * smoothstep(0.88, 0.97, ldNoise(p * 3.7 + 13.0)) * snow * fade * 0.3;
  }
  return c;
}
`;

/** What's where on the land, as a texture the shader reads: R the land (0 on the sea), G how much of a mountain it is.
 * Rows as the painting's (row 0 at its top). */
function landInfoTexture({ W, H, kind, metres }) {
  const data = new Uint8Array(W * H * 2);
  const [lo, hi] = MOUNTAIN;
  for (let i = 0; i < W * H; i++) {
    if (kind[i] === 0) continue;
    const t = Math.min(1, Math.max(0, (metres[i] - lo) / (hi - lo)));
    data[i * 2] = 255;
    data[i * 2 + 1] = Math.round(255 * t * t * (3 - 2 * t));
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGFormat, THREE.UnsignedByteType);
  tex.unpackAlignment = 1; // (rows of any width)
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Puts the texture on the land's material (a MeshBasicMaterial with the map's picture as `map`). `land`: region-map.js's
 * ({ W, H, kind, metres }). */
export function addLandDetail(material, land) {
  const info = landInfoTexture(land);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.ldInfo = { value: info };
    shader.uniforms.ldSize = { value: new THREE.Vector2(land.W, land.H) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLandPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLandPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL}`)
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = landDetail(diffuseColor.rgb);');
  };
  material.customProgramCacheKey = () => 'land-detail';
  material.needsUpdate = true;
}
