import { useEffect, useRef, useState } from 'react';
import { Footprints, Orbit } from 'lucide-react';
import './SurfaceWalkControls.css';

function CircleControl({ label, onChange }) {
  const pointer = useRef(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const reset = e => {
    if (e?.pointerId !== undefined && pointer.current !== e.pointerId) return;
    pointer.current = null; setOffset({ x: 0, y: 0 }); onChange({ x: 0, y: 0 });
  };
  const move = e => {
    if (pointer.current !== e.pointerId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    let x = (e.clientX - rect.left - rect.width / 2) / (rect.width * .32);
    let y = (e.clientY - rect.top - rect.height / 2) / (rect.height * .32);
    const length = Math.max(1, Math.hypot(x, y)); x /= length; y /= length;
    setOffset({ x, y }); onChange({ x, y });
  };
  useEffect(() => {
    window.addEventListener('blur', reset);
    return () => { window.removeEventListener('blur', reset); onChange({ x: 0, y: 0 }); };
  }, []);
  return <div className="walk-circle" role="group" aria-label={label}
    onPointerDown={e => { if (pointer.current !== null) return; e.preventDefault(); pointer.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); move(e); }}
    onPointerMove={move} onPointerUp={reset} onPointerCancel={reset} onLostPointerCapture={reset}>
    <span className="walk-circle-thumb" style={{ transform: `translate(${offset.x * 32}px, ${offset.y * 32}px)` }} />
    <span className="walk-circle-label">{label}</span>
  </div>;
}

export default function SurfaceWalkControls({ getWalker, onToggle, available = true }) {
  const [active, setActive] = useState(false), [notice, setNotice] = useState('');
  const [focused, setFocused] = useState(false), [speed, setSpeed] = useState(1);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const walker = getWalker();
      setActive(!!walker?.active); setFocused(!!walker?.focused); setSpeed(walker?.speedMultiplier ?? 1);
    }, 150);
    return () => window.clearInterval(timer);
  }, []);
  if (!available && !active) return null;
  return <div className={`surface-walk-ui${active ? ' is-walking' : ''}`}>
    <button className="surface-walk-button" type="button" aria-pressed={active}
      title={active ? 'Return to orbit' : 'Walk on the surface where you are looking'}
      onClick={() => { const ok = onToggle(); setActive(!!getWalker()?.active); setNotice(ok === false ? 'Aim at a rocky planet’s surface to walk.' : ''); }}>
      {active ? <Orbit size={20} /> : <Footprints size={20} />}<span>{active ? 'Exit walk' : 'Walk'}</span>
    </button>
    {notice && <span className="walk-notice" role="status">{notice}</span>}
    {active && <>
      <span className="walk-help">WASD / ZQSD · {focused ? 'Mouse to look · Esc to release' : 'Click view to capture mouse'} · Scroll for speed ×{speed.toFixed(1)} · Shift to run</span>
      <div className="walk-touch-controls">
        <CircleControl label="Move" onChange={value => { const walker = getWalker(); if (walker) walker.move = value; }} />
        <CircleControl label="Look" onChange={value => { const walker = getWalker(); if (walker) walker.look = value; }} />
      </div>
    </>}
  </div>;
}
