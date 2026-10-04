import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Crosshair, Navigation, Orbit, X } from 'lucide-react';
import { Explorer } from './Explorer.js';
import { AU, LIGHT_YEAR, MIN_SPEED, MAX_SPEED, formatDistance, formatSpeed, length, relative } from './world.js';
import './exploration.css';

export default function Exploration({ onExit }) {
  const canvasRef = useRef(null);
  const explorerRef = useRef(null);
  const [seed, setSeed] = useState('42');
  const [seedInput, setSeedInput] = useState('42');
  const [hud, setHud] = useState(null);
  const [speed, setSpeed] = useState(100);
  const [locked, setLocked] = useState(false);
  const [layout, setLayout] = useState('wasd');
  const [error, setError] = useState('');
  const [catalogueOpen, setCatalogueOpen] = useState(true);
  useEffect(() => {
    setHud(null); setError(''); setSpeed(100); setLocked(false);
    let explorer;
    try {
      explorer = new Explorer(canvasRef.current, seed, { onHud: setHud, onLock: setLocked, onSpeed: setSpeed, onError: setError });
      explorerRef.current = explorer;
      if (import.meta.env.DEV) window.planetExplorer = explorer;
    } catch (e) { setError(e.message || 'WebGL2 is required to explore.'); }
    return () => {
      explorer?.dispose();
      explorerRef.current = null;
      if (import.meta.env.DEV && window.planetExplorer === explorer) delete window.planetExplorer;
    };
  }, [seed]);
  useEffect(() => { if (explorerRef.current) explorerRef.current.flight.layout = layout; }, [layout, seed]);
  const changeSpeed = value => {
    setSpeed(value);
    if (explorerRef.current) explorerRef.current.flight.speed = value;
  };
  const select = body => explorerRef.current?.select(body);
  const capture = () => canvasRef.current?.click();
  const loading = !hud || hud.queued > 0 || hud.pending > 0;
  return <main className={`exploration${locked ? ' exploration-locked' : ''}`} aria-label="Infinite world exploration">
    <header className="exploration-header">
      <button type="button" onClick={onExit}><ArrowLeft size={16} /> Return to studio</button>
      <strong><Orbit size={18} /> Explore <span>Infinite worlds · real scale</span></strong>
      <button type="button" aria-expanded={catalogueOpen} onClick={() => setCatalogueOpen(v => !v)}>Navigation</button>
    </header>
    <div className="exploration-view">
      <canvas key={seed} ref={canvasRef} aria-label="Free flight view. Click to capture the mouse." />
      <div className="exploration-reticle" aria-hidden>+</div>
      {hud?.marker && <div className="exploration-marker" style={{ left: `${hud.marker.x}%`, top: `${hud.marker.y}%` }}>
        <Crosshair size={22} /><span>{hud.target.name}</span>
      </div>}
      {!locked && !error && <button className="exploration-fly" type="button" onClick={capture}><Navigation size={16} /> Click to fly <span>Esc releases the mouse</span></button>}
      {error && <div className="exploration-error" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="Dismiss error"><X size={16} /></button></div>}
      <section className="exploration-telemetry" aria-label="Flight instruments">
        <span className="exploration-eyebrow">FREE FLIGHT</span>
        <strong>{formatSpeed(hud?.speed ?? 0)}</strong>
        <span>Selected {formatSpeed(speed)} {hud?.limited && '· proximity brake'} {hud?.blocked && '· obstacle'}</span>
        {hud?.target && <p>{hud.target.name}<br /><b>{formatDistance(hud.distance)}</b> to surface{hud.approaching && ' · approaching'}</p>}
        <small>Sector {hud ? Object.values(hud.position.sector).join(' / ') : '0 / 0 / 0'}<br />
          {hud?.loaded ?? 0} bodies resident · {hud?.systems.length ?? 0} systems<br />
          {loading ? `Streaming / compiling${hud?.queued ? ` · ${hud.queued} queued` : ''}` : 'Ready'}</small>
      </section>
      {catalogueOpen && <aside className="exploration-panel" aria-label="Exploration navigation">
        <form onSubmit={event => { event.preventDefault(); const value = seedInput.trim(); if (value) { explorerRef.current?.flight.clear(); setSeed(value); } }}>
          <label htmlFor="exploration-seed">Universe seed</label>
          <div className="exploration-row"><input id="exploration-seed" value={seedInput} maxLength={64} onChange={e => setSeedInput(e.target.value)} /><button type="submit">Generate</button></div>
        </form>
        <label htmlFor="flight-speed">Travel speed <b>{formatSpeed(speed)}</b></label>
        <input id="flight-speed" type="range" min={Math.log10(MIN_SPEED)} max={Math.log10(MAX_SPEED)} step="0.05" value={Math.log10(speed)} onChange={event => changeSpeed(10 ** Number(event.target.value))} />
        <div className="exploration-presets">{[[1, 'Precise'], [100, 'Orbit'], [AU, 'System'], [LIGHT_YEAR * 0.05, 'Interstellar']].map(([value, label]) => <button key={label} type="button" onClick={() => changeSpeed(value)}>{label}</button>)}</div>
        <p className="exploration-help">Mouse to look · wheel to adjust speed · Shift ×20<br />Space / Ctrl rise / descend · F targets your view<br />Automatic braking near surfaces. Travel acceleration permits faster-than-light exploration.</p>
        <label htmlFor="flight-layout">Keyboard layout</label>
        <select id="flight-layout" value={layout} onChange={e => setLayout(e.target.value)}><option value="wasd">WASD · QWERTY</option><option value="azerty">ZQSD · AZERTY</option></select>
        <div className="exploration-target-actions">
          <button type="button" disabled={!hud?.target || !!error} onClick={() => explorerRef.current?.approach()}>Approach target</button>
          <button type="button" disabled={!hud?.approaching} onClick={() => explorerRef.current?.flight.clear()}>Stop</button>
        </div>
        <p className="exploration-help">Approach slows to an orbital viewing distance. Movement or mouse look cancels it; Esc pauses flight.</p>
        <div className="exploration-catalogue">
          <h2>Nearby systems</h2>
          {hud?.systems.map(system => <section key={system.id}>
            <button type="button" className={hud.target?.id === system.star.id ? 'selected' : ''} onClick={() => select(system.star)}>
              <span>☀ {system.star.name}</span><small>{formatDistance(length(relative(system.star.position, hud.position)))}</small>
            </button>
            <small className="exploration-system-type">{system.star.preset} · {system.bodies.length - 1} planets</small>
            {system.bodies.slice(1).map(body => <button key={body.id} type="button" className={hud.target?.id === body.id ? 'selected' : ''} onClick={() => select(body)}>
              <span>{body.name.split(' · ')[1]} · {body.preset}</span><small>{formatDistance(length(relative(body.position, hud.position)))}</small>
            </button>)}
          </section>)}
        </div>
      </aside>}
    </div>
  </main>;
}
