# Studio interop

The studio (this repository's app, `npm run dev`) is a visual editor for the
same `Planet` parameters. There are three ways to take a planet from the
studio into your code.

## 1. "Use in code" (Export panel)

The Export panel's **Use in code** section shows, and copies, the current
body as a constructor call. Procedural terrain lists the parameters that differ
from the defaults. A planet containing a node graph uses a complete
`Planet.fromJSON()` snapshot, preserving numeric precision and its applied graph:

```js
import { Planet, PlanetRenderer } from 'procedural-planets';

const planet = new Planet({
  type: 'gas',
  seed: 3141592,
  gasBandCount: 24,
  gasRingsEnabled: true,
  gasRingColor: [0.86, 0.8, 0.69],
});
scene.add(planet);
```

## 2. The exported preset JSON

**Export** writes a ZIP containing `planet_preset.json` (`star_preset.json`
for stars, which includes any custom star shader). Load it with:

```js
import presetJson from './planet_preset.json';
const planet = Planet.fromJSON(presetJson, { lightSource: sun });
```

## 3. Saved projects

Studio projects live in the browser (IndexedDB). A project object, or just
its complete document loads the same way:

```js
const planet = Planet.fromJSON(project);
```

Parameter sets saved by older studio versions are migrated automatically. The
shape is kept, and the look keys are upgraded to the current render model.

## Round trip

`planet.serialize()` returns the same `{ app, version: 2, mode, params, terrain }` shape
as the studio export. You can store it, send it, and restore it with
`Planet.fromJSON()`.

## Height node graphs

Terrain source and body type are separate. `params.mode` selects Planet, Gas or
Star; `terrain.mode` selects `procedural` or `nodes`. Switching body type retains
the terrestrial graph. Nodes evaluate a height field on normalized local sphere
directions; the final height is clamped to `[0, 1]` and the surface radius is
`radius + height * heightScale`.

```js
import { Planet, createRecipe, validateGraph } from 'procedural-planets';

const graph = createRecipe('two-noises');
const result = validateGraph(graph);
if (!result.valid) throw new Error(result.diagnostics[0].message);
const planet = new Planet({ seed: 42, terrain: { mode: 'nodes', graph } });

// Supply the renderer to validate shader compilation before changing the planet.
const applied = await planet.setTerrainGraph(createRecipe('noise-remap'), { renderer });
if (!applied.ok) console.error(applied.diagnostics);
```

Other recipes are `current` (a faithful copy of classic terrain parameters),
`noise-remap`, and `two-noises`. Available node types are `currentTerrain`,
`noise3d`, `constant`, `mix`, `remap`, and `heightOutput`. The graph is plain JSON:
`{ format: 'procedural-planets-height-graph', version: 1, nodes, edges, outputId }`.
Nodes contain `id`, `type`, `params`; connections contain `id`, `source`,
`sourcePort`, `target`, `targetPort`. The public library has no React Flow dependency.

Studio schema version 2 adds `terrain` and `editor` beside `params`. `terrain.graph`
is the last applied, validated graph. `editor.draftGraph` may contain incomplete
connections; positions, presentation names, groups and viewport also live in
`editor`. Saving and reopening retains both states, and the runtime ignores the
editor. Invalid or unsupported imported data remains available for recovery.
Old projects migrate to procedural terrain without changing their parameter values.

Runtime JSON, mesh bakes, ZIP archives and GLB exports use the applied state only.
Export jobs capture a coherent snapshot before asynchronous packaging, so editing
the live planet during an export does not alter its mesh or preset. ZIP presets
include the complete terrain configuration; editor drafts are excluded. Cloud
projects retain both applied graphs and drafts within the existing 1 MB limit.

The [standalone example](../examples/node-graph.html) demonstrates construction,
serialization and switching between procedural and node terrain through the public API.

## Paint authoring

The terrestrial authoring stack is **Procedural / Node Terrain → Paint Layer →
Final Planet Surface**. Nodes never contain paint edits, and changing the base
retains the separate signed height field and material influences.

Press **P**, or choose **Paint** in the Studio tool rail. The viewport stays live:
left drag paints, right drag orbits, the wheel zooms, and Shift + wheel changes
the brush radius. Esc/P closes Paint Mode while keeping all layers active.
Ctrl/Cmd + Z undoes one complete stroke; Ctrl/Cmd + Shift + Z redoes it.
Brush settings are transient and do not create document history entries.

Sculpt raises/lowers radial elevation. Smooth averages surrounding **final**
elevations and writes only a compensating paint offset. Flatten targets
`planet radius + elevation`; **Pick current height** samples the next clicked
surface. Material paint blends existing Coast/seabed, Sand/desert,
Grass/vegetation, Rock and Snow/ice colors. Painting a seabed material does not
remove the planet's ocean shell. Erase progressively removes both painted height
and material influences. **Clear Painted Layers** confirms before clearing just
paint and is undoable.

Round, Ellipse, Organic, Scatter and Ribbon brushes share size, strength, falloff,
spacing, and (for Ellipse/Ribbon) rotation. Size is a geodesic radius in planet-local
units, with a minimum based on the field resolution. All brushes use normalized
sphere directions and a local tangent frame, including pole/cube-edge crossings.
The outline follows actual displaced terrain.

Editable documents and runtime presets now preserve `paint` separately from
`editor`. Autosave, project switching, browser reload, `.ppplanet` import/export,
cloud project JSON, `Planet.fromJSON()`, and clones retain the exact Float32 field.
Sparse compressed tiles avoid giant pixel JSON arrays and redundant pointer
samples. The cloud API's existing **1 MB project limit** still applies: heavily
painted complex fields can reach it; editable local files have no such API limit.
Undo keeps compressed snapshots only at stable action boundaries.

Studio uses 256 quads per cube face. Detail is limited by that sampling resolution
and by viewport/export mesh LOD. GPU uploads affect dirty faces only, at most
once per frame. Terrain displacement already evaluates the field in each LOD
chunk, so painting does not regenerate atmosphere, clouds, ocean or shaders.
