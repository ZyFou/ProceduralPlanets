import { translateExternalMessage } from '../i18n/externalMessages.js';
import LanguageSwitcher from '../i18n/LanguageSwitcher.jsx';
import { translate, getIntlLocale } from '../i18n/locale.js';
import { useLocale } from '../i18n/useLocale.js';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, Crosshair, Download, Navigation, Orbit, Settings2, X } from 'lucide-react';
import { Explorer } from './Explorer.js';
import SurfaceWalkControls from '../components/SurfaceWalkControls.jsx';
import { AU, LIGHT_YEAR, MIN_SPEED, formatDistance as distance, formatSpeed as speedText, length, relative } from './world.js';
import { clampSpeed } from './flight.js';
import { DEFAULT_SETTINGS, QUALITY_PRESETS, normalizeSettings, readSettings, writeSettings } from './settings.js';
import './exploration.css';

export default function Exploration({ onExit }) {
  useLocale();
  const formatDistance = km => distance(km, getIntlLocale());
  const formatSpeed = km => speedText(km, getIntlLocale());
  const canvasRef = useRef(null), explorerRef = useRef(null);
  const [seed, setSeed] = useState('42'), [seedInput, setSeedInput] = useState('42');
  const [hud, setHud] = useState(null), [speed, setSpeed] = useState(100), [locked, setLocked] = useState(false);
  const [speedDraft, setSpeedDraft] = useState('100');
  const [settings, setSettings] = useState(() => { try { return readSettings(window.localStorage); } catch { return { ...DEFAULT_SETTINGS }; } });
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const [error, setError] = useState(''), [panel, setPanel] = useState('flight');
  const [photo, setPhoto] = useState(false), [hideUI, setHideUI] = useState(false), [photoScale, setPhotoScale] = useState(1);
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    setHud(null); setError(''); setSpeed(100); setSpeedDraft('100'); setLocked(false); setPhoto(false); setHideUI(false);
    let explorer;
    try {
      explorer = new Explorer(canvasRef.current, seed, { onHud: setHud, onLock: setLocked, onSpeed: value => { setSpeed(value); setSpeedDraft(String(value)); }, onError: setError }, settingsRef.current);
      explorerRef.current = explorer;
      if (import.meta.env.DEV) window.planetExplorer = explorer;
    } catch (e) { setError(e.message || translate('WebGL2 is required to explore.')); }
    return () => {
      explorer?.dispose(); explorerRef.current = null;
      if (import.meta.env.DEV && window.planetExplorer === explorer) delete window.planetExplorer;
    };
  }, [seed]);
  useEffect(() => {
    explorerRef.current?.setSettings(settings);
    try {
      if (!writeSettings(window.localStorage, settings)) setNotice(translate('Settings apply for this session; local storage is unavailable.'));
    } catch { setNotice(translate('Settings apply for this session; local storage is unavailable.')); }
  }, [settings]);
  const update = patch => setSettings(value => normalizeSettings({ ...value, ...patch }));
  const changeSpeed = value => {
    const next = clampSpeed(value); setSpeed(next); setSpeedDraft(String(next));
    if (explorerRef.current) explorerRef.current.flight.speed = next;
  };
  const togglePhoto = enabled => {
    setPhoto(enabled); setHideUI(false); setNotice(''); explorerRef.current?.setPhoto(enabled);
    if (enabled) setPanel(null);
  };
  useEffect(() => {
    const key = event => {
      if (photo && event.code === 'Escape') { togglePhoto(false); return; }
      if (event.target.closest?.('input,select,textarea') || event.ctrlKey || event.metaKey || event.repeat) return;
      if (event.code === 'KeyP') { event.preventDefault(); togglePhoto(!photo); }
      if (photo && event.code === 'KeyH') { event.preventDefault(); setHideUI(value => !value); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [photo]);
  const savePhoto = async () => {
    setSaving(true); setNotice('');
    try {
      const image = await explorerRef.current?.takePhoto(photoScale);
      if (image) {
        const url = URL.createObjectURL(image.blob), link = document.createElement('a');
        link.href = url; link.download = `Explore-${(hud?.target?.name || 'space').replace(/[^a-z0-9-]/gi, '-')}-${Date.now()}.png`;
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
        setNotice(translate("Saved PNG · {0} × {1}", { 0: image.width, 1: image.height }));
      }
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  const loading = !hud || hud.queued > 0 || hud.pending > 0;
  const select = body => explorerRef.current?.select(body);
  const capture = () => canvasRef.current?.click();
  const sliderMax = Math.min(Math.log10(Number.MAX_VALUE), Math.max(15, Math.ceil(Math.log10(speed)) + 1));
  return <main className={`exploration${locked ? ' exploration-locked' : ''}${photo ? ' exploration-photo' : ''}${hideUI ? ' exploration-hide-ui' : ''}`} aria-label={translate("Infinite world exploration")}>
    <header className="exploration-header">
      <button type="button" onClick={onExit}><ArrowLeft size={16} /> {translate("Return to studio")}</button>
      <strong><Orbit size={18} /> {translate("Explore")} <span>{translate("Real scale · endless discoveries")}</span></strong>
      <nav aria-label={translate("Explore tools")}>
        <LanguageSwitcher />
        <button type="button" aria-pressed={photo} onClick={() => togglePhoto(!photo)}><Camera size={16} /> {photo ? translate('Exit photo') : translate('Photo')}</button>
        <button type="button" aria-expanded={panel === 'destinations'} onClick={() => setPanel(value => value === 'destinations' ? null : 'destinations')}><Navigation size={16} /> {translate("Navigation")}</button>
        <button type="button" aria-expanded={panel === 'settings'} onClick={() => setPanel(value => value === 'settings' ? null : 'settings')} aria-label={translate("Render settings")}><Settings2 size={16} /></button>
      </nav>
    </header>
    <div className="exploration-view">
      <canvas key={seed} ref={canvasRef} aria-label={translate("Free flight view. Click to capture the mouse. Double-click a planet to teleport.")} />
      {!photo && <SurfaceWalkControls getWalker={() => explorerRef.current?.walker} onToggle={() => { const ok = explorerRef.current?.toggleWalk(); if (ok) setPanel(null); return ok; }} />}
      {!photo && <>
        <div className="exploration-reticle" aria-hidden>+</div>
        {settings.showTargetMarker && hud?.marker && <div className="exploration-marker" style={{ left: `${hud.marker.x}%`, top: `${hud.marker.y}%` }}><Crosshair size={22} /><span>{translate(hud.target.name)}</span></div>}
        <section className="exploration-telemetry" aria-label={translate("Flight instruments")}>
          <span className="exploration-eyebrow">{translate(hud?.walking ? "SURFACE WALK" : "FREE FLIGHT")}</span><strong>{formatSpeed(hud?.speed ?? 0)}</strong>
          <span>{translate("Selected")} {formatSpeed(speed)} {hud?.limited && translate('· proximity brake')} {hud?.blocked && translate('· obstacle')} {hud?.coordinateLimited && translate('· coordinate boundary')}</span>
          {hud?.target && <p>{translate(hud.target.name)}<br /><b>{formatDistance(hud.distance)}</b> {translate("to surface")}{hud.approaching && ` ${translate('· approaching')}`}</p>}
          <small>{loading ? translate('Preparing nearby worlds…') : translate('Ready to explore')} {translate("· P photo")}</small>
        </section>
      </>}
      {!locked && !error && !photo && !hud?.walking && <button className="exploration-fly" type="button" onClick={capture}><Navigation size={16} /> {translate("Click to fly")} <span>{translate("Esc releases the mouse")}</span></button>}
      {error && <div className="exploration-error" role="alert">{translateExternalMessage(error)}<button type="button" onClick={() => setError('')} aria-label={translate("Dismiss error")}><X size={16} /></button></div>}
      {photo && <section className="exploration-photo-bar" aria-label={translate("Photo controls")}>
        <span><Camera size={16} /> {translate("Photo")} <small>{translate("Time frozen · click view to reframe · H hides controls · Esc exits")}</small></span>
        <label>{translate("Field of view")}<input aria-label={translate("Photo field of view")} type="range" min="30" max="110" value={settings.fov} onChange={e => update({ fov: Number(e.target.value) })} /><b>{settings.fov}°</b></label>
        <label>{translate("Exposure")}<input aria-label={translate("Photo exposure")} type="range" min="0.25" max="4" step="0.05" value={settings.exposure} onChange={e => update({ exposure: Number(e.target.value) })} /><b>{settings.exposure.toFixed(2)}</b></label>
        <label>{translate("Size")}<select aria-label={translate("Photo size")} value={photoScale} onChange={e => setPhotoScale(Number(e.target.value))}><option value="1">{translate("Current render")}</option><option value="2">{translate("2× · up to 4096 × 2160")}</option></select></label>
        <div className="exploration-row"><button type="button" onClick={() => setHideUI(true)}>{translate("Hide controls (H)")}</button><button type="button" disabled={saving || loading || !!error} onClick={savePhoto}><Download size={16} /> {saving ? translate('Saving…') : translate('Save PNG')}</button></div>
        {notice && <small role="status">{notice}</small>}
      </section>}
      {panel && <aside className="exploration-panel" aria-label={translate("Exploration navigation")}>
        <div className="exploration-panel-heading"><h2>{panel === 'settings' ? translate('Render settings') : panel === 'destinations' ? translate('Destinations') : translate('Flight')}</h2><button type="button" onClick={() => setPanel(null)} aria-label={translate("Close panel")}><X size={16} /></button></div>
        <div className="exploration-tabs" role="group" aria-label={translate("Explore panel")}><button type="button" aria-pressed={panel === 'flight'} onClick={() => setPanel('flight')}>{translate("Flight")}</button><button type="button" aria-pressed={panel === 'destinations'} onClick={() => setPanel('destinations')}>{translate("Destinations")}</button><button type="button" aria-pressed={panel === 'settings'} onClick={() => setPanel('settings')}>{translate("Settings")}</button></div>
        {panel === 'flight' && <>
          <label htmlFor="flight-speed">{translate("Travel speed")} <b>{formatSpeed(speed)}</b></label>
          <input id="flight-speed" type="range" min={Math.log10(MIN_SPEED)} max={sliderMax} step="0.05" value={Math.log10(speed)} onChange={e => changeSpeed(10 ** Number(e.target.value))} />
          <label htmlFor="flight-speed-value">{translate("Speed in km/s · scientific notation accepted")}</label><input id="flight-speed-value" type="text" inputMode="decimal" value={speedDraft} onBlur={() => setSpeedDraft(String(speed))} onChange={e => {
            const value = e.target.value; setSpeedDraft(value);
            if (value.trim() && !Number.isNaN(Number(value)) && Number(value) > 0) {
              const next = clampSpeed(Number(value)); setSpeed(next);
              if (explorerRef.current) explorerRef.current.flight.speed = next;
            }
          }} />
          <div className="exploration-presets">{[[1, translate('Precise')], [100, translate('Orbit')], [AU, translate('System')], [LIGHT_YEAR * .05, translate('Interstellar')]].map(([value, label]) => <button key={label} type="button" onClick={() => changeSpeed(value)}>{translate(label)}</button>)}</div>
          <p className="exploration-help">{translate("Mouse to look · wheel changes speed · Shift ×20 and bypasses braking")}<br />{translate("Space / Ctrl rise / descend · F targets your view")}<br />{translate("Double-click a planet to teleport to orbit.")}<br />{translate("Automatic braking within 100 radii of a body unless Shift is held. Travel may exceed light speed; the numeric coordinate boundary is shown if reached.")}</p>
          <label htmlFor="flight-layout">{translate("Keyboard layout")}</label><select id="flight-layout" value={settings.layout} onChange={e => update({ layout: e.target.value })}><option value="wasd">{translate("WASD · QWERTY")}</option><option value="azerty">{translate("ZQSD · AZERTY")}</option></select>
          <div className="exploration-target-actions"><button type="button" disabled={!hud?.target || !!error} onClick={() => explorerRef.current?.approach()}>{translate("Approach target")}</button><button type="button" disabled={!hud?.approaching} onClick={() => explorerRef.current?.flight.clear()}>{translate("Stop")}</button></div>
          <p className="exploration-help">{translate("Approach slows to an orbital viewing distance. Movement or mouse look cancels it; Esc pauses flight.")}</p>
        </>}
        {panel === 'destinations' && <>
          <p className="exploration-help">{translate("Click a destination to aim at it. Double-click to teleport to orbit.")}</p>
          <button type="button" onClick={() => explorerRef.current?.visitSolarSystem()}><Orbit size={16} /> {translate("Return to Solar System")}</button>
          <p className="exploration-help">{translate("Sun, eight planets, Pluto and 24 selected moons. True radii and orbital scale; static approximations and procedural surfaces.")} <a href="https://github.com/ZyFou/ProceduralPlanets/blob/feat/infinite-exploration/docs/solar-system.md" target="_blank" rel="noreferrer">{translate("Sources & limits")}</a></p>
          <form onSubmit={event => { event.preventDefault(); const value = seedInput.trim(); if (value) { explorerRef.current?.flight.clear(); setSeed(value); } }}><label htmlFor="exploration-seed">{translate("Procedural universe seed")}</label><div className="exploration-row"><input id="exploration-seed" value={seedInput} maxLength={64} onChange={e => setSeedInput(e.target.value)} /><button type="submit">{translate("Generate")}</button></div></form>
          <label htmlFor="exploration-search">{translate("Find a nearby body")}</label><input id="exploration-search" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={translate("Earth, Titan, a distant sun…")} />
          <div className="exploration-catalogue">{hud?.systems.map(system => <section key={system.id}>
            <button type="button" className={hud.target?.id === system.star.id ? 'selected' : ''} onClick={() => select(system.star)} onDoubleClick={() => explorerRef.current?.teleport(system.star)}><span>☀ {translate(system.star.name)}</span><small>{formatDistance(length(relative(system.star.position, hud.position)))}</small></button>
            <small className="exploration-system-type">{system.id === 'sol' ? translate('Solar System · mean orbital scale') : translate("{0} · {1} planets", { 0: translate(system.star.preset), 1: system.bodies.length - 1 })}</small>
            {system.bodies.slice(1).filter(body => `${body.name} ${translate(body.name)}`.toLowerCase().includes(search.toLowerCase())).map(body => <button key={body.id} type="button" className={`${hud.target?.id === body.id ? 'selected' : ''}${body.parentId ? ' exploration-moon' : ''}`} onClick={() => select(body)} onDoubleClick={() => explorerRef.current?.teleport(body)}><span>{translate(body.name)}{body.parentId && <small> {translate("· moon")}</small>}</span><small>{formatDistance(length(relative(body.position, hud.position)))}</small></button>)}
          </section>)}</div>
        </>}
        {panel === 'settings' && <>
          <p className="exploration-help">{translate("Saved on this device and applied to loaded and future worlds.")}</p>
          <div className="exploration-presets">{Object.entries(QUALITY_PRESETS).map(([name, patch]) => <button key={name} type="button" onClick={() => update(patch)}>{translate(name[0].toUpperCase() + name.slice(1))}</button>)}<button type="button" onClick={() => setSettings({ ...DEFAULT_SETTINGS })}>{translate("Reset")}</button></div>
          {[['renderScale', translate('Render scale'), .5, 2, .25], ['maxDepth', translate('Terrain detail'), 6, 11, 1], ['cloudSteps', translate('Cloud samples'), 8, 96, 8], ['cloudResolution', translate('Cloud resolution'), .25, 1, .25], ['cloudDetailScale', translate('Billow size'), .3, 3, .05], ['fov', translate('Field of view'), 30, 110, 1], ['exposure', translate('Exposure'), .25, 4, .05]].map(([key, label, min, max, step]) => <div className="exploration-setting" key={key}><label htmlFor={`exploration-${key}`}>{translate(label)}<b>{settings[key]}</b></label><input id={`exploration-${key}`} type="range" min={min} max={max} step={step} value={settings[key]} onChange={e => update({ [key]: Number(e.target.value) })} /></div>)}
          {['clouds', 'atmosphere', 'bloom'].map(key => <label className="exploration-toggle" key={key}><input type="checkbox" checked={settings[key]} onChange={e => update({ [key]: e.target.checked })} />{translate(key[0].toUpperCase() + key.slice(1))}</label>)}
          <label className="exploration-toggle"><input type="checkbox" checked={settings.showTargetMarker} onChange={e => update({ showTargetMarker: e.target.checked })} />{translate("Show target marker")}</label>
          <small className="exploration-help">{hud?.loaded ?? 0} {translate("loaded bodies ·")} {hud?.systems.length ?? 0} {translate("systems ·")} {hud?.queued ?? 0} {translate("waiting")}<br />{translate("Sector")} {hud ? Object.values(hud.position.sector).join(' / ') : '0 / 0 / 0'}<br />{translate("Higher settings use more GPU memory and time. Planet-specific atmosphere and cloud limits still apply.")}</small>
          {notice && <small role="status">{notice}</small>}
        </>}
      </aside>}
    </div>
  </main>;
}
