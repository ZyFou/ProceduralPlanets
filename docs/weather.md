# Weather

Terrestrial planets carry **regional, timed weather** on top of their cloud
layer: thunderstorm clusters, hurricanes, rain fronts and clear skies that
form, travel, rain, flash and dissipate. Weather is local — every system is a
cap on the sphere — so one hemisphere can be stormy while the other is clear.

Weather needs the cloud layer (`cloudsEnabled`) and `weatherEnabled` (both on
by default). Gas giants and stars have their own storms (`gasStorms`).

## What you get

| Feature | What it looks like | Driven by |
|---|---|---|
| **Thunderstorms** | Packed cumulonimbus towers with flat dark bases, rain curtains, lightning | `type: 'storm'`, `stormCount` |
| **Hurricanes** | A clear eye, a towering eyewall, central dense overcast and two spiral rain bands, spinning (counter-clockwise in the north) | `type: 'hurricane'`, `hurricaneCount` |
| **Rain fronts** | A long, flat, grey stratiform deck with steady rain | `type: 'rain'`, `stormCount` |
| **Clear skies** | High pressure dissolving the clouds under it | `type: 'clear'` |
| **Rain** | Grey precipitation shafts under raining clouds (slanted by the wind, evaporating as virga when light), darker heavier storm clouds, wet (darker) ground; from a camera under the clouds, falling streaks and reduced visibility | `rainAmount`, each system's `rain` |
| **Lightning** | Flashes lighting the cloud volume from inside, cloud-to-ground bolts, the ground lit around strikes; a `lightning` event per strike | `lightningAmount`, each system's `lightning` |

Dense convective clouds of the background climate also rain on their own
(`rainAmount`); lightning only comes from storm systems.

## Three sources of systems

All systems share 8 GPU slots, filled in this order:

1. **Runtime** — `planet.weather.add()`: scripted, timed events (not saved).
2. **Pinned** — the `weatherSystems` parameter: saved with the planet and the
   studio project.
3. **Procedural** — `stormCount` / `hurricaneCount`: systems that form at a
   random place, travel (tropical storms drift west, mid-latitude ones east,
   hurricanes west and poleward), and dissipate after about `stormLifetime`
   seconds, after which a new one forms elsewhere. Deterministic: the same
   seed and weather time give the same weather.

## Parameters

| Key | Default | Meaning |
|---|---|---|
| `weatherEnabled` | `true` | Systems, rain and lightning on / off |
| `weatherSpeed` | `1` | Rate of the weather clock (lifecycles, tracks, spin, lightning) |
| `stormCount` | `2` | Procedural thunderstorm clusters and rain fronts alive at once |
| `hurricaneCount` | `1` | Procedural hurricanes alive at once |
| `stormSize` | `1` | Size multiplier of the procedural systems |
| `stormLifetime` | `120` | Mean lifetime of a procedural system (weather seconds) |
| `rainAmount` | `0.5` | Precipitation strength |
| `rainColor` | `[0.6, 0.64, 0.7]` | Rain curtain tint (whiter for snow, darker for ash) |
| `lightningAmount` | `0.5` | Strike frequency |
| `lightningBrightness` | `1` | Flash brightness |
| `lightningColor` | `[0.78, 0.84, 1]` | Flash colour |
| `weatherSystems` | `[]` | Pinned systems (below) |

The cloud layer itself gained three shape / light controls:
`cloudTowering` (low flat decks to tall towering cumulonimbus),
`cloudShear` (upper winds lean the towers downwind) and
`cloudSilverLining` (forward-scattering glow toward the sun). See
[parameters.md](parameters.md). A thicker layer (`cloudThickness`) builds
taller towers out of more billows rather than magnifying the same clouds: the
billow size grows only with the square root of the thickness, while the
towers stay about as wide as the layer is tall.

## A system definition

```js
{
  type: 'hurricane',        // 'storm' | 'hurricane' | 'rain' | 'clear'
  lat: 18, lon: -45,        // degrees (y = north pole; or direction: Vector3)
  radius: 10,               // degrees of arc
  intensity: 1,             // 0..1
  coverage: 1,              // how much cloud it builds (clear: removes)
  rain: 1,                  // 0..1 precipitation
  lightning: 0.5,           // 0..2 activity (x lightningAmount)
  tower: 0.85,              // 0..1 depth of the convection
  eye: 0.075,               // hurricanes: eye radius, fraction of radius
  spin: 0.12,               // hurricanes: rad / s (default: by hemisphere)
  heading: 290, speed: 0.03,// track: degrees (0 north, 90 east), degrees / s
  start: 0, duration: 0,    // lifecycle in weather seconds (0 = permanent)
  fadeIn: 0, fadeOut: 0,    // seconds
  period: 0,                // repeat every N seconds (0 = once)
}
```

