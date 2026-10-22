// Detail on the 3D map's land up close (the user's call, 2026-10-22): zoomed in, one pixel of the painting covers a
// hundred metres and more, so the mountains, rocks and woods blurred into smears. This makes up what the painting can't
// hold, in the land's shader -- no bigger picture to download: a fine relief lit from the north-west, and a grain in the
// colours, over whatever map style is showing (topographic or painted). Rough and streaked on steep slopes, finer on the
// flat, calm on water.
//
// Each layer comes in only once its grain is bigger than a few screen pixels, so from far out the map looks exactly as it
// did, and nothing shimmers while it moves. region-map.js puts it on the land's material (addLandDetail); a device with
// no graphics card goes without (it costs a little on every pixel).

const GLSL = /* glsl */ `
varying vec3 vLandPos;
varying vec3 vLandNormal;

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

// The relief at p: five layers, each as strong as its weight w (faded out while it's too fine for the screen). Rock
// (steep) is ridged -- sharp crests; the rest is soft.
float ldRelief(vec2 p, float rock, float w[5]) {
  float h = 0.0;
  float f = 1.0;
  float a = 1.0;
  for (int i = 0; i < 5; i++) {
    if (w[i] > 0.0) { // (a layer too fine to show costs nothing)
      vec2 q = p * f + float(i) * 17.3;
      float soft = ldNoise(q);
      float ridged = 1.0 - abs(2.0 * ldNoise(q * 1.6) - 1.0);
      h += w[i] * a * mix(soft, ridged * ridged, rock * 0.65);
    }
    f *= 2.31;
    a *= 0.45; // about 1 / f: every layer adds as much light and shade
  }
  return h;
}

vec3 landDetail(vec3 colour) {
  vec2 p = vLandPos.xz;
  // world units (painting pixels) a screen pixel covers here -- how fine a layer can be and still show
  float foot = max(fwidth(p.x), fwidth(p.y));
  float w[5];
  float f = 1.0;
  float seen = 0.0;
  for (int i = 0; i < 5; i++) {
    // (x 1.6: the rock's grain is that much finer)
    w[i] = 1.0 - smoothstep(0.1, 0.35, foot * f * 1.6);
    seen = max(seen, w[i]);
    f *= 2.31;
  }
  if (seen <= 0.0) return colour;

  // the land's slope, smoothed over its corners (not each flat triangle's own -- that showed every triangle's edge)
  vec3 n = normalize(vLandNormal);
  float steep = smoothstep(0.25, 0.7, 1.0 - abs(n.y));
  // water: the sea is the flat land at height 0, lakes and rivers are blue -- barely touched
  float blue = smoothstep(0.04, 0.16, colour.b - max(colour.r, colour.g));
  float water = max(blue, 1.0 - step(0.02, vLandPos.y));
  vec2 q = p;

  float e = max(foot * 0.5, 0.002); // the step the relief's slope is measured over: about half a screen pixel
  float h0 = ldRelief(q, steep, w);
  float hx = ldRelief(q + vec2(e, 0.0), steep, w);
  float hz = ldRelief(q + vec2(0.0, e), steep, w);
  vec2 grad = vec2(hx - h0, hz - h0) / e;
  // lit from the north-west, like a shaded relief map; stronger on rock, faint on water
  float strength = mix(0.05, 0.17, steep) * mix(1.0, 0.15, water);
  float light = clamp(-(grad.x + grad.y) * strength, -0.38, 0.38);
  float g1 = 1.0 - smoothstep(0.1, 0.35, foot * 9.7), g2 = 1.0 - smoothstep(0.1, 0.35, foot * 23.1);
  float grain = ((ldNoise(p * 9.7) - 0.5) * g1 + (ldNoise(p * 23.1) - 0.5) * g2) * mix(0.05, 0.08, steep) * (1.0 - water);
  return colour * (1.0 + light + grain);
}
`;

/** Puts the detail on the land's material (a MeshBasicMaterial with the map's picture as `map`; the land's geometry
 * needs its normals -- computeVertexNormals). */
export function addLandDetail(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLandPos;\nvarying vec3 vLandNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLandPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvLandNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL}`)
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = landDetail(diffuseColor.rgb);');
  };
  material.customProgramCacheKey = () => 'land-detail';
  material.needsUpdate = true;
}
