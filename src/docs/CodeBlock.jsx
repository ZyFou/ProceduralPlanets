import { translate } from '../i18n/locale.js';
import { useLocale } from '../i18n/useLocale.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText } from '../utils/clipboard.js';
import { highlight, languageLabel } from './highlight.js';

function Highlighted({ code, lang }) {
  const tokens = useMemo(() => highlight(code, lang), [code, lang]);
  return tokens.map((token, index) => (token.type
    ? <span key={index} className={`hl-${token.type}`}>{token.text}</span>
    : token.text));
}

function CopyButton({ text }) {
  useLocale();
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await copyText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch { /* the code stays selectable */ }
  };
  return (
    <button type="button" className={`docs-copy${copied ? ' copied' : ''}`} onClick={copy}
      aria-label={copied ? translate('Copied') : translate('Copy code')}>
      {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
      <span>{copied ? translate('Copied') : translate('Copy')}</span>
    </button>
  );
}

/**
 * A highlighted code block with a copy button. Pass `tabs`
 * ([{ label, code, lang }]) instead of `code` for alternatives such as
 * npm / import map.
 */
export default function CodeBlock({ code, lang, tabs, caption }) {
  const [active, setActive] = useState(0);
  const items = tabs ?? [{ label: languageLabel(lang), code, lang }];
  const current = items[Math.min(active, items.length - 1)];
  const text = current.code.replace(/\n$/, '');
  return (
    <figure className="docs-code">
      <div className="docs-code-head">
        {items.length > 1 ? (
          <div className="docs-code-tabs" role="tablist">
            {items.map((item, index) => (
              <button key={item.label} type="button" role="tab" aria-selected={index === active}
                className={index === active ? 'active' : ''} onClick={() => setActive(index)}>{item.label}</button>
            ))}
          </div>
        ) : <span className="docs-code-lang">{caption ?? current.label}</span>}
        <CopyButton text={text} />
      </div>
      <pre><code><Highlighted code={text} lang={current.lang} /></code></pre>
    </figure>
  );
}
