import { translate } from '../i18n/locale.js';
import { useLocale } from '../i18n/useLocale.js';
import { useMemo, useState } from 'react';
import { ArrowRight, Box, CloudLightning, Code2, Dices, ExternalLink, Fingerprint, Globe2, Layers3, MonitorPlay, Orbit, Sun, Waves } from 'lucide-react';
import { VERSION } from '../lib/index.js';
import CodeBlock from './CodeBlock.jsx';
import LivePlanet from './LivePlanet.jsx';
import { docsHref } from './docsPages.js';
import { playgroundHref } from './playground/runner.js';
import { viewerProgram } from './playground/templates.js';

const INSTALL_TABS = [
  { label: 'npm', lang: 'sh', code: 'npm install procedural-planets three' },
  { label: 'pnpm', lang: 'sh', code: 'pnpm add procedural-planets three' },
  { label: 'yarn', lang: 'sh', code: 'yarn add procedural-planets three' },
  {
    label: 'Import map',
    lang: 'html',
    code: `<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js",
  "three/examples/jsm/": "https://cdn.jsdelivr.net/npm/three@0.160.1/examples/jsm/",
  "fflate": "https://cdn.jsdelivr.net/npm/fflate@0.8.3/esm/browser.js",
  "procedural-planets": "https://cdn.jsdelivr.net/npm/procedural-planets/dist/lib/procedural-planets.js"
} }
</script>`,
  },
];

const QUICK_PRESETS = [
  { name: 'terran', label: 'Terran' },
  { name: 'desert', label: 'Desert' },
  { name: 'ice', label: 'Ice' },
  { name: 'lava', label: 'Lava' },
  { name: 'ringed', label: 'Ringed' },
  { name: 'iceGiant', label: 'Ice Giant' },
  { name: 'sun', label: 'Sun' },
  { name: 'redGiant', label: 'Red Giant' },
];

const TIERS = [
  {
    icon: Layers3,
    title: 'Planet + PlanetRenderer',
    text: 'The full live render composited into your own three.js frame, depth-tested against your meshes.',
    use: 'Hero planets, anything the camera gets close to',
    href: docsHref('embedding'),
    code: `const planet = new Planet({ preset: 'terran' });
scene.add(planet);
const planets = new PlanetRenderer(renderer);

renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
  planets.render(scene, camera);
});`,
  },
  {
    icon: MonitorPlay,
    title: 'PlanetViewer',
    text: 'A ready-made canvas with a camera, orbit controls, a starfield and one planet.',
    use: 'A planet on a web page, previews, configurators',
    href: docsHref('api', 'planetviewer'),
    code: `const viewer = new PlanetViewer({
  container: document.getElementById('planet'),
  planet: { preset: 'desert', seed: 7 },
});`,
  },
  {
    icon: Box,
    title: 'bakePlanet()',
    text: 'Plain meshes with baked textures and MeshStandardMaterial, lit by your lights.',
    use: 'Distant planets, many planets, mobile, glTF export',
    href: docsHref('baking'),
    code: `const moon = await bakePlanet(renderer, {
  preset: 'moon', radius: 500, textureSize: 1024,
});
scene.add(moon);`,
  },
];

const FEATURES = [
  { icon: Globe2, title: 'Terrestrial planets', text: 'GPU terrain on a quadtree LOD, climate biomes, analytic oceans, volumetric clouds, atmospheric scattering.' },
  { icon: CloudLightning, title: 'Weather', text: 'Storms, hurricanes and rain fronts that form, travel and dissipate, with lightning, all scriptable.' },
  { icon: Waves, title: 'Gas giants', text: 'Belts, zones and jets, storms and a great spot, rings with shadows.' },
  { icon: Sun, title: 'Stars', text: 'Blackbody colour, granulation, sunspots, prominences, a corona and bloom.' },
  { icon: Fingerprint, title: 'Deterministic', text: 'The same seed and parameters always give the same body: a planet is a small object you can save and share.' },
  { icon: Orbit, title: 'Made for three.js', text: 'Planets are Object3Ds: add, move and parent them. ESM, TypeScript declarations, three ≥ 0.160.' },
];

