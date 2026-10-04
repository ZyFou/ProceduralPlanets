# Infinite exploration

The studio's **Explore** navigation item and **View → Explore infinite worlds**
open the same exploration mode. Returning restores the editor's project,
parameters, history and camera: the existing editor stays mounted, with its
render loop and controls suspended during exploration. Exploration does not
edit or save the open project and does not require the account API.

## Flying

Click the flight view to capture the mouse; Escape releases it and stops flight.
Choose **WASD / QWERTY** or **ZQSD / AZERTY** in Navigation. Mouse movement looks
around, Space rises, Ctrl descends, and Shift multiplies the selected speed by
20. The wheel doubles or halves the speed per conventional wheel notch. The
logarithmic slider and Precise / Orbit / System / Interstellar presets cover
1 metre/s to 0.25 light years/s. The instruments show actual speed separately
from selected speed, plus distances in metres, kilometres, AU or light years.

A proximity brake limits travel speed to half the clearance to the nearest
body per second, even during boost. A swept sphere test prevents travel through
an entire body in a single frame. Terrestrial clearance includes the maximum
terrain relief. This is free flight outside a conservative terrain envelope,
not a surface walking or landing simulation. An obstruction cancels targeted
approach; manual flight can steer around it.

Click a body in the nearby catalogue to target and face it, or press F while
flying to select a body near the reticle. **Approach target** accelerates travel
over astronomical distances and slows exponentially to an orbital viewing
position (2.6 radii for planets, 5 radii for stars). Stop, Escape, manual movement,
mouse look, loss of focus and hidden tabs cancel approach. It can be started
without mouse capture. Capturing the mouse begins manual flight and cancels
an ongoing approach.

Changing the universe seed regenerates the universe and resets the starting
position. Exploration always opens close to the first terrestrial world in
sector 0/0/0; systems elsewhere can be visited through the catalogue. A selected
body's screen marker identifies it when it is within view. Tiny distant bodies
are available in Navigation even when their physical angular size is below a
pixel; distances and radii are never enlarged for visibility.

## Architecture and resource limits

- `src/exploration/world.js` generates immutable descriptors from seed + signed
  integer sector. There is one jittered system per sector, with 4–7 planets,
  stellar classes from red/blue giants to dwarfs, rocky worlds and gas giants
  selected from the package's existing presets. Radii are in kilometres and
  orbits start outside the stellar envelope and increase by at least 1.55×.
  Sectors span 4 light years, with typical neighbouring stars several light
  years apart. This is plausible scale and deterministic variety, not a
  gravitational, stellar evolution or habitability simulation. Orbits are
  static so targets remain stable while exploring.
- Positions contain an integer sector, local kilometre offsets and compensated
  remainders. Fine movement is preserved when an offset itself is light years
  large, including across sector boundaries. Every frame subtracts the player
  position on the CPU; the camera stays at zero. Coordinates sent to the GPU
  are relative, while each package `Planet` renders in its own local frame.
- `SystemStream` searches 27 neighbouring sectors every 500 ms, retains the
  nearest **4 systems**, and reconciles at most **16 live bodies**. Planets are
  requested within 0.015 light years, or individually when targeted; stars
  remain available for lighting. Obsolete resources and queued loads are
  removed before new ones are created. At most **one body per 100 ms** is
  allocated; there are no background promises or unbounded descriptor caches.
- `Explorer` imports `Planet` and `PlanetRenderer` from `procedural-planets`,
  through the existing Vite package alias. Body shaders use radius 2000 with
  uniform object scaling to the physical radius. Atmosphere and clouds use
  physical thicknesses converted to the package's fractional parameters.
  Ocean clarity and wavelength also use a budget appropriate to kilometre relief.
  There is one exploration renderer and one package pipeline. No alternative
  planet geometry, shaders or rendering pipeline are introduced.
- Terrain uses the existing quadtree and geomorphing (`chunkRes: 32`,
  `maxDepth: 9`, `splitFactor: 12`, five noise octaves). The larger split range
  resolves curved shallow sea floors when relief is small relative to radius. Clouds use the existing volumetric pass
  at 24 steps and half resolution. Small visible planets use the existing
  impostor atlas (1024 maximum edge, one capture per frame). Subpixel bodies
  are skipped rather than running full star passes for invisible objects.
  Shader warming and pending counts come from the existing package renderer.
- The compatible package addition `PlanetRenderer.release(planet)` returns a
  removed body's atlas slot immediately. The caller still owns and disposes
  that Planet. Atlas sweeping also runs on frames with no visible bodies.
- Exit and seed reset remove listeners, resize observation, render callbacks,
  all live Planet resources, shared pipeline/atlas resources and the WebGL
  context. A seed change replaces the canvas to create a fresh context.

The universe has no designed edge. Integer sectors must still fit JavaScript's
safe integer range; exceeding it stops flight with a message. Interstellar
travel intentionally exceeds light speed. Rendering precision is independent
of accumulated world distance, but the existing terrain shader and finite LOD
remain the limit for fine surface detail. The catalogue shows only the four
nearest systems, not a persistent galaxy map. The starting seed 42 includes a
red giant and a cold terrestrial world; subsequent seeds produce other looks.

## Verification

```sh
npm ci
npm --prefix api ci
npm test
npm run test:api
npm run docs:check
npm run build
npm run dev:web
# In another terminal; needs installed Chromium/Chrome:
node scripts/check-exploration.mjs
# Container without a GPU:
CHROME_NO_SANDBOX=1 node scripts/check-exploration.mjs --software-gpu
```

`EXPLORATION_URL` selects the dev server (default `http://127.0.0.1:7071/`).
`EXPLORATION_ARTIFACTS` selects the screenshot/report directory (default
`artifacts/exploration`). The browser test exercises landing and editor entry,
package objects, speed controls, actual pointer lock/key events, approach,
sector crossing, streaming bounds, cleanup and editor restoration. Its remote
transfer advances flight deterministically to avoid long software GPU runs;
it does not claim to benchmark continuous interstellar rendering.

The Vitest suite covers deterministic regeneration and diversity, physical
radii/orbits, signed coordinates and fine movement, sector boundaries, speed
and key layouts, proximity braking, swept collision, approach cancellation,
progressive streaming, revisit determinism and immediate resource release.
API tests do not require a running database. Screenshot timing or cloud frame
rates are not GPU performance measurements; test on user hardware before
selecting more expensive terrain/cloud budgets.
