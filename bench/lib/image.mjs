// PNG decode / encode (8-bit RGB / RGBA, non-interlaced: what Chrome and
// canvas.toDataURL produce) and the image metrics the harness reports.

import zlib from 'node:zlib';

// ------------------------------------------------------------------- decode
export function decodePNG(buf) {
  if (typeof buf === 'string') buf = Buffer.from(buf.replace(/^data:image\/png;base64,/, ''), 'base64');
  const sig = buf.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') throw new Error('not a PNG');
  let off = 8;
  let width = 0, height = 0, colorType = 0, depth = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG (depth ${depth}, colour ${colorType}, interlace ${interlace})`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = cur[x * bpp];
      out[o + 1] = cur[x * bpp + 1];
      out[o + 2] = cur[x * bpp + 2];
      out[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255;
    }
    [prev, cur] = [cur, prev];
  }
  return { width, height, data: out };
}

// ------------------------------------------------------------------- encode
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePNG({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 1;   // Sub filter
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? data[row + x - 4] : 0;
      raw[y * (stride + 1) + 1 + x] = (data[row + x] - left) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ metrics
const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/**
 * Compare two same-size images. Returns MAE (% of full scale), PSNR (dB),
 * badPct (% of pixels off by > 8/255 in any channel), block SSIM on luma
 * (8x8 windows), and an amplified diff heatmap image.
 */
export function compareImages(a, b, { heatmap = true, badThreshold = 8 } = {}) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const { width: W, height: H } = a;
  const n = W * H;
  let abs = 0, sq = 0, bad = 0;
  const la = new Float32Array(n), lb = new Float32Array(n);
  const heat = heatmap ? new Uint8Array(n * 4) : null;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    let m = 0;
    for (let c = 0; c < 3; c++) {
      const d = a.data[i + c] - b.data[i + c];
      abs += Math.abs(d);
      sq += d * d;
      m = Math.max(m, Math.abs(d));
    }
    if (m > badThreshold) bad++;
    la[p] = luma(a.data, i);
    lb[p] = luma(b.data, i);
    if (heat) {
      // dim reference underneath, differences in hot colours
      const base = la[p] * 0.25;
      const t = Math.min(1, m / 48);
      heat[i] = Math.min(255, base + 255 * Math.min(1, t * 2));
      heat[i + 1] = Math.min(255, base + 255 * Math.max(0, t * 2 - 1));
      heat[i + 2] = base;
      heat[i + 3] = 255;
    }
  }
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  let ssim = 0, blocks = 0;
  for (let by = 0; by + 8 <= H; by += 8) {
    for (let bx = 0; bx + 8 <= W; bx += 8) {
      let ma = 0, mb = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const p = (by + y) * W + bx + x; ma += la[p]; mb += lb[p]; }
      ma /= 64; mb /= 64;
      let va = 0, vb = 0, cov = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const p = (by + y) * W + bx + x;
        const da = la[p] - ma, db = lb[p] - mb;
        va += da * da; vb += db * db; cov += da * db;
      }
      va /= 63; vb /= 63; cov /= 63;
      ssim += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      blocks++;
    }
  }
  const mse = sq / (n * 3);
  return {
    maePct: (abs / (n * 3) / 255) * 100,
    psnr: mse > 0 ? 10 * Math.log10((255 * 255) / mse) : 99,
    badPct: (bad / n) * 100,
    ssim: ssim / Math.max(blocks, 1),
    heatmap: heat ? { width: W, height: H, data: heat } : null,
  };
}

/** Mean absolute luma difference (0..255) and % of pixels whose luma moved > t. */
export function frameDelta(a, b, t = 10) {
  const n = a.width * a.height;
  let sum = 0, big = 0;
  for (let i = 0; i < n * 4; i += 4) {
    const d = Math.abs(luma(a.data, i) - luma(b.data, i));
    sum += d;
    if (d > t) big++;
  }
  return { mean: sum / n, bigPct: (big / n) * 100 };
}

/** Mean luma (0..255) and the share of pixels brighter than `t`. */
export function imageStats(img, t = 24) {
  const n = img.width * img.height;
  let sum = 0, lit = 0;
  for (let i = 0; i < n * 4; i += 4) {
    const l = luma(img.data, i);
    sum += l;
    if (l > t) lit++;
  }
  return { mean: sum / n, litPct: (lit / n) * 100 };
}
