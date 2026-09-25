# Studio interop

The studio (this repository's app, `npm run dev`) is a visual editor for the
same `Planet` parameters. There are three ways to take a planet from the
studio into your code.

## 1. "Use in code" (Export panel)

The Export panel's **Use in code** section shows, and copies, the current
body as a constructor call. It lists only the parameters that differ from the
defaults:

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
its `params`, loads the same way:

```js
const planet = Planet.fromJSON({ params: project.params });
```

Parameter sets saved by older studio versions are migrated automatically. The
shape is kept, and the look keys are upgraded to the current render model.

## Round trip

`planet.serialize()` returns the same `{ app, version, mode, params }` shape
as the studio export. You can store it, send it, and restore it with
`Planet.fromJSON()`.
