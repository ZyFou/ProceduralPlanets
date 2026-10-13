# Référence de l’API

```js
import {
  Planet, PlanetRenderer, PlanetViewer, bakePlanet, PlanetPass,
  listPresets, findPreset, validateParams, PARAM_DOCS,
  DEFAULT_PARAMS, PLANET_PRESETS, GAS_PRESETS, STAR_PRESETS, DEFAULT_STAR_BODY, VERSION,
} from 'procedural-planets';
import { createPlanetArchive, downloadPlanetArchive, exportPlanetGLB, toGLB } from 'procedural-planets/export';
```

Les déclarations TypeScript sont fournies avec le package (`types/index.d.ts`,
`types/export.d.ts`). Chaque paramètre est typé dans l’interface
`PlanetParams`.

---

## `Planet` — hérite de `THREE.Object3D`

Un astre procédural : une planète tellurique, une géante gazeuse ou une étoile.
Ajoutez-le à votre scène, transformez-le ou imbriquez-le comme n’importe quel
objet. Il est dessiné par un `PlanetRenderer`, pas par `renderer.render()`.

### `new Planet(options?)`

| Option | Type | Description |
|---|---|---|
| `type` | `'terrestrial' \| 'gas' \| 'star'` | Type d’astre. Par défaut : celui du préréglage, sinon `'terrestrial'` |
| `preset` | nom de préréglage | Une apparence nommée ([presets.md](../presets.md)). Lève une erreur si elle est inconnue ou ne correspond pas à `type` |
| `params` | objet | Un objet de paramètres complet (par exemple issu du studio). Les clés à plat le remplacent |
| `lightSource` | `Object3D \| Vector3 \| null` | Voir [`lightSource`](#lightsource) |
| `starShader` | chaîne | Corps GLSL personnalisé de `starSurface()` (étoiles) |
| `name` | chaîne | `Object3D.name` |
| *tout paramètre* | | `seed`, `radius`, `seaLevel`, … ([parameters.md](../parameters.md)) |

Les paramètres sont résolus dans cet ordre : valeurs par défaut ← préréglage ←
`params` ← options à plat. Les clés inconnues et les valeurs du mauvais type
sont ignorées avec un avertissement.

### Propriétés

| Propriété | Description |
|---|---|
| `planetType` | `'terrestrial' \| 'gas' \| 'star'` (lecture seule ; `Object3D.type` vaut `'Planet'`) |
| `params` | Les paramètres courants, entièrement résolus. À traiter en lecture seule : utilisez `set()` |
| `lightSource` | La provenance de la lumière du soleil (ci-dessous) |
| `time` | Horloge des shaders en secondes (vagues, écoulement gazeux, surface stellaire) |
| `cloudTime` | Horloge intégrée des nuages |
| `weather` | Météo régionale et chronométrée : systèmes `add` / `update` / `remove`, `sample`, `strike`, l’horloge météo ([weather.md](weather.md)) |
| `transitioning` | Clés de paramètres dont une `transition()` est en cours |
| `boundingRadius` | Rayon, en espace local, englobant tout ce qui est dessiné (atmosphère, anneaux, couronne). Sert à l’élimination hors champ |
| `surfaceRadius` | Rayon, en espace local, de la surface solide ou liquide. Sert à la sélection |
| `starShaderBody` | Le GLSL de `starSurface()` utilisé |
| `isPlanet` | `true` |

#### `lightSource`

- **`Object3D`** : une étoile `Planet`, une `PointLight`, n’importe quel objet. La lumière vient de sa position monde.
- **`DirectionalLight` / `SpotLight`** : la direction de la cible de la lumière vers la lumière, comme three la définit.
- **`Vector3`** : une direction en espace monde pointant *vers* le soleil.
- **`null`** : utilise les paramètres `sunAzimuth` / `sunElevation`, dans le repère local de la planète.

### Méthodes

| Méthode | Description |
|---|---|
| `set(patch)` / `set(key, value)` | Modifie des paramètres en direct (validés ; les couleurs acceptent `[r,g,b]`, `'#rrggbb'`, `0xrrggbb`, `THREE.Color`). Renvoie `this` |
| `get(key)` | La valeur d’un paramètre (les couleurs sous forme d’un nouveau tableau `[r,g,b]`) |
| `applyPreset(name, { setType = true })` | Applique un préréglage. Un préréglage tellurique réinitialise d’abord toutes les clés telluriques (la graine est conservée). Un préréglage gazeux ou stellaire réinitialise son propre domaine. Change le type d’astre sauf avec `setType: false` |
| `randomizeSeed()` | Nouvelle graine aléatoire ; la renvoie |
| `setStarShader(glsl, renderer?)` | Remplace la fonction de surface de l’étoile. Avec un renderer, ou après le premier rendu, sa compilation est d’abord vérifiée. Renvoie `{ ok, error? }` |
| `getSurfaceRadius(localDir)` | Rayon du terrain le long d’une direction locale (copie CPU du champ de hauteur de base) |
| `getSurfacePoint(localDir, target?)` | Point **en espace monde** sur le terrain ou la mer le long d’une direction locale |
| `raycast(raycaster, intersects)` | Prise en charge de `THREE.Raycaster` (une sphère à `surfaceRadius`) |
| `update(delta)` | Avance les horloges. `PlanetRenderer` l’appelle sauf si `autoUpdate` est désactivé |
| `transition(patch, { duration })` | Fait glisser les paramètres numériques / couleurs vers de nouvelles valeurs en `duration` secondes de temps planétaire. Les clés qui reconstruisent / recalculent et les nombres changent immédiatement. Renvoie `this` |
| `addEventListener('lightning', fn)` | Chaque éclair : `{ position (monde), direction (locale), intensity, ground, system }` |
| `serialize()` | `{ app, version, mode, params }`, la même forme que le `planet_preset.json` du studio |
| `clone()` / `copy(source)` | Clone d’Object3D, y compris les paramètres, la source de lumière et le shader d’étoile |
| `dispose()` | Libère les ressources GPU de la planète |
| `setParam(key, value)` | Modificateur bas niveau d’une seule clé, **sans validation** (utilisé par l’interface du studio) |

### `Planet.fromJSON(json, options?)`

Construit une planète à partir de l’un de ces éléments :
- un export du studio (`planet_preset.json` / `star_preset.json`, shader d’étoile personnalisé compris)
- un projet enregistré du studio (`{ params }`)
- un simple objet de paramètres
- une chaîne JSON de l’un des éléments ci-dessus

Les jeux de paramètres enregistrés par d’anciennes versions du studio sont
migrés. `options` sont des options de constructeur supplémentaires, qui
remplacent les paramètres chargés.

---

## `PlanetRenderer`

Dessine des `Planet` avec votre `THREE.WebGLRenderer` (WebGL2). Créez-en **un
par renderer** ; il possède les tampons GPU partagés par les planètes.

### `new PlanetRenderer(renderer, options?)`

| Option | Défaut | Description |
|---|---|---|
| `background` | `'transparent'` | `'transparent'` : composition sur votre image. `'stars'` : la planète la plus lointaine occupe l’image (opaque, avec un champ d’étoiles) |
| `output` | `'auto'` | `'auto'` : affichage pour le canvas et les cibles sRGB, linéaire pour les cibles linéaires. `'display'` : tone mapping ACES (sRGB). `'linear'` : HDR linéaire prémultiplié (pour les pipelines HDR / composer) |
| `depthTest` | `true` | Les planètes sont masquées par votre géométrie |
| `depthWrite` | `true` | La surface des planètes est écrite dans votre tampon de profondeur |
| `scissor` | `true` | Ne calcule que le rectangle de chaque planète à l’écran |
| `autoUpdate` | `true` | Avance les horloges des planètes avec une horloge interne quand `render()` ne reçoit pas de `delta` |
| `maxDelta` | `0.05` | Limite du pas de l’horloge interne (secondes) |
| `impostors` | `true` | Dessine les planètes lointaines comme des imposteurs (voir l’[intégration](embedding.md#distant-planets-impostors)) |
| `impostorPixels` | `90` | Rayon à l’écran (px) sous lequel une planète devient un imposteur |
| `impostorUpdates` | `2` | Nombre maximal d’images d’imposteurs recalculées par frame |
| `impostorAngle` | `0.6` | Changement de direction de vue ou du soleil (degrés) qui rend un imposteur obsolète |
| `impostorRefresh` | `0.5` | Secondes d’horloge planétaire entre deux rafraîchissements d’imposteur (nuages, vagues) |
| `impostorAtlasSize` | `2048` | Plus grand côté de l’atlas d’imposteurs (px) ; il commence à 512 (2 Mo) et double quand il est plein |

### Méthodes

| Méthode | Description |
|---|---|
| `render(planets, camera, { target?, delta? })` | Dessine chaque planète visible de `planets` : une arborescence d’objets (par ex. votre scène), une `Planet` ou un tableau. `camera` doit être une `PerspectiveCamera`. `target` vaut par défaut la cible de rendu courante du renderer et nécessite un tampon de profondeur pour l’occultation. Appelez-la après votre scène opaque |
| `prepare(planets, camera?, options?)` | `Promise` : prépare les planètes sans bloquer la page. Les shaders se compilent en parallèle (`KHR_parallel_shader_compile`), les pré-calculs GPU ponctuels s’exécutent par tranches à chaque image, et la promesse se résout quand le prochain `render()` les dessine en qualité maximale : le bon moment pour masquer un écran de chargement. Options : `modes` (compile aussi les autres types d’astres, `false` par défaut), `bake` (`true` par défaut), `target`, `onProgress({ stage, progress, stageEnd, done, total })` |
| `compile(planets, camera?)` | `Promise` : `prepare()` sans les pré-calculs |
| `setOptions(options)` | Modifie les options à l’exécution |
| `release(planet)` | Libère immédiatement l’imposteur en cache d’un astre retiré ; l’appelant reste propriétaire de la Planet |
| `dispose()` | Libère les tampons partagés (les planètes sont libérées séparément) |
| `info` | `{ planets, culled, pending, impostors, captures }` pour le dernier `render()` |
| `pending` | Planètes ignorées par le dernier `render()` parce que leurs shaders sont encore en compilation |

`render()` ne compile jamais un shader sur le moment. Une planète dont les
programmes se compilent encore en arrière-plan est ignorée (`info.pending`)
plutôt que de figer la page ; appelez d’abord `prepare()` pour l’afficher dès
sa première image.

Le moteur de rendu restaure l’état du renderer hôte qu’il modifie : cible de
rendu, couleur et alpha d’effacement, `autoClear`, scissor.

### Nettoyage en streaming

Pour retirer un astre en direct, appelez `planetRenderer.release(planet)` pour
rendre immédiatement son emplacement d’imposteur, puis retirez et libérez la
`Planet` dont l’appelant est propriétaire. `planetRenderer.dispose()` libère le
pipeline partagé et l’atlas quand toute la vue se ferme.

---

## `PlanetViewer`

Une vue autonome d’une seule planète : son propre `WebGLRenderer`, sa caméra,
ses `OrbitControls`, sa boucle de rendu et son arrière-plan étoilé.

### `new PlanetViewer(options)`

| Option | Défaut | Description |
|---|---|---|
| `canvas` | — | Canvas dans lequel rendre… |
| `container` | — | …ou élément dans lequel créer un canvas pleine taille (l’un des deux est requis) |
| `planet` | terran | Une `Planet` (que le viewer ne libérera pas) ou des options de `Planet` |
| `controls` | `true` | `OrbitControls` |
| `autoStart` | `true` | Démarre la boucle de rendu |
| `pixelRatio` | `2` | Ratio de pixels maximal de l’appareil |
| `onStats` | — | `({ fps, triangles, drawCalls, chunks, pending }) => void`, environ 2 Hz |

### Membres

| Membre | Description |
|---|---|
| `planet`, `renderer`, `camera`, `controls`, `planetRenderer`, `canvas` | Les composants |
| `setPlanet(planetOrOptions)` | Remplace la planète ; renvoie la nouvelle |
| `frame()` | Remet la caméra dans la vue de trois quarts par défaut |
| `start()` / `stop()` / `running` | Boucle de rendu |
| `renderOnce()` | Une image, sans avancer le temps |
| `prepare({ onProgress?, modes? })` | `Promise` : compile les shaders, exécute les pré-calculs et dessine la première image. Se résout une fois cette image en qualité finale affichée dans le canvas |
| `screenshot(w = 1920, h = 1080)` | URL de données PNG en résolution native, quels que soient les réglages de performance de la vue |
| `captureThumbnail(w = 480, h, type = 'image/webp', quality)` | `Promise<string>` : une petite copie de la prochaine image qui dessine la planète (sans rendu supplémentaire) |
| `dispose()` | Libère tout (et retire le canvas qu’il a créé) |

Les réglages **Perf → Rendu** du studio s’appliquent aux trois types d’astres.
Avec `viewer.planet.set({ renderResolution: 0.5, upscaler: 'spatial' })`, le
rendu se fait à la moitié de la largeur et de la hauteur du tampon de dessin
(un quart des pixels), puis l’image est reconstruite à la pleine résolution du
canvas. `renderResolution` accepte 0,25–1 et vaut 1 par défaut ; à 1, la passe
de reconstruction est ignorée. `upscaler` vaut `'bilinear'` par défaut
(interpolation linéaire matérielle). `'spatial'` utilise une reconstruction
bicubique Catmull-Rom, bornée à la plage de couleurs locale pour éviter les
halos, sans historique d’images. Ces réglages sont enregistrés avec la planète
mais n’affectent que `PlanetViewer`, studio compris, et non les scènes hôtes
dessinées avec `PlanetRenderer`. Les changements de préréglage les conservent.

---

## `bakePlanet(renderer, options?)` → `Promise<Group>`

Pré-calcule une planète en simples meshes avec `MeshStandardMaterial`, éclairés
par les lumières de votre scène. Voir [baking.md](baking.md).

| Option | Défaut | Description |
|---|---|---|
| `planet` | — | Une `Planet` à pré-calculer. Sinon, les autres options sont des options de `Planet` (`preset`, `seed`, …) |
| `meshResolution` | `128` | Quads par côté de face du cube (tellurique) / segments de sphère |
| `textureSize` | `1024` | Taille de texture par face du cube, ou largeur de la carte équirectangulaire |
| `water` | `true` | Coquille océanique translucide |
| `atmosphere` | `true` | Liseré atmosphérique de Fresnel, ou halo de couronne pour les étoiles |
| `rings` | `true` | Anneaux des géantes gazeuses |
| `bakeLighting` | `false` | Intègre un soleil fixe dans les textures |
| `starMaterial` | `'basic'` | Surface de l’étoile : `'basic'` (non éclairée) ou `'standard'` (émissive) |
| `onProgress` | — | `(message) => void` |

Le groupe renvoyé possède une méthode `dispose()`, et son `userData.params`
contient les paramètres pré-calculés.

---

## `PlanetPass` — passe EffectComposer

`new PlanetPass(scene, camera, options?)`. Les options sont celles de
`PlanetRenderer` (`output` vaut `'linear'` par défaut), ou `{ planetRenderer }`
pour en réutiliser un. Placez-la juste après la `RenderPass` et terminez la
chaîne par une `OutputPass`. Voir le [guide d’intégration](embedding.md#effectcomposer).

---

## Utilitaires et données

| Export | Description |
|---|---|
| `listPresets()` | `{ terrestrial: string[], gas: string[], star: string[] }` |
| `findPreset(name)` | `{ mode, preset: { label, patch } }` ou `null` |
| `validateParams(patch)` | `{ params, unknown, invalid }` : les valeurs normalisées, plus les clés rejetées |
| `normalizeParam(key, value)` | `{ ok, value }` pour une clé |
| `resolvePlanetParams(options)` | L’objet de paramètres complet qu’utiliserait `new Planet(options)` |
| `migrateParams(params, …)` | Met à niveau un ancien jeu de paramètres du studio |
| `PARAM_DOCS` | Métadonnées par paramètre : `{ domain, group, label, type, default, description, min?, max?, step?, structural? }`. Pratique pour construire des interfaces |
| `DEFAULT_PARAMS`, `GAS_DEFAULTS`, `STAR_DEFAULTS` | Valeurs par défaut |
| `PLANET_PRESETS`, `GAS_PRESETS`, `STAR_PRESETS` | Tables de préréglages `{ name: { label, patch } }` |
| `DEFAULT_STAR_BODY` | Le GLSL par défaut de `starSurface()` (point de départ pour `setStarShader`) |
| `PLANET_TYPES` | Nom de type → mode de rendu |
| `WEATHER_TYPES`, `MAX_WEATHER_SYSTEMS` | Types de systèmes météo et nombre d’emplacements GPU |
| `normalizeWeatherSystem(def)` | Une définition de système météo complétée et validée (ou `null`) |
| `latLonToDirection(lat, lon)`, `directionToLatLon(dir)` | Degrés ↔ direction locale de la planète (la convention de la météo) |
| `VERSION` | Version du package |

---

## `procedural-planets/export`

C’est un point d’entrée séparé, pour que le package principal n’embarque ni
`fflate` ni les exporteurs de three.

| Fonction | Description |
|---|---|
| `createPlanetArchive(renderer, planet, options?)` | Pré-calcule et empaquette une planète comme le bouton Export du studio. Renvoie `{ blob, filename, files }` |
| `downloadPlanetArchive(renderer, planet, options?)` | La même chose, puis déclenche un téléchargement dans le navigateur |
| `exportPlanetGLB(renderer, planet, options?)` | Pré-calcule en glTF binaire (`Uint8Array`). Options identiques à `bakePlanet` |
| `toGLB(object)` | glTF binaire de n’importe quel `Object3D` |
| `downloadBlob(blob, filename)` | Utilitaire de téléchargement dans le navigateur |

Options de l’archive :

| Option | Défaut | Description |
|---|---|---|
| `format` | `'glb'` | `'glb'`, ou `'obj'` (+ textures PNG) |
| `meshResolution` | `128` | |
| `textureSize` | `1024` | |
| `water` | `false` | Coquille océanique |
| `bakeLighting` | `false` | |
| `includeMesh` | `true` | |
| `bakeColor` | `true` | |
| `preset` | `true` | Inclut le JSON des paramètres |
| `onProgress` | — | |

## Calques de peinture à l’exécution

`Planet.serialize()` inclut une section `paint` explicite, indépendante de
`params`, `terrain` et des données de l’éditeur. `Planet.fromJSON()` et
`clone()` la restaurent. Un ancien JSON sans peinture reste non peint. Les
requêtes de surface telluriques et le déplacement GPU du terrain utilisent tous
les deux :

```js
finalRadius = radius + baseElevation(direction) + paintHeightOffset(direction);
```

`getBaseElevation(localDirection)` renvoie l’élévation procédurale / issue des
nœuds avant peinture, en unités locales. `getSurfaceRadius(localDirection)`
inclut la hauteur peinte. `getSurfacePoint()` respecte en plus le niveau de
l’océan. Le raycasting d’une planète tellurique peinte s’affine contre le
terrain déplacé ; les planètes non peintes conservent l’ancien raycasting
approximatif sur une sphère. Les requêtes de rayon des géantes gazeuses et des
étoiles ignorent la peinture tellurique conservée.

```js
const snapshot = planet.serialize();
const restored = Planet.fromJSON(snapshot);
restored.setPaint(snapshot.paint); // restaure uniquement les calques d'exécution
restored.setPaint(null);           // efface uniquement la peinture
```

`planet.paint` est un instantané `SerializedPlanetPaint` détaché. La version 1
utilise `mapping: 'cube-vertices'`, une `resolution` de 16 à 512 quads par face
(Studio : 256), `encoding: 'sparse-zlib-f32le'` et des `data` en base64. Seules
les tuiles 16×16 non vides sont stockées, avec six canaux Float32 par sommet :
variation de hauteur signée, côte/fond marin, sable, végétation, roche et neige.
La charge utile stocke les coordonnées des tuiles et des flottants little-endian
compressés sans perte avec zlib. Les consommateurs doivent conserver cette
section versionnée plutôt que de modifier les échantillons binaires à la main.

Les documents de peinture malformés ou non pris en charge lèvent une erreur
avant de modifier les calques en direct. Les textures de peinture sont allouées
à la demande, donc les planètes non peintes gardent le même profil mémoire
qu’avant. React et le contrôleur de peinture du Studio ne font pas partie de la
bibliothèque publique. Le runtime accepte la peinture enregistrée ; les API de
pinceau propres à l’éditeur restent internes.
