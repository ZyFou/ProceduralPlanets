// ============================================================================
// Starter programs for the docs playground. Each one is a complete ES module
// that runs as-is in the playground's sandbox: `#app` is a full-size element,
// and 'three', 'three/…' and 'procedural-planets' resolve through an import
// map, exactly like the getting-started guide sets them up.
// ============================================================================

const SCENE_SETUP = `const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 1, 1e6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

function resize() {
  renderer.setSize(app.clientWidth, app.clientHeight);
  camera.aspect = app.clientWidth / app.clientHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();`;

export const PLAYGROUND_TEMPLATES = [
  {
    id: 'viewer',
    title: 'PlanetViewer',
    description: 'A planet on a page in a few lines',
    code: `import { PlanetViewer } from 'procedural-planets';

const viewer = new PlanetViewer({
  container: document.getElementById('app'),
  planet: { preset: 'terran', seed: 42 },
});

// change anything live
viewer.planet.set({ seaLevel: 0.55, cloudCoverage: 0.6 });
console.log('seed', viewer.planet.params.seed, '· sea level', viewer.planet.get('seaLevel'));
`,
  },
  {
    id: 'scene',
    title: 'Planet in your scene',
    description: 'Planet + PlanetRenderer next to ordinary meshes',
    code: `import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Planet, PlanetRenderer } from 'procedural-planets';

${SCENE_SETUP}
camera.position.set(2600, 900, 5200);

// a star lights the planet; ordinary meshes get an ordinary light
const sun = new Planet({ type: 'star', preset: 'sun', radius: 2500 });
sun.position.set(90000, 14000, 40000);
const earth = new Planet({ preset: 'terran', seed: 2024, lightSource: sun });
scene.add(sun, earth);

const light = new THREE.DirectionalLight(0xfff4e0, 2.5);
light.position.copy(sun.position);
scene.add(light, new THREE.AmbientLight(0x223344, 0.4));

// a moon that passes in front of and behind the planet
const moon = new THREE.Mesh(
  new THREE.SphereGeometry(320, 48, 24),
  new THREE.MeshStandardMaterial({ color: 0x9a948c, roughness: 0.95 }),
);
scene.add(moon);

const planets = new PlanetRenderer(renderer);
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  const t = clock.elapsedTime * 0.25;
  moon.position.set(Math.cos(t) * 3400, 300, Math.sin(t) * 3400);
  controls.update();
  renderer.render(scene, camera);          // your scene first...
  planets.render(scene, camera, { delta }); // ...then the planets, depth-tested
});
`,
  },
  {
    id: 'system',
    title: 'Star system',
    description: 'A star, a terrestrial planet and a ringed giant',
    code: `import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Planet, PlanetRenderer } from 'procedural-planets';

${SCENE_SETUP}
camera.position.set(0, 9000, 26000);

const star = new Planet({ type: 'star', preset: 'redGiant', radius: 3000 });
const rocky = new Planet({ preset: 'desert', seed: 7, radius: 1200, lightSource: star });
const giant = new Planet({ preset: 'ringed', seed: 3, radius: 2600, lightSource: star });
scene.add(star, rocky, giant);

const planets = new PlanetRenderer(renderer);
// compile and bake everything before the first frame (no pop-in)
const start = performance.now();
await planets.prepare(scene, camera);
console.log(\`ready in \${Math.round(performance.now() - start)} ms\`);

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  const t = clock.elapsedTime;
  rocky.position.set(Math.cos(t * 0.2) * 9000, 0, Math.sin(t * 0.2) * 9000);
  giant.position.set(Math.cos(t * 0.08 + 2) * 17000, 0, Math.sin(t * 0.08 + 2) * 17000);
  controls.update();
  renderer.render(scene, camera);
  planets.render(scene, camera, { delta });
});
`,
  },
  {
    id: 'weather',
    title: 'Weather scripting',
    description: 'Storms, a hurricane and lightning events',
    code: `import { PlanetViewer, latLonToDirection } from 'procedural-planets';

const viewer = new PlanetViewer({
  container: document.getElementById('app'),
  planet: { preset: 'ocean', seed: 12, stormCount: 0, hurricaneCount: 0 },
});
const planet = viewer.planet;

// a hurricane spinning up and drifting west
planet.weather.add({ type: 'hurricane', lat: 18, lon: 30, radius: 11, heading: 280, speed: 0.04 });

// a storm that builds over 6 s, rages, then dissipates over 10 s
planet.weather.add({ type: 'storm', lat: -8, lon: 60, radius: 6, duration: 60, fadeIn: 6, fadeOut: 10 });

// every strike is an event
let strikes = 0;
planet.addEventListener('lightning', (event) => {
  if (++strikes % 5 === 0) console.log(\`\${strikes} strikes, last intensity \${event.intensity.toFixed(2)}\`);
});

// gameplay query: is it raining at 18°N 30°E?
setInterval(() => {
  const { rain, hurricane } = planet.weather.sample(latLonToDirection(18, 30));
  console.log(\`rain \${rain.toFixed(2)} · hurricane \${hurricane.toFixed(2)}\`);
}, 4000);
`,
  },
  {
    id: 'transitions',
    title: 'Transitions',
    description: 'Glide parameters over time',
    code: `import { PlanetViewer } from 'procedural-planets';

const viewer = new PlanetViewer({
  container: document.getElementById('app'),
  planet: { preset: 'terran', seed: 9 },
});
const planet = viewer.planet;

const looks = [
  { seaLevel: 0.7, tempBias: 0.2, cloudCoverage: 0.75 },   // flooded and cloudy
  { seaLevel: 0.25, tempBias: 0.8, cloudCoverage: 0.2 },   // dry and hot
  { seaLevel: 0.45, tempBias: -0.7, cloudCoverage: 0.55 }, // ice age
];

let i = 0;
setInterval(() => {
  const look = looks[i++ % looks.length];
  console.log('transition to', look);
  planet.transition(look, { duration: 4 });
}, 6000);
`,
  },
  {
    id: 'baked',
    title: 'Baked planets',
    description: 'bakePlanet(): standard meshes lit by your lights',
    code: `import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { bakePlanet } from 'procedural-planets';

${SCENE_SETUP}
camera.position.set(0, 3000, 15000);

const light = new THREE.DirectionalLight(0xffffff, 3);
light.position.set(-1, 0.4, 0.6);
scene.add(light, new THREE.AmbientLight(0x404a60, 0.35));

const specs = [
  { preset: 'terran', seed: 11, x: -6500 },
  { preset: 'lava', seed: 4, x: -2200 },
  { preset: 'iceGiant', seed: 3, x: 2600, radius: 1500 },
  { preset: 'moon', seed: 8, x: 6500, radius: 1100 },
];
const bodies = [];
for (const { x, ...options } of specs) {
  const body = await bakePlanet(renderer, { ...options, meshResolution: 96, textureSize: 512 });
  body.position.x = x;
  scene.add(body);
  bodies.push(body);
  console.log('baked', options.preset);
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  for (const body of bodies) body.rotation.y += delta * 0.1;
  controls.update();
  renderer.render(scene, camera);
});
`,
  },
];

export const DEFAULT_TEMPLATE = PLAYGROUND_TEMPLATES[0];

/** A PlanetViewer program for Planet constructor options, as `[key, literal]` entries. */
export function viewerProgram(entries) {
  const body = entries.map(([key, value]) => `    ${key}: ${value},`).join('\n');
  return `import { PlanetViewer } from 'procedural-planets';

const viewer = new PlanetViewer({
  container: document.getElementById('app'),
  planet: {
${body}
  },
});
`;
}
