import { type GameState } from "@shared/schema";
import { createHash } from "crypto";
import fs from 'fs/promises';
import path from 'path';

export type StoredPlayerStatsEntry = {
  wins: number;
  losses: number;
  games: number;
  updatedAt: number;
  lastGameKey?: string;
};

export type StoredPlayerStats = Record<string, StoredPlayerStatsEntry>;

export interface IStorage {
  getGameState(): Promise<GameState | undefined>;
  saveGameState(gameState: GameState): Promise<void>;
  getPlayerStats?(): Promise<StoredPlayerStats>;
  savePlayerStats?(stats: StoredPlayerStats): Promise<void>;
}

export class MemStorage implements IStorage {
  private gameState: GameState | undefined;
  private credentials: Record<string, string>; // map playerId -> passwordHash
  private playerStats: StoredPlayerStats;

  constructor() {
    this.gameState = undefined;
    this.credentials = {};
    this.playerStats = {};
  }

  async getGameState(): Promise<GameState | undefined> {
    return this.gameState;
  }

  async saveGameState(gameState: GameState): Promise<void> {
    this.gameState = gameState;
  }

  async getPlayerStats(): Promise<StoredPlayerStats> {
    return { ...this.playerStats };
  }

  async savePlayerStats(stats: StoredPlayerStats): Promise<void> {
    this.playerStats = { ...stats };
  }

  async setPlayerPassword(playerId: string, password: string): Promise<void> {
    const hash = createHash('sha256').update(password).digest('hex');
    this.credentials[playerId] = hash;
  }

  async verifyPlayerPassword(playerId: string, password: string): Promise<boolean> {
    const hash = createHash('sha256').update(password).digest('hex');
    return this.credentials[playerId] === hash;
  }

  async findPlayerIdByName(name: string): Promise<string | undefined> {
    if (!this.gameState) return undefined;
    const p = this.gameState.players.find(pl => pl.name.trim().toLowerCase() === name.trim().toLowerCase());
    return p?.id;
  }
}
class FileStorage implements IStorage {
  private filePath: string;
  private credPath: string = '';
  private statsPath: string = '';
  private credentials: Record<string, string>;

  constructor(filePath?: string) {
    this.filePath = filePath || (process.env.GAME_STATE_FILE || 'data/game-state.json');
    this.credPath = (process.env.GAME_CRED_FILE || 'data/credentials.json');
    this.statsPath = (process.env.PLAYER_STATS_FILE || 'data/player-stats.json');
    this.credentials = {};
    // ensure directory exists
    try {
      const dir = path.dirname(this.filePath);
      fs.mkdir(dir, { recursive: true }).catch(() => {});
    } catch (e) {}
    // attempt to load credentials file if present
    (async () => {
      try {
        const s = await fs.readFile(this.credPath, 'utf8');
        this.credentials = JSON.parse(s) || {};
      } catch (e) {
        this.credentials = {};
      }
    })();
  }

  private async saveCreds() {
    try {
      const tmp = this.credPath + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(this.credentials), 'utf8');
      await fs.rename(tmp, this.credPath);
    } catch (e) {
      // ignore
    }
  }

  async getGameState(): Promise<GameState | undefined> {
    try {
      const s = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(s) as GameState;
    } catch (e) {
      return undefined;
    }
  }

  async saveGameState(gameState: GameState): Promise<void> {
    const tmp = this.filePath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(gameState), 'utf8');
    await fs.rename(tmp, this.filePath);
  }

  async getPlayerStats(): Promise<StoredPlayerStats> {
    try {
      const s = await fs.readFile(this.statsPath, 'utf8');
      const parsed = JSON.parse(s) || {};
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed as StoredPlayerStats;
    } catch (e) {
      return {};
    }
  }

  async savePlayerStats(stats: StoredPlayerStats): Promise<void> {
    try {
      const dir = path.dirname(this.statsPath);
      await fs.mkdir(dir, { recursive: true });
      const tmp = this.statsPath + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(stats), 'utf8');
      await fs.rename(tmp, this.statsPath);
    } catch (e) {
      // ignore stats persistence errors; game state remains authoritative
    }
  }

  async setPlayerPassword(playerId: string, password: string): Promise<void> {
    const hash = createHash('sha256').update(password).digest('hex');
    this.credentials[playerId] = hash;
    await this.saveCreds();
  }

  async verifyPlayerPassword(playerId: string, password: string): Promise<boolean> {
    const hash = createHash('sha256').update(password).digest('hex');
    return this.credentials[playerId] === hash;
  }

  async findPlayerIdByName(name: string): Promise<string | undefined> {
    const gs = await this.getGameState();
    if (!gs) return undefined;
    const p = gs.players.find(pl => pl.name.trim().toLowerCase() === name.trim().toLowerCase());
    return p?.id;
  }
}

const useFile = process.env.USE_FILE_STORAGE !== 'false';
export const storage = useFile ? new FileStorage(process.env.GAME_STATE_FILE) : new MemStorage();