Only `type` is required; everything else has a per-type default. A system
grows while it fades in and shrinks while it fades out.

## Scripting

```js
const planet = new Planet({ preset: 'ocean' });

// a storm that builds over 6 s, rages for a minute, dissipates over 10 s
const id = planet.weather.add({
  type: 'storm', lat: 12, lon: 40, radius: 5,
  duration: 76, fadeIn: 6, fadeOut: 10,
});

// let it intensify and drift north-east over 20 seconds
planet.weather.update(id, { radius: 8, lat: 20, lon: 48 }, { duration: 20 });

// a hurricane appearing 30 s from now, spinning up, moving west
planet.weather.add({ type: 'hurricane', lat: 15, lon: -30, delay: 30, heading: 280, speed: 0.04 });

// clear the sky over a spot, then let it close again
const hole = planet.weather.add({ type: 'clear', lat: 0, lon: 0, radius: 15 });
setTimeout(() => planet.weather.remove(hole, { fadeOut: 8 }), 20000);

// global changes glide too
planet.transition({ cloudCoverage: 0.75, rainAmount: 0.9 }, { duration: 30 });

// thunder
planet.addEventListener('lightning', (e) => {
  const delay = camera.position.distanceTo(e.position) / speedOfSound;
  setTimeout(() => playThunder(e.intensity), delay * 1000);
});

// gameplay: is it raining here?
const { rain, hurricane } = planet.weather.sample(localDirection);
```

| `planet.weather` | |
|---|---|
| `time` | The weather clock (seconds). Set it to jump or replay (`time = 0`) |
| `add(def)` | Add a runtime system; returns its id. Defaults: start now, fade in 4 s, fade out 6 s, permanent |
| `update(id, patch, { duration })` | Change a system; numeric fields glide over `duration` |
| `remove(id, { fadeOut })` / `clear({ fadeOut })` | Fade out and drop |
| `get(id)` | A copy of a runtime definition |
| `list()` | Every system alive now: `{ id, source, type, lat, lon, strength, radius, definition }` |
| `sample(direction)` | `{ rain, storm, hurricane, clear, lightning }` from the systems at a planet-local direction |
| `strike({ direction?, system?, intensity?, ground? })` | Fire a lightning strike now |
| `enabled` | Whether weather renders on this planet now |

`planet.transition(patch, { duration })` glides any numeric or colour
parameter; keys that rebuild or re-bake (`octaves`, `seed`, `cloudScale`...)
and counts switch at once. A later `set()` of the same key cancels its
transition.

## Pinned systems (saved)

```js
planet.set('weatherSystems', [
  { type: 'hurricane', lat: 16, lon: -50 },                                 // permanent
  { type: 'storm', lat: 5, lon: 20, start: 10, duration: 60, period: 180,   // every 3 minutes
    fadeIn: 10, fadeOut: 15 },
]);
```

Pinned systems follow the weather timeline from 0, so timed and repeating
ones replay identically every time the planet loads.

## Performance

Systems are evaluated analytically in the cloud shaders: no extra textures,
no re-bakes when they move, spin or fade. With no system alive the cost is a
loop that exits at once. Inside a system the cloud pass makes one extra
noise lookup per sample. Rain shafts are only marched where the clouds above
(or the air around a low camera) actually rain, lightning is a handful of
uniforms, and impostor captures leave lightning out. To trim weather away
entirely, set `weatherEnabled: false` (or `stormCount` / `hurricaneCount` to
0 and `rainAmount` to 0 for a calm sky).

## Studio

The **Weather** tab holds the parameters above, the live weather clock (with
*Restart* to replay timed systems), **Live events** (spawn a timed storm,
hurricane, rain front or clear sky under the centre of the view, fire a
strike, fade everything out) and **Pinned systems** (saved with the project,
each with position, size, intensity, rain, lightning, spin, track and
timing).
