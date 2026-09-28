#!/usr/bin/env node
// procedural-planets benchmark harness.
//
//   node bench/run.mjs                       all suites on the working tree
//   node bench/run.mjs --ab <checkout>       A/B against another checkout
//   node bench/run.mjs --suites gpu,fly --scenarios terran-orbit,swarm
//
// Suites
//   startup   cold + warm loads of the studio: loading screens, main-thread
//             stalls, time to the final frame, pops after the reveal, stalls
//             on the first gas / star switch
//   gpu       steady-state scenarios at 1920x1080: GPU per pass, CPU, draws,
//             VRAM, captures (image quality vs the other checkout)
//   anim      time advancing at 60 Hz: frame-time spikes
//   fly       orbit -> surface flythrough: frame times, LOD churn, LOD pops
//
// Results: bench/results/<tag>/results.json + report.html (+ PNGs). The
// scorecard at the end checks the budgets in BUDGETS.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from './lib/cdp.mjs';
import { startVite, installBenchPage } from './lib/server.mjs';
import { decodePNG, encodePNG, compareImages } from './lib/image.mjs';
import { startupRun } from './lib/startup.mjs';
import { writeReport, scorecard } from './lib/report.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INJECT = fs.readFileSync(path.join(ROOT, 'bench', 'lib', 'inject.js'), 'utf8');

function parseArgs(argv) {
  const out = { suites: 'startup,gpu,anim,fly', tag: null, ab: null, scenarios: null, rounds: 3, startupRuns: 2, frames: 360 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--suites') out.suites = v();
    else if (a === '--tag') out.tag = v();
    else if (a === '--ab') out.ab = path.resolve(v());
    else if (a === '--scenarios') out.scenarios = v();
    else if (a === '--rounds') out.rounds = +v();
    else if (a === '--startup-runs') out.startupRuns = +v();
    else if (a === '--frames') out.frames = +v();
    else if (a === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).join('\n')); process.exit(0); }
  }
  out.suites = new Set(out.suites.split(','));
  out.tag ??= new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return out;
}

const log = (...a) => console.log(...a);
const fmt = (x, d = 2) => (x == null ? '-' : typeof x === 'number' ? x.toFixed(d) : String(x));

