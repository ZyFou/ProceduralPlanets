# Getting started

## Requirements

- **three.js ≥ 0.160** as a peer dependency. The package uses your copy of three, so there is never a second instance.
- **WebGL2.** Every current browser supports it. `PlanetRenderer` throws on a WebGL1 context.
- **An ES module environment**, with a bundler (Vite, webpack, esbuild…) or an import map.
- **TypeScript (optional):** the declarations ship with the package. Add `@types/three` for three's own types.

```sh
npm install procedural-planets three
```

Without a bundler, use an import map:

```html
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js",
  "three/examples/jsm/": "https://cdn.jsdelivr.net/npm/three@0.160.1/examples/jsm/",
  "fflate": "https://cdn.jsdelivr.net/npm/fflate@0.8.3/esm/browser.js",
  "procedural-planets": "https://cdn.jsdelivr.net/npm/procedural-planets/dist/lib/procedural-planets.js",
  "procedural-planets/export": "https://cdn.jsdelivr.net/npm/procedural-planets/dist/lib/export.js"
} }
</script>
```

## Three ways to use it

| | What you get | Cost | Use it for |
|---|---|---|---|
| **`Planet` + `PlanetRenderer`** | The full live render (LOD terrain, ocean, volumetric clouds, scattering, gas giant flow, star corona), composited into *your* frame with correct occlusion | A few GPU passes per visible planet | Hero planets, anything the camera gets close to |
| **`PlanetViewer`** | A ready-made canvas with a camera, orbit controls, a starfield and one planet | Same as above | A planet on a web page, previews, configurators |
| **`bakePlanet()`** | Plain `THREE.Mesh`es with baked textures and `MeshStandardMaterial`, lit by your lights | Baked once, then a normal draw call | Distant planets, many planets, mobile, glTF export |

The first two share the same `Planet` object and the same parameters. The baked
tier uses them too: bake any `Planet`, or pass the same options.

## Your first planet in an existing scene

```js
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Planet, PlanetRenderer } from 'procedural-planets';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 1e6);
camera.position.set(0, 1200, 6000);
const controls = new OrbitControls(camera, renderer.domElement);

// 1. create a planet. Every option except type / preset / lightSource /
//    params / starShader is a parameter (see parameters.md).
const planet = new Planet({ preset: 'terran', seed: 1234, radius: 2000 });
scene.add(planet);

// 2. one PlanetRenderer per WebGLRenderer
const planets = new PlanetRenderer(renderer);

// optional: compile the (large) shaders up front instead of on the first frame
await planets.compile(planet, camera);

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);   // 3. your scene...
  planets.render(scene, camera);    // 4. ...then the planets on top
});
```

That's all the integration there is: `planets.render()` finds every visible
`Planet` in the scene, culls the ones off screen, and composites the rest over
what `renderer.render()` drew. It depth-tests against your depth buffer and
writes the planet surfaces into it.

## Creating planets

```js
new Planet();                                    // terran defaults
new Planet({ preset: 'mars' });                  // body type comes from the preset
new Planet({ type: 'gas', preset: 'ringed' });   // explicit type (must match the preset)
new Planet({ type: 'star', starTemperature: 3500, radius: 4000 });
new Planet({ preset: 'desert', seed: 7, seaLevel: 0.25, colSand: '#e8c896' });
new Planet({ params: savedParams });             // a whole parameter object
```

- **Types**: `'terrestrial'` (the default), `'gas'`, `'star'`.
- **Presets**: see [presets.md](presets.md), or call `listPresets()` at runtime.
- **Seed**: any integer. The same seed and parameters always give the same planet.
- **Colours**: sRGB, as `[r, g, b]` in 0–1, `'#rrggbb'`, `0xrrggbb` or a `THREE.Color`.
- **Unknown keys and values of the wrong type** are skipped with a console warning, never silently used.

## Changing a planet

```js
planet.set({ cloudCoverage: 0.7, atmoStrength: 1.3 });   // live, next frame
planet.set('radius', 3500);
planet.get('seaLevel');
planet.applyPreset('ice');          // switch look (and type, for a gas / star preset)
planet.randomizeSeed();
```

Almost every parameter is a uniform, so changing one is free. The three
*structural* keys (`octaves`, `chunkRes`, `maxDepth`) rebuild the terrain LOD
world instead.

## Lighting

A planet is lit by one sun. Set its direction with `lightSource`:

```js
earth.lightSource = sun;                           // a Planet star, a THREE light, any Object3D
earth.lightSource = new THREE.Vector3(1, 0.2, 0);  // a world-space direction toward the sun
earth.lightSource = null;                          // use the sunAzimuth / sunElevation params (planet-local)
```

For a `DirectionalLight` or `SpotLight` the direction is target → position,
as three uses it. For any other object it is planet → object.

## Time

By default, `PlanetRenderer` advances every planet's clock by the real frame
time. That clock drives waves, cloud drift, gas giant flow and the star
surface. For a deterministic timeline:

```js
const planets = new PlanetRenderer(renderer, { autoUpdate: false });
planets.render(scene, camera, { delta: 1 / 60 });   // explicit step
planet.time = 12.5;                                  // or set the clocks directly
```

## Next steps

- [Embedding guide](embedding.md): render order, transparency, post-processing, scale, many planets, performance.
- [API reference](api.md)
- [Examples](../examples/): run `npm run dev` in the repository and open `/examples/`.
