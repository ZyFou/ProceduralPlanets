# ProceduralPlanets — Build Plan & Checkpoints

A **new** planet-only studio, written from scratch. Same tech and architecture
philosophy as ThreeTerrain (Vite + React + three.js, GPU heightfield shaders,
cube-sphere quadtree LOD chunks, shared-uniform materials, dark studio UI) —
but zero code carried over and no flat-terrain legacy: the engine boots
directly into a planet.

Each checkpoint ends in a git commit tagged `checkpoint-N`. Resume from the
first unchecked box.

## Goals (user brief)
- Planet-oriented only; boots straight to a planet (no tile board, ever).
- Cube-sphere quadtree LOD chunks with merge/split + horizon culling.
- Full noise control: scale, octaves, ridge, warp, persistence, craters, seed.
- Cartoon render: toon-banded lighting, hard color bands, stylized palettes.
- Clouds: shell in the spirit of ThreeTerrain's but hard-edged (low softness),
  cartoon look, cheap (no heavy raymarch).
- Water: stylized shell ocean (ThreeTerrain "legacy planet water" spirit),
  higher fidelity: depth bands, hard foam ring.
- Controls over size (radius), render (LOD/resolution/wireframe), style.
- Frontend look = ThreeTerrain studio aesthetic (dark panels, thin borders,
  small-caps labels, left toolbar + side panel + status bar).

## Architecture
```
src/
  main.jsx, App.jsx, styles.css        — React shell, studio look
  engine/
    Engine.js        — renderer/scene/camera/loop/params/callbacks
    PlanetWorld.js   — cube-sphere quadtree LOD chunk manager
    noiseGLSL.js     — shared GLSL: hash/fbm/ridge/warp/crater + height()
    materials.js     — shared uniforms + terrain/water/cloud/atmo/star materials
    presets.js       — DEFAULT_PARAMS + planet style presets
  components/
    controls.jsx     — Slider / Toggle / Select / Color rows
    panels.jsx       — Terrain, Style, Water, Clouds, Performance panels
    TopBar.jsx, LeftToolbar.jsx, StatusBar.jsx
```
Key idea kept from ThreeTerrain: heights are evaluated in GLSL (vertex displaces
a shared grid via per-chunk cube-face basis uniforms; fragment re-evaluates for
analytic normals), so terrain edits are live uniform changes — no CPU meshing.

## Checkpoints 0–2 — Scaffold, LOD terrain, water/clouds/atmosphere  ✅
- [x] Scaffold: package.json / index.html (boot splash) / vite / main.jsx
- [x] noiseGLSL height field (warped fbm continents + ridged mountains +
      worley craters + continent shelf), all uniforms live, OCTAVES define
- [x] PlanetWorld cube-sphere quadtree: split/merge by camera distance,
      shared grid geometry + skirt ring, horizon culling
      (verified: 12 chunks far → 81 near, 60 FPS)
- [x] Terrain material: hard palette bands + toon-banded diffuse, polar caps
- [x] Water shell: discard-above-sea, 3 depth bands, dashed hard foam ring,
      toon spec blob, fresnel alpha
- [x] Cloud shell: fbm coverage with HARD threshold (softness 0.05 default),
      rotation drift, toon shading — cartoon look confirmed
- [x] Atmosphere fresnel rim + hash starfield
- Commit: `checkpoint-2` (0-2 landed together — first boot already renders)

## Checkpoint 3 — Studio UI  ✅ (verify look next)
- [x] Panels: Terrain / Style / Water / Clouds / Perf (controls.jsx primitives)
- [x] TopBar (brand, seed box, dice, screenshot), LeftToolbar, StatusBar
      (fps/tris/draws/chunks — verified live values)
- [x] Presets: Terran, Desert, Ice, Moon, Lava, Candy (applyPreset resets to
      defaults + patch)
- [ ] Visual pass over the panel UI in the browser (only DOM-verified so far)
- Commit: `checkpoint-3`

## Checkpoint 4 — Polish & perf
- [ ] LOD tuning knobs, chunk res selector, wireframe, FPS cap check
- [ ] Save/load params JSON; PNG screenshot
- [ ] README
- Commit: `checkpoint-4`

## Verification notes (this machine)
- preview_screenshot can hang; run `node .claude/shot-receiver.cjs` (port 5199)
  and POST canvas JPEG from page. Occluded tab: rAF frozen → drive
  `engine.renderOnce()` manually before toDataURL; canvas may be size 0 —
  `renderer.setSize(w,h,false)` first.
