// CPU mirror of heightField() in noiseGLSL.js (value path only) — used by the
// exporter to displace mesh vertices. Must stay in lock-step with the GLSL.

function fract(v) {
  return v - Math.floor(v);
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / Math.max(edge1 - edge0, 1e-8), 0, 1);
  return t * t * (3 - 2 * t);
}

// Hashes are evaluated in emulated float32 so they land on the same values as
// the GPU (see hash33 below).
const f32 = Math.fround;
const fract32 = (v) => f32(v - Math.floor(v));
const K1 = f32(0.1031), K2 = f32(31.32);

function hash13(x, y, z) {
  let px = fract32(f32(f32(x) * K1));
  let py = fract32(f32(f32(y) * K1));
  let pz = fract32(f32(f32(z) * K1));
  const d = f32(f32(f32(px * f32(pz + K2)) + py * f32(py + K2)) + pz * f32(px + K2));
  px = f32(px + d);
  py = f32(py + d);
  pz = f32(pz + d);
  return fract32(f32(f32(px + py) * pz));
}

// hash33 -> gradient in [-1,1]^3, written into out[o..o+2]. Every step is
// rounded to float32 like the GPU: the products reach ~1e4 before fract(), so
// double precision would land on a different hash often enough to flip whole
// gradients and misplace exported coastlines.
const H1 = f32(0.1031), H2 = f32(0.1030), H3 = f32(0.0973), H4 = f32(33.33);

function hash33(x, y, z, out, o) {
  let px = fract32(f32(f32(x) * H1));
  let py = fract32(f32(f32(y) * H2));
  let pz = fract32(f32(f32(z) * H3));
  // dot() lowers to mul + fma + fma on the GPU (the double products of two
  // float32 values are exact, so "+ a * b" then rounding emulates an fma)
  const d = f32(f32(f32(px * f32(py + H4)) + py * f32(px + H4)) + pz * f32(pz + H4));
  px = f32(px + d);
  py = f32(py + d);
  pz = f32(pz + d);
  out[o] = fract32(f32(f32(px + py) * pz)) * 2 - 1;
  out[o + 1] = fract32(f32(f32(px + px) * py)) * 2 - 1;
  out[o + 2] = fract32(f32(f32(py + px) * px)) * 2 - 1;
}

const G = new Float64Array(24);
const CORNERS = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];

function gnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const v = new Array(8);
  for (let c = 0; c < 8; c++) {
    const [cx, cy, cz] = CORNERS[c];
    hash33(ix + cx, iy + cy, iz + cz, G, c * 3);
    v[c] = G[c * 3] * (fx - cx) + G[c * 3 + 1] * (fy - cy) + G[c * 3 + 2] * (fz - cz);
  }
  const x00 = v[0] + (v[1] - v[0]) * ux;
  const x10 = v[2] + (v[3] - v[2]) * ux;
  const x01 = v[4] + (v[5] - v[4]) * ux;
  const x11 = v[6] + (v[7] - v[6]) * ux;
  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

// OCT_ROT (GLSL column-major mat3) applied to q, then scaled
function rotScale(q, s) {
  const x = q[0], y = q[1], z = q[2];
  q[0] = (0.00 * x - 0.80 * y - 0.60 * z) * s;
  q[1] = (0.80 * x + 0.36 * y - 0.48 * z) * s;
  q[2] = (0.60 * x - 0.48 * y + 0.64 * z) * s;
}

function continentFbm(px, py, pz, params, out) {
  let sum = 0, amp = 0.5, norm = 0;
  const q = [px, py, pz];
  const octaves = Math.max(1, Math.round(params.octaves));
  out.cLow = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * gnoise(q[0], q[1], q[2]);
    norm += amp;
    if (i === 1) out.cLow = sum / norm;
    amp *= params.persistence;
    rotScale(q, params.lacunarity);
  }
  return sum / Math.max(norm, 1e-5);
}

function ridgedMF(px, py, pz, params) {
  let sum = 0, amp = 0.5, norm = 0, w = 1;
  const q = [px, py, pz];
  const octaves = Math.max(1, Math.round(params.octaves));
  for (let i = 0; i < octaves; i++) {
    const r = 1 - Math.abs(gnoise(q[0], q[1], q[2]));
    const sw = r * r * w;
    sum += amp * sw;
    norm += amp;
    w = clamp(sw * 2, 0, 1);
    amp *= params.persistence;
    rotScale(q, params.lacunarity);
  }
  return sum / Math.max(norm, 1e-5);
}

