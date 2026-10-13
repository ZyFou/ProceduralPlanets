import { GITHUB_REPO_URL } from '../constants/app.js';
import gettingStarted from '../../docs/getting-started.md?raw';
import embedding from '../../docs/embedding.md?raw';
import api from '../../docs/api.md?raw';
import parameters from '../../docs/parameters.md?raw';
import presets from '../../docs/presets.md?raw';
import weather from '../../docs/weather.md?raw';
import baking from '../../docs/baking.md?raw';
import studioInterop from '../../docs/studio-interop.md?raw';
import gettingStartedFr from '../../docs/fr/getting-started.md?raw';
import embeddingFr from '../../docs/fr/embedding.md?raw';
import apiFr from '../../docs/fr/api.md?raw';
import weatherFr from '../../docs/fr/weather.md?raw';
import bakingFr from '../../docs/fr/baking.md?raw';
import studioInteropFr from '../../docs/fr/studio-interop.md?raw';

// ============================================================================
// The documentation's pages. Markdown pages render the repository's
// docs/*.md (the same files shipped in the npm package); `component` pages
// are interactive views built on the package itself.
// ============================================================================

export const DOCS_GROUPS = [
  { id: 'start', title: 'Get started' },
  { id: 'guides', title: 'Guides' },
  { id: 'reference', title: 'Reference' },
];

export const DOCS_PAGES = [
  { id: 'overview', group: 'start', title: 'Overview', component: 'overview', summary: 'What the package does and a live quick start' },
  { id: 'playground', group: 'start', title: 'Playground', component: 'playground', summary: 'Edit and run code in your browser' },
  { id: 'getting-started', group: 'start', title: 'Getting started', file: 'getting-started', source: gettingStarted, summary: 'Install, the three usage tiers, your first planet' },
  { id: 'examples', group: 'start', title: 'Examples', component: 'examples', summary: 'Runnable pages that use the package' },
  { id: 'embedding', group: 'guides', title: 'Embedding guide', file: 'embedding', source: embedding, summary: 'Render order, depth, tone mapping, EffectComposer, scale, performance' },
  { id: 'weather', group: 'guides', title: 'Weather', file: 'weather', source: weather, summary: 'Storms, hurricanes, rain fronts and lightning' },
  { id: 'baking', group: 'guides', title: 'Baking and export', file: 'baking', source: baking, summary: 'bakePlanet, glTF and ZIP export' },
  { id: 'studio-interop', group: 'guides', title: 'Studio interop', file: 'studio-interop', source: studioInterop, summary: 'Load studio projects and exports in code' },
  { id: 'api', group: 'reference', title: 'API reference', file: 'api', source: api, summary: 'Planet, PlanetRenderer, PlanetViewer, bakePlanet, PlanetPass' },
  { id: 'parameters', group: 'reference', title: 'Parameters', component: 'parameters', file: 'parameters', source: parameters, summary: 'Every parameter, with a live preview' },
  { id: 'presets', group: 'reference', title: 'Presets', component: 'presets', file: 'presets', source: presets, summary: 'The built-in looks' },
];

export const DEFAULT_PAGE = 'overview';

// docs/<lang>/<file>.md: same headings in the same order as the English page
const TRANSLATIONS = {
  fr: {
    'getting-started': gettingStartedFr,
    embedding: embeddingFr,
    api: apiFr,
    weather: weatherFr,
    baking: bakingFr,
    'studio-interop': studioInteropFr,
  },
};

/**
 * The markdown to show for `page` in `locale`: { source, reference, file,
 * translated }. `reference` is the English source whose heading ids a
 * translation reuses, so anchors are the same in every language.
 */
export function pageSource(page, locale) {
  const translated = page.file ? TRANSLATIONS[locale]?.[page.file] : null;
  if (translated) return { source: translated, reference: page.source, file: `${locale}/${page.file}`, translated: true };
  return { source: page.source, reference: null, file: page.file, translated: locale === 'en' };
}

export const translationsOf = (locale) => TRANSLATIONS[locale] ?? {};

const PAGE_BY_FILE = new Map(DOCS_PAGES.filter((page) => page.file).map((page) => [page.file, page.id]));
const IMAGES = import.meta.glob('../../docs/images/*', { eager: true, query: '?url', import: 'default' });

export const getPage = (id) => DOCS_PAGES.find((page) => page.id === id) ?? null;

/** The hash route of a docs page and optional anchor. */
export function docsHref(pageId, anchor) {
  return `#/docs/${pageId}${anchor ? `/${encodeURIComponent(anchor)}` : ''}`;
}

/** { page, anchor } from the current location hash (#/docs/<page>/<anchor>). */
export function parseDocsHash(hash = window.location.hash) {
  const [, pageId = '', anchor = ''] = hash.replace(/^#\/?/, '').split('?')[0].split('/');
  const page = getPage(pageId) ? pageId : DEFAULT_PAGE;
  return { page, anchor: anchor ? decodeURIComponent(anchor) : '' };
}

export const githubSourceUrl = (file) => `${GITHUB_REPO_URL}/blob/main/docs/${file}.md`;

/** Link resolution for markdown written for GitHub, seen from `pageId`. */
export function createLinkContext(pageId) {
  return {
    resolveHref(href = '') {
      if (/^(https?:|mailto:)/i.test(href)) return { href, internal: false };
      if (href.startsWith('#')) return { href: docsHref(pageId, href.slice(1)), internal: true };
      // relative to docs/ or to a translation in docs/<lang>/
      const path = href.replace(/^(\.\.?\/)+/, '');
      const doc = /^([\w-]+)\.md(?:#(.*))?$/.exec(path);
      if (doc) {
        const target = PAGE_BY_FILE.get(doc[1]);
        return target
          ? { href: docsHref(target, doc[2]), internal: true }
          : { href: githubSourceUrl(doc[1]) + (doc[2] ? `#${doc[2]}` : ''), internal: false };
      }
      // the runnable examples are deployed next to the studio
      const example = /^examples\/(.*)$/.exec(path);
      if (example) return { href: `/examples/${example[1]}`, internal: false };
      return { href: `${GITHUB_REPO_URL}/blob/main/${path}`, internal: false };
    },
    resolveImage(src = '') {
      const name = src.replace(/^(\.\.?\/)+/, '');
      return IMAGES[`../../docs/${name}`] ?? src;
    },
  };
}