export default function DocsOverview({ onOpenInStudio }) {
  useLocale();
  const [preset, setPreset] = useState('terran');
  const [seed, setSeed] = useState(42);
  const planetOptions = useMemo(() => ({ preset, seed }), [preset, seed]);
  const label = QUICK_PRESETS.find((item) => item.name === preset)?.label ?? preset;
  const snippet = `import { PlanetViewer } from 'procedural-planets';

const viewer = new PlanetViewer({
  container: document.getElementById('planet'),
  planet: { preset: '${preset}', seed: ${seed} },
});`;

  return (
    <div className="docs-overview">
      <header className="docs-hero">
        <span className="docs-version">procedural-planets v{VERSION}</span>
        <h1>{translate('Procedural planets for three.js')}</h1>
        <p>{translate('Planets, gas giants and stars created from code and dropped into your own scene: GPU terrain with LOD, volumetric clouds, analytic oceans and physically based atmospheres.')}</p>
        <div className="docs-hero-actions">
          <a className="docs-btn" href={docsHref('getting-started')}>{translate('Get started')} <ArrowRight size={14} aria-hidden /></a>
          <a className="docs-btn ghost" href={docsHref('api')}>{translate('API reference')}</a>
          <a className="docs-btn ghost" href="https://www.npmjs.com/package/procedural-planets" target="_blank" rel="noopener noreferrer">npm <ExternalLink size={12} aria-hidden /></a>
        </div>
      </header>

      <section className="docs-section">
        <h2 id="install">{translate('Install')}</h2>
        <p>{translate('The package needs WebGL2 and three.js 0.160 or newer as a peer dependency. It is ESM-only and ships TypeScript declarations.')}</p>
        <CodeBlock tabs={INSTALL_TABS} />
      </section>

      <section className="docs-section">
        <h2 id="try-it">{translate('Try it')}</h2>
        <p>{translate('This preview is the package running in your browser. Pick a preset or roll a seed: the code below is all it takes.')}</p>
        <div className="docs-try">
          <LivePlanet planet={planetOptions} />
          <div className="docs-try-side">
            <div className="docs-chip-row" role="group" aria-label={translate('Preset')}>
              {QUICK_PRESETS.map((item) => (
                <button key={item.name} type="button" className={item.name === preset ? 'active' : ''} aria-pressed={item.name === preset} onClick={() => setPreset(item.name)}>
                  {translate(item.label)}
                </button>
              ))}
            </div>
            <CodeBlock code={snippet} lang="js" />
            <div className="docs-preview-actions">
              <button type="button" className="docs-btn ghost" onClick={() => setSeed((Math.random() * 1e5) | 0)}><Dices size={13} aria-hidden /> {translate('Random seed')}</button>
              <a className="docs-btn ghost" href={playgroundHref(viewerProgram([['preset', `'${preset}'`], ['seed', String(seed)]]))}><Code2 size={13} aria-hidden /> {translate('Edit in Playground')}</a>
              {onOpenInStudio && (
                <button type="button" className="docs-btn" onClick={() => onOpenInStudio(translate(label), planetOptions)}>
                  <ExternalLink size={13} aria-hidden /> {translate('Open in Studio')}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="docs-section">
        <h2 id="three-ways-to-use-it">{translate('Three ways to use it')}</h2>
        <div className="docs-tiers">
          {TIERS.map(({ icon: Icon, title, text, use, href, code }) => (
            <article key={title} className="docs-tier">
              <div className="docs-tier-text">
                <header><Icon size={17} aria-hidden /><h3>{title}</h3></header>
                <p>{translate(text)}</p>
                <small>{translate(use)}</small>
                <a href={href}>{translate('Read the guide')} <ArrowRight size={12} aria-hidden /></a>
              </div>
              <CodeBlock code={code} lang="js" />
            </article>
          ))}
        </div>
      </section>

      <section className="docs-section">
        <h2 id="features">{translate('Features')}</h2>
        <div className="docs-features">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="docs-feature">
              <Icon size={18} aria-hidden />
              <strong>{translate(title)}</strong>
              <span>{translate(text)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
