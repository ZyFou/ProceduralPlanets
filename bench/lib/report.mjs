// Scorecard (budgets -> PASS / FAIL) and the HTML report.

import fs from 'node:fs';
import path from 'node:path';

const median = (a) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

// ---- metric extraction ------------------------------------------------------
function startupMetric(v, kind, fn) {
  return median((v.startup ?? []).map((r) => fn(r[kind])));
}

/**
 * Budgets. `max` / `min` are absolute limits; `vsBaseline` is the largest
 * allowed ratio current / baseline (lower is better metrics).
 */
function budgetRows(res) {
  const rows = [];
  const cur = res.versions.current;
  const base = res.versions.baseline ?? null;
  const add = (group, label, get, opt = {}) => {
    const c = get(cur);
    const b = base ? get(base) : null;
    if (c == null && b == null) return;
    rows.push({ group, label, current: c, baseline: b, unit: opt.unit ?? '', ...opt });
  };
  if ((cur.startup ?? []).length) {
    for (const kind of ['cold', 'warm']) {
      add('startup', `${kind}: loading screens shown`, (v) => startupMetric(v, kind, (r) => r.loaderScreens), { max: 1, digits: 0 });
      add('startup', `${kind}: worst main-thread stall while loading`, (v) => startupMetric(v, kind, (r) => r.loading.maxGapMs), { unit: 'ms', max: 100, digits: 0 });
      add('startup', `${kind}: worst stall after the reveal`, (v) => startupMetric(v, kind, (r) => r.afterReveal.maxGapMs), { unit: 'ms', max: 50, digits: 0 });
      add('startup', `${kind}: total blocking time`, (v) => startupMetric(v, kind, (r) => r.whole.blockingMs), { unit: 'ms', max: 250, digits: 0 });
      add('startup', `${kind}: biggest jump after the reveal (pop-in)`, (v) => startupMetric(v, kind, (r) => r.postReveal.maxStepPct), { unit: '% px', max: 1, digits: 2 });
      add('startup', `${kind}: time to final frame`, (v) => startupMetric(v, kind, (r) => r.visuallyComplete), { unit: 'ms', digits: 0, info: true });
      add('startup', `${kind}: loader hidden at`, (v) => startupMetric(v, kind, (r) => r.loaderHiddenAt), { unit: 'ms', digits: 0, info: true });
      add('startup', `${kind}: first gas switch stall`, (v) => startupMetric(v, kind, (r) => r.modes?.gas?.maxGapMs), { unit: 'ms', max: 50, digits: 0 });
      add('startup', `${kind}: first star switch stall`, (v) => startupMetric(v, kind, (r) => r.modes?.star?.maxGapMs), { unit: 'ms', max: 50, digits: 0 });
      add('startup', `${kind}: first gas switch shown after`, (v) => startupMetric(v, kind, (r) => r.modes?.gas?.shownMs), { unit: 'ms', digits: 0, info: true });
      add('startup', `${kind}: first star switch shown after`, (v) => startupMetric(v, kind, (r) => r.modes?.star?.shownMs), { unit: 'ms', digits: 0, info: true });
    }
  }
  const scen = Object.keys(cur.gpu ?? {});
  for (const n of scen) {
    add('errors', `${n}: console errors`, (v) => v.gpu?.[n]?.errors?.length ?? 0, { max: 0, digits: 0 });
  }
  for (const n of scen) {
    add('gpu', `${n}: GPU frame`, (v) => v.gpu?.[n]?.gpuMs, { unit: 'ms', vsBaseline: 1.05, digits: 2 });
  }
  for (const n of scen) {
    add('cpu', `${n}: CPU submit`, (v) => v.gpu?.[n]?.cpuMs, { unit: 'ms', vsBaseline: 1.25, max: 4, digits: 2 });
  }
  for (const n of scen) {
    add('vram', `${n}: VRAM`, (v) => v.gpu?.[n]?.vram?.totalMB, { unit: 'MB', vsBaseline: 1.0, digits: 1 });
  }
  for (const n of scen) {
    add('quality', `${n}: SSIM vs baseline`, (v) => v.gpu?.[n]?.quality?.ssim, { min: 0.96, digits: 4 });
  }
  for (const n of scen) {
    add('warmup', `${n}: worst frame on first show`, (v) => v.gpu?.[n]?.warmup?.maxFrameMs, { unit: 'ms', max: 50, digits: 0 });
  }
  for (const n of scen) {
    add('warmup', `${n}: time until first full frame`, (v) => v.gpu?.[n]?.warmup?.readyMs ?? v.gpu?.[n]?.warmup?.ms, { unit: 'ms', digits: 0, info: true });
  }
  for (const n of Object.keys(cur.anim ?? {})) {
    add('anim', `${n}: GPU p99 / p50`, (v) => (v.anim?.[n] ? v.anim[n].gpu.p99 / Math.max(v.anim[n].gpu.p50, 1e-3) : null), { max: 1.5, digits: 2 });
    add('anim', `${n}: GPU spikes (360 frames)`, (v) => v.anim?.[n]?.gpu.spikes, { max: 3, digits: 0 });
  }
  if (cur.fly) {
    add('fly', 'flythrough: GPU p99', (v) => v.fly?.gpu.p99, { unit: 'ms', vsBaseline: 1.0, digits: 2 });
    add('fly', 'flythrough: hitches (> 2x median)', (v) => v.fly?.gpu.hitches, { max: 0, digits: 0 });
    add('fly', 'flythrough: CPU p99', (v) => v.fly?.cpu.p99, { unit: 'ms', max: 6, digits: 2 });
    add('fly', 'flythrough: frames with LOD pops', (v) => v.fly?.pops.framesWithPops, { max: 3, digits: 0 });
    add('fly', 'flythrough: worst LOD pop', (v) => v.fly?.pops.maxPct, { unit: '% px', max: 0.25, digits: 3 });
    add('fly', 'flythrough: total LOD pop', (v) => v.fly?.pops.sumPct, { unit: '% px', max: 1, digits: 2 });
  }
  for (const r of rows) {
    const fails = [];
    if (r.current == null) { r.status = 'n/a'; continue; }
    if (r.max != null && r.current > r.max + 1e-9) fails.push(`> ${r.max}`);
    if (r.min != null && r.current < r.min - 1e-9) fails.push(`< ${r.min}`);
    if (r.vsBaseline != null && r.baseline != null && r.baseline > 0 && r.current > r.baseline * r.vsBaseline + 0.02) {
      fails.push(`> ${r.vsBaseline}x baseline`);
    }
    r.status = r.info ? 'info' : fails.length ? 'FAIL' : 'PASS';
    r.why = fails.join(', ');
    r.delta = r.baseline != null && r.baseline !== 0 ? (r.current - r.baseline) / Math.abs(r.baseline) : null;
  }
  return rows;
}