async function openBench(browser, server) {
  const page = await browser.newPage();
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
  await page.navigate(`${server.url}/bench/page/bench.html`, { waitFor: 'window.benchReady === true', timeout: 120000 });
  return page;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.join(ROOT, 'bench', 'results', args.tag);
  fs.mkdirSync(outDir, { recursive: true });
  const versions = [{ label: 'current', root: ROOT }];
  if (args.ab) {
    installBenchPage(ROOT, args.ab);
    versions.unshift({ label: 'baseline', root: args.ab });
  }
  log(`bench ${args.tag}: ${versions.map((v) => `${v.label}=${v.root}`).join('  ')}`);

  const servers = [];
  for (const v of versions) servers.push(await startVite(v.root, v.label));
  const results = { tag: args.tag, date: new Date().toISOString(), host: os.hostname(), versions: {}, suites: [...args.suites] };
  for (const s of servers) results.versions[s.label] = { root: s.root, gpu: {}, anim: {}, fly: null, startup: [] };

  try {
    // ---------------------------------------------------------------- gpu
    if (args.suites.has('gpu') || args.suites.has('anim') || args.suites.has('fly')) {
      const browser = await launchChrome();
      try {
        const pages = {};
        for (const s of servers) pages[s.label] = await openBench(browser, s);
        const info = await pages[servers[0].label].eval('window.bench.info()');
        results.gpuName = info.gpu;
        log(`GPU: ${info.gpu}  timer queries: ${info.timer}  parallel compile: ${info.parallelCompile}`);
        const scenarios = args.scenarios ? args.scenarios.split(',') : info.scenarios;
        results.calibration = { before: await pages[servers[0].label].eval('window.bench.calibrate()') };
        log(`calibration (fixed workload): ${results.calibration.before.lowMs} ms (median ${results.calibration.before.medianMs}) — compare across runs; high = GPU busy / throttled`);

        if (args.suites.has('gpu')) {
          for (const [k, name] of scenarios.entries()) {
            // alternate the order per scenario: clock / thermal drift hits both
            const order = k % 2 ? [...servers].reverse() : servers;
            const imgs = {};
            for (const s of order) {
              const r = await pages[s.label].eval(`window.bench.run(${JSON.stringify(name)}, { rounds: ${args.rounds} })`);
              if (r.png) {
                const file = `${s.label}_${name}.png`;
                const img = decodePNG(r.png);
                fs.writeFileSync(path.join(outDir, file), encodePNG(img));
                imgs[s.label] = img;
                r.image = file;
                delete r.png;
              }
              results.versions[s.label].gpu[name] = r;
              if (r.errors?.length) log(`  !! ${s.label} ${name}: ${r.errors.length} console error(s): ${r.errors[0].slice(0, 160)}`);
              log(`  ${s.label.padEnd(8)} ${name.padEnd(15)} gpu ${fmt(r.gpuMs)} ms  cpu ${fmt(r.cpuMs)}  wall ${fmt(r.wallMs)}  draws ${r.stats.draws}  chunks ${r.stats.chunks}  vram ${fmt(r.vram?.totalMB, 1)} MB  ready ${fmt(r.warmup.readyMs, 0)} ms (worst frame ${fmt(r.warmup.maxFrameMs, 0)} ms)`);
            }
            if (imgs.baseline && imgs.current) {
              const q = compareImages(imgs.baseline, imgs.current);
              const heat = `diff_${name}.png`;
              fs.writeFileSync(path.join(outDir, heat), encodePNG(q.heatmap));
              results.versions.current.gpu[name].quality = { psnr: +q.psnr.toFixed(2), ssim: +q.ssim.toFixed(5), maePct: +q.maePct.toFixed(4), badPct: +q.badPct.toFixed(3), heatmap: heat };
              log(`           quality vs baseline: PSNR ${q.psnr.toFixed(1)} dB  SSIM ${q.ssim.toFixed(4)}  bad ${q.badPct.toFixed(2)}%`);
            }
          }
        }

        if (args.suites.has('anim')) {
          for (const name of ['terran-orbit', 'system'].filter((n) => scenarios.includes(n) || !args.scenarios)) {
            for (const s of servers) {
              const r = await pages[s.label].eval(`window.bench.animated(${JSON.stringify(name)}, { frames: ${args.frames} })`);
              results.versions[s.label].anim[name] = r;
              log(`  ${s.label.padEnd(8)} anim ${name.padEnd(13)} gpu p50 ${fmt(r.gpu.p50)}  p99 ${fmt(r.gpu.p99)}  max ${fmt(r.gpu.max)}  spikes ${r.gpu.spikes}`);
            }
          }
        }

        if (args.suites.has('fly')) {
          for (const s of servers) {
            const r = await pages[s.label].eval(`window.bench.flythrough({ frames: ${args.frames}, popFrames: ${args.frames} })`);
            results.versions[s.label].fly = r;
            log(`  ${s.label.padEnd(8)} fly gpu p50 ${fmt(r.gpu.p50)}  p99 ${fmt(r.gpu.p99)}  max ${fmt(r.gpu.max)}  hitches ${r.gpu.hitches}  cpu p99 ${fmt(r.cpu.p99)}  churn ${r.lod.churnTotal}  pops: frames ${r.pops.framesWithPops}  max ${fmt(r.pops.maxPct, 3)}%  sum ${fmt(r.pops.sumPct, 2)}%`);
          }
        }
        results.calibration.after = await pages[servers[0].label].eval('window.bench.calibrate()');
        log(`calibration after: ${results.calibration.after.lowMs} ms (median ${results.calibration.after.medianMs})`);
        for (const p of Object.values(pages)) {
          const cons = p.console.filter((c) => c.type === 'error' || c.type === 'exception' || c.type === 'warning');
          if (cons.length) log(`  console: ${cons.slice(0, 5).map((c) => c.text.slice(0, 200)).join(' | ')}`);
        }
      } finally {
        await browser.close();
      }
    }

    // ------------------------------------------------------------ startup
    if (args.suites.has('startup')) {
      for (let run = 0; run < args.startupRuns; run++) {
        for (const s of (run % 2 ? [...servers].reverse() : servers)) {
          const cold = await startupRun(s.url, { cold: true, outDir: run === 0 ? outDir : null, tag: s.label });
          // warm: prime a persistent profile once, then measure a second visit
          const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-warm-'));
          await startupRun(s.url, { cold: false, profile, holdMs: 1500 });
          const warm = await startupRun(s.url, { cold: false, profile, outDir: run === 0 ? outDir : null, tag: s.label });
          fs.rmSync(profile, { recursive: true, force: true });
          results.versions[s.label].startup.push({ cold, warm });
          for (const r of [cold, warm]) {
            log(`  ${s.label.padEnd(8)} startup ${r.cold ? 'cold' : 'warm'}: loaders ${r.loaderScreens} (hidden ${r.loaderHiddenAt} ms)  complete ${r.visuallyComplete} ms  max gap loading ${r.loading.maxGapMs} / after ${r.afterReveal.maxGapMs} ms  blocking ${r.whole.blockingMs} ms  pop after reveal ${r.postReveal.maxStepPct}%  modes gas ${r.modes.gas.maxGapMs} (shown ${r.modes.gas.shownMs}) star ${r.modes.star.maxGapMs} (shown ${r.modes.star.shownMs}) ms`);
          }
        }
      }
    }
  } finally {
    for (const s of servers) s.stop();
  }

  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 1));
  const card = scorecard(results);
  writeReport(outDir, results, card);
  log('\n' + card.text);
  log(`\nreport: ${path.join(outDir, 'report.html')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
