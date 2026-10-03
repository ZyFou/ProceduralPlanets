# Height graph browser checks

Start the repository Vite server and open `/test/visual/graph-checks.html`.
The page runs automatically and publishes readable JSON in `.tests` and
`window.__graphChecks`. It uses the actual source checkout served by Vite.

Reference seed: **1337**. Fields are evaluated at fourteen normalized local
directions covering six axis poles, cube edges, corners and a regular direction.
GPU values use a 14 × 2 RGBA FloatType render target: row one stores height and
gradient, row two stores cLow and mtn. `EXT_color_buffer_float` is required for
quantitative readback. The result records the browser, graphics adapter, WebGL
version, viewport, timestamp and parallel compilation extension availability.
Record the Git commit separately when retaining this output as evidence.

The page validates actual GPU link status for the three recipes, a graph with
two independently configured Current Terrain sources, and the complete terrain
materials. CPU/GPU discrepancies for each scalar and gradient are measured and
printed. The measurement test asserts linking, finite readback and every
displayed CPU/GPU review tolerance. Its `withinReviewTolerance` flag records
that result. Thresholds are not adjusted automatically based on measured data.
Classic GPU identity and duplicated cube-junction directions have hard `1e-5`
tolerances. A moving-camera visual check is still required for LOD transitions.

The ninth check renders ten near/far camera positions into a 128 × 128 target,
records visible pixels and LOD chunk/depth counts, and checks for WebGL errors
and new programs. This discrete sweep complements manual inspection; it does
not prove absence of every seam or temporal artifact. Scalar, seed, layout and
disconnected-branch changes report material creations, renderer compile calls,
GPU program counts and atomic application latency after warming. This timing
does not include browser input delivery or the next presented display frame.

Atomic update checks inject a genuinely invalid terrain fragment shader and
verify that its failed link leaves the previous graph, program, sampler and
surface radius intact, and disposes both rejected materials once. The race and
dispose checks compile real shaders and deliberately gate reported completion
to guarantee the inverse-finish schedule. They verify latest-revision wins,
candidate disposal, and independence between two Planet instances.

The deliberate invalid-shader case can emit a WebGL diagnostic in browser
developer tools. Its expected failure is recorded as a passing regression when
the runtime preserves the previously applied state.
