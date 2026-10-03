# Height node graph V1 — validation record

Validated on 3 October 2026 from the `develop` checkout initially at
`d537d438c8410bad208bbc2c6b085a9e3effb6c2`. The local ProceduralTerrains UI
reference was `04ff07203b397d01585b177d6b04e3b207010e48`. No remote branch,
package or site was published. The existing independent landing CSS edit is
excluded from the node graph commits.

## Delivered behavior

- Terrain → Nodes encapsulates the classic terrain in Current Terrain → Height
  Output. Planet/Gas/Star remain independent body modes.
- Six node types and three recipes drive spherical CPU and GLSL generation.
  The public library exports the graph core without React Flow.
- Custom cards, cyan ports, search, inspector, selection, duplication, groups,
  global history and docking use the Terrains workspace conventions. Default
  widths are palette 208 px, inspector 372 px; graph height is 38%.
- Applied terrain, draft and presentation are separate schema 2 document data.
  Invalid drafts keep the last valid terrain, including after reopen and undo.
  Malformed imports are preserved and diagnosed.
- Candidate shaders must really link before replacing the applied terrain.
  Obsolete and rejected candidates are disposed. Numeric values and seed use
  existing uniforms where the shader structure permits.
- JSON, clone, surface sampling, snippet, CPU geometry baking, GPU texture
  baking, GLB and ZIP presets retain a fixed applied generation snapshot.

## Repository checks

`npm ci`, `npm test`, `npm run test:api`, `npm run docs:check` and
`npm run build` completed successfully. Final unit suite: **88 tests across
9 files**. API suite: **26 tests**, including graph round trips and the 1 MB
document limit. Build includes both public library and Studio. The Studio
keeps React Flow in a separate lazy workspace chunk (about 221 kB JS and
56 kB CSS); the main Studio chunk retains Vite's size warning.

## Actual WebGL and export checks

Chrome 154 / Windows 10 / WebGL 2 / ANGLE Direct3D 11 / NVIDIA RTX 5060 Ti.
The [retained GPU report](../output/playwright/graph-gpu-results.json) records
seed 1337, fourteen directions per recipe and nine passing checks. Float
render targets were read back from actual linked programs.

| Field / scenario | Maximum measured absolute discrepancy |
| --- | ---: |
| Current Terrain height CPU/GPU | 0.0000749521 |
| Noise → Remap height CPU/GPU | 0.0000195127 |
| Two Noise → Mix height CPU/GPU | 0.0000182264 |
| Two independently configured Current Terrain sources | 0.0002952303 |
| Largest gradient component discrepancy among those recipes | 0.0994861 |
| Initial classic GPU identity / repeated face-junction directions | 0 |

The displayed fixed review tolerances are enforced. These measurements do not
establish a universal tolerance for extreme frequency/octave combinations or
all GPUs. Ten near/far rendered frames selected 6–76 visible chunks and depths
1–3 without missing terrain, GL errors or new shader programs. Deliberate link
failure, inverse completion order and disposal retained the right sampler and
materials. Final GPU resource counts were zero after cleanup.

Layout/reorder, disconnected incomplete nodes, numeric values and seed created
zero materials and zero shader programs after warming. Atomic update timings
in that run were 0.1–0.4 ms. A separate
[Studio measurement](../output/playwright/studio-node-metrics.json) recorded no
node-editor resource before opening the workspace, 88.4 ms from the first
workspace resource request to mounted cards, and 95.8 ms from a Mix numeric
input to the first animation frame after the graph returned valid. These are
single local development observations, not FPS or production performance
guarantees; the startup timestamp includes initial engine loading.

The [export report](../output/playwright/graph-export-results.json) has four
passing actual WebGL bake / GLB reimport / async ZIP / snippet checks. Geometry
resolution was 8; requested face texture resolution 32 used the baker's minimum
64. The reimport contained six meshes, normals and colors, no shader errors,
24,576 texture pixels and maximum vertex-radius error 0.00000558313.

## Browser workflows and captures

Compared both live workspaces in fixed-size iframe viewports, since the browser
extension's viewport override did not change the native window dimensions:

- [Planets 1440 × 900](../output/playwright/planets-nodes-1440.png) and
  [Terrains 1440 × 900](../output/playwright/terrains-nodes-1440.png).
- [Planets 1100 × 800](../output/playwright/planets-nodes-1100.png) and
  [Terrains 1100 × 800](../output/playwright/terrains-nodes-1100.png).
- [390 × 844 mobile viewer](../output/playwright/planets-nodes-mobile.png) and
  [invalid draft retaining the planet](../output/playwright/planets-invalid-draft.png).

Planets retains its left tool rail and body selector; Terrains-specific color,
2D-preview and sub-mode commands are intentionally absent. Browser checks
covered recipe changes with visible cables, reload, Mix numeric edit and undo,
Ctrl+D duplication and undo, groups/collapse/undo/ungroup, Save as, .ppplanet
download, and Gas → Star → Planet with the graph retained. The downloaded
[test document](../output/playwright/nodes-roundtrip.ppplanet) contains both
four-node graphs and editor positions.

Remaining validation limits: the Chrome extension blocked file-chooser import
because file URL access is disabled (parser round trips pass); no authenticated
production cloud sync was performed (API contract tests pass); the full pointer
regression for every dock/resize combination remains manual. Discrete LOD
readbacks do not replace inspection across every camera angle. Desktop editing
is the V1 scope; mobile displays the planet and preserves the graph with an
explicit desktop-editing notice. CPU/GPU differences at extreme settings are
documented in the [core notes](../src/engine/graph/README.md).

Reproduce GPU checks at `/test/visual/graph-checks.html`, export checks at
`/test/visual/graph-export-checks.html`, and viewport/load checks at
`/test/visual/workspace-viewports.html`. The optional local
`node test/visual/reference-proxy.mjs` fixture forwards the Terrains dev server
on 6061 through loopback port 7074 for same-origin reference controls.
