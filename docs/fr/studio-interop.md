# Interopérabilité avec le Studio

Le studio (l’application de ce dépôt, `npm run dev`) est un éditeur visuel des
mêmes paramètres de `Planet`. Il existe trois façons de faire passer une planète
du studio à votre code.

## 1. « Utiliser en code » (panneau Export)

La section **Utiliser en code** du panneau Export affiche, et copie, l’astre
courant sous forme d’appel de constructeur. Le terrain procédural liste les
paramètres qui diffèrent des valeurs par défaut. Une planète qui contient un
graphe de nœuds utilise un instantané `Planet.fromJSON()` complet, qui conserve
la précision numérique et son graphe appliqué :

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

## 2. Le JSON de préréglage exporté

**Export** produit un ZIP contenant `planet_preset.json` (`star_preset.json`
pour les étoiles, qui inclut un éventuel shader d’étoile personnalisé).
Chargez-le avec :

```js
import presetJson from './planet_preset.json';
const planet = Planet.fromJSON(presetJson, { lightSource: sun });
```

## 3. Projets enregistrés

Les projets du studio vivent dans le navigateur (IndexedDB). Un objet projet,
ou simplement son document complet, se charge de la même façon :

```js
const planet = Planet.fromJSON(project);
```

Les jeux de paramètres enregistrés par d’anciennes versions du studio sont
migrés automatiquement. La forme est conservée, et les clés d’apparence sont
mises à niveau vers le modèle de rendu actuel.

## Aller-retour

`planet.serialize()` renvoie la même forme `{ app, version: 2, mode, params, terrain }`
que l’export du studio. Vous pouvez la stocker, l’envoyer et la restaurer avec
`Planet.fromJSON()`.

## Graphes de nœuds de hauteur

La source du terrain et le type d’astre sont indépendants. `params.mode`
sélectionne Planète, Gaz ou Étoile ; `terrain.mode` sélectionne `procedural` ou
`nodes`. Changer de type d’astre conserve le graphe tellurique. Les nœuds
évaluent un champ de hauteur sur des directions normalisées de la sphère
locale ; la hauteur finale est bornée à `[0, 1]` et le rayon de la surface vaut
`radius + height * heightScale`.

```js
import { Planet, createRecipe, validateGraph } from 'procedural-planets';

const graph = createRecipe('two-noises');
const result = validateGraph(graph);
if (!result.valid) throw new Error(result.diagnostics[0].message);
const planet = new Planet({ seed: 42, terrain: { mode: 'nodes', graph } });

// Fournissez le renderer pour valider la compilation du shader avant de modifier la planète.
const applied = await planet.setTerrainGraph(createRecipe('noise-remap'), { renderer });
if (!applied.ok) console.error(applied.diagnostics);
```

Les autres recettes sont `current` (une copie fidèle des paramètres de terrain
classiques), `noise-remap` et `two-noises`. Les types de nœuds disponibles sont
`currentTerrain`, `noise3d`, `constant`, `mix`, `remap` et `heightOutput`. Le
graphe est du JSON simple :
`{ format: 'procedural-planets-height-graph', version: 1, nodes, edges, outputId }`.
Les nœuds contiennent `id`, `type`, `params` ; les connexions contiennent `id`,
`source`, `sourcePort`, `target`, `targetPort`. La bibliothèque publique ne
dépend pas de React Flow.

La version 2 du schéma du studio ajoute `terrain` et `editor` à côté de
`params`. `terrain.graph` est le dernier graphe appliqué et validé.
`editor.draftGraph` peut contenir des connexions incomplètes ; les positions,
noms d’affichage, groupes et la vue sont aussi stockés dans `editor`.
L’enregistrement et la réouverture conservent les deux états, et le runtime
ignore l’éditeur. Les données importées invalides ou non prises en charge
restent disponibles pour être récupérées. Les anciens projets migrent vers le
terrain procédural sans changer la valeur de leurs paramètres.

