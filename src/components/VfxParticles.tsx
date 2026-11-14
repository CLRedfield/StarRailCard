import type { CSSProperties } from 'react';
import './VfxParticles.css';

export type VfxPreset =
  | 'slash-gold'
  | 'heavy-crimson'
  | 'counter-violet'
  | 'shield-cyan'
  | 'poison-emerald'
  | 'thorns-rose'
  | 'heal-aurora'
  | 'prism-rainbow'
  | 'instant-quantum';

interface Props {
  preset: VfxPreset;
  count?: number;
  spread?: number;
  angleOffset?: number;
  x?: number;
  y?: number;
  reducedMotion?: boolean;
  className?: string;
}

const PALETTES: Record<VfxPreset, string[]> = {
  'slash-gold': ['#fff7c7', '#89ecff', '#ffd666', '#ffffff'],
  'heavy-crimson': ['#ffe38f', '#ff6c85', '#fff4d6', '#ffb454'],
  'counter-violet': ['#d8b8ff', '#8bf0ff', '#ffe28a', '#f6dcff'],
  'shield-cyan': ['#bff7ff', '#71d9ff', '#ffeaa8', '#ffffff'],
  'poison-emerald': ['#c2ff9e', '#86e270', '#c78cff', '#e7ffcf'],
  'thorns-rose': ['#ffb4f0', '#e377d8', '#ffd99c', '#fff0ff'],
  'heal-aurora': ['#9ef7d4', '#fff0a8', '#75e6e0', '#e9fff6'],
  'prism-rainbow': ['#8ceeff', '#ffd978', '#e29eff', '#ff9ec4', '#9cffc8'],
  'instant-quantum': ['#cba7ff', '#8be8ff', '#fff0b3', '#ffffff'],
};

const SHAPES: Record<VfxPreset, readonly ('star' | 'streak' | 'orb' | 'shard')[]> = {
  'slash-gold': ['streak', 'star', 'orb', 'streak'],
  'heavy-crimson': ['streak', 'star', 'shard', 'streak'],
  'counter-violet': ['shard', 'star', 'streak', 'orb'],
  'shield-cyan': ['shard', 'orb', 'streak', 'shard'],
  'poison-emerald': ['orb', 'orb', 'star', 'orb'],
  'thorns-rose': ['shard', 'streak', 'star', 'shard'],
  'heal-aurora': ['star', 'orb', 'star', 'orb'],
  'prism-rainbow': ['star', 'orb', 'shard', 'star'],
  'instant-quantum': ['star', 'streak', 'shard', 'orb'],
};

function pseudoFraction(seed: number): number {
  const raw = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return raw - Math.floor(raw);
}

/** Deterministic GPU-composited particle burst (never consumes gameplay RNG). */
export default function VfxParticles({
  preset,
  count = 14,
  spread = 86,
  angleOffset = 0,
  x = 50,
  y = 50,
  reducedMotion = false,
  className = '',
}: Props) {
  if (reducedMotion || count <= 0) return null;
  const palette = PALETTES[preset];
  const shapes = SHAPES[preset];
  const upwardBias = preset === 'poison-emerald' || preset === 'heal-aurora';
  const ringSweep = preset === 'slash-gold' || preset === 'heavy-crimson' || preset === 'counter-violet';

  return (
    <div
      className={`vfx-particle-burst vfx-${preset} ${className}`}
      style={{ left: `${x}%`, top: `${y}%` }}
      aria-hidden="true"
    >
      <i className="vfx-shockwave" />
      {Array.from({ length: count }, (_, i) => {
        const f1 = pseudoFraction(i + 1 + count * 3);
        const f2 = pseudoFraction(i * 7 + 19);
        const golden = ((i + 0.5) / count) * Math.PI * 2 + angleOffset + (f1 - 0.5) * 0.45;
        const dist = spread * (0.48 + f2 * 0.72);
        const tx = Math.cos(golden) * dist;
        const ty = Math.sin(golden) * (upwardBias ? dist * 0.65 : dist * (ringSweep ? 0.85 : 0.95)) - (upwardBias ? 22 + f1 * 34 : 0);
        const deg = Math.round((golden * 180) / Math.PI);
        const shape = shapes[i % shapes.length];
        const color = palette[i % palette.length];
        const scale = +(0.68 + f1 * 0.72).toFixed(2);
        const delay = Math.round((i % 5) * 18 + f2 * 35);
        const dur = Math.round(420 + f1 * 240);
        return (
          <i
            key={i}
            className={`vfx-particle shape-${shape}`}
            style={
              {
                '--tx': `${tx.toFixed(1)}px`,
                '--ty': `${ty.toFixed(1)}px`,
                '--rot': `${deg}deg`,
                '--scale': scale,
                '--delay': `${delay}ms`,
                '--dur': `${dur}ms`,
                '--color': color,
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
