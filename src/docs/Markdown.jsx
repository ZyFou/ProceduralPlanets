import { Fragment, createElement } from 'react';
import { marked } from 'marked';
import { Link2 } from 'lucide-react';
import CodeBlock from './CodeBlock.jsx';

// ============================================================================
// Renders the repository's docs/*.md as React: marked tokenises, this file
// turns tokens into elements, so links can be routed inside the docs page
// and code fences get the highlighted, copyable CodeBlock. Heading ids follow
// GitHub's slugs, so anchors written for GitHub keep working here.
// ============================================================================

const INLINE_TAGS = new Set(['kbd', 'sub', 'sup', 'b', 'strong', 'i', 'em', 'code', 'small', 'mark']);
const parsed = new Map();

let decoder = null;
function decodeEntities(text) {
  if (!text.includes('&') || typeof document === 'undefined') return text;
  decoder ??= document.createElement('textarea');
  decoder.innerHTML = text;
  return decoder.value;
}

/** Plain text of inline tokens (for slugs, the table of contents, search). */
export function plainText(tokens = []) {
  return tokens.map((token) => {
    if (token.tokens) return plainText(token.tokens);
    if (token.type === 'html') return '';
    return decodeEntities(token.text ?? '');
  }).join('');
}

/** GitHub-compatible heading slugs; repeated headings get -1, -2… */
export function createSlugger() {
  const seen = new Map();
  return (text) => {
    const base = text.toLowerCase().trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  };
}

const headingTokens = (tokens) => tokens.filter((token) => token.type === 'heading');

/**
 * Tokens plus the heading outline of a markdown source (memoised). With a
 * `reference` (the English page of a translation) whose headings have the
 * same depths in the same order, the translation reuses its ids.
 */
export function parseMarkdown(source, reference = null) {
  const key = reference ? `${reference.length}:${reference}${source}` : source;
  if (parsed.has(key)) return parsed.get(key);
  const tokens = marked.lexer(source, { gfm: true });
  const own = headingTokens(tokens);
  const base = reference ? parseMarkdown(reference).headings : null;
  const aligned = base && base.length === own.length && base.every((heading, i) => heading.depth === own[i].depth);
  const slug = createSlugger();
  const headings = own.map((token, i) => {
    const text = plainText(token.tokens);
    token.id = aligned ? base[i].id : slug(text);
    return { depth: token.depth, text, id: token.id };
  });
  const result = { tokens, headings, aligned: !reference || !!aligned };
  parsed.set(key, result);
  return result;
}

function DocLink({ href, title, ctx, children }) {
  const target = ctx.resolveHref(href);
  if (target.internal) {
    return <a href={target.href} title={title || undefined}>{children}</a>;
  }
  return <a href={target.href} title={title || undefined} target="_blank" rel="noopener noreferrer">{children}</a>;
}

function Inline({ tokens = [], ctx }) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const key = i;
    switch (token.type) {
      case 'text':
        out.push(token.tokens
          ? <Inline key={key} tokens={token.tokens} ctx={ctx} />
          : <Fragment key={key}>{decodeEntities(token.text)}</Fragment>);
        break;
      case 'escape':
        out.push(<Fragment key={key}>{token.text}</Fragment>);
        break;
      case 'strong':
        out.push(<strong key={key}><Inline tokens={token.tokens} ctx={ctx} /></strong>);
        break;
      case 'em':
        out.push(<em key={key}><Inline tokens={token.tokens} ctx={ctx} /></em>);
        break;
      case 'del':
        out.push(<del key={key}><Inline tokens={token.tokens} ctx={ctx} /></del>);
        break;
      case 'codespan':
        out.push(<code key={key}>{token.text}</code>);
        break;
      case 'br':
        out.push(<br key={key} />);
        break;
      case 'link':
        out.push(<DocLink key={key} href={token.href} title={token.title} ctx={ctx}><Inline tokens={token.tokens} ctx={ctx} /></DocLink>);
        break;
      case 'image':
        out.push(<img key={key} src={ctx.resolveImage(token.href)} alt={token.text} title={token.title || undefined} loading="lazy" />);
        break;
      case 'html': {
        // pair simple inline tags (<kbd>Ctrl</kbd>); anything else is shown as text
        const open = /^<([a-z]+)\s*>$/i.exec(token.text);
        const tag = open?.[1].toLowerCase();
        if (/^<br\s*\/?>$/i.test(token.text)) { out.push(<br key={key} />); break; }
        if (tag && INLINE_TAGS.has(tag)) {
          const close = tokens.findIndex((t, j) => j > i && t.type === 'html' && new RegExp(`^</${tag}\\s*>$`, 'i').test(t.text));
          if (close > i) {
            out.push(createElement(tag, { key }, <Inline tokens={tokens.slice(i + 1, close)} ctx={ctx} />));
            i = close;
            break;
          }
        }
        // a stray known tag is dropped; unknown "tags" (<string>) are prose
        const name = /^<\/?([a-z]+)[^>]*>$/i.exec(token.text)?.[1].toLowerCase();
        if (!INLINE_TAGS.has(name)) out.push(<Fragment key={key}>{token.text}</Fragment>);
        break;
      }
      default:
        out.push(<Fragment key={key}>{decodeEntities(token.raw ?? token.text ?? '')}</Fragment>);
    }
  }
  return out;
}