Le JSON d’exécution, les pré-calculs de meshes, les archives ZIP et les exports
GLB n’utilisent que l’état appliqué. Les exports capturent un instantané
cohérent avant l’empaquetage asynchrone : modifier la planète en direct pendant
un export ne change ni son mesh ni son préréglage. Les préréglages du ZIP
incluent la configuration complète du terrain ; les brouillons de l’éditeur en
sont exclus. Les projets cloud conservent les graphes appliqués et les
brouillons dans la limite existante de 1 Mo.

L’[exemple autonome](../../examples/node-graph.html) montre la construction, la
sérialisation et le passage du terrain procédural au terrain par nœuds via
l’API publique.

## Création de peinture

La pile de création tellurique est **Terrain procédural / par nœuds → Calque de
peinture → Surface finale de la planète**. Les nœuds ne contiennent jamais de
modifications de peinture, et changer la base conserve le champ de hauteur
signé et les influences de matériaux séparés.

Appuyez sur **P**, ou choisissez **Peinture** dans la barre d’outils du Studio.
La vue reste active : glisser avec le bouton gauche peint, glisser avec le
bouton droit fait orbiter, la molette zoome, et Maj + molette change le rayon
du pinceau. Échap/P ferme le mode Peinture en gardant tous les calques actifs.
Ctrl/Cmd + Z annule un trait complet ; Ctrl/Cmd + Maj + Z le rétablit. Les
réglages du pinceau sont temporaires et ne créent pas d’entrée dans
l’historique du document.

Sculpter élève ou abaisse l’élévation radiale. Lisser fait la moyenne des
élévations **finales** environnantes et n’écrit qu’un décalage de peinture
compensatoire. Aplanir vise `rayon de la planète + élévation` ; **Prendre la
hauteur actuelle** échantillonne la prochaine surface cliquée. La peinture de
matériaux mélange les couleurs existantes Côte/fond marin, Sable/désert,
Herbe/végétation, Roche et Neige/glace. Peindre un matériau de fond marin ne
retire pas la coquille océanique de la planète. Effacer retire
progressivement la hauteur peinte et les influences de matériaux. **Effacer les
calques peints** demande confirmation avant d’effacer uniquement la peinture,
et peut être annulé.

Les pinceaux Rond, Ellipse, Organique, Dispersion et Ruban partagent la taille,
l’intensité, l’atténuation, l’espacement et (pour Ellipse/Ruban) la rotation. La
taille est un rayon géodésique en unités locales de la planète, avec un minimum
basé sur la résolution du champ. Tous les pinceaux utilisent des directions
normalisées de la sphère et un repère tangent local, y compris au passage des
pôles et des arêtes du cube. Le contour suit le terrain réellement déplacé.

Les documents modifiables et les préréglages d’exécution conservent désormais
`paint` séparément de `editor`. L’enregistrement automatique, le changement de
projet, le rechargement du navigateur, l’import/export `.ppplanet`, le JSON des
projets cloud, `Planet.fromJSON()` et les clones conservent exactement le champ
Float32. Des tuiles compressées et creuses évitent de gigantesques tableaux JSON
de pixels et des échantillons de pointeur redondants. La **limite de 1 Mo par
projet** de l’API cloud s’applique toujours : des champs complexes très peints
peuvent l’atteindre ; les fichiers locaux modifiables n’ont pas cette limite.
L’annulation ne conserve des instantanés compressés qu’aux limites d’actions
stables.

Le Studio utilise 256 quads par face du cube. Le détail est limité par cette
résolution d’échantillonnage et par le LOD du mesh de la vue ou de l’export. Les
envois au GPU ne concernent que les faces modifiées, au plus une fois par
image. Le déplacement du terrain évalue déjà le champ dans chaque chunk de LOD :
peindre ne régénère ni l’atmosphère, ni les nuages, ni l’océan, ni les shaders.
