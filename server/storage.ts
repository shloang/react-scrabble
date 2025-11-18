import { type GameState } from "@shared/schema";
import { createHash } from "crypto";

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

export const storage = new MemStorage();
