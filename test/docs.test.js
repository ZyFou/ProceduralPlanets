import { describe, expect, it } from 'vitest';
import { createSlugger, parseMarkdown } from '../src/docs/Markdown.jsx';
import { highlight } from '../src/docs/highlight.js';
import { DOCS_PAGES, createLinkContext, parseDocsHash } from '../src/docs/docsPages.js';
import { formatValue, planetSnippet, toHex } from '../src/docs/planetCode.js';
import { PARAM_DOCS } from '../src/lib/paramDocs.js';

describe('documentation page', () => {
  it('slugs headings like GitHub, so anchors written for GitHub keep working', () => {
    const slug = createSlugger();
    expect(slug('Planet — extends THREE.Object3D')).toBe('planet--extends-threeobject3d');
    expect(slug('Distant planets: impostors')).toBe('distant-planets-impostors');
    expect(slug('Methods')).toBe('methods');
    expect(slug('Methods')).toBe('methods-1');
  });

  it('resolves every in-repo anchor link of the rendered docs to an existing heading', () => {
    const ids = new Map(DOCS_PAGES.filter((page) => page.source).map((page) => [page.id, new Set(parseMarkdown(page.source).headings.map((h) => h.id))]));
    for (const page of DOCS_PAGES.filter((p) => p.source)) {
      const ctx = createLinkContext(page.id);
      for (const [, href] of page.source.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = ctx.resolveHref(href);
        if (!target.internal) continue;
        const { page: targetPage, anchor } = parseDocsHash(target.href);
        if (anchor && targetPage !== 'parameters' && targetPage !== 'presets') {
          expect(ids.get(targetPage)?.has(anchor), `${page.id}: ${href}`).toBe(true);
        }
      }
    }
  });

  it('routes GitHub-relative links inside the docs or out to the repository', () => {
    const ctx = createLinkContext('api');
    expect(ctx.resolveHref('presets.md')).toEqual({ href: '#/docs/presets', internal: true });
    expect(ctx.resolveHref('embedding.md#effectcomposer')).toEqual({ href: '#/docs/embedding/effectcomposer', internal: true });
    expect(ctx.resolveHref('#lightsource')).toEqual({ href: '#/docs/api/lightsource', internal: true });
    expect(ctx.resolveHref('../examples/composer.html')).toEqual({ href: '/examples/composer.html', internal: false });
    expect(ctx.resolveHref('releasing.md').href).toMatch(/github\.com\/.+\/blob\/main\/docs\/releasing\.md$/);
  });

  it('parses docs routes and falls back to the overview', () => {
    expect(parseDocsHash('#/docs/api/lightsource')).toEqual({ page: 'api', anchor: 'lightsource' });
    expect(parseDocsHash('#/docs')).toEqual({ page: 'overview', anchor: '' });
    expect(parseDocsHash('#/docs/unknown')).toEqual({ page: 'overview', anchor: '' });
  });

  it('highlights code without losing characters', () => {
    const code = "const p = new Planet({ preset: 'terran' }); // hi\nplanet.set({ seaLevel: 0.5 });";
    const tokens = highlight(code, 'js');
    expect(tokens.map((t) => t.text).join('')).toBe(code);
    expect(tokens).toContainEqual({ type: 'keyword', text: 'const' });
    expect(tokens).toContainEqual({ type: 'string', text: "'terran'" });
    expect(tokens).toContainEqual({ type: 'comment', text: '// hi' });
    expect(highlight('plain', 'unknown')).toEqual([{ type: null, text: 'plain' }]);
  });

  it('writes parameter values as code a Planet accepts', () => {
    expect(toHex([1, 0.5, 0])).toBe('#ff8000');
    expect(formatValue([0, 0, 1], 'color')).toBe("'#0000ff'");
    expect(formatValue(0.123456, 'number')).toBe('0.1235');
    expect(planetSnippet([['preset', "'desert'"], ['seed', '7']], { imports: false }))
      .toBe("const planet = new Planet({ preset: 'desert', seed: 7 });");
    for (const doc of Object.values(PARAM_DOCS)) expect(doc.domain).toMatch(/^(planet|gas|star)$/);
  });
});