function Heading({ token, ctx }) {
  const Tag = `h${Math.min(token.depth, 6)}`;
  if (token.depth === 1) return <Tag id={token.id}><Inline tokens={token.tokens} ctx={ctx} /></Tag>;
  return (
    <Tag id={token.id} className="docs-heading">
      <Inline tokens={token.tokens} ctx={ctx} />
      <a className="docs-anchor" href={ctx.resolveHref(`#${token.id}`).href} aria-label={`Link to ${token.text}`}><Link2 size={14} aria-hidden /></a>
    </Tag>
  );
}

function Blocks({ tokens = [], ctx, tight = false }) {
  return tokens.map((token, index) => {
    switch (token.type) {
      case 'space':
        return null;
      case 'heading':
        return <Heading key={index} token={token} ctx={ctx} />;
      case 'paragraph':
        return tight
          ? <Inline key={index} tokens={token.tokens} ctx={ctx} />
          : <p key={index}><Inline tokens={token.tokens} ctx={ctx} /></p>;
      case 'text':
        return <Inline key={index} tokens={token.tokens ?? [token]} ctx={ctx} />;
      case 'code':
        return <CodeBlock key={index} code={token.text} lang={token.lang} />;
      case 'blockquote':
        return <blockquote key={index}><Blocks tokens={token.tokens} ctx={ctx} /></blockquote>;
      case 'hr':
        return <hr key={index} />;
      case 'list': {
        const items = token.items.map((item, itemIndex) => (
          <li key={itemIndex}>
            {item.task && <input type="checkbox" checked={!!item.checked} readOnly disabled />}
            <Blocks tokens={item.tokens} ctx={ctx} tight={!token.loose} />
          </li>
        ));
        return token.ordered
          ? <ol key={index} start={token.start || undefined}>{items}</ol>
          : <ul key={index}>{items}</ul>;
      }
      case 'table':
        return (
          <div key={index} className="docs-table">
            <table>
              <thead>
                <tr>{token.header.map((cell, c) => (
                  <th key={c} style={token.align[c] ? { textAlign: token.align[c] } : undefined}><Inline tokens={cell.tokens} ctx={ctx} /></th>
                ))}</tr>
              </thead>
              <tbody>
                {token.rows.map((row, r) => (
                  <tr key={r}>{row.map((cell, c) => (
                    <td key={c} style={token.align[c] ? { textAlign: token.align[c] } : undefined}><Inline tokens={cell.tokens} ctx={ctx} /></td>
                  ))}</tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'html':
        // comments (generated-file banners) are dropped; the docs' own HTML is trusted
        if (/^\s*<!--[\s\S]*-->\s*$/.test(token.text)) return null;
        return <div key={index} className="docs-html" dangerouslySetInnerHTML={{ __html: token.text }} />;
      default:
        return null;
    }
  });
}

/**
 * Render a markdown document (`reference`: see parseMarkdown). ctx: { resolveHref(href) → { href, internal },
 * resolveImage(src) → url }. `skipTitle` drops the leading # heading when the
 * page draws its own header.
 */
export default function Markdown({ source, reference = null, ctx, skipTitle = false }) {
  const { tokens } = parseMarkdown(source, reference);
  const title = skipTitle ? tokens.find((token) => token.type === 'heading' && token.depth === 1) : null;
  const visible = title ? tokens.filter((token) => token !== title) : tokens;
  return <div className="docs-markdown"><Blocks tokens={visible} ctx={ctx} /></div>;
}
