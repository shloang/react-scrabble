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

export async function updateGameState(gameState: GameState): Promise<void> {
  const response = await fetch('/api/game/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gameState)
  });
  if (!response.ok) {
    throw new Error('Failed to update game state');
  }
}

export async function validateWord(word: string): Promise<boolean> {
  const response = await fetch(`/api/validate-word/${encodeURIComponent(word)}`);
  if (!response.ok) {
    throw new Error('Failed to validate word');
  }
  const data = await response.json();
  return data.isValid;
}
