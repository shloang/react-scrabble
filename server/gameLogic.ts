import { BOARD_SIZE, SPECIAL_SQUARES, TILE_VALUES, PlacedTile, BoardCell } from "@shared/schema";

export type WordInfo = { word: string; positions: { row: number; col: number }[] };

function getSquareType(row: number, col: number) {
  for (const [type, positions] of Object.entries(SPECIAL_SQUARES)) {
    if ((positions as number[][]).some(([r, c]) => r === row && c === col)) return type;
  }
  return 'NORMAL';
}

function cellLetter(cell: BoardCell): string | null {
  if (!cell) return null;
  return (cell as any).letter || null;
}

export function extractWordsFromBoard(board: BoardCell[][], placedTiles: PlacedTile[]): WordInfo[] {
  const words: WordInfo[] = [];

  // horizontal
  for (let row = 0; row < BOARD_SIZE; row++) {
    let word = '';
    let positions: { row: number; col: number }[] = [];
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = board[row][col];
      const letter = cellLetter(cell);
      if (letter) {
        word += letter;
        positions.push({ row, col });
      } else {
        if (word.length > 1) {
          const hasNewTile = positions.some(pos => placedTiles.some(t => t.row === pos.row && t.col === pos.col));
          if (hasNewTile) words.push({ word, positions });
        }
        word = '';
        positions = [];
      }
    }
    if (word.length > 1) {
      const hasNewTile = positions.some(pos => placedTiles.some(t => t.row === pos.row && t.col === pos.col));
      if (hasNewTile) words.push({ word, positions });
    }
  }

  // vertical
  for (let col = 0; col < BOARD_SIZE; col++) {
    let word = '';
    let positions: { row: number; col: number }[] = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
      const cell = board[row][col];
      const letter = cellLetter(cell);
      if (letter) {
        word += letter;
        positions.push({ row, col });
      } else {
        if (word.length > 1) {
          const hasNewTile = positions.some(pos => placedTiles.some(t => t.row === pos.row && t.col === pos.col));
          if (hasNewTile) words.push({ word, positions });
        }
        word = '';
        positions = [];
      }
    }
    if (word.length > 1) {
      const hasNewTile = positions.some(pos => placedTiles.some(t => t.row === pos.row && t.col === pos.col));
      if (hasNewTile) words.push({ word, positions });
    }
  }

  // single tile placed
  if (words.length === 0 && placedTiles.length === 1) {
    words.push({ word: placedTiles[0].letter, positions: [{ row: placedTiles[0].row, col: placedTiles[0].col }] });
  }

  return words;
}

export function calculateScore(words: WordInfo[], board: BoardCell[][], placedTiles: PlacedTile[]): number {
  let totalScore = 0;

  for (const { word, positions } of words) {
    let wordScore = 0;
    let wordMultiplier = 1;

    for (const { row, col } of positions) {
      const cell = board[row][col];
      const letter = cellLetter(cell);
      if (!letter) continue;
      // Check for persisted blank on board cell (cell.blank) OR placed-blank in placedTiles
      const placedInfo = placedTiles.find(t => t.row === row && t.col === col) as any;
      const persistedBlank = !!(cell as any)?.blank;
      let tileScore = 0;
      if (persistedBlank || (placedInfo && placedInfo.blank)) {
        tileScore = 0;
      } else {
        tileScore = TILE_VALUES[letter] ?? 0;
      }
      const isNewTile = placedTiles.some(t => t.row === row && t.col === col);
      if (isNewTile) {
        const squareType = getSquareType(row, col) as string;
        if (squareType === 'DL') tileScore *= 2;
        if (squareType === 'TL') tileScore *= 3;
        // START acts as DW
        if (squareType === 'DW' || squareType === 'START') wordMultiplier *= 2;
        if (squareType === 'TW') wordMultiplier *= 3;
      }
      wordScore += tileScore;
    }

    wordScore *= wordMultiplier;
    totalScore += wordScore;
  }

  if (placedTiles.length === 7) totalScore += 50;

  return totalScore;
}
