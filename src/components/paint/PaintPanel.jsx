import { translate } from '../../i18n/locale.js';
import { useLocale } from '../../i18n/useLocale.js';
import { X, Pipette, Trash2 } from 'lucide-react';
import { Slider, SelectRow, Section } from '../controls.jsx';
import { PAINT_TOOLS } from './PaintToolbar.jsx';

const options = (values) => values.map(([value, label]) => ({ value, label }));
const SHAPES = options([['round', 'Round'], ['ellipse', 'Ellipse'], ['organic', 'Organic'], ['scatter', 'Scatter'], ['ribbon', 'Ribbon']]);
const MATERIALS = options([['coast', 'Coast / seabed'], ['sand', 'Sand / desert'], ['vegetation', 'Grass / vegetation'], ['rock', 'Rock'], ['snow', 'Snow / ice']]);

export default function PaintPanel({ activeTool, state, radius, resolution, onSetting, onExit, onClear }) {
  useLocale();
  const meta = PAINT_TOOLS.find((t) => t.id === activeTool) ?? PAINT_TOOLS[0];
  const set = (key) => (value) => onSetting({ [key]: value });
  const strength = <Slider label={translate("Strength")} value={state.strength} min={0.01} max={1} onChange={set('strength')} />;
  return <aside className="paint-panel side-drawer open" aria-label={translate("Paint settings")}>
    <div className="side-panel">
      <div className="side-panel-header">
        <div className="side-panel-heading"><div className="paint-mode-label">{translate("Paint Mode")}</div><div className="side-panel-title">{translate(meta.label)}</div><div className="side-panel-desc">{translate(meta.description)}</div></div>
        <button type="button" className="side-panel-close" onClick={onExit} aria-label={translate("Exit Paint Mode")} title={translate("Exit Paint Mode (Esc)")}><X size={15} /></button>
      </div>
      <div className="side-panel-content">
        {activeTool !== 'brush' && <Section title={translate(meta.label)}>
          {activeTool === 'sculpt' && <SelectRow label={translate("Direction")} value={state.tool === 'lower' ? 'lower' : 'raise'} options={options([['raise', translate('Raise')], ['lower', translate('Lower')]])} onChange={set('tool')} />}
          {activeTool === 'flatten' && <>
            <Slider label={translate("Target elevation")} value={state.targetElevation} min={-radius * 0.25} max={radius * 0.45} step={1} digits={1} onChange={set('targetElevation')} />
            <button type="button" className={`paint-action${state.pickHeight ? ' active' : ''}`} onClick={() => onSetting({ pickHeight: !state.pickHeight })}><Pipette size={14} />{state.pickHeight ? translate('Click the surface to pick') : translate('Pick current height')}</button>
          </>}
          {activeTool === 'material' && <SelectRow label={translate("Material")} value={state.material} options={MATERIALS} onChange={set('material')} />}
          {strength}
        </Section>}
        <Section title={translate("Brush settings")}>
          <Slider label={translate("Brush size")} value={state.brushSize} min={radius * 4 / resolution} max={radius * 0.45} step={1} digits={0} onChange={set('brushSize')} title={translate("Geodesic brush radius, in planet-local units")} />
          {activeTool === 'brush' && strength}
          <SelectRow label={translate("Shape")} value={state.brushShape} options={SHAPES} onChange={set('brushShape')} />
          <Slider label={translate("Falloff")} value={state.falloff} min={0} max={1} onChange={set('falloff')} />
          <Slider label={translate("Stroke spacing")} value={state.brushSpacing} min={0.08} max={1} onChange={set('brushSpacing')} />
          {['ellipse', 'ribbon'].includes(state.brushShape) && <Slider label={translate("Brush rotation")} value={state.brushRotation} min={-180} max={180} step={1} digits={0} onChange={set('brushRotation')} />}
          {state.brushShape === 'scatter' && <Slider label={translate("Scatter amount")} value={state.brushScatter} min={0.05} max={0.75} onChange={set('brushScatter')} />}
        </Section>
        {activeTool === 'erase' && <Section title={translate("Reset paint")}><p className="paint-note">{translate("Clear height and material paint. Your terrain, graph, seed, atmosphere and water settings stay intact.")}</p><button type="button" className="paint-action danger" onClick={onClear}><Trash2 size={14} />{translate("Clear Painted Layers")}</button></Section>}
        <div className="paint-help"><span>{translate("Left drag")} <b>{translate("Paint")}</b></span><span>{translate("Right drag")} <b>{translate("Orbit")}</b></span><span>{translate("Wheel")} <b>{translate("Zoom")}</b></span><span>{translate("Shift + wheel")} <b>{translate("Brush size")}</b></span><span>Ctrl / ⌘ + Z <b>{translate("Undo stroke")}</b></span><span>Ctrl / ⌘ + {translate("Shift")} + Z <b>{translate("Redo stroke")}</b></span><span>{translate("Esc")} <b>{translate("Exit Paint Mode")}</b></span></div>
      </div>
    </div>
  </aside>;
}
