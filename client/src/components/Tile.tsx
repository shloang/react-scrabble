import { TILE_VALUES } from "@shared/schema";
import { useEffect, useRef, useState } from 'react';

interface TileProps {
  letter: string | null;
  isSelected?: boolean;
  isEmpty?: boolean;
  isBlank?: boolean;
  onClick?: () => void;
  className?: string;
  draggable?: boolean;
  onDragStart?: (e: any) => void;
  onDragEnd?: (e: any) => void;
  style?: React.CSSProperties;
}

export default function Tile({ letter, isSelected, isEmpty, isBlank, onClick, className = '', draggable, onDragStart, onDragEnd, style }: TileProps) {
  if (isEmpty) {
    return (
      <div 
        className={`w-full aspect-square border-2 border-dashed border-muted rounded-md ${className}`}
        data-testid="tile-empty"
      />
    );
  }

  if (!letter) {
    return (
      <div 
        className={`w-full aspect-square bg-muted/30 rounded-md ${className}`}
        data-testid="tile-null"
      />
    );
  }

  const points = isBlank ? 0 : (TILE_VALUES[letter] ?? 0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [tileSize, setTileSize] = useState(0);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new (window as any).ResizeObserver((entries: any) => {
      for (const entry of entries) {
        const r = entry.contentRect;
        setTileSize(Math.min(r.width, r.height));
      }
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    setTileSize(Math.min(rect.width, rect.height));
    return () => ro.disconnect();
  }, []);

  const explicitFontSize = (() => {
    try {
      const fs = (style as any)?.fontSize;
      if (!fs) return undefined;
      if (typeof fs === 'number') return fs;
      const m = String(fs).match(/^(\d+)/);
      if (m) return parseInt(m[1], 10);
    } catch (err) { /* ignore */ }
    return undefined;
  })();

  const mainFontSize = explicitFontSize ?? (tileSize ? Math.max(12, Math.round(tileSize * 0.48)) : undefined);
  const pointsFontSize = explicitFontSize ? Math.max(8, Math.round(explicitFontSize * 0.28)) : (tileSize ? Math.max(8, Math.round(tileSize * 0.18)) : undefined);

  return (
    <div
      ref={rootRef}
      onClick={onClick}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={
        `w-full aspect-square bg-amber-100 dark:bg-amber-900 rounded-md shadow-md relative
        flex items-center justify-center font-bold
        transition-all duration-200
        ${onClick ? 'cursor-pointer hover-elevate active-elevate-2' : ''}
        ${isSelected ? 'ring-4 ring-primary scale-105' : ''}
        ${isBlank ? 'ring-2 ring-yellow-300/50' : ''}
        ${className}`
      }
      style={{ fontFamily: 'Noto Sans, sans-serif', ...(style || {}) }}
      data-testid={`tile-${letter.toLowerCase()}`}
    >
      <span className="text-foreground" style={mainFontSize ? { fontSize: mainFontSize + 'px', lineHeight: 1 } : undefined}>{letter}</span>
      {isBlank && (
        <span className="absolute left-1 top-1 w-3 h-3 rounded-full bg-yellow-400 ring-1 ring-yellow-600/40" aria-hidden />
      )}
      <span
        className="absolute font-normal text-muted-foreground"
        style={pointsFontSize ? {
          fontSize: pointsFontSize + 'px',
          padding: Math.max(2, Math.round(tileSize * 0.03)) + 'px ' + Math.max(4, Math.round(tileSize * 0.06)) + 'px',
          borderRadius: Math.max(6, Math.round(tileSize * 0.06)) + 'px',
          right: '4%',
          bottom: '4%'
        } : undefined}
      >
        {points}
      </span>
    </div>
  );
}
