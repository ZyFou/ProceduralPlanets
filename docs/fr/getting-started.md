# Premiers pas

## Prérequis

- **three.js ≥ 0.160** en dépendance pair. Le package utilise votre copie de three : il n’y a jamais de seconde instance.
- **WebGL2.** Tous les navigateurs actuels le prennent en charge. `PlanetRenderer` lève une erreur sur un contexte WebGL1.
- **Un environnement de modules ES**, avec un bundler (Vite, webpack, esbuild…) ou une import map.
- **TypeScript (facultatif) :** les déclarations sont fournies avec le package. Ajoutez `@types/three` pour les types de three.

```sh
npm install procedural-planets three
```

Sans bundler, utilisez une import map :

```html
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js",
  "three/examples/jsm/": "https://cdn.jsdelivr.net/npm/three@0.160.1/examples/jsm/",
  "fflate": "https://cdn.jsdelivr.net/npm/fflate@0.8.3/esm/browser.js",
  "procedural-planets": "https://cdn.jsdelivr.net/npm/procedural-planets/dist/lib/procedural-planets.js",
  "procedural-planets/export": "https://cdn.jsdelivr.net/npm/procedural-planets/dist/lib/export.js"
} }
</script>
```

## Trois façons de l’utiliser

| | Ce que vous obtenez | Coût | À utiliser pour |
|---|---|---|---|
| **`Planet` + `PlanetRenderer`** | Le rendu complet en direct (terrain LOD, océan, nuages volumétriques, diffusion atmosphérique, écoulement des géantes gazeuses, couronne stellaire), composé dans *votre* image avec une occultation correcte | Quelques passes GPU par planète visible | Planètes principales, tout ce dont la caméra s’approche |
| **`PlanetViewer`** | Un canvas prêt à l’emploi avec une caméra, des contrôles d’orbite, un champ d’étoiles et une planète | Identique | Une planète sur une page web, des aperçus, des configurateurs |
| **`bakePlanet()`** | De simples `THREE.Mesh` avec textures pré-calculées et `MeshStandardMaterial`, éclairés par vos lumières | Pré-calculé une fois, puis un appel de dessin normal | Planètes lointaines, nombreuses planètes, mobile, export glTF |

Les deux premières partagent le même objet `Planet` et les mêmes paramètres. La
version pré-calculée les utilise aussi : pré-calculez n’importe quelle `Planet`,
ou passez les mêmes options.

## Votre première planète dans une scène existante

```js
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Planet, PlanetRenderer } from 'procedural-planets';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 1e6);
camera.position.set(0, 1200, 6000);
const controls = new OrbitControls(camera, renderer.domElement);

// 1. créer une planète. Toute option autre que type / preset / lightSource /
//    params / starShader est un paramètre (voir parameters.md).
const planet = new Planet({ preset: 'terran', seed: 1234, radius: 2000 });
scene.add(planet);

// 2. un PlanetRenderer par WebGLRenderer
const planets = new PlanetRenderer(renderer);

// facultatif : compiler les (gros) shaders à l'avance plutôt qu'à la première image
await planets.compile(planet, camera);

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);   // 3. votre scène...
  planets.render(scene, camera);    // 4. ...puis les planètes par-dessus
});
```

C’est toute l’intégration : `planets.render()` trouve chaque `Planet` visible de
la scène, écarte celles hors de l’écran et compose les autres par-dessus ce que
`renderer.render()` a dessiné. Le test de profondeur se fait contre votre
tampon de profondeur, et la surface des planètes y est écrite.

## Créer des planètes

```js
new Planet();                                    // valeurs par défaut terran
new Planet({ preset: 'mars' });                  // le type d'astre vient du préréglage
new Planet({ type: 'gas', preset: 'ringed' });   // type explicite (doit correspondre au préréglage)
new Planet({ type: 'star', starTemperature: 3500, radius: 4000 });
new Planet({ preset: 'desert', seed: 7, seaLevel: 0.25, colSand: '#e8c896' });
new Planet({ params: savedParams });             // un objet de paramètres complet
```

- **Types** : `'terrestrial'` (par défaut), `'gas'`, `'star'`.
- **Préréglages** : voir [presets.md](../presets.md), ou appelez `listPresets()` à l’exécution.
- **Graine** : n’importe quel entier. La même graine et les mêmes paramètres donnent toujours la même planète.
- **Couleurs** : en sRGB, sous forme `[r, g, b]` entre 0 et 1, `'#rrggbb'`, `0xrrggbb` ou `THREE.Color`.
- **Les clés inconnues et les valeurs du mauvais type** sont ignorées avec un avertissement dans la console, jamais utilisées en silence.

## Modifier une planète

```js
planet.set({ cloudCoverage: 0.7, atmoStrength: 1.3 });   // en direct, à l'image suivante
planet.set('radius', 3500);
planet.get('seaLevel');
planet.applyPreset('ice');          // change d'apparence (et de type, pour un préréglage gazeux / stellaire)
planet.randomizeSeed();
```

Presque tous les paramètres sont des uniforms : en changer un ne coûte rien. Les
trois clés *structurelles* (`octaves`, `chunkRes`, `maxDepth`) reconstruisent
plutôt le monde LOD du terrain.

## Éclairage

Une planète est éclairée par un seul soleil. Réglez sa direction avec `lightSource` :

```js
earth.lightSource = sun;                           // une étoile Planet, une lumière THREE, tout Object3D
earth.lightSource = new THREE.Vector3(1, 0.2, 0);  // une direction en espace monde vers le soleil
earth.lightSource = null;                          // utilise les paramètres sunAzimuth / sunElevation (repère local de la planète)
```

Pour une `DirectionalLight` ou une `SpotLight`, la direction va de la cible vers
la position, comme dans three. Pour tout autre objet, elle va de la planète vers
l’objet.

## Temps

Par défaut, `PlanetRenderer` avance l’horloge de chaque planète du temps réel
écoulé entre deux images. Cette horloge anime les vagues, la dérive des nuages,
l’écoulement des géantes gazeuses et la surface des étoiles. Pour une
chronologie déterministe :

```js
const planets = new PlanetRenderer(renderer, { autoUpdate: false });
planets.render(scene, camera, { delta: 1 / 60 });   // pas explicite
planet.time = 12.5;                                  // ou réglez directement les horloges
```

## Étapes suivantes

- [Guide d’intégration](embedding.md) : ordre de rendu, transparence, post-traitement, échelle, nombreuses planètes, performances.
- [Référence de l’API](api.md)
- [Exemples](../../examples/) : lancez `npm run dev` dans le dépôt et ouvrez `/examples/`.
