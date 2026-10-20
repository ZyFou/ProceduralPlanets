import { translate } from '../../i18n/locale.js';
import { useLocale } from '../../i18n/useLocale.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, Eraser, Link2, LoaderCircle, Play, RotateCcw, ShieldCheck, Terminal } from 'lucide-react';
import { copyText } from '../../utils/clipboard.js';
import CodeEditor from './CodeEditor.jsx';
import { DEFAULT_TEMPLATE, PLAYGROUND_TEMPLATES } from './templates.js';
import { PACKAGE_URL, buildDocument, buildStandalone, codeFromHash, encodeCode } from './runner.js';

// ============================================================================
// The docs playground: edit a module, run it in an isolated iframe, read its
// console. Code comes from a share link, the viewer's last draft, or a
// template, in that order.
// ============================================================================

const DRAFT_KEY = 'procedural-planets:docs-playground:v1';
const MAX_LOGS = 200;

function readDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null'); } catch { return null; }
}
function writeDraft(draft) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* session only */ }
}

function initialState() {
  const shared = codeFromHash();
  if (shared) return { code: shared, template: null, shared: true };
  const draft = readDraft();
  if (draft?.code) return { code: draft.code, template: draft.template ?? null, shared: false };
  return { code: DEFAULT_TEMPLATE.code, template: DEFAULT_TEMPLATE.id, shared: false };
}

const newToken = () => Math.random().toString(36).slice(2);

export default function Playground() {
  useLocale();
  const [{ code, template }, setState] = useState(initialState);
  const [run, setRun] = useState(() => ({ code, token: newToken() }));
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState('running');   // running | ready | error
  const [linkCopied, setLinkCopied] = useState(false);
  const frameRef = useRef(null);
  const logRef = useRef(null);
  const srcDoc = useMemo(() => buildDocument(run.code, run.token), [run]);
  const edited = template ? PLAYGROUND_TEMPLATES.find((t) => t.id === template)?.code !== code : true;

  const errorLine = useMemo(() => {
    const last = [...logs].reverse().find((entry) => entry.level === 'error');
    const match = last && /\(line (\d+)\)/.exec(last.text);
    return match ? Number(match[1]) : null;
  }, [logs]);

  // a new share link while the playground is open
  useEffect(() => {
    const onHash = () => {
      const shared = codeFromHash();
      if (!shared) return;
      setState({ code: shared, template: null });
      setLogs([]);
      setStatus('running');
      setRun({ code: shared, token: newToken() });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // keep the draft (per viewer, best effort)
  useEffect(() => {
    const timer = setTimeout(() => writeDraft({ code, template }), 400);
    return () => clearTimeout(timer);
  }, [code, template]);

  // console and lifecycle messages from the sandbox
  useEffect(() => {
    const onMessage = (event) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || data.__playground !== run.token) return;
      if (data.type === 'ready') { setStatus((current) => (current === 'error' ? current : 'ready')); return; }
      if (data.type === 'error') setStatus('error');
      const text = (Array.isArray(data.args) ? data.args : []).join(' ');
      setLogs((current) => [...current.slice(-(MAX_LOGS - 1)), { level: data.type, text, id: `${Date.now()}-${current.length}` }]);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [run.token]);

  useEffect(() => {
    const box = logRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [logs]);

  const execute = useCallback((source = code) => {
    setLogs([]);
    setStatus('running');
    setRun({ code: source, token: newToken() });
  }, [code]);

  const pickTemplate = (id) => {
    const next = PLAYGROUND_TEMPLATES.find((item) => item.id === id);
    if (!next) return;
    setState({ code: next.code, template: next.id });
    execute(next.code);
  };

  const reset = () => pickTemplate(template ?? DEFAULT_TEMPLATE.id);

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}#/docs/playground?code=${encodeCode(code)}`;
    window.history.replaceState(null, '', url);
    try {
      await copyText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch { /* the address bar holds the link */ }
  };

  const download = () => {
    const blob = new Blob([buildStandalone(code)], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'procedural-planets.html';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="pg">
      <header className="docs-page-head">
        <span className="docs-eyebrow">{translate('Get started')}</span>
        <h1>{translate('Playground')}</h1>
        <p>{translate('Edit the code and run it: it executes the published package in an isolated frame. Start from a template, then share a link or download a standalone page.')}</p>
      </header>

      <div className="pg-toolbar">
        <label className="pg-select">
          <span>{translate('Template')}</span>
          <select value={template ?? ''} onChange={(event) => pickTemplate(event.target.value)}>
            {!template && <option value="">{translate('Custom code')}</option>}
            {PLAYGROUND_TEMPLATES.map((item) => <option key={item.id} value={item.id}>{translate(item.title)}</option>)}
          </select>
        </label>
        {template && <span className="pg-template-desc">{translate(PLAYGROUND_TEMPLATES.find((item) => item.id === template)?.description)}</span>}
        <button type="button" className="docs-btn" onClick={() => execute()} title="Ctrl+Enter">
          <Play size={13} aria-hidden /> {translate('Run')} <kbd>Ctrl ↵</kbd>
        </button>
        <button type="button" className="docs-btn ghost" onClick={reset} disabled={!edited && !!template}>
          <RotateCcw size={13} aria-hidden /> {translate('Reset')}
        </button>
        <span className="pg-toolbar-spacer" />
        <button type="button" className="docs-btn ghost" onClick={share}>
          {linkCopied ? <Check size={13} aria-hidden /> : <Link2 size={13} aria-hidden />} {linkCopied ? translate('Link copied') : translate('Share')}
        </button>
        <button type="button" className="docs-btn ghost" onClick={download}>
          <Download size={13} aria-hidden /> {translate('Download .html')}
        </button>
      </div>

      <div className="pg-layout">
        <CodeEditor value={code} onChange={(next) => setState((current) => ({ ...current, code: next }))} onRun={() => execute()} label={translate('Playground code')} errorLine={errorLine} />
        <div className="pg-output">
          <div className="pg-frame">
            <iframe
              key={run.token}
              ref={frameRef}
              title={translate('Playground output')}
              sandbox="allow-scripts"
              srcDoc={srcDoc}
            />
            {status === 'running' && (
              <div className="docs-live-status"><LoaderCircle size={15} className="docs-spin" aria-hidden /> {translate('Running…')}</div>
            )}
          </div>
          <section className="pg-console" aria-label={translate('Console')}>
            <header>
              <span><Terminal size={13} aria-hidden /> {translate('Console')}</span>
              <button type="button" className="docs-copy" onClick={() => setLogs([])} disabled={!logs.length}>
                <Eraser size={12} aria-hidden /> <span>{translate('Clear')}</span>
              </button>
            </header>
            <div className="pg-logs" ref={logRef} role="log" aria-live="polite">
              {logs.length === 0 && <p className="pg-log-empty">{translate('console.log() output appears here.')}</p>}
              {logs.map((entry) => <pre key={entry.id} className={`pg-log ${entry.level}`}>{entry.text}</pre>)}
            </div>
          </section>
          <p className="pg-note"><ShieldCheck size={13} aria-hidden /> {translate('Runs {0} from jsDelivr, sandboxed: the code cannot reach this site’s data.', { 0: PACKAGE_URL.split('/npm/')[1] })}</p>
        </div>
      </div>
    </div>
  );
}
