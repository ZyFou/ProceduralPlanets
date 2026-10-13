# Météo

Les planètes telluriques portent une **météo régionale et chronométrée** par-dessus
leur couche nuageuse : amas orageux, ouragans, fronts de pluie et ciels dégagés
qui se forment, se déplacent, déversent leur pluie, s’illuminent d’éclairs et se
dissipent. La météo est locale — chaque système est une calotte sur la sphère —
si bien qu’un hémisphère peut être orageux pendant que l’autre est dégagé.

La météo nécessite la couche nuageuse (`cloudsEnabled`) et `weatherEnabled`
(tous deux activés par défaut). Les géantes gazeuses et les étoiles ont leurs
propres tempêtes (`gasStorms`).

## Ce que vous obtenez

| Fonctionnalité | Aspect | Piloté par |
|---|---|---|
| **Orages** | Tours de cumulonimbus serrées à la base sombre et plate, rideaux de pluie, éclairs | `type: 'storm'`, `stormCount` |
| **Ouragans** | Un œil dégagé, un mur de l’œil imposant, une couverture centrale dense et deux bandes de pluie en spirale, en rotation (sens antihoraire au nord) | `type: 'hurricane'`, `hurricaneCount` |
| **Fronts de pluie** | Une longue couche stratiforme grise et plate avec une pluie continue | `type: 'rain'`, `stormCount` |
| **Ciels dégagés** | Un anticyclone qui dissout les nuages au-dessous de lui | `type: 'clear'` |
| **Pluie** | Rideaux de précipitations gris sous les nuages qui pleuvent (inclinés par le vent, s’évaporant en virga quand elle est faible), nuages d’orage plus sombres et plus lourds, sol mouillé (plus sombre) ; depuis une caméra sous les nuages, des traînées qui tombent et une visibilité réduite | `rainAmount`, le `rain` de chaque système |
| **Éclairs** | Des flashs qui illuminent le volume nuageux de l’intérieur, des éclairs nuage-sol, le sol éclairé autour des impacts ; un événement `lightning` par éclair | `lightningAmount`, le `lightning` de chaque système |

Les nuages convectifs denses du climat de fond pleuvent aussi d’eux-mêmes
(`rainAmount`) ; les éclairs ne viennent que des systèmes orageux.

## Trois sources de systèmes

Tous les systèmes partagent 8 emplacements GPU, remplis dans cet ordre :

1. **Exécution** — `planet.weather.add()` : des événements scriptés et chronométrés (non enregistrés).
2. **Épinglés** — le paramètre `weatherSystems` : enregistrés avec la planète et le
   projet du studio.
3. **Procéduraux** — `stormCount` / `hurricaneCount` : des systèmes qui se forment
   à un endroit aléatoire, se déplacent (les tempêtes tropicales dérivent vers
   l’ouest, celles des latitudes moyennes vers l’est, les ouragans vers l’ouest
   et vers les pôles) et se dissipent au bout d’environ `stormLifetime`
   secondes, après quoi un nouveau se forme ailleurs. Déterministes : la même
   graine et le même temps météo donnent la même météo.

## Paramètres

| Clé | Défaut | Signification |
|---|---|---|
| `weatherEnabled` | `true` | Systèmes, pluie et éclairs activés / désactivés |
| `weatherSpeed` | `1` | Vitesse de l’horloge météo (cycles de vie, trajectoires, rotation, éclairs) |
| `stormCount` | `2` | Amas orageux et fronts de pluie procéduraux actifs en même temps |
| `hurricaneCount` | `1` | Ouragans procéduraux actifs en même temps |
| `stormSize` | `1` | Multiplicateur de taille des systèmes procéduraux |
| `stormLifetime` | `120` | Durée de vie moyenne d’un système procédural (secondes météo) |
| `rainAmount` | `0.5` | Intensité des précipitations |
| `rainColor` | `[0.6, 0.64, 0.7]` | Teinte des rideaux de pluie (plus blanche pour la neige, plus sombre pour la cendre) |
| `lightningAmount` | `0.5` | Fréquence des éclairs |
| `lightningBrightness` | `1` | Luminosité des flashs |
| `lightningColor` | `[0.78, 0.84, 1]` | Couleur des flashs |
| `weatherSystems` | `[]` | Systèmes épinglés (ci-dessous) |

La couche nuageuse elle-même a gagné trois contrôles de forme et de lumière :
`cloudTowering` (des couches basses et plates aux hauts cumulonimbus),
`cloudShear` (les vents d’altitude inclinent les tours dans le sens du vent) et
`cloudSilverLining` (lueur de diffusion vers l’avant en direction du soleil).
Voir [parameters.md](../parameters.md). Une couche plus épaisse
(`cloudThickness`) construit des tours plus hautes à partir de davantage de
bourgeonnements plutôt que d’agrandir les mêmes nuages : la taille des
bourgeonnements ne croît qu’avec la racine carrée de l’épaisseur, tandis que les
tours restent à peu près aussi larges que la couche est haute.

## Définition d’un système

