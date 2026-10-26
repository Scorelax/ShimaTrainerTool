// The sea on the 3D map (the user's call, 2026-10-26: a bit of life in the water, made in code rather than as a model):
// waves in three sizes drifting their own ways, glints of the map's sun from the north-west on them, the water lighter
// close to the coast and darker further out, and faint surf pulsing along the shore. Over whatever map style is
// showing, only where it's blue -- a name painted over the water, or the painting's own white surf, is left as it is.
//
// The waves come in only once they're a good few screen pixels big (FADE), like the land's detail (land-detail.js),
// so from far out the sea looks as it did. region-map.js puts it on the land's material (addSea) and moves `time` on while
// the waves can be seen; a device with no graphics card goes without.
import * as THREE from '../vendor/three/three.module.min.js';

const REACH = 40;   // painting pixels from the coast where the water has darkened all the way (and the info stops)
// The longest wave, in painting pixels (120 m each) -- the others 2.7 and 7.3 times shorter
export const LONGEST_WAVE = 6;
// A wave starts to show at FADE[1] painting pixels to the screen pixel per pixel of its length (~7 screen pixels
// long), and is all there at FADE[0] (~20)
export const FADE = [0.05, 0.15];

const GLSL = /* glsl */ `
uniform sampler2D seaInfo;
uniform vec2 seaSize;
uniform float seaTime;
varying vec3 vSeaPos;

float seaHash(vec2 c) {
  c = mod(c, 289.0);
  vec3 p = fract(vec3(c.xyx) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float seaNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(seaHash(i), seaHash(i + vec2(1.0, 0.0)), u.x), mix(seaHash(i + vec2(0.0, 1.0)), seaHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// the noise's slope at p
vec2 seaSlope(vec2 p) {
  float h = seaNoise(p);
  return vec2(seaNoise(p + vec2(0.04, 0.0)) - h, seaNoise(p + vec2(0.0, 0.04)) - h) / 0.04;
}

vec3 seaSurface(vec3 colour) {
  vec2 p = vSeaPos.xz;
  // (the sea told by the land's own data, not its height -- the triangles sloping up to the coast showed)
  float info = texture2D(seaInfo, (p + seaSize * 0.5) / seaSize).r;
  float k = smoothstep(0.03, 0.1, info) * smoothstep(0.03, 0.12, colour.b - max(colour.r, colour.g));
  if (k <= 0.0) return colour;
  float away = clamp((info - 0.1) / 0.9, 0.0, 1.0);   // 0 at the coast, 1 at ${REACH} pixels out and further

  // deeper further out
  vec3 c = colour * mix(1.08, 0.9, smoothstep(0.0, 1.0, away));

  // the waves: three sizes of moving noise, each faded in once it's a few screen pixels big
  float foot = max(fwidth(p.x), fwidth(p.y));
  vec2 slope = vec2(0.0);
  float seen = 0.0;
  float scale = ${(1 / LONGEST_WAVE).toFixed(5)};
  float amp = 1.0;
  vec2 dirs[3];
  dirs[0] = vec2(0.8, 0.6);
  dirs[1] = vec2(-0.55, 0.83);
  dirs[2] = vec2(0.32, -0.95);
  for (int i = 0; i < 3; i++) {
    float w = 1.0 - smoothstep(${FADE[0]}, ${FADE[1]}, foot * scale);
    if (w > 0.0) {
      // each layer turned its own way, so the noise's square grid doesn't line up and show
      float a = 0.6 + 1.9 * float(i);
      mat2 turn = mat2(cos(a), sin(a), -sin(a), cos(a));
      vec2 s = seaSlope(turn * (p * scale) + dirs[i] * seaTime * (0.07 + 0.05 * float(i)) + float(i) * 31.7);
      slope += w * amp * (s * turn);
      seen = max(seen, w);
    }
    scale *= 2.7;
    amp *= 0.6;
  }
  if (seen > 0.0) {
    vec3 n = normalize(vec3(-slope.x * 0.22, 1.0, -slope.y * 0.22));
    vec3 sun = normalize(vec3(-0.62, 1.0, -0.55));   // the map's light, from the north-west
    vec3 eye = normalize(cameraPosition - vSeaPos);
    float shade = (dot(n, sun) - sun.y) * 0.6;
    float glint = pow(max(dot(reflect(-sun, n), eye), 0.0), 500.0);
    c = c * (1.0 + shade * seen) + vec3(0.9, 0.95, 1.0) * glint * 0.16 * seen;
    // surf: faint bands running in to the shore, a few pixels out
    float px = away * ${REACH.toFixed(1)};
    float band = smoothstep(0.8, 1.0, sin(px * 2.1 - seaTime * 1.3 + seaNoise(p * 0.35) * 6.0));
    c += vec3(0.85, 0.92, 1.0) * band * (1.0 - smoothstep(0.8, 3.5, px)) * 0.06 * (1.0 - smoothstep(0.15, 0.5, foot));
  }
  return mix(colour, c, k);
}
`;

/** How far each sea pixel is from the coast, as a texture the shader reads: 0 on the land (lakes and rivers too), 0.1
 * at the coast up to 1 at REACH pixels out. Rows as the painting's (row 0 at its top). */
export function seaInfoTexture(land) {
  const { W, H, kind } = land;
  const d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = kind[i] === 0 ? 1e6 : 0;
  // two passes of a chamfer distance (good to a few percent -- plenty for a shade)
  const D = Math.SQRT2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - W] + 1);
        if (x > 0) v = Math.min(v, d[i - W - 1] + D);
        if (x < W - 1) v = Math.min(v, d[i - W + 1] + D);
      }
      d[i] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x < W - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < H - 1) {
        v = Math.min(v, d[i + W] + 1);
        if (x < W - 1) v = Math.min(v, d[i + W + 1] + D);
        if (x > 0) v = Math.min(v, d[i + W - 1] + D);
      }
      d[i] = v;
    }
  }
  const data = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) data[i] = kind[i] === 0 ? Math.round(255 * (0.1 + (0.9 * Math.min(d[i], REACH)) / REACH)) : 0;
  const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  tex.unpackAlignment = 1; // (rows of any width)
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Puts the sea on the land's material (a MeshBasicMaterial with the map's picture as `map`), after anything already
 * there (land-detail.js). `uniforms`: { info (seaInfoTexture), size: [W, H], time ({ value }: seconds) }. */
export function addSea(material, { info, size, time }) {
  const before = material.onBeforeCompile;
  const beforeKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    before?.call(material, shader, renderer);
    shader.uniforms.seaInfo = { value: info };
    shader.uniforms.seaSize = { value: new THREE.Vector2(size[0], size[1]) };
    shader.uniforms.seaTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSeaPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeaPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL}`)
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = seaSurface(diffuseColor.rgb);');
  };
  material.customProgramCacheKey = () => `${beforeKey.call(material)}+sea`;
  material.needsUpdate = true;
}
