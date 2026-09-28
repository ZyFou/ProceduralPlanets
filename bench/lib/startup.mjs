// Startup suite: loads the studio like a user does and records what they see.
//
//   filmstrip  Page.startScreencast frames (timestamped) -> visual progress,
//              when the planet appears, pops after the loading screen is gone
//   frames     rAF gaps from navigation start -> main-thread stalls
//   loaders    visibility of every loading overlay (#boot-splash,
//              [data-pp-loader]) -> how many loading screens the user sees
//   marks      the app's own pp:* performance marks
//   modes      planet -> gas -> star switches: the stall of first use

import fs from 'node:fs';
import path from 'node:path';
import { launchChrome, sleep } from './cdp.mjs';
import { decodePNG, encodePNG, frameDelta, imageStats } from './image.mjs';

const INJECT = fs.readFileSync(new URL('./inject.js', import.meta.url), 'utf8');

function gapsIn(frames, t0, t1) {
  const gaps = [];
  for (let i = 1; i < frames.length; i++) {
    if (frames[i] < t0 || frames[i - 1] > t1) continue;
    gaps.push({ t: frames[i - 1], ms: frames[i] - frames[i - 1] });
  }
  const ms = gaps.map((g) => g.ms);
  const max = ms.length ? Math.max(...ms) : 0;
  return {
    frames: gaps.length,
    maxGapMs: +max.toFixed(1),
    maxGapAt: gaps.find((g) => g.ms === max)?.t ?? null,
    over50: ms.filter((x) => x > 50).length,
    over100: ms.filter((x) => x > 100).length,
    blockingMs: +ms.reduce((a, x) => a + Math.max(0, x - 50), 0).toFixed(1),
    top: [...gaps].sort((a, b) => b.ms - a.ms).slice(0, 6).map((g) => ({ t: +g.t.toFixed(0), ms: +g.ms.toFixed(1) })),
  };
}

function loaderPhases(loaders) {
  // per loader id: [visibleFrom, hiddenAt]
  const byId = new Map();
  for (const e of loaders) {
    const s = byId.get(e.id) ?? { id: e.id, shownAt: null, fadeStart: null, hiddenAt: null, maxOpacity: 0 };
    if (e.opacity > 0.02 && s.shownAt === null) s.shownAt = e.t;
    if (e.opacity > 0.02) s.maxOpacity = Math.max(s.maxOpacity, e.opacity);
    if (e.opacity <= 0.02 && s.shownAt !== null) s.hiddenAt = e.t;
    if (e.opacity > 0.02 && e.opacity < 0.9 && s.shownAt !== null && s.fadeStart === null && s.maxOpacity > 0.9) s.fadeStart = e.t;
    if (e.opacity > 0.9) s.hiddenAt = null;
    byId.set(e.id, s);
  }
  return [...byId.values()].filter((s) => s.shownAt !== null);
}

