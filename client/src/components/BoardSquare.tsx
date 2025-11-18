import { SquareType } from "@shared/schema";
import Tile from "./Tile";

interface BoardSquareProps {
  row: number;
  col: number;
  type: SquareType;
  letter: string | null;
  isNewlyPlaced?: boolean;
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

export default function BoardSquare({ row, col, type, letter, isNewlyPlaced, onClick, onDrop, highlight }: BoardSquareProps) {
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
        <div className="w-[85%] h-[85%]">
          <Tile
            letter={letter}
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
      ) : (
        type !== 'NORMAL' && (
          <span className="text-xs font-bold uppercase tracking-wide text-white dark:text-white/90">
            {SQUARE_LABELS[type]}
          </span>
        )
      )}
    </div>
  );
}
