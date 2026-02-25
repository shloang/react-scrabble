import { z } from "zod";

// Russian Scrabble (Эрудит) Game Schema

export const BOARD_SIZE = 15;
export const MOVE_TIME = 180; // 3 minutes per turn

export const TILE_VALUES: Record<string, number> = {
  А: 1, Б: 3, В: 2, Г: 3, Д: 2, Е: 1, Ж: 5, З: 5, И: 1, Й: 4, К: 2, Л: 2,
  М: 2, Н: 1, О: 1, П: 2, Р: 2, С: 2, Т: 2, У: 3, Ф: 10, Х: 5, Ц: 9, Ч: 5,
  Ш: 8, Щ: 10, Ы: 3, Ь: 5, Э: 8, Ю: 8, Я: 3, '?': 0
};

export const TILE_DISTRIBUTION: Record<string, number> = {
  А: 9, Б: 3, В: 4, Г: 3, Д: 4, Е: 9, Ж: 2, З: 2, И: 8, Й: 2, К: 4, Л: 4,
  М: 4, Н: 5, О: 10, П: 4, Р: 5, С: 5, Т: 5, У: 3, Ф: 1, Х: 2, Ц: 1, Ч: 2,
  Ш: 1, Щ: 1, Ы: 4, Ь: 2, Э: 1, Ю: 1, Я: 3, '?': 3
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
  avatarUrl?: string;
  score: number;
  ready?: boolean;
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
  previews?: Record<string, PlacedTile[]>;
  gameEnded?: boolean;
  winnerId?: string;
  endReason?: string;
  // Whether the game is currently paused (clients should stop timers)
  paused?: boolean;
  // ID of the player who paused the game (optional)
  pausedBy?: string | null;
  // Server-authoritative timestamp for when the current turn started (ms since epoch)
  turnStart?: number | null;
  // When the game was paused (ms since epoch) or null when not paused
  pausedAt?: number | null;
}

export const playerSchema = z.object({
  id: z.string(),
  name: z.string(),
  rack: z.array(z.string().nullable()),
  avatarUrl: z.string().url().optional(),
  score: z.number(),
  ready: z.boolean().optional(),
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
  previews: z.record(z.array(z.object({ row: z.number(), col: z.number(), letter: z.string(), blank: z.boolean().optional() }))).optional(),
  paused: z.boolean().optional(),
  pausedBy: z.string().nullable().optional(),
  turnStart: z.number().nullable().optional(),
  pausedAt: z.number().nullable().optional(),
});

export type InsertPlayer = Omit<Player, 'id'>;
export type InsertGameState = GameState;
