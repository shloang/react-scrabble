import {
  BOARD_SIZE,
  type BoardCell,
  type Move,
  type MoveWordScore,
  type PlacedTile,
} from '@shared/schema';
import { calculateWordScores, extractWordsFromBoard } from './gameLogic';

export interface EndGameHighlights {
  highestMove: Move | null;
  highestWord: { word: string; score: number; move: Move | null };
  longestWord: { word: string; length: number; move: Move | null };
}

function placedTilesForMove(move: Move): PlacedTile[] {
  const raw = move.meta?.placedTiles;
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry): PlacedTile[] => {
    const row = Number(entry?.row);
    const col = Number(entry?.col);
    const letter = typeof entry?.letter === 'string' ? entry.letter : '';
    if (!Number.isInteger(row) || !Number.isInteger(col) || !letter) return [];
    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return [];
    return [{ row, col, letter, blank: !!entry?.blank }];
  });
}

function recordedWordScores(move: Move): MoveWordScore[] {
  if (!Array.isArray(move.wordScores)) return [];
  return move.wordScores.flatMap((entry): MoveWordScore[] => {
    if (!entry || typeof entry.word !== 'string' || !Number.isFinite(entry.score)) return [];
    return [{ word: entry.word, score: Number(entry.score) }];
  });
}

export function getEndGameHighlights(moves: Move[]): EndGameHighlights {
  const board: BoardCell[][] = Array.from({ length: BOARD_SIZE }, () =>
    Array<BoardCell>(BOARD_SIZE).fill(null),
  );
  let highestMove: Move | null = null;
  let highestWord = { word: '', score: 0, move: null as Move | null };
  let longestWord = { word: '', length: 0, move: null as Move | null };

  for (const move of moves) {
    const isPlay = move.type === 'play' || (!move.type && move.words.length > 0);
    if (!isPlay) continue;

    if (!highestMove || move.score > highestMove.score) highestMove = move;

    const placedTiles = placedTilesForMove(move);
    for (const tile of placedTiles) {
      board[tile.row][tile.col] = { letter: tile.letter, blank: !!tile.blank };
    }

    let wordScores = recordedWordScores(move);
    if (wordScores.length === 0 && placedTiles.length > 0) {
      const words = extractWordsFromBoard(board, placedTiles);
      wordScores = calculateWordScores(words, board, placedTiles);
    }

    // A single legacy word can still be recovered without guessing how a
    // multi-word turn was split. Keep the rack bonus separate from that word.
    if (wordScores.length === 0 && move.words.length === 1) {
      const inferredBonus = Number.isFinite(move.bingoBonus)
        ? Number(move.bingoBonus)
        : (placedTiles.length === 7 ? 50 : 0);
      wordScores = [{ word: move.words[0], score: Math.max(0, move.score - inferredBonus) }];
    }

    for (const entry of wordScores) {
      if (entry.score > highestWord.score) {
        highestWord = { word: entry.word, score: entry.score, move };
      }
    }

    for (const word of move.words) {
      if (word.length > longestWord.length) {
        longestWord = { word, length: word.length, move };
      }
    }
  }

  return { highestMove, highestWord, longestWord };
}
