import { useMemo, useRef } from 'react';
import { highlight } from '../highlight.js';

// ============================================================================
// A small code editor: a transparent textarea over the docs highlighter, kept
// in sync while scrolling. Tab indents, Shift+Tab outdents, Enter keeps the
// indentation, Ctrl/Cmd+Enter runs.
// ============================================================================

const INDENT = '  ';

export default function CodeEditor({ value, onChange, onRun, label, errorLine }) {
  const textRef = useRef(null);
  const preRef = useRef(null);
  const gutterRef = useRef(null);
  const tokens = useMemo(() => highlight(value, 'js'), [value]);
  const lineCount = value.split('\n').length;

  const syncScroll = () => {
    const text = textRef.current;
    if (preRef.current) preRef.current.style.transform = `translate(${-text.scrollLeft}px, ${-text.scrollTop}px)`;
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-text.scrollTop}px)`;
  };

  // replace [start, end) and put the caret / selection back; insertText keeps
  // the browser's own undo history
  const edit = (start, end, insert, selStart, selEnd = selStart) => {
    const text = textRef.current;
    text.setSelectionRange(start, end);
    const inserted = typeof document.execCommand === 'function' && document.execCommand('insertText', false, insert);
    if (inserted) {
      text.setSelectionRange(selStart, selEnd);
      return;
    }
    onChange(value.slice(0, start) + insert + value.slice(end));
    setTimeout(() => textRef.current?.setSelectionRange(selStart, selEnd), 0);
  };

  const onKeyDown = (event) => {
    const text = event.currentTarget;
    const { selectionStart: start, selectionEnd: end } = text;
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      onRun?.();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      if (start === end && !event.shiftKey) {
        edit(start, end, INDENT, start + INDENT.length);
        return;
      }
      // indent / outdent every selected line
      const block = value.slice(lineStart, end);
      const lines = block.split('\n');
      const changed = event.shiftKey
        ? lines.map((line) => line.replace(/^ {1,2}/, ''))
        : lines.map((line) => INDENT + line);
      const joined = changed.join('\n');
      const firstDelta = changed[0].length - lines[0].length;
      edit(lineStart, end, joined, Math.max(lineStart, start + firstDelta), lineStart + joined.length);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const line = value.slice(lineStart, start);
      let indent = /^\s*/.exec(line)[0];
      if (/[{[(]\s*$/.test(line)) indent += INDENT;
      const insert = `\n${indent}`;
      edit(start, end, insert, start + insert.length);
    }
  };

  return (
    <div className="pg-editor">
      <div className="pg-gutter" aria-hidden>
        <div ref={gutterRef}>
          {Array.from({ length: lineCount }, (_, i) => (
            <span key={i} className={errorLine === i + 1 ? 'error' : ''}>{i + 1}</span>
          ))}
        </div>
      </div>
      <div className="pg-code">
        <pre ref={preRef} aria-hidden><code>
          {tokens.map((token, i) => (token.type ? <span key={i} className={`hl-${token.type}`}>{token.text}</span> : token.text))}
          {'\n'}
        </code></pre>
        <textarea
          ref={textRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onScroll={syncScroll}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          wrap="off"
          aria-label={label}
        />
      </div>
    </div>
  );
}
