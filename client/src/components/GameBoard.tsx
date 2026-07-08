import { memo } from "react";
import { BOARD_SIZE, SPECIAL_SQUARES, SquareType, PlacedTile, BoardCell } from "@shared/schema";
import BoardSquare from "./BoardSquare";
import { useElementSize } from "@/hooks/useElementSize";

interface GameBoardProps {
  board: BoardCell[][];
  placedTiles: PlacedTile[];
  onSquareClick?: (row: number, col: number) => void;
  onTileDrop?: (row: number, col: number, data: any) => void;
  placedWordStatuses?: { word: string; positions: { row: number; col: number }[]; status: 'valid' | 'invalid' | 'checking' }[];
  typingCursor?: { row: number; col: number; direction: 'right' | 'down' } | null;
  lastMovePositions?: { row: number; col: number }[];
  previews?: Record<string, PlacedTile[]>;
}

function getSquareType(row: number, col: number): SquareType {
  for (const [type, positions] of Object.entries(SPECIAL_SQUARES)) {
    if (positions.some(([r, c]) => r === row && c === col)) {
      return type as SquareType;
    }
  }
  return 'NORMAL';
}

function GameBoard({ board, placedTiles, onSquareClick, onTileDrop, placedWordStatuses, lastMovePositions, typingCursor, previews }: GameBoardProps) {
  const { ref: boardAreaRef, size } = useElementSize<HTMLDivElement>();
  const boardSize = Math.floor(Math.min(size.width || 0, size.height || 0, 900));
  const boardStyle = boardSize > 0
    ? { width: `${boardSize}px`, height: `${boardSize}px` }
    : { width: 'min(100%, 800px)', aspectRatio: '1/1' };

  return (
    <div
      ref={boardAreaRef}
      className="w-full h-full min-h-0 flex items-center justify-center"
      data-testid="game-board"
    >
      <div 
        className="grid gap-1 bg-card rounded-lg p-2 shadow-xl border border-card-border box-border"
        style={{ 
          gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)`,
          ...boardStyle,
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
            // check previews: pick first preview tile that occupies this square
            let previewForSquare: { playerId: string; tile: PlacedTile } | null = null;
            if (previews) {
              for (const pid of Object.keys(previews)) {
                const arr = previews[pid] || [];
                for (const t of arr) {
                  if (t.row === rowIndex && t.col === colIndex) {
                    previewForSquare = { playerId: pid, tile: t } as any;
                    break;
                  }
                }
                if (previewForSquare) break;
              }
            }

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
                onSquareClick={onSquareClick}
                onDrop={onTileDrop}
                highlight={highlight}
                isLastMove={isLastMovePlaced}
                preview={previewForSquare ? { letter: previewForSquare.tile.letter, isBlank: !!previewForSquare.tile.blank, playerId: previewForSquare.playerId } : null}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function sameCell(a: BoardCell, b: BoardCell) {
  if (a === b) return true;
  if (!a || !b) return a === b;
  return (a as any).letter === (b as any).letter && !!(a as any).blank === !!(b as any).blank;
}

function sameBoard(a: BoardCell[][], b: BoardCell[][]) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let row = 0; row < a.length; row += 1) {
    if (!a[row] || !b[row] || a[row].length !== b[row].length) return false;
    for (let col = 0; col < a[row].length; col += 1) {
      if (!sameCell(a[row][col], b[row][col])) return false;
    }
  }
  return true;
}

function samePositions(a?: { row: number; col: number }[], b?: { row: number; col: number }[]) {
  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].row !== b[i].row || a[i].col !== b[i].col) return false;
  }
  return true;
}

function samePlacedTiles(a?: PlacedTile[], b?: PlacedTile[]) {
  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (
      a[i].row !== b[i].row ||
      a[i].col !== b[i].col ||
      a[i].letter !== b[i].letter ||
      !!(a[i] as any).blank !== !!(b[i] as any).blank
    ) {
      return false;
    }
  }
  return true;
}

function sameTypingCursor(
  a?: { row: number; col: number; direction: 'right' | 'down' } | null,
  b?: { row: number; col: number; direction: 'right' | 'down' } | null
) {
  if (a === b) return true;
  if (!a || !b) return a === b;
  return a.row === b.row && a.col === b.col && a.direction === b.direction;
}

function sameWordStatuses(
  a?: { word: string; positions: { row: number; col: number }[]; status: 'valid' | 'invalid' | 'checking' }[],
  b?: { word: string; positions: { row: number; col: number }[]; status: 'valid' | 'invalid' | 'checking' }[]
) {
  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].word !== b[i].word || a[i].status !== b[i].status || !samePositions(a[i].positions, b[i].positions)) {
      return false;
    }
  }
  return true;
}

function samePreviews(a?: Record<string, PlacedTile[]>, b?: Record<string, PlacedTile[]>) {
  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!samePlacedTiles(a[key], b[key])) return false;
  }
  return true;
}

export default memo(GameBoard, (prev, next) => (
  sameBoard(prev.board, next.board) &&
  samePlacedTiles(prev.placedTiles, next.placedTiles) &&
  sameWordStatuses(prev.placedWordStatuses, next.placedWordStatuses) &&
  sameTypingCursor(prev.typingCursor, next.typingCursor) &&
  samePositions(prev.lastMovePositions, next.lastMovePositions) &&
  samePreviews(prev.previews, next.previews) &&
  prev.onSquareClick === next.onSquareClick &&
  prev.onTileDrop === next.onTileDrop
));
