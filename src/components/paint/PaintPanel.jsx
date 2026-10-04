import { X, Pipette, Trash2 } from 'lucide-react';
import { Slider, SelectRow, Section } from '../controls.jsx';
import { PAINT_TOOLS } from './PaintToolbar.jsx';

const options = (values) => values.map(([value, label]) => ({ value, label }));
const SHAPES = options([['round', 'Round'], ['ellipse', 'Ellipse'], ['organic', 'Organic'], ['scatter', 'Scatter'], ['ribbon', 'Ribbon']]);
const MATERIALS = options([['coast', 'Coast / seabed'], ['sand', 'Sand / desert'], ['vegetation', 'Grass / vegetation'], ['rock', 'Rock'], ['snow', 'Snow / ice']]);

export default function PaintPanel({ activeTool, state, radius, resolution, onSetting, onExit, onClear }) {
  const meta = PAINT_TOOLS.find((t) => t.id === activeTool) ?? PAINT_TOOLS[0];
  const set = (key) => (value) => onSetting({ [key]: value });
  const strength = <Slider label="Strength" value={state.strength} min={0.01} max={1} onChange={set('strength')} />;
  return <aside className="paint-panel side-drawer open" aria-label="Paint settings">
    <div className="side-panel">
      <div className="side-panel-header">
        <div className="side-panel-heading"><div className="paint-mode-label">Paint Mode</div><div className="side-panel-title">{meta.label}</div><div className="side-panel-desc">{meta.description}</div></div>
        <button type="button" className="side-panel-close" onClick={onExit} aria-label="Exit Paint Mode" title="Exit Paint Mode (Esc)"><X size={15} /></button>
      </div>
      <div className="side-panel-content">
        {activeTool !== 'brush' && <Section title={meta.label}>
          {activeTool === 'sculpt' && <SelectRow label="Direction" value={state.tool === 'lower' ? 'lower' : 'raise'} options={options([['raise', 'Raise'], ['lower', 'Lower']])} onChange={set('tool')} />}
          {activeTool === 'flatten' && <>
            <Slider label="Target elevation" value={state.targetElevation} min={-radius * 0.25} max={radius * 0.45} step={1} digits={1} onChange={set('targetElevation')} />
            <button type="button" className={`paint-action${state.pickHeight ? ' active' : ''}`} onClick={() => onSetting({ pickHeight: !state.pickHeight })}><Pipette size={14} />{state.pickHeight ? 'Click the surface to pick' : 'Pick current height'}</button>
          </>}
          {activeTool === 'material' && <SelectRow label="Material" value={state.material} options={MATERIALS} onChange={set('material')} />}
          {strength}
        </Section>}
        <Section title="Brush settings">
          <Slider label="Brush size" value={state.brushSize} min={radius * 4 / resolution} max={radius * 0.45} step={1} digits={0} onChange={set('brushSize')} title="Geodesic brush radius, in planet-local units" />
          {activeTool === 'brush' && strength}
          <SelectRow label="Shape" value={state.brushShape} options={SHAPES} onChange={set('brushShape')} />
          <Slider label="Falloff" value={state.falloff} min={0} max={1} onChange={set('falloff')} />
          <Slider label="Stroke spacing" value={state.brushSpacing} min={0.08} max={1} onChange={set('brushSpacing')} />
          {['ellipse', 'ribbon'].includes(state.brushShape) && <Slider label="Brush rotation" value={state.brushRotation} min={-180} max={180} step={1} digits={0} onChange={set('brushRotation')} />}
          {state.brushShape === 'scatter' && <Slider label="Scatter amount" value={state.brushScatter} min={0.05} max={0.75} onChange={set('brushScatter')} />}
        </Section>
        {activeTool === 'erase' && <Section title="Reset paint"><p className="paint-note">Clear height and material paint. Your terrain, graph, seed, atmosphere and water settings stay intact.</p><button type="button" className="paint-action danger" onClick={onClear}><Trash2 size={14} />Clear Painted Layers</button></Section>}
        <div className="paint-help"><span>Left drag <b>Paint</b></span><span>Right drag <b>Orbit</b></span><span>Wheel <b>Zoom</b></span><span>Shift + wheel <b>Brush size</b></span><span>Ctrl / ⌘ + Z <b>Undo stroke</b></span><span>Ctrl / ⌘ + Shift + Z <b>Redo stroke</b></span><span>Esc <b>Exit Paint Mode</b></span></div>
      </div>
    </div>
  </aside>;
}
