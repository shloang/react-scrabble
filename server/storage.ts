import { type GameState } from "@shared/schema";
import { createHash } from "crypto";
import fs from 'fs/promises';
import path from 'path';

export interface IStorage {
  getGameState(): Promise<GameState | undefined>;
  saveGameState(gameState: GameState): Promise<void>;
}

export class MemStorage implements IStorage {
  private gameState: GameState | undefined;
  private credentials: Record<string, string>; // map playerId -> passwordHash

  constructor() {
    this.gameState = undefined;
    this.credentials = {};
  }

  async getGameState(): Promise<GameState | undefined> {
    return this.gameState;
  }

  async saveGameState(gameState: GameState): Promise<void> {
    this.gameState = gameState;
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
  private credPath: string;
  private credentials: Record<string, string>;

  constructor(filePath?: string) {
    this.filePath = filePath || (process.env.GAME_STATE_FILE || 'data/game-state.json');
    this.credPath = (process.env.GAME_CRED_FILE || 'data/credentials.json');
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
