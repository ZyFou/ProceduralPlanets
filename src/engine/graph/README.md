# Spherical height graph core

This directory has no Studio, React or DOM dependency. `compileGraph` validates
and snapshots a version 1 graph, then emits a CPU evaluator, GLSL and uniforms.
All source directions are local normalized 3D vectors. Final heights are clamped
to `[0, 1]`; gradients are derivatives with respect to that normalized direction
in ambient 3D coordinates. Surface-normal consumers use the tangential component.

Current Terrain snapshots the ten classic terrain controls. Its seed comes from
the project; Noise 3D optionally adds an integer offset to that same seed. Direct
Current Terrain → Output exposes `identityParams` for the original optimized
material. Multiple Current Terrain sources have separate helper names and
uniforms. Mix blends height, gradient and the two material auxiliaries. Remap
preserves auxiliaries, scales the gradient and clears it in clamped regions.

The CPU value path for Current Terrain calls the existing `PlanetHeightSampler`.
Its auxiliary and derivative path uses scalar automatic differentiation of the
same noise, warp, shelf, ridge and crater equations in `noiseGLSL.js`. Noise 3D
uses the existing quintic lattice-gradient hash conventions and octave rotation.
CPU math uses doubles with float32 hash emulation, as the classic sampler does;
GPU arithmetic remains float32. Exact GPU equality is not promised, especially
with high frequency, lacunarity and octave combinations. The tests verify exact
classic CPU height identity and tangent finite-difference gradient errors below
`0.01` on regular directions. Browser tests are still required for actual GPU
linking, visual seams and CPU/GPU tolerances on supported hardware.

Admission budgets are 64 nodes, 128 connections, 128 active shader work units
and 250,000 generated GLSL characters. Noise 3D uses one work unit per octave.
Current Terrain conservatively counts its two octave stacks, six domain-warp
samples, one belt sample, and 54 Worley cell visits for the two crater layers.
These limits bound shader work and keep additional scalar uniform components
below 384; they are not benchmarked frame-time guarantees. Disconnected nodes
still count against document size, but do not add shader work or uniforms.

Unsupported versions, node types or parameter names, malformed connections,
nonfinite values and invalid bounds produce diagnostics without modifying the
imported graph. Unknown imported fields remain recoverable in the draft. Extra
top-level metadata is preserved and never changes a compilation signature.
`structureSignature` includes active topology and octave counts;
`signature` additionally includes registered values and the project seed.
