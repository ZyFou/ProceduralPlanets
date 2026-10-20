import { translate } from '../i18n/locale.js';
import { useLocale } from '../i18n/useLocale.js';
import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, RotateCcw } from 'lucide-react';
import { PlanetViewer } from '../engine/PlanetViewer.js';

// ============================================================================
// A live PlanetViewer inside a docs page. The viewer is only created once the
// frame scrolls into view and stops rendering while it is off screen, so a
// page never pays for a planet nobody looks at. `planet` is the Planet
// constructor options: a new type / preset swaps the planet, anything the
// parent does through onViewer (planet.set) is applied in place.
// ============================================================================

export default function LivePlanet({ planet, onViewer, className = '', label }) {
  useLocale();
  const hostRef = useRef(null);
  const viewerRef = useRef(null);
  const planetRef = useRef(planet);
  const onViewerRef = useRef(onViewer);
  const [status, setStatus] = useState('idle');   // idle | loading | ready | error
  planetRef.current = planet;
  onViewerRef.current = onViewer;
  const planetKey = JSON.stringify(planet);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let visible = false;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !viewerRef.current) {
        setStatus('loading');
        try {
          const viewer = new PlanetViewer({ container: host, planet: planetRef.current, pixelRatio: 1.5 });
          viewerRef.current = viewer;
          onViewerRef.current?.(viewer);
          viewer.prepare()
            .then(() => { if (viewerRef.current === viewer) setStatus('ready'); })
            .catch(() => { if (viewerRef.current === viewer) setStatus('error'); });
        } catch {
          setStatus('error');
        }
        return;
      }
      const viewer = viewerRef.current;
      if (!viewer) return;
      if (visible) viewer.start();
      else viewer.stop();
    }, { threshold: 0.05 });
    observer.observe(host);
    return () => {
      observer.disconnect();
      const viewer = viewerRef.current;
      viewerRef.current = null;
      onViewerRef.current?.(null);
      viewer?.dispose();
      host.querySelector('canvas')?.remove();
    };
  }, []);

  // a different body: swap the planet, keep the renderer and its programs
  const firstKey = useRef(planetKey);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || planetKey === firstKey.current) return;
    firstKey.current = planetKey;
    setStatus('loading');
    viewer.setPlanet(planetRef.current);
    onViewerRef.current?.(viewer);
    viewer.prepare()
      .then(() => { if (viewerRef.current === viewer) setStatus('ready'); })
      .catch(() => { if (viewerRef.current === viewer) setStatus('error'); });
  }, [planetKey]);

  return (
    <div className={`docs-live ${className}`} aria-label={label ?? translate('Live planet preview')} role="img">
      <div ref={hostRef} className="docs-live-canvas" />
      {status === 'loading' && (
        <div className="docs-live-status"><LoaderCircle size={15} className="docs-spin" aria-hidden /> {translate('Compiling shaders…')}</div>
      )}
      {status === 'error' && (
        <div className="docs-live-status error">{translate('This preview needs WebGL2.')}</div>
      )}
      {status === 'ready' && (
        <button type="button" className="docs-live-reset" onClick={() => viewerRef.current?.frame()} title={translate('Reset camera')} aria-label={translate('Reset camera')}>
          <RotateCcw size={13} aria-hidden />
        </button>
      )}
    </div>
  );
}