export function scorecard(res) {
  const rows = budgetRows(res);
  const f = (x, d) => (x == null ? '-' : Number(x).toFixed(d ?? 2));
  const lines = [];
  lines.push(`${'metric'.padEnd(58)} ${'baseline'.padStart(10)} ${'current'.padStart(10)} ${'delta'.padStart(8)}  status`);
  let group = null;
  for (const r of rows) {
    if (r.group !== group) { group = r.group; lines.push(`-- ${group}`); }
    const d = r.delta == null ? '' : `${r.delta > 0 ? '+' : ''}${(r.delta * 100).toFixed(0)}%`;
    lines.push(`${r.label.padEnd(58).slice(0, 58)} ${f(r.baseline, r.digits).padStart(10)} ${f(r.current, r.digits).padStart(10)} ${d.padStart(8)}  ${r.status}${r.why ? ` (${r.why})` : ''}`);
  }
  const fails = rows.filter((r) => r.status === 'FAIL');
  lines.push(`\n${rows.filter((r) => r.status === 'PASS').length} pass, ${fails.length} fail`);
  return { rows, fails, text: lines.join('\n') };
}

// ---- HTML report -----------------------------------------------------------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function sparkline(series, { w = 560, h = 90, color = '#5b8cff', ref = null, label = '' } = {}) {
  if (!series?.length) return '';
  const max = Math.max(...series, ref ?? 0) * 1.08 || 1;
  const pts = series.map((v, i) => `${((i / Math.max(1, series.length - 1)) * w).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(' ');
  const refLine = ref != null ? `<line x1="0" x2="${w}" y1="${h - (ref / max) * h}" y2="${h - (ref / max) * h}" stroke="#666" stroke-dasharray="3 3"/>` : '';
  return `<figure class="spark"><svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${refLine}<polyline fill="none" stroke="${color}" stroke-width="1.4" points="${pts}"/></svg><figcaption>${esc(label)} (max ${max.toFixed(2)})</figcaption></figure>`;
}

export function writeReport(outDir, res, card) {
  const cur = res.versions.current;
  const base = res.versions.baseline;
  const rows = card.rows.map((r) => {
    const d = r.delta == null ? '' : `${r.delta > 0 ? '+' : ''}${(r.delta * 100).toFixed(0)}%`;
    const good = r.delta != null && r.delta < -0.02;
    const bad = r.delta != null && r.delta > 0.02;
    return `<tr class="${r.status}"><td>${esc(r.group)}</td><td>${esc(r.label)}</td><td>${r.baseline == null ? '-' : Number(r.baseline).toFixed(r.digits ?? 2)}</td><td>${r.current == null ? '-' : Number(r.current).toFixed(r.digits ?? 2)} ${esc(r.unit)}</td><td class="${good ? 'good' : bad ? 'bad' : ''}">${d}</td><td>${r.status}${r.why ? ` <small>${esc(r.why)}</small>` : ''}</td></tr>`;
  }).join('\n');

  const scen = Object.keys(cur.gpu ?? {});
  const passTable = (v, n) => {
    const p = v?.gpu?.[n]?.passes;
    if (!p) return '';
    return `<table class="mini">${Object.entries(p).map(([k, ms]) => `<tr><td>${esc(k)}</td><td>${ms.toFixed(3)}</td></tr>`).join('')}</table>`;
  };
  const gpuSections = scen.map((n) => {
    const c = cur.gpu[n];
    const b = base?.gpu?.[n];
    const q = c.quality;
    return `<section><h3>${esc(n)}</h3>
      <div class="imgs">
        ${b?.image ? `<figure><img src="${b.image}"><figcaption>baseline · ${b.gpuMs} ms GPU · ${b.vram?.totalMB} MB</figcaption></figure>` : ''}
        ${c.image ? `<figure><img src="${c.image}"><figcaption>current · ${c.gpuMs} ms GPU · ${c.vram?.totalMB} MB</figcaption></figure>` : ''}
        ${q?.heatmap ? `<figure><img src="${q.heatmap}"><figcaption>diff · PSNR ${q.psnr} dB · SSIM ${q.ssim}</figcaption></figure>` : ''}
      </div>
      <div class="passes">${b ? `<div><b>baseline passes (ms)</b>${passTable(base, n)}</div>` : ''}<div><b>current passes (ms)</b>${passTable(cur, n)}</div>
      <div><b>stats</b><pre>${esc(JSON.stringify({ current: c.stats, baseline: b?.stats }, null, 1))}</pre></div></div>
    </section>`;
  }).join('\n');

  const flySection = ['baseline', 'current'].filter((k) => res.versions[k]?.fly).map((k) => {
    const f = res.versions[k].fly;
    return `<section><h3>flythrough · ${k}</h3>
      ${sparkline(f.series.gpu, { label: 'GPU ms per frame', ref: f.gpu.p50 })}
      ${sparkline(f.series.cpu, { label: 'CPU ms per frame', color: '#e8a33c' })}
      ${sparkline(f.series.churn, { label: 'LOD chunks added + removed per frame', color: '#9b7bff' })}
      ${sparkline(f.series.popPct, { label: '% of pixels popping per frame (LOD update at a fixed camera)', color: '#ff5b6b' })}
    </section>`;
  }).join('\n');

  const animSection = ['baseline', 'current'].filter((k) => res.versions[k]).map((k) => Object.entries(res.versions[k].anim ?? {}).map(([n, a]) =>
    `<section><h3>animated ${esc(n)} · ${k}</h3>${sparkline(a.series, { label: `GPU ms per frame (p50 ${a.gpu.p50}, p99 ${a.gpu.p99})`, ref: a.gpu.p50 })}</section>`).join('')).join('\n');

  const startupSection = ['baseline', 'current'].filter((k) => res.versions[k]?.startup?.length).map((k) => {
    const s = res.versions[k].startup[0];
    return ['cold', 'warm'].map((kind) => {
      const r = s[kind];
      const strip = (r.filmstrip ?? []).map((f) => `<figure><img src="${f.file}"><figcaption>${f.t} ms</figcaption></figure>`).join('');
      return `<section><h3>startup ${kind} · ${k}</h3>
        <p>loading screens: ${r.loaderScreens} · loader hidden at ${r.loaderHiddenAt} ms · final frame at ${r.visuallyComplete} ms ·
        worst stall while loading ${r.loading.maxGapMs} ms / after ${r.afterReveal.maxGapMs} ms · change after reveal ${r.postReveal.toFinalAtReveal}%</p>
        <p class="marks">${(r.marks ?? []).map((m) => `${esc(m.name)} ${m.t}`).join(' · ')}</p>
        ${sparkline(r.filmSeries.map((f) => f.toFinal), { label: '% of screen still different from the final frame (filmstrip)', color: '#40c090' })}
        <div class="strip">${strip}</div></section>`;
    }).join('');
  }).join('\n');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>bench ${esc(res.tag)}</title><style>
  :root { color-scheme: dark; }
  body { background: #0b0d12; color: #cfd6e2; font: 13px/1.45 system-ui, sans-serif; margin: 0; padding: 24px 32px; }
  h1 { font-size: 18px; margin: 0 0 4px; } h2 { font-size: 15px; margin: 28px 0 10px; border-bottom: 1px solid #222a36; padding-bottom: 6px; }
  h3 { font-size: 13px; margin: 18px 0 8px; color: #e8edf5; }
  table { border-collapse: collapse; } td, th { padding: 3px 10px; border-bottom: 1px solid #1a202a; text-align: left; }
  tr.FAIL td:last-child { color: #ff6b78; font-weight: 600; } tr.PASS td:last-child { color: #52d19a; }
  td.good { color: #52d19a; } td.bad { color: #ff9c6b; }
  .imgs { display: flex; gap: 8px; flex-wrap: wrap; } .imgs img { width: 480px; display: block; border: 1px solid #222a36; }
  figure { margin: 0; } figcaption { color: #7d8799; font-size: 11px; margin-top: 3px; }
  .passes { display: flex; gap: 24px; margin-top: 8px; } .mini td { padding: 1px 8px; font-size: 11px; }
  pre { font-size: 10px; color: #8994a6; margin: 0; }
  .strip { display: flex; gap: 4px; flex-wrap: wrap; } .strip img { width: 200px; display: block; }
  .spark svg { background: #10141b; border: 1px solid #1d2430; } .marks { color: #8994a6; font-size: 11px; }
  small { color: #8994a6; }
  </style></head><body>
  <h1>procedural-planets bench · ${esc(res.tag)}</h1>
  <div>${esc(res.gpuName ?? '')} · ${esc(res.date)}${res.calibration ? ` · calibration ${res.calibration.before?.lowMs} → ${res.calibration.after?.lowMs} ms (fixed workload: higher = GPU busy or throttled)` : ''}</div>
  <p><small>GPU times are the 20th percentile of 40 frames (contention only adds time), median of rounds; baseline and current alternate per scenario.</small></p>
  <h2>Scorecard</h2><table><tr><th>suite</th><th>metric</th><th>baseline</th><th>current</th><th>delta</th><th>status</th></tr>${rows}</table>
  <h2>Startup</h2>${startupSection}
  <h2>GPU scenarios</h2>${gpuSections}
  <h2>Animated</h2>${animSection}
  <h2>Flythrough</h2>${flySection}
  </body></html>`;
  fs.writeFileSync(path.join(outDir, 'report.html'), html);
}
