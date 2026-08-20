import { memo } from "react";
import { SquareType } from "@shared/schema";
import Tile from "./Tile";
import { useElementSize } from '@/hooks/useElementSize';

interface BoardSquareProps {
  row: number;
  col: number;
  type: SquareType;
  letter: string | null;
  isNewlyPlaced?: boolean;
  isBlankPlaced?: boolean;
  isTypingCursor?: 'right' | 'down' | null;
  onClick?: () => void;
  onSquareClick?: (row: number, col: number) => void;
  onDrop?: (row: number, col: number, data: any) => void;
  highlight?: 'valid' | 'invalid' | 'checking' | null;
  isLastMove?: boolean;
  canDragTile?: boolean;
  preview?: { letter: string; isBlank?: boolean; playerId?: string } | null;
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

function BoardTile({
  row,
  col,
  letter,
  isBlankPlaced,
  isLastMove,
  isNewlyPlaced,
  highlight,
  canDrag,
  onClick,
}: {
  row: number;
  col: number;
  letter: string;
  isBlankPlaced?: boolean;
  isLastMove?: boolean;
  isNewlyPlaced?: boolean;
  highlight?: 'valid' | 'invalid' | 'checking' | null;
  canDrag?: boolean;
  onClick?: () => void;
}) {
  const { ref: containerRef, size } = useElementSize<HTMLDivElement>();
  const tileSize = Math.min(size.width, size.height);
  const fontStyle: React.CSSProperties = tileSize ? { fontSize: Math.max(10, Math.round(tileSize * 0.5)) + 'px' } : {};
  const outlineClass = highlight === 'valid'
    ? 'ring-[3px] ring-green-500 dark:ring-green-400'
    : highlight === 'invalid'
      ? 'ring-[3px] ring-red-500 dark:ring-red-400'
      : highlight === 'checking'
        ? 'ring-2 ring-yellow-400 dark:ring-yellow-300'
        : isNewlyPlaced
          ? 'ring-2 ring-primary'
          : '';

  return (
    <div ref={containerRef} className={`w-[85%] h-[85%] rounded-md transition-shadow ${outlineClass}`}>
      <Tile
        letter={letter}
        isBlank={!!isBlankPlaced}
        style={{ ...fontStyle, compactBadge: true } as any}
        onClick={onClick}
        draggable={!!canDrag}
        onDragStart={canDrag ? (e) => {
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
        } : undefined}
        onDragEnd={canDrag ? () => { document.body.classList.remove('dragging'); } : undefined}
        isSelected={isLastMove}
      />
    </div>
  );
}

function BoardSquare({ row, col, type, letter, isNewlyPlaced, isBlankPlaced, isTypingCursor, onClick, onSquareClick, onDrop, highlight, isLastMove, canDragTile, preview }: BoardSquareProps) {
  const hasLetter = letter !== null;
  const handleClick = onClick || (onSquareClick ? () => onSquareClick(row, col) : undefined);

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
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={(e) => { handleDrop(e); const el = (e.currentTarget as HTMLElement); if (el) el.classList.remove('drop-target', 'invalid'); }}
      className={`
        aspect-square border border-border/30 flex items-center justify-center relative
        ${!hasLetter ? SQUARE_COLORS[type] : 'bg-background'}
        ${handleClick && !hasLetter ? 'cursor-pointer hover:opacity-80' : ''}
      `}
      data-testid={`square-${row}-${col}`}
    >
      {hasLetter ? (
        <BoardTile
          row={row}
          col={col}
          letter={letter}
          isBlankPlaced={isBlankPlaced}
          isLastMove={isLastMove}
          isNewlyPlaced={isNewlyPlaced}
          highlight={highlight}
          canDrag={!!isNewlyPlaced && !!canDragTile}
          onClick={handleClick}
        />
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
      {/* Preview tile when square is empty */}
      {!hasLetter && preview && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[75%] h-[75%] opacity-70">
            <Tile
              letter={preview.letter}
              isBlank={!!preview.isBlank}
              style={{ compactBadge: true } as any}
              isSelected={false}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function samePreview(a?: BoardSquareProps['preview'], b?: BoardSquareProps['preview']) {
  if (a === b) return true;
  if (!a || !b) return a === b;
  return a.letter === b.letter && !!a.isBlank === !!b.isBlank && a.playerId === b.playerId;
}

export default memo(BoardSquare, (prev, next) => (
  prev.row === next.row &&
  prev.col === next.col &&
  prev.type === next.type &&
  prev.letter === next.letter &&
  prev.isNewlyPlaced === next.isNewlyPlaced &&
  prev.isBlankPlaced === next.isBlankPlaced &&
  prev.isTypingCursor === next.isTypingCursor &&
  prev.highlight === next.highlight &&
  prev.isLastMove === next.isLastMove &&
  prev.canDragTile === next.canDragTile &&
  samePreview(prev.preview, next.preview) &&
  prev.onClick === next.onClick &&
  prev.onSquareClick === next.onSquareClick &&
  prev.onDrop === next.onDrop
));
