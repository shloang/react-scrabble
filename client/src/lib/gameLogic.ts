import { BOARD_SIZE, SPECIAL_SQUARES, TILE_VALUES, SquareType, PlacedTile, GameState } from "@shared/schema";

export function getSquareType(row: number, col: number): SquareType {
  for (const [type, positions] of Object.entries(SPECIAL_SQUARES)) {
    if (positions.some(([r, c]) => r === row && c === col)) {
      return type as SquareType;
    }
  }
  return 'NORMAL';
}

export interface WordInfo {
  word: string;
  positions: { row: number; col: number }[];
}

export function extractWordsFromBoard(board: (string | null)[][], placedTiles: PlacedTile[]): WordInfo[] {
  const words: WordInfo[] = [];
  
  // Check horizontal words
  for (let row = 0; row < BOARD_SIZE; row++) {
    let word = '';
    let positions: { row: number; col: number }[] = [];
    
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row][col]) {
        word += board[row][col];
        positions.push({ row, col });
      } else {
        if (word.length > 1) {
          const hasNewTile = positions.some(pos => 
            placedTiles.some(t => t.row === pos.row && t.col === pos.col)
          );
          if (hasNewTile) {
            words.push({ word, positions });
          }
        }
        word = '';
        positions = [];
      }
    }
    if (word.length > 1) {
      const hasNewTile = positions.some(pos => 
        placedTiles.some(t => t.row === pos.row && t.col === pos.col)
      );
      if (hasNewTile) {
        words.push({ word, positions });
      }
    }
  }
  
  // Check vertical words
  for (let col = 0; col < BOARD_SIZE; col++) {
    let word = '';
    let positions: { row: number; col: number }[] = [];
    
    for (let row = 0; row < BOARD_SIZE; row++) {
      if (board[row][col]) {
        word += board[row][col];
        positions.push({ row, col });
      } else {
        if (word.length > 1) {
          const hasNewTile = positions.some(pos => 
            placedTiles.some(t => t.row === pos.row && t.col === pos.col)
          );
          if (hasNewTile) {
            words.push({ word, positions });
          }
        }
        word = '';
        positions = [];
      }
    }
    if (word.length > 1) {
      const hasNewTile = positions.some(pos => 
        placedTiles.some(t => t.row === pos.row && t.col === pos.col)
      );
      if (hasNewTile) {
        words.push({ word, positions });
      }
    }
  }
  
  // If only one tile placed, it's the word itself
  if (words.length === 0 && placedTiles.length === 1) {
    words.push({ 
      word: placedTiles[0].letter, 
      positions: [{ row: placedTiles[0].row, col: placedTiles[0].col }] 
    });
  }
  
  return words;
}

export function calculateScore(
  words: WordInfo[], 
  board: (string | null)[][], 
  placedTiles: PlacedTile[]
): number {
  let totalScore = 0;

  words.forEach(({ word, positions }) => {
    let wordScore = 0;
    let wordMultiplier = 1;

    positions.forEach(({ row, col }) => {
      const letter = board[row][col];
      if (!letter) return;
      
      let tileScore = TILE_VALUES[letter] ?? 0;
      const isNewTile = placedTiles.some(t => t.row === row && t.col === col);
      
      if (isNewTile) {
        const squareType = getSquareType(row, col);
        
        if (squareType === 'DL') tileScore *= 2;
        if (squareType === 'TL') tileScore *= 3;
        if (squareType === 'DW') wordMultiplier *= 2;
        if (squareType === 'TW' || squareType === 'START') wordMultiplier *= 3;
      }
      
      wordScore += tileScore;
    });

    wordScore *= wordMultiplier;
    totalScore += wordScore;
  });

  // Bonus for using all 7 tiles
  if (placedTiles.length === 7) {
    totalScore += 50;
  }

  return totalScore;
}

export function validatePlacement(board: (string | null)[][], placedTiles: PlacedTile[]): { valid: boolean; error?: string } {
  if (placedTiles.length === 0) {
    return { valid: false, error: 'Нет размещенных фишек' };
  }

  // Check if tiles are in a line (all same row or all same column)
  const rows = placedTiles.map(t => t.row);
  const cols = placedTiles.map(t => t.col);
  const allSameRow = rows.every(r => r === rows[0]);
  const allSameCol = cols.every(c => c === cols[0]);

  if (!allSameRow && !allSameCol) {
    return { valid: false, error: 'Фишки должны быть размещены в одну линию' };
  }

  // Check if tiles are connected (no gaps in placed tiles)
  if (allSameRow) {
    const sortedCols = [...cols].sort((a, b) => a - b);
    for (let i = 0; i < sortedCols.length - 1; i++) {
      const gap = sortedCols[i + 1] - sortedCols[i];
      if (gap > 1) {
        // Check if there are existing tiles filling the gap
        for (let col = sortedCols[i] + 1; col < sortedCols[i + 1]; col++) {
          if (!board[rows[0]][col]) {
            return { valid: false, error: 'В размещении есть пробелы' };
          }
        }
      }
    }
  } else {
    const sortedRows = [...rows].sort((a, b) => a - b);
    for (let i = 0; i < sortedRows.length - 1; i++) {
      const gap = sortedRows[i + 1] - sortedRows[i];
      if (gap > 1) {
        // Check if there are existing tiles filling the gap
        for (let row = sortedRows[i] + 1; row < sortedRows[i + 1]; row++) {
          if (!board[row][cols[0]]) {
            return { valid: false, error: 'В размещении есть пробелы' };
          }
        }
      }
    }
  }

  // Check if this is the first move (board is empty except for placed tiles)
  const boardHasExistingTiles = board.some((row, r) => 
    row.some((cell, c) => 
      cell !== null && !placedTiles.some(t => t.row === r && t.col === c)
    )
  );

  if (!boardHasExistingTiles) {
    // First move - must include the center square (7, 7)
    const includesCenter = placedTiles.some(t => t.row === 7 && t.col === 7);
    if (!includesCenter) {
      return { valid: false, error: 'Первый ход должен включать центральную клетку' };
    }
  } else {
    // Not first move - must connect to existing tiles
    const connectsToExisting = placedTiles.some(({ row, col }) => {
      // Check adjacent squares for existing tiles
      const adjacentPositions = [
        [row - 1, col], [row + 1, col], // vertical
        [row, col - 1], [row, col + 1]  // horizontal
      ];
      
      return adjacentPositions.some(([r, c]) => {
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
        // Must be an existing tile (not a newly placed one)
        return board[r][c] !== null && !placedTiles.some(t => t.row === r && t.col === c);
      });
    });

    if (!connectsToExisting) {
      return { valid: false, error: 'Фишки должны соединяться с существующими словами' };
    }
  }

  return { valid: true };
}
