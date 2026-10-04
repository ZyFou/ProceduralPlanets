// A nearest-filtered Float32 texture array with six spherical face layers. Explicit interpolation is shared
// with PlanetPaintLayerManager.sample; inclusive edge vertices remove seams.
export const PLANET_PAINT_GLSL = /* glsl */ `
uniform highp sampler2DArray uPaintFaces;
uniform float uPaintResolution;
uniform float uPaintActive;
vec3 paintFaceUV(vec3 d) {
  vec3 a = abs(d); float f; vec2 uv;
  if (a.z >= a.x && a.z >= a.y) {
    f = d.z >= 0.0 ? 0.0 : 1.0; uv = vec2(f == 0.0 ? d.x : -d.x, d.y) / a.z;
  } else if (a.x >= a.y) {
    f = d.x >= 0.0 ? 2.0 : 3.0; uv = vec2(f == 2.0 ? -d.z : d.z, d.y) / a.x;
  } else {
    f = d.y >= 0.0 ? 4.0 : 5.0; uv = vec2(d.x, f == 4.0 ? -d.z : d.z) / a.y;
  }
  return vec3(clamp(uv * 0.5 + 0.5, 0.0, 1.0), f);
}
vec4 paintFetch(float f, vec2 uv) {
  return texture(uPaintFaces, vec3(uv, f));
}
vec4 paintSample(vec3 direction, float bank) {
  if (uPaintActive < 0.5) return vec4(0.0);
  vec3 fuv = paintFaceUV(direction);
  vec2 p = fuv.xy * uPaintResolution;
  vec2 lo = floor(p), hi = min(lo + 1.0, vec2(uPaintResolution)), t = p - lo;
  float side = uPaintResolution + 1.0;
  vec2 scale = vec2(side, side * 2.0);
  vec2 shift = vec2(0.5, 0.5 + bank * side);
  vec4 a = paintFetch(fuv.z, (lo + shift) / scale);
  vec4 b = paintFetch(fuv.z, (vec2(hi.x, lo.y) + shift) / scale);
  vec4 c = paintFetch(fuv.z, (vec2(lo.x, hi.y) + shift) / scale);
  vec4 d = paintFetch(fuv.z, (hi + shift) / scale);
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}
float paintHeight(vec3 d) { return paintSample(d, 0.0).r; }
vec3 paintGradient(vec3 d) {
  if (uPaintActive < 0.5) return vec3(0.0);
  float e = 0.5 / uPaintResolution;
  return vec3(
    paintHeight(normalize(d + vec3(e,0,0))) - paintHeight(normalize(d - vec3(e,0,0))),
    paintHeight(normalize(d + vec3(0,e,0))) - paintHeight(normalize(d - vec3(0,e,0))),
    paintHeight(normalize(d + vec3(0,0,e))) - paintHeight(normalize(d - vec3(0,0,e)))
  ) / (2.0 * e);
}
`;

// Included after SURFACE_GLSL in terrestrial shaders only; ordinary lighting,
// detail, climate, water and atmosphere continue to use their existing shader.
export const PLANET_PAINT_ALBEDO_GLSL = /* glsl */ `
vec3 paintedAlbedo(vec3 dir, vec3 base, inout float rock, inout float snow) {
  if (uPaintActive < 0.5) return base;
  vec4 a = paintSample(dir, 0.0), b = paintSample(dir, 1.0);
  float total = a.g + a.b + a.a + b.r + b.g;
  rock = rock * max(0.0, 1.0-total) + b.r;
  snow = snow * max(0.0, 1.0-total) + b.g;
  // Coast/seabed, desert sand, vegetation, rock and snow reuse planet colours.
  vec3 painted = mix(lin(uColSand), lin(uColRock) * vec3(0.55,0.52,0.5), 0.35) * a.g + lin(uColSand) * a.b + lin(uColGrass) * a.a
    + lin(uColRock) * b.r + lin(uColSnow) * b.g;
  return base * max(0.0, 1.0-total) + painted / max(1.0, total);
}
`;

export function createPaintUniforms() {
  return { uPaintFaces: { value: null },
    uPaintResolution: { value: 256 }, uPaintActive: { value: 0 }, uPaintExtent: { value: 0 } };
}
