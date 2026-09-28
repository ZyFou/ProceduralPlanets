# Benchmark harness

Measures what a user feels (loading, stalls, pops) and what the GPU pays
(frame time per pass, VRAM), with image checks so an optimisation can't
quietly change the look. It drives a **headless Chrome on the real GPU**
(ANGLE / D3D11 on Windows) through the DevTools protocol, with no extra
dependencies.

```sh
npm run bench                                   # every suite, working tree only
npm run bench -- --ab ../baseline-checkout      # A/B against another checkout
npm run bench -- --suites gpu,fly --scenarios terran-orbit,swarm --rounds 3
```

Results go to `bench/results/<tag>/`: `results.json`, `report.html` (scorecard,
per-pass tables, before / current / diff images, filmstrips, frame-time
charts) and the PNGs. The scorecard is also printed to the console; each metric
is checked against a budget in `lib/report.mjs`.

For `--ab`, the other checkout needs a `node_modules` (a junction or symlink to
this one is fine). The bench page is copied into it, and each checkout gets its
own Vite dependency cache.

## Suites

| Suite | What it measures |
|---|---|
| `startup` | Cold (fresh profile, no shader cache) and warm loads of the studio. It records a screencast filmstrip, rAF gaps from navigation start (main-thread stalls), long animation frames, each loading overlay's visibility (how many loading screens), `pp:*` performance marks, the biggest frame-to-frame jump after the reveal (pop-in) and when the final frame is up. Then it switches to gas and star: stall and time until the new body is on screen |
| `gpu` | Steady-state scenarios at 1920x1080 with fixed time and camera. It records GPU time per pass (timer queries, one per render target), CPU submit time, pipelined wall time, draws, triangles, chunks, impostors, VRAM (a ledger of every GL allocation in the context), the worst frame and the time until the first full frame on first show, plus a PNG capture compared to the other checkout (PSNR, SSIM, heatmap) |
| `anim` | Time advancing at 60 Hz (weather re-bakes, drift): per-frame GPU time p50 / p99 / max, spikes |
| `fly` | Orbit to mountain top to skimming the surface. Pass 1: per-frame GPU / CPU, LOD churn. Pass 2: **LOD pops**, where every frame is drawn twice at the same camera, first with the previous frame's LOD and then with the updated one, and the pixels that change are the pop |

Scenarios (`page/bench.js`): terran at orbit / near / low / surface / inside the
clouds, ocean, moon (craters), gas giant, ringed giant, star, `system` (the
solar-system example: star, planet, ringed giant and host meshes) and `swarm`
(12 bodies from 20 to 160 px across, the impostor case).

## Reading the numbers

- GPU times are the **20th percentile** of 40 frames (other work sharing the GPU
  only ever adds time), then the median of the rounds. Baseline and current
  alternate per scenario, so clock and thermal drift hit both.
- `calibration` (a fixed shader workload, measured before and after) tells
  whether the GPU was busy or throttled during the run. Compare it across runs
  before trusting absolute numbers.
- Chrome's GPU shader cache is small and its hits vary between runs, so warm
  startup times vary. Cold starts use `--disable-gpu-shader-disk-cache`.

## Tools

- `node bench/exp.mjs script.js` runs a snippet in the bench page
  (`window.bench` exports `build`, `warm`, `timePasses`, `THREE`...) for
  one-off experiments. Set `BENCH_ROOT=<checkout>` to run it against another
  checkout.
- `node bench/lib/contact.mjs out.png <cols> frame1.png frame2.png ...` builds
  a contact sheet of filmstrip frames.

## Layout

```
run.mjs            CLI: servers, Chrome, suites, report
exp.mjs            one-off experiments in the bench page
lib/cdp.mjs        minimal DevTools-protocol client + headless Chrome launcher
lib/server.mjs     Vite dev servers per checkout (vite-serve.mjs: own dep cache)
lib/inject.js      injected before page scripts: rAF gaps, long frames, VRAM ledger,
                   GL sync waits, loader visibility
lib/startup.mjs    the startup suite (screencast filmstrip analysis)
lib/image.mjs      PNG decode / encode, PSNR / SSIM / heatmaps
lib/report.mjs     budgets, scorecard, report.html
page/bench.html    the in-page harness (public API + a little introspection)
page/bench.js      scenarios, GPU timers, flythrough, captures
```
