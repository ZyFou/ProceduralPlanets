import { useEffect, useState } from 'react';

// Small control primitives shared by every panel — same interaction model as
// the ThreeTerrain studio (drag slider, or type in the value box and Enter).

export function Slider({ label, value, min, max, step = 0.01, digits = 2, onChange, title }) {
  const fmt = (v) => Number(v).toFixed(digits);
  const [text, setText] = useState(fmt(value));
  useEffect(() => { setText(fmt(value)); }, [value]);

  const commit = () => {
    const v = parseFloat(text);
    if (Number.isFinite(v)) onChange(Math.min(Math.max(v, min), max));
    else setText(fmt(value));
  };

  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="ctl" title={title}>
      <div className="ctl-top">
        <span className="ctl-label">{label}</span>
        <input
          className="ctl-val"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
        />
      </div>
      <div className="ctl-track">
        <div className="ctl-fill" style={{ width: `${fill}%` }} />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
      </div>
    </div>
  );
}

export function Toggle({ label, value, onChange, title }) {
  return (
    <label className="toggle" title={title}>
      <span className="ctl-label">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={!!value}
        className={`switch${value ? ' on' : ''}`}
        onClick={() => onChange(!value)}
      >
        <span className="knob" />
      </button>
    </label>
  );
}

const toHex = (rgb) => '#' + rgb.map((c) => Math.round(Math.min(Math.max(c, 0), 1) * 255).toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

export function ColorRow({ label, value, onChange }) {
  return (
    <label className="color-row">
      <span className="color-chip" style={{ background: toHex(value) }} />
      <span className="ctl-label">{label}</span>
      <input type="color" value={toHex(value)} onChange={(e) => onChange(fromHex(e.target.value))} />
    </label>
  );
}

export function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`section${open ? ' open' : ''}`}>
      <button type="button" className="section-header" onClick={() => setOpen(!open)}>
        <span className="section-caret">{open ? '▾' : '▸'}</span>
        {title}
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}
