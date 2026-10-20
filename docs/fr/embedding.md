# Guide d’intégration

Comment les planètes en direct s’insèrent dans un rendu three.js existant, et
les réglages qui comptent une fois que c’est fait.

## Fonctionnement

Une `Planet` est un `Object3D` sans géométrie propre : `renderer.render()` ne
dessine rien pour elle. Quand vous appelez `planetRenderer.render(scene, camera)`,
le moteur de rendu procède ainsi :

1. Il rassemble les `Planet` visibles sous `scene` (une arborescence, une seule planète ou un tableau).
2. Il élimine celles qui sortent du champ de vision d’après leur sphère englobante, qui couvre l’atmosphère, les anneaux ou la couronne.
3. Il trie les autres de la plus lointaine à la plus proche.
4. Pour chaque planète :
   1. Il construit une **caméra relais dans le repère local de la planète** (`planet.matrixWorld⁻¹ · camera.matrixWorld`). Ses plans proche et lointain sont réajustés autour de la planète, ce qui lui donne sa précision de profondeur indépendamment des réglages de votre caméra.
   2. Il exécute les passes propres à la planète : surface HDR et profondeur, puis le raymarching des nuages volumétriques, puis la composition de l’océan, de l’atmosphère et du tone mapping. Les passes sont **limitées (scissor)** au rectangle de la planète à l’écran.
   3. Il fusionne le résultat sur votre cible en alpha prémultiplié, avec un **test de profondeur** contre votre tampon de profondeur.
   4. Il écrit la surface solide de la planète dans votre tampon de profondeur.

Comme chaque planète est rendue dans son propre repère local, vous pouvez la
déplacer, la faire pivoter, la mettre à l’échelle uniformément et l’imbriquer
comme n’importe quel objet. Les shaders gardent aussi toute leur précision loin
de l’origine du monde.

## Ordre de rendu

```js
renderer.render(scene, camera);    // 1. votre géométrie opaque (remplit le tampon de profondeur)
planets.render(scene, camera);     // 2. les planètes : masquées par votre géométrie, elles couvrent ce qui est derrière elles
```

Les **objets transparents** comme les particules, sprites, vitres ou halos
doivent être dessinés **après** les planètes, pour se fondre par-dessus. Une
solution consiste à les placer sur un autre calque :

```js
renderer.autoClear = false;
renderer.clear();
camera.layers.set(0);  renderer.render(scene, camera);   // opaque
planets.render(scene, camera);
camera.layers.set(1);  renderer.render(scene, camera);   // les objets transparents vivent sur le calque 1
```

### Ce que fait (et ne fait pas) le test de profondeur

- **Votre géométrie placée devant une planète la masque.** Un vaisseau qui passe devant le globe fonctionne, tout comme une lune derrière les anneaux.
- **Une planète masque votre géométrie située derrière elle**, et la profondeur de sa surface est écrite pour tout ce qui est dessiné ensuite.
- **Les bords translucides** (le liseré de l’atmosphère, les espaces entre les anneaux, la couronne) se fondent sur votre géométrie située derrière eux. Ils n’occultent jamais ce qui est dessiné ensuite.
- Vos objets ne sont **pas voilés** par l’atmosphère d’une planète, et ils ne projettent aucune ombre sur les planètes (ni n’en reçoivent). Une planète en direct est éclairée par sa `lightSource`, pas par les lumières three. Le brouillard de la scène ne s’applique pas aux planètes.
- Avec la caméra **à l’intérieur** de l’atmosphère d’une planète, le ciel ne remplit que les pixels où votre tampon de profondeur est vide : vos objets proches restent nets.
- Un **tampon de profondeur logarithmique** (`new WebGLRenderer({ logarithmicDepthBuffer: true })`) est pris en charge.

## Couleur de sortie et tone mapping

`PlanetRenderer({ output })` contrôle ce qu’écrivent les planètes :

| `output` | Ce qui est écrit | À utiliser quand |
|---|---|---|
| `'auto'` (par défaut) | `'display'` pour le canvas et les cibles de rendu sRGB, `'linear'` pour les cibles linéaires | Presque toujours |
| `'display'` | sRGB avec tone mapping (ACES), comme le studio | Vous rendez dans le canvas ou dans une cible sRGB |
| `'linear'` | **HDR linéaire** prémultiplié | Vous rendez dans une cible HDR et appliquez le tone mapping ensuite (EffectComposer + OutputPass) |

Avec `'display'`, le `toneMapping` de votre renderer ne s’applique pas aux
planètes, puisqu’elles ont déjà leur tone mapping. Utilisez le paramètre
`exposure` pour les équilibrer avec le reste de la scène.