export async function startupRun(serverUrl, { cold = true, outDir = null, tag = 'run', holdMs = 5000, maxMs = 40000, profile = null } = {}) {
  const browser = await launchChrome({ coldShaders: cold, profile });
  const page = await browser.newPage();
  const shots = [];
  try {
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
    await page.send('Network.enable');
    await page.send('Network.setCacheDisabled', { cacheDisabled: cold });
    page.on('Page.screencastFrame', (p) => {
      shots.push({ ts: p.metadata.timestamp * 1000, data: p.data });
      page.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
    });
    await page.send('Page.startScreencast', { format: 'png', maxWidth: 640, maxHeight: 360, everyNthFrame: 1 });
    const tNav = Date.now();
    await page.navigate(`${serverUrl}/`, { timeout: 60000 });
    const timeOrigin = await page.eval('performance.timeOrigin');

    // wait until every loader is gone (or none ever showed) and the page held still
    const t0 = Date.now();
    let hiddenSince = null;
    for (;;) {
      await sleep(100);
      const st = await page.eval(`(() => {
        const t = window.__ppTrace.snapshot();
        const ids = new Map();
        for (const e of t.loaders) ids.set(e.id, e.opacity);
        const anyVisible = [...ids.values()].some((o) => o > 0.02);
        return { anyVisible, n: t.loaders.length, ready: !!window.planetStudio };
      })()`);
      if (!st.anyVisible && st.ready) hiddenSince ??= Date.now();
      else hiddenSince = null;
      if (hiddenSince && Date.now() - hiddenSince > holdMs) break;
      if (Date.now() - t0 > maxMs) break;
    }
    const snap = await page.eval('window.__ppTrace.snapshot()');
    const fcp = await page.eval(`performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint')?.startTime ?? null`);
    await page.send('Page.stopScreencast');

    // ---- mode switches (first use of the gas / star programs): main-thread
    // stalls, and how long until the new body type is actually on screen
    const modes = {};
    for (const mode of ['gas', 'star', 'planet']) {
      const sw = await page.eval(`(async () => {
        const e = window.planetStudio;
        const t0 = performance.now();
        e.setParam('mode', '${mode}');
        let shownMs = null;
        while (performance.now() - t0 < 10000) {
          await new Promise((r) => requestAnimationFrame(r));
          if (e.planetRenderer.pending === 0 && e.planetRenderer.info.planets > 0) { shownMs = performance.now() - t0; break; }
        }
        return { t0, shownMs };
      })()`);
      await sleep(1500);
      const s2 = await page.eval('window.__ppTrace.snapshot().frames');
      modes[mode] = { ...gapsIn(s2, sw.t0, sw.t0 + 2500), shownMs: sw.shownMs && +sw.shownMs.toFixed(0) };
    }

    // ---- analysis
    const phases = loaderPhases(snap.loaders);
    const loaderHiddenAt = phases.length ? Math.max(...phases.map((p) => p.hiddenAt ?? snap.now)) : 0;
    const fadeStart = phases.length ? Math.max(...phases.map((p) => p.fadeStart ?? p.hiddenAt ?? 0)) : 0;
    const frames = snap.frames;
    const endT = snap.now;

    // filmstrip, in page time
    const film = shots.map((s) => ({ t: s.ts - timeOrigin, img: decodePNG(s.data) }))
      .filter((f) => f.t >= 0 && f.t <= endT + 200);
    const final = film[film.length - 1]?.img;
    const filmStats = film.map((f, i) => {
      const toFinal = final ? frameDelta(f.img, final) : { mean: 0, bigPct: 0 };
      const step = i ? frameDelta(film[i - 1].img, f.img) : { mean: 0, bigPct: 0 };
      return { t: f.t, lit: imageStats(f.img).litPct, toFinal, step };
    });
    // the final frame is up once nothing jumps any more (slow animation —
    // clouds drifting — moves a little every frame and is not a jump)
    let visuallyComplete = filmStats[0]?.t ?? null;
    for (const f of filmStats) if (f.step.bigPct > 1) visuallyComplete = f.t;
    // after the loading screen is fully gone, what still changes (pops, a
    // planet that is not there yet, a black canvas)
    const after = filmStats.filter((f) => f.t > loaderHiddenAt + 34);
    const postReveal = {
      frames: after.length,
      maxStepPct: +Math.max(0, ...after.map((f) => f.step.bigPct)).toFixed(2),
      toFinalAtReveal: after.length ? +after[0].toFinal.bigPct.toFixed(2) : null,
    };
    // compositor stalls: gaps between screencast frames while loading
    const filmGaps = [];
    for (let i = 1; i < film.length; i++) if (film[i].t <= loaderHiddenAt + 500) filmGaps.push(film[i].t - film[i - 1].t);

    const res = {
      cold,
      fcp: fcp && +fcp.toFixed(0),
      loaders: phases.map((p) => ({ id: p.id, shownAt: +p.shownAt.toFixed(0), fadeStart: p.fadeStart && +p.fadeStart.toFixed(0), hiddenAt: p.hiddenAt && +p.hiddenAt.toFixed(0) })),
      loaderScreens: phases.length,
      loaderHiddenAt: +loaderHiddenAt.toFixed(0),
      fadeStart: +fadeStart.toFixed(0),
      visuallyComplete: visuallyComplete && +visuallyComplete.toFixed(0),
      marks: snap.marks.filter((m) => m.name.startsWith('pp:')).map((m) => ({ name: m.name, t: +m.t.toFixed(0) })),
      loading: gapsIn(frames, 0, loaderHiddenAt),
      afterReveal: gapsIn(frames, loaderHiddenAt, endT),
      whole: gapsIn(frames, 0, endT),
      filmMaxGapMs: filmGaps.length ? +Math.max(...filmGaps).toFixed(0) : null,
      postReveal,
      modes,
      gl: { links: snap.gl.links, peakMB: +(snap.gl.peak / 1048576).toFixed(1), liveMB: +(snap.gl.liveTotal / 1048576).toFixed(1), syncWaitMs: +snap.gl.syncWaits.reduce((a, w) => a + w.ms, 0).toFixed(1), syncWaitsTop: [...snap.gl.syncWaits].sort((a, b) => b.ms - a.ms).slice(0, 5) },
      loaf: snap.loaf.filter((l) => l.duration > 100).slice(0, 8).map((l) => ({ start: +l.start.toFixed(0), duration: +l.duration.toFixed(0), scripts: l.scripts.map((s) => `${s.fn || '?'}@${s.url} ${s.duration.toFixed(0)}ms`) })),
      navToLoadMs: Date.now() - tNav,
    };
    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true });
      const strip = [];
      let next = 0;
      for (const f of film) {
        if (f.t < next) continue;
        const file = `${tag}_${cold ? 'cold' : 'warm'}_${String(Math.round(f.t)).padStart(5, '0')}.png`;
        fs.writeFileSync(path.join(outDir, file), encodePNG(f.img));
        strip.push({ t: +f.t.toFixed(0), file });
        next = f.t + 250;
      }
      res.filmstrip = strip;
    }
    res.filmSeries = filmStats.map((f) => ({ t: +f.t.toFixed(0), lit: +f.lit.toFixed(1), toFinal: +f.toFinal.bigPct.toFixed(2), step: +f.step.bigPct.toFixed(2) }));
    return res;
  } finally {
    await browser.close();
  }
}
