import type { GameState } from '@shared/schema';

export function hasGameInProgress(state?: GameState | null): boolean {
  return !!state?.currentPlayer && (state.turn || 0) > 0 && !state.gameEnded;
}

export function shouldRouteGameToLobby(state: GameState | null | undefined, playerId: string | null): boolean {
  if (!state || !playerId || state.gameEnded || hasGameInProgress(state)) return false;
  return Array.isArray(state.players) && state.players.some(player => player.id === playerId);
}