const O1 = f32(17.1), O2 = f32(41.7);

function worley(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fract(x), fy = fract(y), fz = fract(z);
  let best = 8;
  for (let gx = -1; gx <= 1; gx++) {
    for (let gy = -1; gy <= 1; gy++) {
      for (let gz = -1; gz <= 1; gz++) {
        const cx = ix + gx, cy = iy + gy, cz = iz + gz;
        const ox = hash13(cx, cy, cz);
        const oy = hash13(cx + O1, cy + O1, cz + O1);
        const oz = hash13(cx + O2, cy + O2, cz + O2);
        const dx = gx + ox - fx;
        const dy = gy + oy - fy;
        const dz = gz + oz - fz;
        best = Math.min(best, Math.sqrt(dx * dx + dy * dy + dz * dz));
      }
    }
  }
  return best;
}

function craterLayer(x, y, z) {
  const d = worley(x, y, z);
  const bowl = 1 - smoothstep(0, 0.55, d);
  const rim = smoothstep(0.42, 0.55, d) * (1 - smoothstep(0.55, 0.75, d));
  return rim * 0.35 - bowl * bowl * 0.9;
}

function warpAxis(px, py, pz, o1, o2) {
  return gnoise(px * 0.9 + o1[0], py * 0.9 + o1[1], pz * 0.9 + o1[2])
    + 0.5 * gnoise(px * 1.9 + o2[0], py * 1.9 + o2[1], pz * 1.9 + o2[2]);
}

const CONT_GAIN = 1.0;
const RIDGE_BIAS = 0.62;
const RIDGE_GAIN = 3.3;

export class PlanetHeightSampler {
  constructor(params, uniforms) {
    this.params = params;
    this.uniforms = uniforms;
    this._tmp = { cLow: 0 };
  }

  height01(x, y, z) {
    const p = this.params;
    const seed = this.uniforms.uSeedOffset.value;
    const px = x * p.noiseScale + seed.x;
    const py = y * p.noiseScale + seed.y;
    const pz = z * p.noiseScale + seed.z;

    const wx = warpAxis(px, py, pz, [11.3, 0, 0], [21.7, 3.1, 0]);
    const wy = warpAxis(px, py, pz, [0, 47.9, 0], [0, 57.3, 7.7]);
    const wz = warpAxis(px, py, pz, [0, 0, 83.1], [5.9, 0, 91.3]);
    const qx = px + wx * p.warp;
    const qy = py + wy * p.warp;
    const qz = pz + wz * p.warp;

    let c = 0.465 + continentFbm(qx, qy, qz, p, this._tmp) * CONT_GAIN;
    const shelf = smoothstep(0.44, 0.54, c);
    const shaped = 0.28 + shelf * 0.18 + (c - 0.5) * 0.35;
    c = c * (1 - p.continents) + shaped * p.continents;

    const land = smoothstep(0.40, 0.50, c);
    const belt = 1 - Math.abs(gnoise(qx * 0.55 + 5.3, qy * 0.55 + 1.7, qz * 0.55 + 9.1)) * 4.5;
    const beltW = 0.12 + 0.88 * smoothstep(0.15, 0.9, belt);
    const ms = p.mountainScale;
    const r = ridgedMF(qx * ms + 7.7, qy * ms + 7.7, qz * ms + 7.7, p);
    const mt = Math.max(r - RIDGE_BIAS, 0) * RIDGE_GAIN;
    let h = c + mt * mt * land * beltW * p.ridge * 0.8;

    if (p.craters > 0.001) {
      const cx = x * p.craterScale + seed.x;
      const cy = y * p.craterScale + seed.y;
      const cz = z * p.craterScale + seed.z;
      const c1 = craterLayer(cx, cy, cz);
      const c2 = craterLayer(cx * 2.3 + 17, cy * 2.3 + 17, cz * 2.3 + 17);
      h += (c1 + c2 * 0.45) * p.craters * 0.35;
    }

    return clamp(h, 0, 1);
  }

  heightAtDirection(dir) {
    return this.height01(dir.x, dir.y, dir.z) * this.params.heightScale;
  }
}
