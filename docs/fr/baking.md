# Pré-calcul et export

## `bakePlanet()` : des planètes statiques avec des matériaux standard

```js
import { bakePlanet } from 'procedural-planets';

const mars = await bakePlanet(renderer, { preset: 'mars', seed: 3, radius: 1200, textureSize: 1024 });
mars.position.set(20000, 0, -5000);
scene.add(mars);
// ...
mars.dispose();   // géométries, matériaux, textures
```

Une planète pré-calculée est un `THREE.Group` de meshes ordinaires :

| Astre | Meshes |
|---|---|
| Tellurique | Six faces de cube-sphère déplacées (`Planet_pos_x`, …), chacune avec sa propre texture de couleur ; en option une coquille océanique translucide (`Planet_Ocean`) et un liseré atmosphérique de Fresnel (`Planet_Atmosphere`) |
| Géante gazeuse | Une sphère UV avec une texture de bandes équirectangulaire, des anneaux (`GasPlanet_Rings`, texture radiale avec alpha), un liseré atmosphérique ; inclinée selon `gasTilt` comme la version en direct |
| Étoile | Une sphère UV avec une texture de surface équirectangulaire (`MeshBasicMaterial` non éclairé par défaut) et un halo de couronne additif |

Les textures de couleur sont rendues par **le même GLSL que la planète en
direct** : biomes, neige, bandes, taches et shaders d’étoile personnalisés sont
tous conservés. Le relief provient de la copie CPU du champ de hauteur. Les
meshes utilisent `MeshStandardMaterial` : les lumières, ombres, brouillard et
tone mapping de votre scène s’appliquent comme pour tout autre objet.

Ce qui n’est pas conservé : les nuages volumétriques, l’océan animé, la
diffusion atmosphérique, l’écoulement des géantes gazeuses et l’animation des
étoiles. Une planète pré-calculée est un instantané.

Pré-calculez une planète en direct existante pour obtenir exactement son
apparence :

```js
const live = new Planet({ preset: 'alien', seed: 9, cloudCoverage: 0.3 });
const baked = await bakePlanet(renderer, { planet: live, textureSize: 512 });
```

Le pré-calcul prend de quelques millisecondes à quelques secondes, selon
`textureSize` et `meshResolution`. Il bloque le GPU pendant son exécution :
faites-le pendant le chargement.

Usages typiques :
- planètes lointaines, comme niveau éloigné d’un `THREE.LOD` (voir [embedding.md](embedding.md#many-planets))
- des dizaines d’astres en arrière-plan
- cibles mobiles
- tout ce que vous voulez exporter

## Export vers des fichiers : `procedural-planets/export`

```js
import { createPlanetArchive, downloadPlanetArchive, exportPlanetGLB } from 'procedural-planets/export';

// le bouton Export du studio : ZIP avec planet.glb (ou .obj + PNG) et planet_preset.json
await downloadPlanetArchive(renderer, planet, { format: 'glb', textureSize: 2048, water: true });

// ou garder les octets
const { blob, filename, files } = await createPlanetArchive(renderer, planet);
const glb = await exportPlanetGLB(renderer, planet, { meshResolution: 256 });   // Uint8Array
```

Le `planet_preset.json` de l’archive contient tous les paramètres et se
recharge avec `Planet.fromJSON()` (voir [studio-interop.md](studio-interop.md)).

## Terrain peint

Tous les chemins de pré-calcul et d’export telluriques évaluent **la base
procédurale / issue des nœuds + le décalage de hauteur peint**. `bakePlanet()`,
`exportPlanetGLB()` et `createPlanetArchive()` conservent la peinture quand ils
figent un instantané d’exécution. Les sommets du GLB contiennent la géométrie
finale déplacée ; leurs textures de couleur pré-calculées utilisent les mêmes
poids de matériaux, la même palette et les mêmes dégradés de peinture que le
shader tellurique en direct. Le `planet_preset.json` du ZIP contient aussi le
champ `paint` versionné.

Les interactions, le curseur et l’interface du mode Peinture ne sont pas
exportés. La résolution du mesh exporté détermine toujours la quantité de
détails sculptés fins représentés : augmentez `meshResolution` pour les reliefs
étroits. L’océan et l’atmosphère conservent leurs options d’export existantes.
La peinture ne modifie jamais leur configuration.
