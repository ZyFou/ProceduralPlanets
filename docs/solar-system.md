# Solar System catalogue

Explore starts near Earth, in the Solar System at sector 0/0/0. Navigation →
**Return to Solar System** restores that starting viewpoint from anywhere.
The Sun, the eight planets, Pluto and 24 selected moons are always available in
its catalogue. Selection and approach use the same streaming and `PlanetRenderer`
as procedural systems. At most 16 body resources and four systems are resident.
A moon selected for approach and its parent get priority over other planets.

## Data and approximations

Distances and radii are kilometres throughout, with no compression of orbital
spacing or inflation of distant moons. An AU is 149,597,870.7 km. Mean spherical
radii come from [JPL planetary physical parameters](https://ssd.jpl.nasa.gov/planets/phys_par.html)
and [JPL satellite physical parameters](https://ssd.jpl.nasa.gov/sats/phys_par/sep.html).
The Sun uses NASA's [mean radius and effective temperature](https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html)
(695,700 km and 5772 K).

For Mercury–Neptune, `src/exploration/solarSystem.js` implements Kepler's equation
using the constant J2000 elements in Table 1 of [JPL approximate planet positions](https://ssd.jpl.nasa.gov/planets/approx_pos.html).
There is no advancing orbital clock or current-date ephemeris. Earth's location
uses the Earth–Moon barycentre approximation directly. Pluto uses mean a/e/i
from the [NASA Pluto fact sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/plutofact.html);
its mean longitude, perihelion and node use that fact sheet’s J2000 table.

Moons use circular orbits at the mean semimajor distances in [JPL satellite mean elements](https://ssd.jpl.nasa.gov/sats/elem/).
Their phases are deterministic illustrations, independent of the universe seed.
The orbital planes simplify the Moon's inclination, Uranian tilt and Triton's
retrograde inclination; the remaining moon planes are illustrative. Charon's
19,596 km separation uses NASA's Pluto fact sheet. These moon positions are
**not ephemerides**: JPL explicitly distinguishes mean orbital elements from
accurate ephemeris calculations.

## Included moons

| Parent | Moons |
| --- | --- |
| Earth | Moon |
| Mars | Phobos, Deimos |
| Jupiter | Io, Europa, Ganymede, Callisto, Amalthea |
| Saturn | Mimas, Enceladus, Tethys, Dione, Rhea, Titan, Hyperion, Iapetus |
| Uranus | Miranda, Ariel, Umbriel, Titania, Oberon |
| Neptune | Triton, Proteus |
| Pluto | Charon |

No other satellites are currently included. The source module contains each
radius and orbital distance for review. Small moons are spherical equivalents,
not reconstructions of their irregular shapes.

## Appearance and physics limits

All surfaces, gas bands, rings, clouds and star effects use the existing package
presets with deterministic seeds. Earth's continents are generated terrain;
there are no geographic maps or measured moon topography. Saturn's rings and
planetary atmospheres are visual approximations. Lighting uses the direction to
the system's star, including when the star has not been loaded; radiometric
falloff, eclipses, tidal locking, axial orientation and n-body gravity are not
simulated. The camera is a free exploration tool with swept collision protection,
not a relativistic spacecraft model. Approach stops at an orbital viewpoint;
walking and landing are not implemented.

Sources consulted 2026-10-04. The values are an explicit offline catalogue,
not live astronomical data.
