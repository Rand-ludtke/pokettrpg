import React from 'react';
import { withPublicBase } from '../utils/publicBase';

const CUSTOM_TYPES = new Set([
  'crystal', 'cosmic', 'nuclear', 'stellar', 'sound', 'light', 'shadow',
  '???',
]);

const TYPE_COLORS: Record<string, string> = {
  normal: '#A8A878', fire: '#F08030', water: '#6890F0', electric: '#F8D030',
  grass: '#78C850', ice: '#98D8D8', fighting: '#C03028', poison: '#A040A0',
  ground: '#E0C068', flying: '#A890F0', psychic: '#F85888', bug: '#A8B820',
  rock: '#B8A038', ghost: '#705898', dragon: '#7038F8', dark: '#705848',
  steel: '#B8B8D0', fairy: '#EE99AC',
  crystal: '#A8D8EA', cosmic: '#6B2FA0', nuclear: '#92D050', stellar: '#44698F',
  sound: '#FF66AA', light: '#FFFACD', shadow: '#5A4975',
  '???': '#68A090',
};

function titleCase(s: string): string {
  return String(s || '')
    .split(/[\-\s]/)
    .map(w => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

export interface TypeIconProps {
  type: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const TypeIcon: React.FC<TypeIconProps> = ({ type, size = 18, className = 'pixel', style }) => {
  const t = String(type || '').toLowerCase();
  if (CUSTOM_TYPES.has(t)) {
    const label = titleCase(type);
    const color = TYPE_COLORS[t] || '#888';
    return (
      <span
        title={label}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: size ? size * 2.5 : 40,
          height: size,
          padding: '0 4px',
          borderRadius: 3,
          background: color,
          color: t === 'light' ? '#333' : '#fff',
          fontSize: Math.max(9, size * 0.55),
          fontWeight: 700,
          textShadow: t === 'light' ? 'none' : '0 1px 1px rgba(0,0,0,0.5)',
          textTransform: 'uppercase',
          border: `1px solid rgba(0,0,0,0.2)`,
          boxSizing: 'border-box',
          ...style,
        }}
      >
        {label}
      </span>
    );
  }

  return (
    <img
      className={className}
      src={withPublicBase(`vendor/showdown/sprites/types/${titleCase(type)}.png`)}
      alt={titleCase(type)}
      style={{ height: size, ...style }}
    />
  );
};

export default TypeIcon;
