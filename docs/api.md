# API reference

```js
import {
  Planet, PlanetRenderer, PlanetViewer, bakePlanet, PlanetPass,
  listPresets, findPreset, validateParams, PARAM_DOCS,
  DEFAULT_PARAMS, PLANET_PRESETS, GAS_PRESETS, STAR_PRESETS, DEFAULT_STAR_BODY, VERSION,
} from 'procedural-planets';
import { createPlanetArchive, downloadPlanetArchive, exportPlanetGLB, toGLB } from 'procedural-planets/export';
```

TypeScript declarations ship with the package (`types/index.d.ts`,
`types/export.d.ts`). Every parameter is typed in the `PlanetParams`
interface.

---

## `Planet` — extends `THREE.Object3D`

One procedural body: a terrestrial planet, a gas giant or a star. Add it to
your scene and transform or parent it like any object. It is drawn by a
`PlanetRenderer`, not by `renderer.render()`.

### `new Planet(options?)`

| Option | Type | Description |
|---|---|---|
| `type` | `'terrestrial' \| 'gas' \| 'star'` | Body type. Default: the preset's type, else `'terrestrial'` |
| `preset` | preset name | A named look ([presets.md](presets.md)). Throws if unknown or if it doesn't match `type` |
| `params` | object | A whole parameter object (for example from the studio). Flat keys override it |
| `lightSource` | `Object3D \| Vector3 \| null` | See [`lightSource`](#lightsource) |
| `starShader` | string | Custom `starSurface()` GLSL body (stars) |
| `name` | string | `Object3D.name` |
| *any parameter* | | `seed`, `radius`, `seaLevel`, … ([parameters.md](parameters.md)) |

Parameters resolve in this order: defaults ← preset ← `params` ← flat options.
Unknown keys, and values of the wrong type, are skipped with a warning.

### Properties

| Property | Description |
|---|---|
| `planetType` | `'terrestrial' \| 'gas' \| 'star'` (read-only; `Object3D.type` is `'Planet'`) |
| `params` | The current, fully resolved parameters. Treat as read-only and use `set()` |
| `lightSource` | Where the sunlight comes from (below) |
| `time` | Shader clock in seconds (waves, gas flow, star surface) |
| `cloudTime` | Integrated cloud clock |
| `weather` | Regional, timed weather: `add` / `update` / `remove` systems, `sample`, `strike`, the weather clock ([weather.md](weather.md)) |
| `transitioning` | Parameter keys with a `transition()` still running |
| `boundingRadius` | Local-space radius enclosing everything drawn (atmosphere, rings, corona). Used for culling |
| `surfaceRadius` | Local-space radius of the solid or liquid surface. Used for picking |
| `starShaderBody` | The `starSurface()` GLSL in use |
| `isPlanet` | `true` |

#### `lightSource`

- **`Object3D`**: a `Planet` star, a `PointLight`, any object. The light comes from its world position.
- **`DirectionalLight` / `SpotLight`**: the direction from the light's target to the light, as three defines it.
- **`Vector3`**: a world-space direction pointing *toward* the sun.
- **`null`**: use the `sunAzimuth` / `sunElevation` parameters, in the planet's local frame.

### Methods

| Method | Description |
|---|---|
| `set(patch)` / `set(key, value)` | Set parameters live (validated; colours accept `[r,g,b]`, `'#rrggbb'`, `0xrrggbb`, `THREE.Color`). Returns `this` |
| `get(key)` | One parameter value (colours as a fresh `[r,g,b]` array) |
| `applyPreset(name, { setType = true })` | Apply a preset. A terrestrial preset resets all terrestrial keys first (the seed is kept). A gas or star preset resets its own domain. Switches the body type unless `setType: false` |
| `randomizeSeed()` | New random seed; returns it |
| `setStarShader(glsl, renderer?)` | Replace the star surface function. With a renderer, or after the first render, it is compile-checked first. Returns `{ ok, error? }` |
| `getSurfaceRadius(localDir)` | Terrain radius along a local direction (CPU mirror of the base height field) |
| `getSurfacePoint(localDir, target?)` | **World-space** point on the terrain or sea surface along a local direction |
| `raycast(raycaster, intersects)` | `THREE.Raycaster` support (a sphere at `surfaceRadius`) |
| `update(delta)` | Advance the clocks. `PlanetRenderer` calls this unless `autoUpdate` is off |
| `transition(patch, { duration })` | Glide numeric / colour parameters to new values over `duration` seconds of planet time. Rebuild / re-bake keys and counts switch at once. Returns `this` |
| `addEventListener('lightning', fn)` | Every lightning strike: `{ position (world), direction (local), intensity, ground, system }` |
| `serialize()` | `{ app, version, mode, params }`, the same shape as the studio's `planet_preset.json` |
| `clone()` / `copy(source)` | Object3D clone, including the parameters, light source and star shader |
| `dispose()` | Free the planet's GPU resources |
| `setParam(key, value)` | Low-level, **unvalidated** single-key setter (used by the studio UI) |

### `Planet.fromJSON(json, options?)`

Builds a planet from any of these:
- a studio export (`planet_preset.json` / `star_preset.json`, custom star shader included)
- a saved studio project (`{ params }`)
- a bare parameter object
- a JSON string of any of the above

Parameter sets saved by older studio versions are migrated. `options` are
extra constructor options, and override the loaded parameters.

---

## `PlanetRenderer`

Draws `Planet`s with your `THREE.WebGLRenderer` (WebGL2). Create **one per
renderer**; it owns the GPU buffers the planets share.

### `new PlanetRenderer(renderer, options?)`

| Option | Default | Description |
|---|---|---|
| `background` | `'transparent'` | `'transparent'`: composite over your frame. `'stars'`: the farthest planet owns the frame (opaque, with a starfield) |
| `output` | `'auto'` | `'auto'`: display for the canvas and sRGB targets, linear for linear targets. `'display'`: ACES tone mapped (sRGB). `'linear'`: premultiplied linear HDR (for HDR / composer pipelines) |
| `depthTest` | `true` | Planets are hidden behind your geometry |
| `depthWrite` | `true` | Planet surfaces are written into your depth buffer |
| `scissor` | `true` | Only shade each planet's screen rectangle |
| `autoUpdate` | `true` | Advance planet clocks from an internal clock when `render()` gets no `delta` |
| `maxDelta` | `0.05` | Clamp for the internal clock step (seconds) |
| `impostors` | `true` | Draw distant planets as impostors (see [embedding](embedding.md#distant-planets-impostors)) |
| `impostorPixels` | `90` | Screen radius (px) under which a planet becomes an impostor |
| `impostorUpdates` | `2` | Impostor pictures re-rendered per frame at most |
| `impostorAngle` | `0.6` | View or sun direction change (degrees) that makes an impostor stale |
| `impostorRefresh` | `0.5` | Planet-clock seconds between impostor refreshes (clouds, waves) |
| `impostorAtlasSize` | `2048` | Largest impostor atlas edge (px); it starts at 512 (2 MB) and doubles when full |

### Methods

| Method | Description |
|---|---|
| `render(planets, camera, { target?, delta? })` | Draw every visible planet in `planets`: an object tree (e.g. your scene), a `Planet` or an array. `camera` must be a `PerspectiveCamera`. `target` defaults to the renderer's current render target and needs a depth buffer for occlusion. Call it after your opaque scene |
| `prepare(planets, camera?, options?)` | `Promise`: get planets ready without stalling the page. Shaders compile in parallel (`KHR_parallel_shader_compile`), the one-time GPU bakes run a slice per frame, and it resolves when the next `render()` draws them at full quality: the place to hide a loading screen. Options: `modes` (also compile the other body types, default `false`), `bake` (default `true`), `target`, `onProgress({ stage, progress, stageEnd, done, total })` |
| `compile(planets, camera?)` | `Promise`: `prepare()` without the bakes |
| `setOptions(options)` | Change options at runtime |
| `release(planet)` | Immediately release the cached impostor of a removed body; the caller still owns the Planet |
| `dispose()` | Free the shared buffers (planets are disposed separately) |
| `info` | `{ planets, culled, pending, impostors, captures }` for the last `render()` |
| `pending` | Planets the last `render()` skipped because their shaders are still compiling |

`render()` never compiles a shader on the spot. A planet whose programs are
still compiling in the background is skipped (`info.pending`) instead of
freezing the page; call `prepare()` first to show it from its first frame.

The renderer restores the host renderer's state that it touches: render
target, clear colour and alpha, `autoClear`, scissor.

### Streaming cleanup

When removing a live body, call `planetRenderer.release(planet)` to return its
cached impostor slot immediately, then remove and dispose the caller-owned
`Planet`. `planetRenderer.dispose()` releases the shared pipeline and atlas
when the entire view closes.

---

## `PlanetViewer`

A self-contained single-planet view: its own `WebGLRenderer`, camera,
`OrbitControls`, render loop and starfield background.

### `new PlanetViewer(options)`

| Option | Default | Description |
|---|---|---|
| `canvas` | — | Canvas to render into… |
| `container` | — | …or an element to create a full-size canvas in (one of the two is required) |
| `planet` | terran | A `Planet` (which the viewer won't dispose) or `Planet` options |
| `controls` | `true` | `OrbitControls` |
| `autoStart` | `true` | Start the render loop |
| `pixelRatio` | `2` | Max device pixel ratio |
| `onStats` | — | `({ fps, triangles, drawCalls, chunks, pending }) => void`, about 2 Hz |

### Members

| Member | Description |
|---|---|
| `planet`, `renderer`, `camera`, `controls`, `planetRenderer`, `canvas` | The pieces |
| `setPlanet(planetOrOptions)` | Swap the planet; returns the new one |
| `frame()` | Reset the camera to the default three-quarter view |
| `start()` / `stop()` / `running` | Render loop |
| `renderOnce()` | One frame, without advancing time |
| `prepare({ onProgress?, modes? })` | `Promise`: compile the shaders, run the bakes and draw the first frame. Resolves once that final-quality frame is on the canvas |
| `screenshot(w = 1920, h = 1080)` | PNG data URL at native resolution, regardless of viewport performance settings |
| `captureThumbnail(w = 480, h, type = 'image/webp', quality)` | `Promise<string>`: a small copy of the next frame that draws the planet (no extra render) |
| `dispose()` | Free everything (and remove the canvas it created) |

The studio's **Perf → Rendering** controls apply to all three body types.
Set `viewer.planet.set({ renderResolution: 0.5, upscaler: 'spatial' })` to render
at half the drawing-buffer width and height (one quarter of the pixels), then
reconstruct the frame at the canvas's full resolution. `renderResolution`
accepts 0.25–1 and defaults to 1; at 1 the reconstruction pass is bypassed.
`upscaler` defaults to `'bilinear'` (hardware linear interpolation). `'spatial'`
uses Catmull-Rom bicubic reconstruction, clamped to the local colour range to
avoid ringing, with no frame history. These settings are saved with the planet
but affect only `PlanetViewer`, including the studio, rather than host scenes
drawn with `PlanetRenderer`. Preset changes preserve them.

---

## `bakePlanet(renderer, options?)` → `Promise<Group>`

Bakes a planet into plain meshes with `MeshStandardMaterial`, lit by your
scene's lights. See [baking.md](baking.md).

| Option | Default | Description |
|---|---|---|
| `planet` | — | A `Planet` to bake. Otherwise the remaining options are `Planet` options (`preset`, `seed`, …) |
| `meshResolution` | `128` | Quads per cube-face side (terrestrial) / sphere segments |
| `textureSize` | `1024` | Texture size per cube face, or width of the equirectangular map |
| `water` | `true` | Translucent ocean shell |
| `atmosphere` | `true` | Fresnel atmosphere rim, or corona glow for stars |
| `rings` | `true` | Gas giant rings |
| `bakeLighting` | `false` | Fold a fixed sun into the textures |
| `starMaterial` | `'basic'` | Star surface: `'basic'` (unlit) or `'standard'` (emissive) |
| `onProgress` | — | `(message) => void` |

The returned group has a `dispose()` method, and its `userData.params` holds
the baked parameters.

---

## `PlanetPass` — EffectComposer pass

`new PlanetPass(scene, camera, options?)`. Options are `PlanetRenderer`
options (the default `output` is `'linear'`), or `{ planetRenderer }` to reuse
one. Put it right after the `RenderPass` and end the chain with an
`OutputPass`. See the [embedding guide](embedding.md#effectcomposer).

---

## Helpers and data

| Export | Description |
|---|---|
| `listPresets()` | `{ terrestrial: string[], gas: string[], star: string[] }` |
| `findPreset(name)` | `{ mode, preset: { label, patch } }` or `null` |
| `validateParams(patch)` | `{ params, unknown, invalid }`: normalised values, plus the keys that were rejected |
| `normalizeParam(key, value)` | `{ ok, value }` for one key |
| `resolvePlanetParams(options)` | The full parameter object that `new Planet(options)` would use |
| `migrateParams(params, …)` | Upgrade an old studio parameter set |
| `PARAM_DOCS` | Metadata per parameter: `{ domain, group, label, type, default, description, min?, max?, step?, structural? }`. Handy for building UIs |
| `DEFAULT_PARAMS`, `GAS_DEFAULTS`, `STAR_DEFAULTS` | Defaults |
| `PLANET_PRESETS`, `GAS_PRESETS`, `STAR_PRESETS` | Preset tables `{ name: { label, patch } }` |
| `DEFAULT_STAR_BODY` | The default `starSurface()` GLSL (a starting point for `setStarShader`) |
| `PLANET_TYPES` | Type name → render mode |
| `WEATHER_TYPES`, `MAX_WEATHER_SYSTEMS` | Weather system kinds and the GPU slot count |
| `normalizeWeatherSystem(def)` | A completed, validated weather system definition (or `null`) |
| `latLonToDirection(lat, lon)`, `directionToLatLon(dir)` | Degrees ↔ planet-local direction (the weather convention) |
| `VERSION` | Package version |

---

## `procedural-planets/export`

This is a separate entry point, so the core package doesn't bundle `fflate`
or three's exporters.

| Function | Description |
|---|---|
| `createPlanetArchive(renderer, planet, options?)` | Bake and package a planet like the studio's Export button. Returns `{ blob, filename, files }` |
| `downloadPlanetArchive(renderer, planet, options?)` | The same, then trigger a browser download |
| `exportPlanetGLB(renderer, planet, options?)` | Bake to a binary glTF (`Uint8Array`). Options as `bakePlanet` |
| `toGLB(object)` | Binary glTF of any `Object3D` |
| `downloadBlob(blob, filename)` | Browser download helper |

Archive options:

| Option | Default | Description |
|---|---|---|
| `format` | `'glb'` | `'glb'`, or `'obj'` (+ PNG textures) |
| `meshResolution` | `128` | |
| `textureSize` | `1024` | |
| `water` | `false` | Ocean shell |
| `bakeLighting` | `false` | |
| `includeMesh` | `true` | |
| `bakeColor` | `true` | |
| `preset` | `true` | Include the parameter JSON |
| `onProgress` | — | |

## Runtime paint layers

`Planet.serialize()` includes an explicit `paint` section, independent from
`params`, `terrain` and editor data. `Planet.fromJSON()` and `clone()` restore it.
Old JSON without paint remains unpainted. Terrestrial surface queries and GPU
terrain displacement both use:

```js
finalRadius = radius + baseElevation(direction) + paintHeightOffset(direction);
```

`getBaseElevation(localDirection)` returns the procedural/node elevation before
paint, in local units. `getSurfaceRadius(localDirection)` includes painted height.
`getSurfacePoint()` additionally respects the existing ocean level. Painted terrestrial
raycasting refines against the displaced terrain; unpainted planets retain legacy
approximate sphere raycasting. Gas/star radius queries ignore
retained terrestrial paint.

```js
const snapshot = planet.serialize();
const restored = Planet.fromJSON(snapshot);
restored.setPaint(snapshot.paint); // restore just the runtime layers
restored.setPaint(null);           // clear just paint
```

`planet.paint` is a detached `SerializedPlanetPaint` snapshot. Version 1 uses
`mapping: 'cube-vertices'`, a `resolution` of 16–512 quads per face (Studio: 256),
`encoding: 'sparse-zlib-f32le'`, and base64 `data`. Only nonempty 16×16 tiles are
stored, with six Float32 channels per vertex: signed height delta, coast/seabed,
sand, vegetation, rock and snow. The payload stores tile coordinates and
little-endian floats with lossless zlib compression. Consumers should preserve
this versioned section rather than hand-editing binary samples.

Malformed/unsupported paint documents throw before changing the live layers.
Paint textures allocate lazily, so unpainted planets retain the previous runtime
memory profile. React and the Studio paint controller are not part of the public
library. The runtime accepts saved paint; editor-specific brush APIs remain internal.