Les cibles de rendu dont `texture.colorSpace` vaut `THREE.SRGBColorSpace` sont
encodées par le GPU à l’écriture. En mode `'display'`, les planètes y écrivent
des valeurs *linéaires* après tone mapping, comme les matériaux de three : le
résultat correspond à un rendu dans le canvas.

## EffectComposer

```js
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { PlanetPass } from 'procedural-planets';

renderer.toneMapping = THREE.ACESFilmicToneMapping;
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new PlanetPass(scene, camera));  // juste après la RenderPass
composer.addPass(new UnrealBloomPass(/* ... */)); // les effets facultatifs voient aussi les planètes
composer.addPass(new OutputPass());               // tone mapping + sRGB pour tout
```

`PlanetPass` compose sur le tampon de lecture du composer. Elle conserve la
profondeur de la RenderPass, n’échange pas les tampons et utilise
`output: 'linear'` par défaut. Ne la placez jamais en dernière passe. Voir
[`examples/composer.html`](../../examples/composer.html).

## Rendre dans votre propre cible de rendu

```js
planets.render(scene, camera, { target: myRenderTarget });
```

La cible doit avoir un tampon de profondeur (c’est le cas par défaut pour
`WebGLRenderTarget`) qui contient déjà la profondeur de votre scène. Les tampons
internes suivent la taille de la cible. Sans `target`, c’est la cible de rendu
courante du renderer qui est utilisée.

Avec `output: 'auto'`, une cible linéaire (le `NoColorSpace` par défaut, et les
cibles HalfFloat) reçoit du HDR linéaire, prêt pour votre propre tone mapping.
Une cible sRGB (`rt.texture.colorSpace = THREE.SRGBColorSpace`) reçoit le rendu
d’affichage.

## Arrière-plan : transparent ou étoilé

`new PlanetRenderer(renderer, { background: 'stars' })` confie l’image à la
planète **la plus lointaine**. Elle est dessinée opaque, sur un champ d’étoiles
procédural et un disque solaire, comme le font le studio et `PlanetViewer`. Les
autres planètes se composent toujours par-dessus. Utilisez ce mode quand les
planètes *sont* la scène, par exemple en arrière-plan d’un menu.

## Unités, échelle et précision

- **`radius`** (2000 par défaut) et **`heightScale`** (80 par défaut) sont exprimés dans les unités locales de la planète. À l’échelle 1, ce sont vos unités monde. L’atmosphère, les nuages et la taille des vagues suivent l’échelle de la planète.
- **L’échelle de l’objet** doit être uniforme : `planet.scale.setScalar(s)`. Une échelle non uniforme n’est pas prise en charge.
- **Les plans proche et lointain de la caméra** n’affectent pas la qualité des planètes, qui réajustent les leurs. Seules les valeurs de profondeur écrites dans votre tampon utilisent la projection de votre caméra. Une planète au-delà du plan lointain de votre caméra est quand même dessinée, derrière tout le reste.
- **Précision** : chaque planète est rendue relativement à elle-même, donc une planète placée à 10⁶ unités de l’origine a le même aspect qu’une planète à l’origine.

## Nombreuses planètes

- Les planètes partagent les cibles GPU du renderer. Chaque planète **visible** coûte ses propres passes.
- **Les planètes invisibles ne coûtent rien.** Celles hors de l’écran sont éliminées, et `planet.visible = false` en ignore une.
- La planète **tellurique** avec nuages est la plus coûteuse. Ses cartes météo occupent 9 Mo de près, et bien moins quand elle est petite à l’écran (elles sont dimensionnées en conséquence : 128, 256 ou 512 texels par face du cube).
- `planetRenderer.info` → `{ planets, culled, pending, impostors, captures }` pour la dernière image.

### Planètes lointaines : imposteurs

Une planète dont le rayon à l’écran est inférieur à `impostorPixels` (90 px par
défaut) est dessinée comme un **imposteur**. Le même pipeline la rend dans un
emplacement d’un atlas HDR partagé, depuis le point de vue courant, et un
billboard affiche cette image à chaque frame. Le rendu est identique au rendu
complet et écrit la même profondeur : votre géométrie l’occulte toujours et
est occultée par lui. L’image est rafraîchie quand elle devient obsolète : la
direction de vue ou du soleil a changé (`impostorAngle`), la distance ou la
taille a changé, un paramètre a été modifié, ou `impostorRefresh` secondes de
temps planétaire se sont écoulées (nuages, vagues). Au plus `impostorUpdates`
images sont recalculées par frame, les plus anciennes d’abord.

