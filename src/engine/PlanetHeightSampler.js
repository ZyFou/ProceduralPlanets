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

function hash13(x, y, z) {
  let px = fract(x * 0.1031);
  let py = fract(y * 0.1031);
  let pz = fract(z * 0.1031);
  const d = px * (pz + 31.32) + py * (py + 31.32) + pz * (px + 31.32);
  px += d;
  py += d;
  pz += d;
  return fract((px + py) * pz);
}

function vnoise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fract(x), fy = fract(y), fz = fract(z);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash13(ix, iy, iz);
  const b = hash13(ix + 1, iy, iz);
  const c = hash13(ix, iy + 1, iz);
  const d = hash13(ix + 1, iy + 1, iz);
  const e = hash13(ix, iy, iz + 1);
  const g = hash13(ix + 1, iy, iz + 1);
  const h = hash13(ix, iy + 1, iz + 1);
  const k = hash13(ix + 1, iy + 1, iz + 1);
  const x00 = a * (1 - ux) + b * ux;
  const x10 = c * (1 - ux) + d * ux;
  const x01 = e * (1 - ux) + g * ux;
  const x11 = h * (1 - ux) + k * ux;
  const y0 = x00 * (1 - uy) + x10 * uy;
  const y1 = x01 * (1 - uy) + x11 * uy;
  return y0 * (1 - uz) + y1 * uz;
}

function fbm(x, y, z, params) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let px = x, py = y, pz = z;
  const octaves = Math.max(1, Math.round(params.octaves));
  for (let i = 0; i < octaves; i++) {
    sum += vnoise3(px, py, pz) * amp;
    norm += amp;
    amp *= params.persistence;
    px *= params.lacunarity;
    py *= params.lacunarity;
    pz *= params.lacunarity;
  }
  return sum / Math.max(norm, 1e-5);
}

function ridgedFbm(x, y, z, params) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let px = x, py = y, pz = z;
  const octaves = Math.max(1, Math.round(params.octaves));
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(vnoise3(px, py, pz) * 2 - 1);
    sum += n * n * amp;
    norm += amp;
    amp *= params.persistence;
    px *= params.lacunarity;
    py *= params.lacunarity;
    pz *= params.lacunarity;
  }
  return sum / Math.max(norm, 1e-5);
}

function worley(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fract(x), fy = fract(y), fz = fract(z);
  let best = 8;
  for (let gx = -1; gx <= 1; gx++) {
    for (let gy = -1; gy <= 1; gy++) {
      for (let gz = -1; gz <= 1; gz++) {
        const cx = ix + gx, cy = iy + gy, cz = iz + gz;
        const ox = hash13(cx, cy, cz);
        const oy = hash13(cx + 17.1, cy + 17.1, cz + 17.1);
        const oz = hash13(cx + 41.7, cy + 41.7, cz + 41.7);
        const dx = gx + ox - fx;
        const dy = gy + oy - fy;
        const dz = gz + oz - fz;
        best = Math.min(best, Math.sqrt(dx * dx + dy * dy + dz * dz));
      }
    }
  }
  return best;
}

export class PlanetHeightSampler {
  constructor(params, uniforms) {
    this.params = params;
    this.uniforms = uniforms;
  }

  height01(x, y, z) {
    const p = this.params;
    const seed = this.uniforms.uSeedOffset.value;
    let px = x * p.noiseScale + seed.x;
    let py = y * p.noiseScale + seed.y;
    let pz = z * p.noiseScale + seed.z;

    const wx = vnoise3(px * 1.7 + 11.3, py * 1.7 + 11.3, pz * 1.7 + 11.3) - 0.5;
    const wy = vnoise3(px * 1.7 + 47.9, py * 1.7 + 47.9, pz * 1.7 + 47.9) - 0.5;
    const wz = vnoise3(px * 1.7 + 83.1, py * 1.7 + 83.1, pz * 1.7 + 83.1) - 0.5;
    px += wx * p.warp;
    py += wy * p.warp;
    pz += wz * p.warp;

    let c = fbm(px, py, pz, p);
    const shelf = smoothstep(0.38, 0.62, c);
    c = c * (1 - p.continents) + (shelf * 0.72 + c * 0.28) * p.continents;

    const landMask = smoothstep(0.48, 0.62, c);
    const m = ridgedFbm(px * p.mountainScale + 7.7, py * p.mountainScale + 7.7, pz * p.mountainScale + 7.7, p);
    c += m * m * landMask * p.ridge * 0.55;

    if (p.craters > 0.001) {
      const d = worley(x * p.craterScale + seed.x, y * p.craterScale + seed.y, z * p.craterScale + seed.z);
      const bowl = 1 - smoothstep(0, 0.55, d);
      const rim = smoothstep(0.42, 0.55, d) * (1 - smoothstep(0.55, 0.75, d));
      c += (rim * 0.35 - bowl * bowl * 0.9) * p.craters * 0.35;
    }

    return clamp(c, 0, 1);
  }

  heightAtDirection(dir) {
    return this.height01(dir.x, dir.y, dir.z) * this.params.heightScale;
  }
}
