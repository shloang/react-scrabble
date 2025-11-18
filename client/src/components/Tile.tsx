import { TILE_VALUES } from "@shared/schema";

interface TileProps {
  letter: string | null;
  isSelected?: boolean;
  isEmpty?: boolean;
  onClick?: () => void;
  className?: string;
}

export default function Tile({ letter, isSelected, isEmpty, onClick, className = '' }: TileProps) {
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

  const points = TILE_VALUES[letter] ?? 0;

  return (
    <div
      onClick={onClick}
      className={`
        w-full aspect-square bg-amber-100 dark:bg-amber-900 rounded-md shadow-md relative
        flex items-center justify-center font-bold text-2xl
        transition-all duration-200
        ${onClick ? 'cursor-pointer hover-elevate active-elevate-2' : ''}
        ${isSelected ? 'ring-4 ring-primary scale-105' : ''}
        ${className}
      `}
      style={{ fontFamily: 'Noto Sans, sans-serif' }}
      data-testid={`tile-${letter.toLowerCase()}`}
    >
      <span className="text-foreground">{letter}</span>
      <span className="absolute bottom-1 right-1.5 text-xs text-muted-foreground font-normal">
        {points}
      </span>
    </div>
  );
}
