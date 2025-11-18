import { SquareType } from "@shared/schema";
import Tile from "./Tile";

interface BoardSquareProps {
  row: number;
  col: number;
  type: SquareType;
  letter: string | null;
  isNewlyPlaced?: boolean;
  onClick?: () => void;
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

export default function BoardSquare({ row, col, type, letter, isNewlyPlaced, onClick }: BoardSquareProps) {
  const hasLetter = letter !== null;

  return (
    <div
      onClick={onClick}
      className={`
        aspect-square border border-border/30 flex items-center justify-center relative
        ${!hasLetter ? SQUARE_COLORS[type] : 'bg-background'}
        ${onClick && !hasLetter ? 'cursor-pointer hover:opacity-80' : ''}
        ${isNewlyPlaced ? 'ring-2 ring-primary ring-inset' : ''}
      `}
      data-testid={`square-${row}-${col}`}
    >
      {hasLetter ? (
        <div className="w-[85%] h-[85%]">
          <Tile letter={letter} onClick={onClick} />
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
