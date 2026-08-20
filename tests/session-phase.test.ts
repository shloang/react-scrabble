import test from 'node:test';
import assert from 'node:assert/strict';
import type { GameState } from '../shared/schema.ts';
import { hasGameInProgress, shouldRouteGameToLobby } from '../client/src/lib/sessionPhase.ts';

function makeState(overrides?: Partial<GameState>): GameState {
  return {
    board: Array.from({ length: 15 }, () => Array(15).fill(null)),
    tileBag: [],
    players: [{ id: 'p1', name: 'Alice', rack: [], score: 0 }],
    currentPlayer: null,
    turn: 0,
    moves: [],
    gameEnded: false,
    ...overrides,
  };
}

test('a persisted lobby reopened at the game route returns its player to the lobby', () => {
  const persistedLobby = makeState();

  assert.equal(hasGameInProgress(persistedLobby), false);
  assert.equal(shouldRouteGameToLobby(persistedLobby, 'p1'), true);
});

test('active and ended games remain available at the game route', () => {
  const activeGame = makeState({ currentPlayer: 'p1', turn: 1 });
  const endedGame = makeState({ gameEnded: true, winnerId: 'p1' });

  assert.equal(hasGameInProgress(activeGame), true);
  assert.equal(shouldRouteGameToLobby(activeGame, 'p1'), false);
  assert.equal(shouldRouteGameToLobby(endedGame, 'p1'), false);
});

test('a stale local player id does not trigger lobby routing', () => {
  assert.equal(shouldRouteGameToLobby(makeState(), 'missing-player'), false);
});
