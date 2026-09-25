# Embedding guide

How live planets fit into an existing three.js renderer, and the knobs that
matter once they do.

## How it works

A `Planet` is an `Object3D` that carries no geometry of its own:
`renderer.render()` draws nothing for it. When you call
`planetRenderer.render(scene, camera)`, the renderer does the following:

1. Collects the visible `Planet`s under `scene` (a tree, a single planet or an array).
2. Frustum-culls each one against its bounding sphere, which covers the atmosphere, rings or corona.
3. Sorts the rest far to near.
4. For each planet:
   1. Builds a **proxy camera in the planet's local frame** (`planet.matrixWorld⁻¹ · camera.matrixWorld`). Its near and far planes are refitted around the planet, which gives the planet's depth precision independently of your camera settings.
   2. Renders the planet's own passes: HDR surface and depth, then the volumetric cloud raymarch, then the ocean, atmosphere and tone-mapping composite. The passes are **scissored** to the planet's screen rectangle.
   3. Blends the result over your target with premultiplied alpha, **depth-tested** against your depth buffer.
   4. Writes the planet's solid surface into your depth buffer.

Because each planet renders in its own local frame, you can move, rotate,
uniformly scale and parent a planet like any other object. The shaders also
keep full precision far from the world origin.

## Render order

```js
renderer.render(scene, camera);    // 1. your opaque geometry (fills the depth buffer)
planets.render(scene, camera);     // 2. planets: hidden behind your geometry, covering what's behind them
```

**Transparent objects** such as particles, sprites, glass or glows should be
drawn **after** the planets, so that they blend over them. One way is to put
them on another layer:

```js
renderer.autoClear = false;
renderer.clear();
camera.layers.set(0);  renderer.render(scene, camera);   // opaque
planets.render(scene, camera);
camera.layers.set(1);  renderer.render(scene, camera);   // transparent things live on layer 1
```

### What the depth test does and doesn't do

- **Your geometry in front of a planet hides it.** A ship passing in front of the globe works, and so does a moon behind the rings.
- **A planet hides your geometry behind it**, and its surface depth is written for anything drawn later.
- **Translucent edges** (the atmosphere rim, ring gaps, the corona) blend over your geometry behind them. They never occlude anything drawn later.
- Your objects are **not hazed** by a planet's atmosphere, and they cast no shadows on planets (and receive none). A live planet is lit by its `lightSource`, not by three lights. Scene fog does not apply to planets.
- With the camera **inside** a planet's atmosphere, the sky only fills pixels where your depth buffer is empty, so your nearby objects stay crisp.
- A **logarithmic depth buffer** (`new WebGLRenderer({ logarithmicDepthBuffer: true })`) is supported.

## Colour output and tone mapping

`PlanetRenderer({ output })` controls what the planets write:

| `output` | What is written | Use when |
|---|---|---|
| `'auto'` (default) | `'display'` for the canvas and for sRGB render targets, `'linear'` for linear ones | Almost always |
| `'display'` | Tone-mapped (ACES) sRGB, like the studio | You render to the canvas or to an sRGB target |
| `'linear'` | Premultiplied **linear HDR** | You render into an HDR target and tone map afterwards (EffectComposer + OutputPass) |

With `'display'`, your renderer's `toneMapping` does not apply to the planets,
because they are already tone mapped. Use the `exposure` parameter to balance
them against the rest of the scene.

Render targets whose `texture.colorSpace` is `THREE.SRGBColorSpace` are
encoded by the GPU when written. In `'display'` mode the planets write
tone-mapped *linear* values into them, the same way three's own materials do,
so the result matches a render to the canvas.

## EffectComposer

```js
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { PlanetPass } from 'procedural-planets';

renderer.toneMapping = THREE.ACESFilmicToneMapping;
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new PlanetPass(scene, camera));  // right after the RenderPass
composer.addPass(new UnrealBloomPass(/* ... */)); // optional effects see the planets too
composer.addPass(new OutputPass());               // tone mapping + sRGB for everything
```

`PlanetPass` composites onto the composer's read buffer. It keeps the depth
from the RenderPass, does not swap buffers, and defaults to `output: 'linear'`.
Never make it the last pass. See [`examples/composer.html`](../examples/composer.html).

