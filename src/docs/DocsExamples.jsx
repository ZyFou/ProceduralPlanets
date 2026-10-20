import { translate } from '../i18n/locale.js';
import { useLocale } from '../i18n/useLocale.js';
import { Code2, ExternalLink } from 'lucide-react';
import { GITHUB_REPO_URL } from '../constants/app.js';

// The runnable pages in examples/ (built and deployed next to the studio).
const EXAMPLES = [
  { file: 'viewer.html', title: 'PlanetViewer', api: 'PlanetViewer', text: 'A planet on a page in a few lines, with a button for every preset.' },
  { file: 'embed-solar-system.html', title: 'Planets in an existing scene', api: 'Planet + PlanetRenderer', text: 'A star, a planet and a ringed giant inside an ordinary three.js scene, with meshes occluding and occluded by them.' },
  { file: 'composer.html', title: 'EffectComposer', api: 'PlanetPass', text: 'PlanetPass in an EffectComposer chain with bloom and OutputPass.' },
  { file: 'baked.html', title: 'Baked planets', api: 'bakePlanet()', text: 'Static meshes with baked textures and standard materials, lit by scene lights.' },
  { file: 'node-graph.html', title: 'Height node graph', api: 'setTerrainGraph()', text: 'Build a terrain from a height graph recipe, entirely in code.' },
];

export default function DocsExamples() {
  useLocale();
  return (
    <div className="docs-examples">
      <header className="docs-page-head">
        <span className="docs-eyebrow">{translate('Get started')}</span>
        <h1>{translate('Examples')}</h1>
        <p>{translate('Each example is a single HTML page that imports procedural-planets exactly like your code would. Open one live, or read its source.')}</p>
      </header>
      <div className="docs-example-grid">
        {EXAMPLES.map((example) => (
          <article key={example.file} className="docs-example">
            <code className="docs-example-api">{example.api}</code>
            <h2>{translate(example.title)}</h2>
            <p>{translate(example.text)}</p>
            <div className="docs-example-links">
              <a className="docs-btn" href={`/examples/${example.file}`} target="_blank" rel="noopener noreferrer">
                {translate('Open live')} <ExternalLink size={12} aria-hidden />
              </a>
              <a className="docs-btn ghost" href={`${GITHUB_REPO_URL}/blob/main/examples/${example.file}`} target="_blank" rel="noopener noreferrer">
                <Code2 size={13} aria-hidden /> {translate('Source')}
              </a>
            </div>
          </article>
        ))}
      </div>
      <p className="docs-note">{translate('To run them locally, clone the repository, run npm install and npm run dev, then open /examples/.')}</p>
    </div>
  );
}
