import { BOARD_SIZE, SPECIAL_SQUARES, SquareType, PlacedTile } from "@shared/schema";
import BoardSquare from "./BoardSquare";

interface GameBoardProps {
  board: (string | null)[][];
  placedTiles: PlacedTile[];
  onSquareClick?: (row: number, col: number) => void;
}

function getSquareType(row: number, col: number): SquareType {
  for (const [type, positions] of Object.entries(SPECIAL_SQUARES)) {
    if (positions.some(([r, c]) => r === row && c === col)) {
      return type as SquareType;
    }
  }
  return 'NORMAL';
}

export default function GameBoard({ board, placedTiles, onSquareClick }: GameBoardProps) {
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
            
            return (
              <BoardSquare
                key={`${rowIndex}-${colIndex}`}
                row={rowIndex}
                col={colIndex}
                type={squareType}
                letter={cell}
                isNewlyPlaced={isNewlyPlaced}
                onClick={() => onSquareClick?.(rowIndex, colIndex)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