## Rendering into your own render target

```js
planets.render(scene, camera, { target: myRenderTarget });
```

The target must have a depth buffer (the default for `WebGLRenderTarget`) that
already holds your scene's depth. Internal buffers follow the target's size.
When `target` is omitted, the renderer's current render target is used.

With `output: 'auto'`, a linear target (the default `NoColorSpace`, and
HalfFloat targets) receives linear HDR, ready for your own tone mapping. An
sRGB target (`rt.texture.colorSpace = THREE.SRGBColorSpace`) receives the
display look.

## Background: transparent or stars

`new PlanetRenderer(renderer, { background: 'stars' })` makes the **farthest**
planet own the frame instead. It is drawn opaque, over a procedural starfield
and sun disc, the way the studio and `PlanetViewer` do it. Any other planets
still composite on top. Use this when the planets *are* the scene, for example
in a menu background.

## Units, scale and precision

- **`radius`** (default 2000) and **`heightScale`** (default 80) are in the planet's local units. With scale 1 those are your world units. Atmosphere, clouds and ocean wave sizes scale with the planet.
- **Object scale** must be uniform: `planet.scale.setScalar(s)`. Non-uniform scale is not supported.
- **Camera near and far** don't affect planet quality, because the planet refits its own. Only the depth values written into your buffer use your camera's projection. A planet beyond your camera's far plane is still drawn, behind everything else.
- **Precision**: each planet renders relative to itself, so a planet placed 10⁶ units from the origin looks the same as one at the origin.

## Many planets

- Planets share the renderer's GPU targets. Each **visible** planet costs its own passes.
- **Planets that are not visible cost nothing.** Off-screen planets are culled, and `planet.visible = false` skips one.
- The **terrestrial** planet with clouds is the expensive one. It also allocates ~19 MB of weather cube maps.
- A good pattern for many bodies is to switch between a live planet up close and a baked mesh far away with `THREE.LOD`. `PlanetRenderer` only draws visible planets, and `renderer.render()` updates the LOD first:

```js
const lod = new THREE.LOD();
lod.addLevel(new Planet({ preset: 'mars', seed: 3, lightSource: sun }), 0);
lod.addLevel(await bakePlanet(renderer, { preset: 'mars', seed: 3, textureSize: 512 }), 40000);
scene.add(lod);
```

- `planetRenderer.info` → `{ planets, culled }` for the last frame.

## Performance knobs

| Parameter | Effect |
|---|---|
| `cloudsEnabled` | The volumetric cloud pass is the most expensive thing on a terrestrial planet |
| `cloudQuality` | Max raymarch steps (default 64) |
| `cloudResolution` | Cloud pass resolution budget (0.25–1). Small on-screen planets get full resolution automatically |
| `chunkRes`, `maxDepth`, `splitFactor` | Terrain LOD density (grid size per chunk, tree depth, split distance) |
| `octaves` | Noise octaves (compile-time) |
| `scissor` (renderer option) | Leave it on: planets only shade their screen rectangle |

**Shader compilation.** The terrain shader is large, and its first use can
stall for a moment. Call `await planets.compile(planet, camera)` during
loading. It uses `KHR_parallel_shader_compile` where the browser supports it.

## Picking and placing things on a planet

```js
const hits = raycaster.intersectObject(planet);           // sphere at planet.surfaceRadius
const dirLocal = new THREE.Vector3(0.3, 0.8, -0.5);
const base = planet.getSurfacePoint(dirLocal);            // world position on terrain or sea
building.position.copy(base);
```

`getSurfacePoint` and `getSurfaceRadius` read a CPU mirror of the base
terrain octaves. It matches the rendered terrain closely, but not to the
finest detail octaves.

## Limitations

- Only `PerspectiveCamera` is supported. Orthographic cameras are skipped with a warning, and WebXR / `ArrayCamera` is not supported.
- There is one sun per planet.
- A planet always renders the full frame height at the output resolution. Split-screen viewports (`setViewport`) are not supported yet.
- Reversed-Z depth buffers are not supported.