```js
{
  type: 'hurricane',        // 'storm' | 'hurricane' | 'rain' | 'clear'
  lat: 18, lon: -45,        // degrés (y = pôle nord ; ou direction: Vector3)
  radius: 10,               // degrés d'arc
  intensity: 1,             // 0..1
  coverage: 1,              // quantité de nuages créée (clear : en retire)
  rain: 1,                  // 0..1 précipitations
  lightning: 0.5,           // 0..2 activité (x lightningAmount)
  tower: 0.85,              // 0..1 profondeur de la convection
  eye: 0.075,               // ouragans : rayon de l'œil, fraction du rayon
  spin: 0.12,               // ouragans : rad / s (par défaut : selon l'hémisphère)
  heading: 290, speed: 0.03,// trajectoire : degrés (0 nord, 90 est), degrés / s
  start: 0, duration: 0,    // cycle de vie en secondes météo (0 = permanent)
  fadeIn: 0, fadeOut: 0,    // secondes
  period: 0,                // se répète toutes les N secondes (0 = une fois)
}
```

Seul `type` est obligatoire ; tout le reste a une valeur par défaut selon le
type. Un système grandit pendant son apparition et rétrécit pendant sa
disparition.

## Scripts

```js
const planet = new Planet({ preset: 'ocean' });

// un orage qui se forme en 6 s, fait rage une minute, se dissipe en 10 s
const id = planet.weather.add({
  type: 'storm', lat: 12, lon: 40, radius: 5,
  duration: 76, fadeIn: 6, fadeOut: 10,
});

// le laisser s'intensifier et dériver vers le nord-est en 20 secondes
planet.weather.update(id, { radius: 8, lat: 20, lon: 48 }, { duration: 20 });

// un ouragan qui apparaît dans 30 s, prend de la vitesse et se déplace vers l'ouest
planet.weather.add({ type: 'hurricane', lat: 15, lon: -30, delay: 30, heading: 280, speed: 0.04 });

// dégager le ciel au-dessus d'un point, puis le laisser se refermer
const hole = planet.weather.add({ type: 'clear', lat: 0, lon: 0, radius: 15 });
setTimeout(() => planet.weather.remove(hole, { fadeOut: 8 }), 20000);

// les changements globaux glissent aussi
planet.transition({ cloudCoverage: 0.75, rainAmount: 0.9 }, { duration: 30 });

// le tonnerre
planet.addEventListener('lightning', (e) => {
  const delay = camera.position.distanceTo(e.position) / speedOfSound;
  setTimeout(() => playThunder(e.intensity), delay * 1000);
});

// gameplay : pleut-il ici ?
const { rain, hurricane } = planet.weather.sample(localDirection);
```

| `planet.weather` | |
|---|---|
| `time` | L’horloge météo (secondes). Modifiez-la pour sauter ou rejouer (`time = 0`) |
| `add(def)` | Ajoute un système d’exécution ; renvoie son identifiant. Par défaut : démarre maintenant, apparaît en 4 s, disparaît en 6 s, permanent |
| `update(id, patch, { duration })` | Modifie un système ; les champs numériques glissent sur `duration` |
| `remove(id, { fadeOut })` / `clear({ fadeOut })` | Fait disparaître puis supprime |
| `get(id)` | Une copie d’une définition d’exécution |
| `list()` | Chaque système actif en ce moment : `{ id, source, type, lat, lon, strength, radius, definition }` |
| `sample(direction)` | `{ rain, storm, hurricane, clear, lightning }` d’après les systèmes à une direction locale de la planète |
| `strike({ direction?, system?, intensity?, ground? })` | Déclenche un éclair maintenant |
| `enabled` | Indique si la météo est rendue sur cette planète en ce moment |

`planet.transition(patch, { duration })` fait glisser n’importe quel paramètre
numérique ou de couleur ; les clés qui reconstruisent ou recalculent
(`octaves`, `seed`, `cloudScale`...) et les nombres changent immédiatement. Un
`set()` ultérieur de la même clé annule sa transition.

## Systèmes épinglés (enregistrés)

```js
planet.set('weatherSystems', [
  { type: 'hurricane', lat: 16, lon: -50 },                                 // permanent
  { type: 'storm', lat: 5, lon: 20, start: 10, duration: 60, period: 180,   // toutes les 3 minutes
    fadeIn: 10, fadeOut: 15 },
]);
```

Les systèmes épinglés suivent la chronologie météo à partir de 0 : ceux qui sont
chronométrés ou répétés se rejouent à l’identique à chaque chargement de la
planète.

## Performances

Les systèmes sont évalués analytiquement dans les shaders des nuages : aucune
texture supplémentaire, aucun recalcul quand ils se déplacent, tournent ou
s’estompent. Sans système actif, le coût se résume à une boucle qui s’arrête
aussitôt. À l’intérieur d’un système, la passe des nuages fait une lecture de
bruit supplémentaire par échantillon. Les rideaux de pluie ne sont parcourus que
là où les nuages au-dessus (ou l’air autour d’une caméra basse) pleuvent
réellement, les éclairs se résument à quelques uniforms, et les captures
d’imposteurs ignorent les éclairs. Pour supprimer entièrement la météo, réglez
`weatherEnabled: false` (ou `stormCount` / `hurricaneCount` à 0 et `rainAmount`
à 0 pour un ciel calme).

## Studio

L’onglet **Météo** regroupe les paramètres ci-dessus, l’horloge météo en direct
(avec *Redémarrer* pour rejouer les systèmes chronométrés), les **Événements en
direct** (faire apparaître un orage, un ouragan, un front de pluie ou un ciel
dégagé chronométré au centre de la vue, déclencher un éclair, tout faire
disparaître) et les **Systèmes épinglés** (enregistrés avec le projet, chacun
avec sa position, sa taille, son intensité, sa pluie, ses éclairs, sa rotation,
sa trajectoire et sa chronologie).
