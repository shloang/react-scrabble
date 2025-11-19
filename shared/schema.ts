import { z } from "zod";

// Russian Scrabble (Эрудит) Game Schema

export const BOARD_SIZE = 15;
export const MOVE_TIME = 180; // 3 minutes per turn

export const TILE_VALUES: Record<string, number> = {
  А: 1, Б: 3, В: 1, Г: 3, Д: 2, Е: 1, Ё: 3, Ж: 5, З: 5, И: 1, Й: 4, К: 2, Л: 2,
  М: 2, Н: 1, О: 1, П: 2, Р: 1, С: 1, Т: 1, У: 2, Ф: 10, Х: 5, Ц: 5, Ч: 5,
  Ш: 8, Щ: 10, Ъ: 10, Ы: 4, Ь: 3, Э: 8, Ю: 8, Я: 3, '?': 0
};

export const TILE_DISTRIBUTION: Record<string, number> = {
  А: 10, Б: 3, В: 5, Г: 3, Д: 5, Е: 9, Ё: 1, Ж: 2, З: 2, И: 10, Й: 2, К: 6, Л: 4,
  М: 5, Н: 8, О: 10, П: 6, Р: 6, С: 6, Т: 5, У: 3, Ф: 1, Х: 2, Ц: 1, Ч: 2,
  Ш: 1, Щ: 1, Ъ: 1, Ы: 3, Ь: 3, Э: 1, Ю: 1, Я: 3, '?': 2
};

export type SquareType = 'TW' | 'DW' | 'TL' | 'DL' | 'START' | 'NORMAL';

export interface SpecialSquare {
  row: number;
  col: number;
  type: SquareType;
}

export const SPECIAL_SQUARES: Record<SquareType, number[][]> = {
  TW: [[0,0], [0,7], [0,14], [7,0], [7,14], [14,0], [14,7], [14,14]],
  DW: [[1,1], [2,2], [3,3], [4,4], [1,13], [2,12], [3,11], [4,10], [10,4], [11,3], [12,2], [13,1], [10,10], [11,11], [12,12], [13,13]],
  TL: [[1,5], [1,9], [5,1], [5,5], [5,9], [5,13], [9,1], [9,5], [9,9], [9,13], [13,5], [13,9]],
  DL: [[0,3], [0,11], [2,6], [2,8], [3,0], [3,7], [3,14], [6,2], [6,6], [6,8], [6,12], [7,3], [7,11], [8,2], [8,6], [8,8], [8,12], [11,0], [11,7], [11,14], [12,6], [12,8], [14,3], [14,11]],
  START: [[7,7]],
  NORMAL: []
};

export interface Player {
  id: string;
  name: string;
  rack: (string | null)[];
  score: number;
}

export interface PlacedTile {
  row: number;
  col: number;
  letter: string;
  blank?: boolean;
}

export interface Move {
  playerId: string;
  playerName: string;
  words: string[];
  score: number;
  turn: number;
  timestamp: number;
  type?: 'play' | 'skip' | 'exchange';
  meta?: Record<string, any> | null;
}

export type BoardCell = { letter: string; blank?: boolean } | null;

export interface GameState {
  board: BoardCell[][];
  tileBag: string[];
  players: Player[];
  currentPlayer: string | null;
  turn: number;
  moves?: Move[];
}

export const playerSchema = z.object({
  id: z.string(),
  name: z.string(),
  rack: z.array(z.string().nullable()),
  score: z.number(),
});

export const boardCellSchema = z.object({
  letter: z.string(),
  blank: z.boolean().optional()
}).nullable();

export const gameStateSchema = z.object({
  board: z.array(z.array(boardCellSchema)),
  tileBag: z.array(z.string()),
  players: z.array(playerSchema),
  currentPlayer: z.string().nullable(),
  turn: z.number(),
  moves: z.array(z.object({
    playerId: z.string(),
    playerName: z.string(),
    words: z.array(z.string()),
    score: z.number(),
    turn: z.number(),
    timestamp: z.number(),
    type: z.enum(['play', 'skip', 'exchange']).optional(),
    meta: z.record(z.any()).nullable().optional()
  })).optional(),
});

export type InsertPlayer = Omit<Player, 'id'>;
export type InsertGameState = GameState;
