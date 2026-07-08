import { GameState } from "@shared/schema";
import { apiGet, apiPost, handleApiResponse } from './apiClient';

export async function getGameState(): Promise<GameState | null> {
  return apiGet<GameState | null>('/api/game', 'Failed to get game state');
}

export async function initializeGame(): Promise<GameState> {
  return apiPost<GameState>('/api/game/init', undefined, 'Failed to initialize game');
}

export async function joinGame(playerName: string, password: string): Promise<{ playerId: string; gameState: GameState; signalingToken?: string; signalingTokenTtlMs?: number }> {
  const response = await fetch('/api/game/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerName, password })
  });
  return handleApiResponse(response, 'Failed to join game');
}

export async function leaveGame(playerId: string): Promise<{ success: boolean; gameState?: GameState | null }> {
  return apiPost<{ success: boolean; gameState?: GameState | null }, { playerId: string }>('/api/game/leave', { playerId }, 'Failed to leave game');
}

export async function kickPlayer(requesterId: string, targetPlayerId: string): Promise<{ success: boolean; gameState?: GameState | null }> {
  return apiPost<
    { success: boolean; gameState?: GameState | null },
    { requesterId: string; targetPlayerId: string }
  >('/api/game/kick', { requesterId, targetPlayerId }, 'Failed to remove player');
}

export async function resetSession(
  requesterId: string,
  options?: { preservePlayers?: boolean },
): Promise<{ success: boolean; gameState?: GameState | null }> {
  return apiPost<
    { success: boolean; gameState?: GameState | null },
    { requesterId: string; preservePlayers?: boolean }
  >('/api/game/reset-session', { requesterId, preservePlayers: options?.preservePlayers }, 'Failed to reset session');
}

export type UpdateResponse = { success: boolean; gameState?: GameState };

export async function updateGameState(gameState: GameState): Promise<UpdateResponse> {
  return apiPost<UpdateResponse, GameState>('/api/game/update', gameState, 'Failed to update game state');
}

export async function sendPreview(playerId: string, placedTiles: Array<{ row: number; col: number; letter: string; blank?: boolean }>) {
  return apiPost('/api/game/preview', { playerId, placedTiles }, 'Failed to send preview');
}

export type WordValidation = { isValid: boolean; extract?: string | null; word?: string };

export async function validateWord(word: string): Promise<WordValidation> {
  const data = await apiGet<any>(`/api/validate-word/${encodeURIComponent(word)}`, 'Failed to validate word');
  return { isValid: !!data.isValid, extract: data.extract || null, word: data.word };
}