Rien à configurer : un système solaire de petites planètes coûte quelques
billboards plus deux ou trois petits rendus par frame. Les étoiles sont
toujours dessinées en entier (leur éblouissement s’étend sur toute l’image).
Désactivez-le avec `{ impostors: false }`.

Pour les corps très lointains, vous pouvez toujours basculer vers un mesh
pré-calculé statique avec `THREE.LOD`. `PlanetRenderer` ne dessine que les
planètes visibles, et `renderer.render()` met d’abord le LOD à jour :

```js
const lod = new THREE.LOD();
lod.addLevel(new Planet({ preset: 'mars', seed: 3, lightSource: sun }), 0);
lod.addLevel(await bakePlanet(renderer, { preset: 'mars', seed: 3, textureSize: 512 }), 40000);
scene.add(lod);
```

## Charger sans blocage

WebGL lie un programme de shader à son premier dessin, puis attend le pilote.
Pour le shader du terrain, cela prend des secondes pendant lesquelles la page
est figée. `PlanetRenderer` ne fait jamais cela : il compile en arrière-plan
tous les programmes dont une planète a besoin (`KHR_parallel_shader_compile`)
et ignore la planète jusqu’à ce qu’ils soient prêts (`info.pending`). Pour
afficher une planète dès sa toute première image, préparez-la derrière votre
écran de chargement :

```js
await planets.prepare(scene, camera, {
  onProgress: ({ stage, progress }) => loadingBar.set(progress),   // 0..1
});
// le prochain planets.render() dessine tout en qualité maximale
hideLoadingScreen();
```

`prepare()` compile les programmes en parallèle, exécute les pré-calculs GPU
ponctuels (bruit des nuages, transmittance, premier état météo) par tranches à
chaque image, et effectue un premier dessin de chaque programme. Passez
`{ modes: true }` pour compiler aussi les autres types d’astres et les couches
facultatives (nuages, anneaux), afin que les changements ultérieurs n’attendent
jamais. `PlanetViewer.prepare()` fait de même et se résout une fois sa première
image affichée dans le canvas.

## Réglages de performance

| Paramètre | Effet |
|---|---|
| `cloudsEnabled` | La passe des nuages volumétriques est l’élément le plus coûteux d’une planète tellurique |
| `cloudQuality` | Nombre maximal de pas de raymarching (64 par défaut). La longueur des pas suit la structure des nuages, donc la plupart des rayons en demandent bien moins |
| `cloudResolution` | Budget de résolution de la passe des nuages (0,25–1). Les planètes petites à l’écran obtiennent automatiquement la pleine résolution, et seul le rectangle à l’écran de la couche nuageuse est tracé |
| `chunkRes`, `maxDepth`, `splitFactor` | Densité du LOD du terrain : taille de grille par chunk, profondeur de l’arbre, distance de subdivision. Tout le terrain est un seul dessin instancié par variante de shader |
| `octaves` | Octaves de bruit (à la compilation) |
| `scissor` (option du renderer) | Laissez-le activé : les planètes ne calculent que leur rectangle à l’écran |
| `impostors`, `impostorPixels` (options du renderer) | Planètes lointaines en billboards (voir plus haut) |

**Niveau de détail.** Le LOD du terrain utilise le geomorphing : les sommets
d’un chunk glissent vers la grille de son parent quand la caméra s’éloigne, si
bien que les chunks se subdivisent et fusionnent sans saut visible.

## Sélectionner et placer des objets sur une planète

```js
const hits = raycaster.intersectObject(planet);           // sphère à planet.surfaceRadius
const dirLocal = new THREE.Vector3(0.3, 0.8, -0.5);
const base = planet.getSurfacePoint(dirLocal);            // position monde sur le terrain ou la mer
building.position.copy(base);
```

`getSurfacePoint` et `getSurfaceRadius` lisent une copie CPU des octaves de base
du terrain. Elle correspond étroitement au terrain rendu, mais pas aux octaves
de détail les plus fines.

## Limitations

- Seule la `PerspectiveCamera` est prise en charge. Les caméras orthographiques sont ignorées avec un avertissement, et WebXR / `ArrayCamera` n’est pas pris en charge.
- Il y a un seul soleil par planète.
- Une planète est toujours rendue sur toute la hauteur de l’image à la résolution de sortie. Les vues en écran partagé (`setViewport`) ne sont pas encore prises en charge.
- Les tampons de profondeur à Z inversé ne sont pas pris en charge.
