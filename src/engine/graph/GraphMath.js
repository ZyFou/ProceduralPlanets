// Analytic derivatives in the same 3D domain as noiseGLSL. Scalar dual values
// keep the chain rule explicit through warp, octave rotation and shelf curves.
const f32 = Math.fround;
const fract32 = v => f32(v - Math.floor(v));
export const dual = (v, g = [0, 0, 0]) => ({ v, g });
const d = x => typeof x === 'number' ? dual(x) : x;
export const add = (a, b) => { a = d(a); b = d(b); return dual(a.v + b.v, a.g.map((v, i) => v + b.g[i])); };
export const mul = (a, b) => { a = d(a); b = d(b); return dual(a.v * b.v, a.g.map((v, i) => v * b.v + b.g[i] * a.v)); };
export const sub = (a, b) => add(a, mul(b, -1));
export const scale = (a, k) => mul(a, k);
export const mix = (a, b, t) => add(scale(a, 1 - t), scale(b, t));
export const clampD = (a, low = 0, high = 1) => a.v <= low ? dual(low) : a.v >= high ? dual(high) : a;
const absD = a => a.v < 0 ? scale(a, -1) : a;
const positive = a => a.v > 0 ? a : dual(0);
const smooth = (low, high, a) => { const t = clampD(scale(sub(a, low), 1 / (high - low))); return mul(mul(t, t), sub(3, scale(t, 2))); };
const offset = (p, a) => p.map((x, i) => add(x, Array.isArray(a) ? a[i] : a));
const frequency = (p, k) => p.map(x => scale(x, k));
const rotScale = (q, s) => [scale(add(scale(q[1], -0.8), scale(q[2], -0.6)), s), scale(add(add(scale(q[0], 0.8), scale(q[1], 0.36)), scale(q[2], -0.48)), s), scale(add(add(scale(q[0], 0.6), scale(q[1], -0.48)), scale(q[2], 0.64)), s)];
function hash33(x, y, z) {
  let px = fract32(f32(f32(x) * f32(0.1031))), py = fract32(f32(f32(y) * f32(0.1030))), pz = fract32(f32(f32(z) * f32(0.0973)));
  const k = f32(33.33);
  const v = f32(f32(f32(px * f32(py + k)) + py * f32(px + k)) + pz * f32(pz + k));
  px = f32(px + v); py = f32(py + v); pz = f32(pz + v);
  return [fract32(f32(f32(px + py) * pz)) * 2 - 1, fract32(f32(f32(px + px) * py)) * 2 - 1, fract32(f32(f32(py + px) * px)) * 2 - 1];
}
function hash13(x, y, z) {
  const k = f32(0.1031), k2 = f32(31.32);
  let px = fract32(f32(f32(x) * k)), py = fract32(f32(f32(y) * k)), pz = fract32(f32(f32(z) * k));
  const v = f32(f32(f32(px * f32(pz + k2)) + py * f32(py + k2)) + pz * f32(px + k2));
  px = f32(px + v); py = f32(py + v); pz = f32(pz + v);
  return fract32(f32(f32(px + py) * pz));
}
export function noiseD(p) {
  const i = p.map(x => Math.floor(x.v)), f = p.map((x, j) => sub(x, i[j]));
  const u = f.map(x => mul(mul(mul(x, x), x), add(mul(x, sub(scale(x, 6), 15)), 10)));
  const values = [];
  for (let z = 0; z <= 1; z++) for (let y = 0; y <= 1; y++) for (let x = 0; x <= 1; x++) {
    const grad = hash33(i[0] + x, i[1] + y, i[2] + z);
    values.push(add(add(scale(sub(f[0], x), grad[0]), scale(sub(f[1], y), grad[1])), scale(sub(f[2], z), grad[2])));
  }
  const interpolate = (a, b, t) => add(a, mul(sub(b, a), t));
  return interpolate(interpolate(interpolate(values[0], values[1], u[0]), interpolate(values[2], values[3], u[0]), u[1]), interpolate(interpolate(values[4], values[5], u[0]), interpolate(values[6], values[7], u[0]), u[1]), u[2]);
}
export function fbmD(p, params) {
  let q = p, sum = dual(0), amp = 0.5, norm = 0, low = 0;
  for (let i = 0; i < params.octaves; i++) {
    sum = add(sum, scale(noiseD(q), amp)); norm += amp;
    if (i === 1) low = sum.v / norm;
    amp *= params.persistence; q = rotScale(q, params.lacunarity);
  }
  return { field: scale(sum, 1 / Math.max(norm, 1e-5)), low };
}
function ridgedD(p, params) {
  let q = p, sum = dual(0), amp = 0.5, norm = 0, weight = dual(1);
  for (let i = 0; i < params.octaves; i++) {
    const r = sub(1, absD(noiseD(q))), sw = mul(mul(r, r), weight);
    sum = add(sum, scale(sw, amp)); norm += amp; weight = clampD(scale(sw, 2));
    amp *= params.persistence; q = rotScale(q, params.lacunarity);
  }
  return scale(sum, 1 / Math.max(norm, 1e-5));
}
function craterD(p) {
  const i = p.map(x => Math.floor(x.v)), f = p.map((x, j) => sub(x, i[j]));
  let distance = 8, best;
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    const cell = [i[0] + x, i[1] + y, i[2] + z];
    const offsets = [0, f32(17.1), f32(41.7)].map(k => hash13(cell[0] + k, cell[1] + k, cell[2] + k));
    const delta = [x, y, z].map((v, j) => sub(v + offsets[j], f[j]));
    const dist = Math.hypot(...delta.map(v => v.v));
    if (dist < distance) { distance = dist; best = delta; }
  }
  const g = [0, 1, 2].map(axis => best.reduce((v, c) => v + c.v * c.g[axis], 0) / Math.max(distance, 1e-5));
  const w = dual(distance, g), bowl = sub(1, smooth(0, 0.55, w));
  const rim = mul(smooth(0.42, 0.55, w), sub(1, smooth(0.55, 0.75, w)));
  return sub(scale(rim, 0.35), scale(mul(bowl, bowl), 0.9));
}
export function directionDual(direction) { return direction.map((value, axis) => dual(value, [0, 1, 2].map(i => i === axis ? 1 : 0))); }
export function classicD(direction, params, seed) {
  const dir = directionDual(direction), point = offset(frequency(dir, params.noiseScale), seed);
  const warp = (a, b) => add(noiseD(offset(frequency(point, 0.9), a)), scale(noiseD(offset(frequency(point, 1.9), b)), 0.5));
  const w = [warp([11.3, 0, 0], [21.7, 3.1, 0]), warp([0, 47.9, 0], [0, 57.3, 7.7]), warp([0, 0, 83.1], [5.9, 0, 91.3])];
  const q = point.map((v, i) => add(v, scale(w[i], params.warp)));
  const fbm = fbmD(q, params), c0 = add(0.465, fbm.field);
  const shaped = add(add(0.28, scale(smooth(0.44, 0.54, c0), 0.18)), scale(sub(c0, 0.5), 0.35));
  const c = mix(c0, shaped, params.continents), land = smooth(0.4, 0.5, c);
  let height = c, mtn = 0;
  if (land.v > 0 && params.ridge > 0) {
    const belt = sub(1, scale(absD(noiseD(offset(frequency(q, 0.55), [5.3, 1.7, 9.1]))), 4.5));
    const beltW = add(0.12, scale(smooth(0.15, 0.9, belt), 0.88));
    const mt = scale(positive(sub(ridgedD(offset(frequency(q, params.mountainScale), 7.7), params), 0.62)), 3.3);
    height = add(height, scale(mul(mul(mul(mt, mt), land), beltW), params.ridge * 0.8));
    mtn = clampD(mul(mul(mt, land), beltW)).v;
  }
  if (params.craters > 0.001) {
    const cp = offset(frequency(dir, params.craterScale), seed);
    height = add(height, scale(add(craterD(cp), scale(craterD(offset(frequency(cp, 2.3), 17)), 0.45)), params.craters * 0.35));
  }
  return { field: clampD(height), cLow: 0.465 + fbm.low, mtn };
}
