'use client';
import { Monitor, Smartphone } from 'lucide-react';

type Orientation = 'horizontal' | 'vertical';

type Props = {
  orientation: Orientation;
  onChange: (o: Orientation) => void;
};

export default function OrientationToggle({ orientation, onChange }: Props) {
  return (
    <div className="flex justify-center mt-6">
      <div className="inline-flex items-center gap-2 bg-slate-800/60 backdrop-blur-sm border border-slate-600/40 rounded-2xl p-2">
        <button
          onClick={() => onChange('horizontal')}
          className={`flex items-center gap-3 px-6 py-3 rounded-xl font-medium transition-all duration-200 ${
            orientation === 'horizontal'
              ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-600/25 scale-105'
              : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
          }`}
        >
          <Monitor size={18} />
          <div className="text-left">
            <div className="text-sm font-semibold">Horizontal</div>
            <div className="text-xs opacity-70">2400×1350px</div>
          </div>
        </button>
        <button
          onClick={() => onChange('vertical')}
          className={`flex items-center gap-3 px-6 py-3 rounded-xl font-medium transition-all duration-200 ${
            orientation === 'vertical'
              ? 'bg-gradient-to-r from-purple-600 to-purple-700 text-white shadow-lg shadow-purple-600/25 scale-105'
              : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
          }`}
        >
          <Smartphone size={18} />
          <div className="text-left">
            <div className="text-sm font-semibold">Vertical</div>
            <div className="text-xs opacity-70">1350×2400px</div>
          </div>
        </button>
      </div>
    </div>
  );
}
