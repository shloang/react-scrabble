import { BOARD_SIZE, SPECIAL_SQUARES, SquareType, PlacedTile, BoardCell } from "@shared/schema";
import BoardSquare from "./BoardSquare";

interface GameBoardProps {
  board: BoardCell[][];
  placedTiles: PlacedTile[];
  onSquareClick?: (row: number, col: number) => void;
  onTileDrop?: (row: number, col: number, data: any) => void;
  placedWordStatuses?: { word: string; positions: { row: number; col: number }[]; status: 'valid' | 'invalid' | 'checking' }[];
  typingCursor?: { row: number; col: number; direction: 'right' | 'down' } | null;
  lastMovePositions?: { row: number; col: number }[];
}

function getSquareType(row: number, col: number): SquareType {
  for (const [type, positions] of Object.entries(SPECIAL_SQUARES)) {
    if (positions.some(([r, c]) => r === row && c === col)) {
      return type as SquareType;
    }
  }
  return 'NORMAL';
}

export default function GameBoard({ board, placedTiles, onSquareClick, onTileDrop, placedWordStatuses, lastMovePositions, typingCursor }: GameBoardProps) {
  return (
    <div className="w-full max-w-[800px] mx-auto" data-testid="game-board">
      <div 
        className="grid gap-1 bg-card rounded-lg p-2 shadow-xl border border-card-border"
        style={{ 
          gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)`,
          aspectRatio: '1/1'
        }}
      >
        {board.map((row, rowIndex) =>
          row.map((cell, colIndex) => {
            const squareType = getSquareType(rowIndex, colIndex);
            const isNewlyPlaced = placedTiles.some(
              t => t.row === rowIndex && t.col === colIndex
            );
            const isLastMovePlaced = (lastMovePositions || []).some(p => p.row === rowIndex && p.col === colIndex);
            const isBlankPlaced = (placedTiles as any).some(
              (t: any) => t.row === rowIndex && t.col === colIndex && t.blank
            );
            
            // Determine highlight status for this square based on placedWordStatuses
            let highlight: 'valid' | 'invalid' | 'checking' | null = null;
            if (placedWordStatuses) {
              for (const w of placedWordStatuses) {
                if (w.positions.some(p => p.row === rowIndex && p.col === colIndex)) {
                  highlight = w.status;
                  break;
                }
              }
            }

            const cellObj = cell as BoardCell;
            const letter = cellObj ? (cellObj as any).letter : null;
            const persistentBlank = !!(cellObj && (cellObj as any).blank);

            const isTypingCursor = typingCursor && typingCursor.row === rowIndex && typingCursor.col === colIndex ? typingCursor.direction : null;

            return (
              <BoardSquare
                key={`${rowIndex}-${colIndex}`}
                row={rowIndex}
                col={colIndex}
                type={squareType}
                letter={letter}
                isNewlyPlaced={isNewlyPlaced}
                isBlankPlaced={isBlankPlaced || persistentBlank}
                isTypingCursor={isTypingCursor}
                onClick={() => onSquareClick?.(rowIndex, colIndex)}
                onDrop={(r, c, data) => onTileDrop?.(r, c, data)}
                highlight={highlight}
                isLastMove={isLastMovePlaced}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
