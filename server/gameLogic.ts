import { BOARD_SIZE, SPECIAL_SQUARES, SquareType, PlacedTile, BoardCell, TILE_VALUES } from "@shared/schema";
import type { GameState, Move } from "@shared/schema";

export interface WordInfo {
  word: string;
  positions: { row: number; col: number }[];
}

export function extractWordsFromBoard(board: BoardCell[][], placedTiles: PlacedTile[]): WordInfo[] {
  const words: WordInfo[] = [];
  const placedSet = new Set(placedTiles.map(t => `${t.row},${t.col}`));

  // Check horizontal words
  for (let row = 0; row < BOARD_SIZE; row++) {
    let word = '';
    let startCol = -1;
    const positions: { row: number; col: number }[] = [];

    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = board[row][col];
      if (cell) {
        if (word === '') startCol = col;
        word += cell.letter;
        positions.push({ row, col });
      } else {
        if (word.length > 1) {
          const hasNewTile = positions.some(pos => placedSet.has(`${pos.row},${pos.col}`));
          if (hasNewTile) {
            words.push({ word, positions: [...positions] });
          }
        }
        word = '';
        positions.length = 0;
      }
    }
    if (word.length > 1) {
      const hasNewTile = positions.some(pos => placedSet.has(`${pos.row},${pos.col}`));
      if (hasNewTile) {
        words.push({ word, positions: [...positions] });
      }
    }
  }

  // Check vertical words
  for (let col = 0; col < BOARD_SIZE; col++) {
    let word = '';
    let startRow = -1;
    const positions: { row: number; col: number }[] = [];

    for (let row = 0; row < BOARD_SIZE; row++) {
      const cell = board[row][col];
      if (cell) {
        if (word === '') startRow = row;
        word += cell.letter;
        positions.push({ row, col });
      } else {
        if (word.length > 1) {
          const hasNewTile = positions.some(pos => placedSet.has(`${pos.row},${pos.col}`));
          if (hasNewTile) {
            words.push({ word, positions: [...positions] });
          }
        }
        word = '';
        positions.length = 0;
      }
    }
    if (word.length > 1) {
      const hasNewTile = positions.some(pos => placedSet.has(`${pos.row},${pos.col}`));
      if (hasNewTile) {
        words.push({ word, positions: [...positions] });
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
  board: BoardCell[][],
  placedTiles: PlacedTile[]
): number {
  if (words.length === 0) return 0;

  let totalScore = 0;
  const placedSet = new Set(placedTiles.map(t => `${t.row},${t.col}`));

  for (const { word, positions } of words) {
    let wordScore = 0;
    let wordMultiplier = 1;

    for (const { row, col } of positions) {
      const isNewTile = placedSet.has(`${row},${col}`);
      const cell = board[row][col];
      if (!cell) continue;

      const letter = cell.letter;
      const baseValue = cell.blank ? 0 : (TILE_VALUES[letter] ?? 0);

      if (isNewTile) {
        // Check for special squares
        const squareType = getSquareType(row, col);
        if (squareType === 'TW') {
          wordMultiplier *= 3;
          wordScore += baseValue;
        } else if (squareType === 'DW' || squareType === 'START') {
          // START (center) counts as a double-word for the first move
          wordMultiplier *= 2;
          wordScore += baseValue;
        } else if (squareType === 'TL') {
          wordScore += baseValue * 3;
        } else if (squareType === 'DL') {
          wordScore += baseValue * 2;
        } else {
          wordScore += baseValue;
        }
      } else {
        wordScore += baseValue;
      }
    }

    totalScore += wordScore * wordMultiplier;
  }

  // Bonus for using all 7 tiles
  if (placedTiles.length === 7) {
    totalScore += 50;
  }

  return totalScore;
}

function getSquareType(row: number, col: number): SquareType {
  for (const [type, positions] of Object.entries(SPECIAL_SQUARES)) {
    if (positions.some(([r, c]) => r === row && c === col)) {
      return type as SquareType;
    }
  }
  return 'NORMAL';
}

export function validatePlacement(board: BoardCell[][], placedTiles: PlacedTile[]): { valid: boolean; error?: string } {
  if (placedTiles.length === 0) {
    return { valid: false, error: 'Не размещено ни одной фишки' };
  }

  // Check if all tiles are on the board
  for (const tile of placedTiles) {
    if (tile.row < 0 || tile.row >= BOARD_SIZE || tile.col < 0 || tile.col >= BOARD_SIZE) {
      return { valid: false, error: 'Фишка размещена вне доски' };
    }
    if (board[tile.row][tile.col] !== null) {
      return { valid: false, error: 'Клетка уже занята' };
    }
  }

  // Check if tiles form a contiguous line
  const rows = placedTiles.map(t => t.row);
  const cols = placedTiles.map(t => t.col);
  const allSameRow = rows.every(r => r === rows[0]);
  const allSameCol = cols.every(c => c === cols[0]);

  if (!allSameRow && !allSameCol) {
    return { valid: false, error: 'Фишки должны быть размещены в одну линию' };
  }

  // Check if tiles are contiguous
  if (allSameRow) {
    const sortedCols = [...cols].sort((a, b) => a - b);
    for (let i = 1; i < sortedCols.length; i++) {
      if (sortedCols[i] - sortedCols[i - 1] > 1) {
        return { valid: false, error: 'Фишки должны быть размещены подряд' };
      }
    }
  } else {
    const sortedRows = [...rows].sort((a, b) => a - b);
    for (let i = 1; i < sortedRows.length; i++) {
      if (sortedRows[i] - sortedRows[i - 1] > 1) {
        return { valid: false, error: 'Фишки должны быть размещены подряд' };
      }
    }
  }

  // Check if at least one tile connects to existing tiles (for first move, check if center is used)
  const hasExistingTiles = board.some(row => row.some(cell => cell !== null));
  if (hasExistingTiles) {
    let connects = false;
    for (const tile of placedTiles) {
      const { row, col } = tile;
      // Check adjacent cells
      if ((row > 0 && board[row - 1][col] !== null) ||
          (row < BOARD_SIZE - 1 && board[row + 1][col] !== null) ||
          (col > 0 && board[row][col - 1] !== null) ||
          (col < BOARD_SIZE - 1 && board[row][col + 1] !== null)) {
        connects = true;
        break;
      }
    }
    if (!connects) {
      return { valid: false, error: 'Новые фишки должны соединяться с существующими' };
    }
  } else {
    // First move must use center square
    const centerUsed = placedTiles.some(t => t.row === 7 && t.col === 7);
    if (!centerUsed) {
      return { valid: false, error: 'Первый ход должен использовать центральную клетку' };
    }
  }

  return { valid: true };
}

/**
 * Check if the game has ended
 */
export function checkGameEnd(gameState: GameState): { ended: boolean; reason?: string; winnerId?: string } {
  // Check if any player has no tiles and bag is empty
  for (const player of gameState.players) {
    const hasTiles = player.rack.some(t => t !== null);
    if (!hasTiles && gameState.tileBag.length === 0) {
      // Find winner (highest score)
      const winner = gameState.players.reduce((prev, curr) => 
        curr.score > prev.score ? curr : prev
      );
      return { ended: true, reason: 'player_out_of_tiles', winnerId: winner.id };
    }
  }

  // Check if all players skipped twice in a row
  const moves = gameState.moves || [];
  if (moves.length >= gameState.players.length * 2) {
    const recentMoves = moves.slice(-gameState.players.length * 2);
    const allSkips = recentMoves.every(m => m.type === 'skip');
    if (allSkips) {
      // Find winner (highest score)
      const winner = gameState.players.reduce((prev, curr) => 
        curr.score > prev.score ? curr : prev
      );
      return { ended: true, reason: 'all_skipped_twice', winnerId: winner.id };
    }
  }

  return { ended: false };
}
