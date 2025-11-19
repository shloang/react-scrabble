import { SquareType } from "@shared/schema";
import Tile from "./Tile";
import { useEffect, useRef, useState } from 'react';

interface BoardSquareProps {
  row: number;
  col: number;
  type: SquareType;
  letter: string | null;
  isNewlyPlaced?: boolean;
  isBlankPlaced?: boolean;
  isTypingCursor?: 'right' | 'down' | null;
  onClick?: () => void;
  onDrop?: (row: number, col: number, data: any) => void;
  highlight?: 'valid' | 'invalid' | 'checking' | null;
}

const SQUARE_COLORS: Record<SquareType, string> = {
  TW: 'bg-red-500 dark:bg-red-700',
  DW: 'bg-pink-400 dark:bg-pink-700',
  TL: 'bg-blue-500 dark:bg-blue-700',
  DL: 'bg-sky-400 dark:bg-sky-700',
  START: 'bg-pink-400 dark:bg-pink-700',
  NORMAL: 'bg-green-50 dark:bg-green-950'
};

const SQUARE_LABELS: Record<SquareType, string> = {
  TW: 'TW',
  DW: 'DW',
  TL: 'TL',
  DL: 'DL',
  START: '★',
  NORMAL: ''
};

export default function BoardSquare({ row, col, type, letter, isNewlyPlaced, isBlankPlaced, isTypingCursor, onClick, onDrop, highlight }: BoardSquareProps) {
  const hasLetter = letter !== null;

  const handleDragOver = (e: any) => {
    e.preventDefault();
  };

  const handleDragEnter = (e: any) => {
    // highlight as drop target
    const el = e.currentTarget as HTMLElement;
    if (!el) return;
    if (hasLetter) {
      el.classList.add('drop-target', 'invalid');
    } else {
      el.classList.add('drop-target');
    }
  };

  const handleDragLeave = (e: any) => {
    const el = e.currentTarget as HTMLElement;
    if (el) el.classList.remove('drop-target', 'invalid');
  };

  const handleDrop = (e: any) => {
    e.preventDefault();
    try {
      const d = e.dataTransfer.getData('text/plain');
      if (!d) return;
      const parsed = JSON.parse(d);
      // call parent
      onDrop?.(row, col, parsed);
    } catch (err) {
      // ignore invalid drop
    }
  };

  return (
    <div
      onClick={onClick}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={(e) => { handleDrop(e); const el = (e.currentTarget as HTMLElement); if (el) el.classList.remove('drop-target', 'invalid'); }}
      className={`
        aspect-square border border-border/30 flex items-center justify-center relative
        ${!hasLetter ? SQUARE_COLORS[type] : 'bg-background'}
        ${onClick && !hasLetter ? 'cursor-pointer hover:opacity-80' : ''}
        ${isNewlyPlaced ? 'ring-2 ring-primary ring-inset' : ''}
        ${highlight === 'valid' ? 'ring-4 ring-green-400/60' : ''}
        ${highlight === 'invalid' ? 'ring-4 ring-red-400/60' : ''}
        ${highlight === 'checking' ? 'ring-2 ring-yellow-300/60' : ''}
      `}
      data-testid={`square-${row}-${col}`}
    >
      {hasLetter ? (
        (() => {
          const containerRef = useRef<HTMLDivElement | null>(null);
          const [tileSize, setTileSize] = useState<number>(0);

          useEffect(() => {
            const el = containerRef.current;
            if (!el) return;
            // ResizeObserver to update tile size when square resizes
            const ro = new (window as any).ResizeObserver((entries: any) => {
              for (const entry of entries) {
                const cr = entry.contentRect;
                const min = Math.min(cr.width, cr.height);
                setTileSize(min);
              }
            });
            ro.observe(el);
            // initial size
            const rect = el.getBoundingClientRect();
            setTileSize(Math.min(rect.width, rect.height));
            return () => ro.disconnect();
          }, []);

          const fontStyle: React.CSSProperties = tileSize ? { fontSize: Math.max(10, Math.round(tileSize * 0.5)) + 'px' } : {};

          return (
            <div ref={containerRef} className="w-[85%] h-[85%]">
              <Tile
                letter={letter}
                isBlank={!!isBlankPlaced}
                style={fontStyle}
                onClick={onClick}
                onDragStart={(e) => {
                  try {
                    e.dataTransfer.setData('text/plain', JSON.stringify({ source: 'board', fromRow: row, fromCol: col, letter }));
                    e.dataTransfer.effectAllowed = 'move';
                    document.body.classList.add('dragging');

                    const ghost = document.createElement('div');
                    ghost.className = 'drag-ghost';
                    ghost.textContent = letter;
                    document.body.appendChild(ghost);
                    const rect = ghost.getBoundingClientRect();
                    const offsetX = rect.width / 2;
                    const offsetY = rect.height / 2;
                    try { e.dataTransfer.setDragImage(ghost, offsetX, offsetY); } catch (err) {}
                    setTimeout(() => ghost.remove(), 0);
                  } catch (err) {
                    // ignore
                  }
                }}
                onDragEnd={() => { document.body.classList.remove('dragging'); }}
              />
            </div>
          );
        })()
      ) : (
        type !== 'NORMAL' && (
          <span className="text-xs font-bold uppercase tracking-wide text-white dark:text-white/90">
            {SQUARE_LABELS[type]}
          </span>
        )
      )}
      {/* Typing cursor arrow overlay when empty */}
      {!hasLetter && isTypingCursor && (
        <div className={`absolute inset-0 flex items-center justify-center pointer-events-none`} aria-hidden>
          <div className="rounded-md p-1 shadow-lg flex items-center justify-center bg-zinc-700 dark:bg-zinc-200 text-white dark:text-black" style={{ opacity: 0.95 }}>
            {isTypingCursor === 'right' ? (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M5 12h12" strokeLinecap="round" strokeLinejoin="round" stroke="white" />
                <path d="M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" stroke="white" />
              </svg>
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 5v12" strokeLinecap="round" strokeLinejoin="round" stroke="white" />
                <path d="M6 11l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" stroke="white" />
              </svg>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
