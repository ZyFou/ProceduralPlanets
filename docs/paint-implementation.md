# Paint integration

Reference inspected: ZyFou/ProceduralTerrains `PaintModeManager`, `PaintLayerManager`,
`PaintPanel`, `PaintToolbar`, `PaintBrushCursor`, and paint styles (main branch).
Reuse its compact icon rail/settings panel, shared brushes, spacing, one-stroke
history, and independence between editing and layer rendering. Terrain X/Z
coordinates, flat cursors, and board textures cannot be reused on a sphere.

Integration points, in implementation order:

1. `src/paint/sphericalPaintMapping.js`: normalized local directions, six faces,
   geodesic brush distances, tangent frame and exponential-map brush shapes.
2. `PlanetPaintLayerManager`: signed local-unit height and five influences
   (coast, sand, vegetation, rock, snow), shared CPU/GPU bilinear sampling via a WebGL2 six-layer texture array.
   Face grids include shared edge vertices. Stamps evaluate spherical directions
   on every touched face, so edges/corners have identical values. Persistence:
   sparse 16x16 tiles, lossless zlib Float32 little-endian data, base64; no pixel
   JSON arrays or redundant pointer events. Malformed payloads are rejected.
3. `Planet.js`: owns layers, adds offsets after `_createHeightSampler`, keeps
   layers through `setTerrain`/parameter edits, serializes/copies/restores layers,
   expands bounds/clipping, disposes textures. Gas/star ignore layers.
4. `materials.js`: stable paint uniforms in shared uniforms, displacement in
   both exact and low-varying vertex shaders, paint gradients in fragment
   normals, material influences blended into existing terrestrial albedo.
   LOD grids already evaluate direction-based GPU heights: no chunk geometry
   rebuild or independent painted mesh is needed.
5. `PlanetPaintPicker`/`PlanetPaintBrushCursor`: local ray/root refinement against
   the final CPU height field; geodesic outline sampled on displaced terrain.
6. `PlanetPaintModeManager`/`Engine`: canvas capture-phase input ownership,
   right-button OrbitControls rotation, ordinary wheel zoom, Shift-wheel size,
   pointer capture/cancel/blur cleanup, frame batching and dirty-face uploads.
7. `App.jsx`/paint components: P/Escape workspace lifecycle; existing Studio
   undo/redo receives one stable compressed paint document per completed stroke.
   Brush settings are transient and never enter document history.
8. `Root.jsx`/`ProjectStore`/`ProjectDocument`: explicit runtime `paint` alongside
   params/terrain/editor; autosave, switches, editable files, cloud project JSON.
   Existing API preserves extra document fields and enforces its 1 MB limit.
9. `PlanetBaker`/`PlanetExporter`/`Engine.exportPlanet`: final CPU geometry and
   same GPU albedo/normal blending; archive preset includes runtime paint.
10. Types, documentation, unit and real WebGL browser tests verify these paths.

The authoring stack remains Procedural/Node Terrain -> Paint Layer -> Final Surface.


Validation notes:

- Unit tests cover spherical mapping, tool math, exact sparse-tile persistence,
  project/runtime round trips, procedural and node bases, and stroke boundaries.
- Browser tests run the real Studio with Chromium software WebGL, exercise input
  and project reload, and compile both terrestrial material variants. The export
  harness reads Float32 GPU samples at seams/poles, checks dirty uploads without
  shader recompilation, checks a second renderer, and reloads GLB/ZIP output.
- A local CPU check at resolution 256, radius 1000, brush radius 80 and five
  procedural octaves measured median sculpt/material stamps around 1–2 ms.
  Smooth stamps with the editor's base-height cache measured about 7–14 ms after
  an initial roughly 80 ms fill. Sparse serialization of that edited patch was
  about 10.5 KB. These are CPU measurements, not hardware GPU frame-rate claims.
- Larger brushes and dense edits cost more CPU/storage. Studio clamps minimum
  size to the field resolution; export mesh resolution controls narrow-feature
  fidelity. Existing cloud document size limits continue to apply.
