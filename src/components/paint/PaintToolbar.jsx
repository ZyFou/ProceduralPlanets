import { Mountain, Waves, Minus, Palette, Eraser, SlidersHorizontal } from 'lucide-react';

export const PAINT_TOOLS = [
  { id: 'sculpt', label: 'Sculpt', icon: Mountain, description: 'Raise or lower the surface along its spherical normal.' },
  { id: 'smooth', label: 'Smooth', icon: Waves, description: 'Blend final elevations toward neighboring terrain.' },
  { id: 'flatten', label: 'Flatten', icon: Minus, description: 'Blend toward a target elevation above the planet radius.' },
  { id: 'material', label: 'Material', icon: Palette, description: 'Blend surface influences using the planet’s existing colors.' },
  { id: 'erase', label: 'Erase', icon: Eraser, description: 'Restore the procedural or node terrain beneath the paint.' },
  { id: 'brush', label: 'Brush', icon: SlidersHorizontal, description: 'Shape and application settings shared by every tool.' },
];

export default function PaintToolbar({ activeTool, onSelect }) {
  return <nav className="paint-toolbar left-toolbar" aria-label="Paint Tools">
    {PAINT_TOOLS.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={`toolbar-btn${activeTool === id ? ' active' : ''}`} title={label} aria-label={label} aria-pressed={activeTool === id} onClick={() => onSelect(id)}>
      <Icon size={19} strokeWidth={1.75} aria-hidden /><span className="toolbar-btn-label">{label}</span>
    </button>)}
  </nav>;
}
