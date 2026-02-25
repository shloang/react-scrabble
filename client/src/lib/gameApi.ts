import { GameState } from "@shared/schema";

export async function getGameState(): Promise<GameState | null> {
  const response = await fetch('/api/game');
  if (!response.ok) {
    throw new Error('Failed to get game state');
  }
  return response.json();
}

export async function initializeGame(): Promise<GameState> {
  const response = await fetch('/api/game/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!response.ok) {
    throw new Error('Failed to initialize game');
  }
  return response.json();
}

export async function joinGame(playerName: string, password: string): Promise<{ playerId: string; gameState: GameState }> {
  const response = await fetch('/api/game/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerName, password })
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to join game');
  }
  return response.json();
}

export async function leaveGame(playerId: string): Promise<{ success: boolean; gameState?: GameState | null }> {
  const response = await fetch('/api/game/leave', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error || 'Failed to leave game');
  }

  return response.json();
}

export type UpdateResponse = { success: boolean; gameState?: GameState };

export async function updateGameState(gameState: GameState): Promise<UpdateResponse> {
  const response = await fetch('/api/game/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gameState)
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error || 'Failed to update game state');
  }
  return response.json();
}

export async function sendPreview(playerId: string, placedTiles: Array<{ row: number; col: number; letter: string; blank?: boolean }>) {
  const response = await fetch('/api/game/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, placedTiles })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error || 'Failed to send preview');
  }
  return response.json();
}

export type WordValidation = { isValid: boolean; extract?: string | null; word?: string };

export async function validateWord(word: string): Promise<WordValidation> {
  const response = await fetch(`/api/validate-word/${encodeURIComponent(word)}`);
  if (!response.ok) {
    throw new Error('Failed to validate word');
  }
  const data = await response.json();
  return { isValid: !!data.isValid, extract: data.extract || null, word: data.word };
}
