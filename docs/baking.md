# Baking and export

## `bakePlanet()`: static planets with standard materials

```js
import { bakePlanet } from 'procedural-planets';

const mars = await bakePlanet(renderer, { preset: 'mars', seed: 3, radius: 1200, textureSize: 1024 });
mars.position.set(20000, 0, -5000);
scene.add(mars);
// ...
mars.dispose();   // geometries, materials, textures
```

A baked planet is a `THREE.Group` of ordinary meshes:

| Body | Meshes |
|---|---|
| Terrestrial | Six displaced cube-sphere faces (`Planet_pos_x`, …), each with its own colour texture; optionally a translucent ocean shell (`Planet_Ocean`) and a fresnel atmosphere rim (`Planet_Atmosphere`) |
| Gas giant | A UV sphere with an equirectangular band texture, rings (`GasPlanet_Rings`, radial texture with alpha), an atmosphere rim; tilted by `gasTilt` like the live one |
| Star | A UV sphere with an equirectangular surface texture (unlit `MeshBasicMaterial` by default) and an additive corona glow |

The colour textures are rendered by **the same GLSL as the live planet**:
biomes, snow, bands, spots and custom star shaders all carry over. The relief
comes from the CPU mirror of the height field. The meshes use
`MeshStandardMaterial`, so your scene's lights, shadows, fog and tone mapping
apply as for any other object.

What doesn't carry over: volumetric clouds, the animated ocean, atmospheric
scattering, gas giant flow and star animation. A baked planet is a snapshot.

Bake an existing live planet to get exactly its look:

```js
const live = new Planet({ preset: 'alien', seed: 9, cloudCoverage: 0.3 });
const baked = await bakePlanet(renderer, { planet: live, textureSize: 512 });
```

Baking takes from milliseconds to a few seconds, depending on `textureSize`
and `meshResolution`. It blocks the GPU while it runs, so bake during loading.

Typical uses:
- distant planets, as the far level of a `THREE.LOD` (see [embedding.md](embedding.md#many-planets))
- dozens of background bodies
- mobile targets
- anything you want to export

## Export to files: `procedural-planets/export`

```js
import { createPlanetArchive, downloadPlanetArchive, exportPlanetGLB } from 'procedural-planets/export';

// the studio's Export button: ZIP with planet.glb (or .obj + PNGs) and planet_preset.json
await downloadPlanetArchive(renderer, planet, { format: 'glb', textureSize: 2048, water: true });

// or keep the bytes
const { blob, filename, files } = await createPlanetArchive(renderer, planet);
const glb = await exportPlanetGLB(renderer, planet, { meshResolution: 256 });   // Uint8Array
```

The `planet_preset.json` in the archive holds the full parameters, and loads
back with `Planet.fromJSON()` (see [studio-interop.md](studio-interop.md)).
