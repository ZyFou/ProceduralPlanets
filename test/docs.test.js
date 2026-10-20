import { describe, expect, it } from 'vitest';
import { createSlugger, parseMarkdown } from '../src/docs/Markdown.jsx';
import { highlight } from '../src/docs/highlight.js';
import { DOCS_PAGES, createLinkContext, pageSource, parseDocsHash, translationsOf } from '../src/docs/docsPages.js';
import { IMPORT_MAP, buildDocument, buildStandalone, codeFromHash, decodeCode, playgroundHref } from '../src/docs/playground/runner.js';
import { PLAYGROUND_TEMPLATES } from '../src/docs/playground/templates.js';
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

describe('documentation translations', () => {
  const pages = DOCS_PAGES.filter((page) => page.file && translationsOf('fr')[page.file]);

  it('translates every guide and keeps the English heading outline, so anchors work in both languages', () => {
    expect(pages.map((page) => page.id).sort()).toEqual(['api', 'baking', 'embedding', 'getting-started', 'studio-interop', 'weather']);
    for (const page of pages) {
      const { source, reference } = pageSource(page, 'fr');
      const fr = parseMarkdown(source, reference);
      const en = parseMarkdown(page.source);
      expect(fr.aligned, `${page.id}: same headings, same depths, same order`).toBe(true);
      expect(fr.headings.map((h) => h.id)).toEqual(en.headings.map((h) => h.id));
      expect(fr.headings[0].text).not.toBe(en.headings[0].text);
    }
  });

  it('keeps the code of the translated pages runnable (same imports and calls)', () => {
    const calls = (text) => [...text.replace(/\r\n/g, '\n').matchAll(/```js\n([\s\S]*?)```/g)]
      .map(([, code]) => code.replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ').trim());
    for (const page of pages) {
      expect(calls(pageSource(page, 'fr').source), page.id).toEqual(calls(page.source));
    }
  });

  it('resolves the links of the translated pages', () => {
    const ids = new Map(DOCS_PAGES.filter((page) => page.source).map((page) => [page.id, new Set(parseMarkdown(page.source).headings.map((h) => h.id))]));
    for (const page of pages) {
      const ctx = createLinkContext(page.id);
      for (const [, href] of pageSource(page, 'fr').source.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = ctx.resolveHref(href);
        if (target.internal) {
          const { page: targetPage, anchor } = parseDocsHash(target.href);
          expect(DOCS_PAGES.some((p) => p.id === targetPage), href).toBe(true);
          if (anchor) expect(ids.get(targetPage)?.has(anchor), `${page.id}: ${href}`).toBe(true);
        } else if (!/^https?:/.test(href)) {
          expect(target.href, href).toMatch(/^\/examples\//);
        }
      }
    }
  });

  it('falls back to English for pages without a translation', () => {
    const presets = DOCS_PAGES.find((page) => page.id === 'presets');
    expect(pageSource(presets, 'fr')).toMatchObject({ source: presets.source, translated: false });
    expect(pageSource(presets, 'en')).toMatchObject({ translated: true });
  });
});

describe('playground', () => {
  it('round-trips code through share links', () => {
    const code = PLAYGROUND_TEMPLATES.map((template) => template.code).join('\n// ---\n');
    const href = playgroundHref(code);
    expect(href).toMatch(/^#\/docs\/playground\?code=[\w-]+$/);
    expect(codeFromHash(href)).toBe(code);
    expect(decodeCode('not-valid')).toBeNull();
  });

  it('builds an isolated document whose error lines map back to the editor', () => {
    const html = buildDocument("console.log('a');\nthrow new Error('b </script> c');", 'token-1');
    expect(html).toContain('"procedural-planets":');
    expect(html).not.toContain("'b </script> c'");
    const lines = html.split('\n');
    const offset = Number(/__playgroundOffset = (\d+)/.exec(html)[1]);
    expect(lines[offset]).toBe("console.log('a');");
    expect(buildStandalone('x()')).toContain('<script type="importmap">');
  });

  it('starts every template from the public package entry points', () => {
    for (const template of PLAYGROUND_TEMPLATES) {
      const imports = [...template.code.matchAll(/from '([^']+)'/g)].map(([, name]) => name);
      for (const name of imports) expect(Object.keys(IMPORT_MAP.imports).some((key) => name === key || (key.endsWith('/') && name.startsWith(key))), name).toBe(true);
    }
  });
});
