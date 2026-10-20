import { translate } from '../i18n/locale.js';
import { useLocale } from '../i18n/useLocale.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Code2, Dices, ExternalLink, Orbit, Sun, Waves } from 'lucide-react';
import { GAS_PRESETS, PLANET_PRESETS, STAR_PRESETS } from '../engine/presets.js';
import { PlanetViewer } from '../engine/PlanetViewer.js';
import { PARAM_DOCS } from '../lib/paramDocs.js';
import CodeBlock from './CodeBlock.jsx';
import LivePlanet from './LivePlanet.jsx';
import Markdown from './Markdown.jsx';
import { formatValue, planetSnippet } from './planetCode.js';
import { playgroundHref } from './playground/runner.js';
import { viewerProgram } from './playground/templates.js';

// ============================================================================
// Presets as a gallery: thumbnails rendered by the package itself (one small
// offscreen viewer, preset after preset), a live view of the selected one
// and its constructor call. The generated table from docs/presets.md follows.
// ============================================================================

const KINDS = [
  { id: 'terrestrial', label: 'Terrestrial', icon: Orbit, table: PLANET_PRESETS },
  { id: 'gas', label: 'Gas giants', icon: Waves, table: GAS_PRESETS },
  { id: 'star', label: 'Stars', icon: Sun, table: STAR_PRESETS },
];
const ALL = KINDS.flatMap((kind) => Object.entries(kind.table).map(([name, preset]) => ({ name, kind: kind.id, label: preset.label, patch: preset.patch ?? {} })));
const THUMB_SEED = 42;
const STORAGE_KEY = 'procedural-planets:docs-preset-thumbs:v2';
// closer than the viewer's default framing; rings and coronas need more room
const THUMB_ZOOM = { terrestrial: 0.62, gas: 0.86, star: 0.8 };

const thumbs = new Map((() => {
  try { return Object.entries(JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}')); } catch { return []; }
})());
const saveThumbs = () => {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(thumbs))); } catch { /* memory only */ }
};

/** Render the missing thumbnails one by one; onThumb(name, dataUrl) as they land. */
function useThumbnails() {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const missing = ALL.filter((preset) => !thumbs.has(preset.name));
    if (!missing.length) return undefined;
    let cancelled = false;
    const host = document.createElement('div');
    host.className = 'docs-thumb-host';
    document.body.appendChild(host);
    let viewer = null;
    (async () => {
      try {
        viewer = new PlanetViewer({ container: host, planet: { preset: missing[0].name, seed: THUMB_SEED }, controls: false, autoStart: false, pixelRatio: 1 });
        for (const preset of missing) {
          if (cancelled) break;
          viewer.setPlanet({ preset: preset.name, seed: THUMB_SEED });
          viewer.camera.position.multiplyScalar(THUMB_ZOOM[preset.kind]);
          viewer.camera.lookAt(0, 0, 0);
          await viewer.prepare();
          if (cancelled) break;
          const capture = viewer.captureThumbnail(320, 200);
          viewer.renderOnce();
          const url = await capture;
          if (url) {
            thumbs.set(preset.name, url);
            saveThumbs();
            setVersion((v) => v + 1);
          }
        }
      } catch { /* no WebGL2: the cards keep their icons */ }
      viewer?.dispose();
      viewer = null;
      host.remove();
    })();
    return () => { cancelled = true; };
  }, []);
  return thumbs;
}

function highlights(patch) {
  return Object.entries(patch)
    .filter(([key]) => PARAM_DOCS[key] && PARAM_DOCS[key].type !== 'color')
    .slice(0, 6);
}

export default function PresetGallery({ source, ctx, anchor, onOpenInStudio }) {
  useLocale();
  const initial = ALL.find((preset) => preset.name === anchor) ?? ALL[0];
  const [selected, setSelected] = useState(initial.name);
  const [kind, setKind] = useState(initial.kind);
  const [seed, setSeed] = useState(THUMB_SEED);
  const images = useThumbnails();
  useEffect(() => {
    const linked = ALL.find((item) => item.name === anchor);
    if (!linked) return;
    setSelected(linked.name);
    setKind(linked.kind);
  }, [anchor]);
  const stageRef = useRef(null);
  const select = (name) => {
    setSelected(name);
    stageRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const preset = ALL.find((item) => item.name === selected);
  const visible = ALL.filter((item) => item.kind === kind);
  const planetOptions = useMemo(() => ({ preset: selected, seed }), [selected, seed]);
  const changed = Object.keys(preset.patch).length;

  return (
    <div className="docs-presets">
      <header className="docs-page-head">
        <span className="docs-eyebrow">{translate('Reference')}</span>
        <h1>{translate('Presets')}</h1>
        <p>{translate('A preset is a named patch over the default parameters. Pick one, then override anything you like.')}</p>
      </header>

      <div className="docs-preset-stage" ref={stageRef}>
        <LivePlanet planet={planetOptions} />
        <div className="docs-preset-detail">
          <span className="docs-eyebrow">{translate(KINDS.find((item) => item.id === preset.kind).label)}</span>
          <h2>{translate(preset.label)} <code>{preset.name}</code></h2>
          <p>{changed ? translate('{0} parameters differ from the defaults.', { 0: changed }) : translate('The default parameters of this body type.')}</p>
          {highlights(preset.patch).length > 0 && (
            <ul className="docs-chips">
              {highlights(preset.patch).map(([key, value]) => <li key={key}><code>{key}: {formatValue(value, PARAM_DOCS[key].type)}</code></li>)}
            </ul>
          )}
          <CodeBlock lang="js" code={planetSnippet([['preset', `'${preset.name}'`], ['seed', String(seed)]])} />
          <div className="docs-preview-actions">
            <button type="button" className="docs-btn ghost" onClick={() => setSeed((Math.random() * 1e5) | 0)}><Dices size={13} aria-hidden /> {translate('Random seed')}</button>
            <a className="docs-btn ghost" href={playgroundHref(viewerProgram([['preset', `'${preset.name}'`], ['seed', String(seed)]]))}><Code2 size={13} aria-hidden /> {translate('Edit in Playground')}</a>
            {onOpenInStudio && (
              <button type="button" className="docs-btn" onClick={() => onOpenInStudio(translate(preset.label), { preset: preset.name, seed })}>
                <ExternalLink size={13} aria-hidden /> {translate('Open in Studio')}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="docs-segmented" role="tablist" aria-label={translate('Body type')}>
        {KINDS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={kind === id} className={kind === id ? 'active' : ''} onClick={() => setKind(id)}>
            <Icon size={13} aria-hidden /> {translate(label)}
          </button>
        ))}
      </div>
      <div className="docs-preset-grid">
        {visible.map((item) => {
          const Icon = KINDS.find((k) => k.id === item.kind).icon;
          return (
            <button key={item.name} type="button" className={`docs-preset-card${item.name === selected ? ' active' : ''}`}
              aria-pressed={item.name === selected} onClick={() => select(item.name)}>
              <span className="docs-preset-thumb">
                {images.has(item.name) ? <img src={images.get(item.name)} alt="" /> : <Icon size={22} aria-hidden />}
              </span>
              <strong>{translate(item.label)}</strong>
              <code>{item.name}</code>
            </button>
          );
        })}
      </div>

      <section className="docs-preset-table">
        <Markdown source={source} ctx={ctx} skipTitle />
      </section>
    </div>
  );
}
