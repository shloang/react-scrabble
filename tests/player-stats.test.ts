import test from 'node:test';
import assert from 'node:assert/strict';
import { getStats, incrementDraw } from '../client/src/lib/playerStats.ts';

test('old local stats default draws to zero and keep existing totals', () => {
  const values = new Map<string, string>();
  values.set('rs_player_stats', JSON.stringify({
    p1: { wins: 4, losses: 3, games: 7 },
  }));

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });

  assert.deepEqual(getStats('p1'), { wins: 4, losses: 3, draws: 0, games: 7 });
  assert.deepEqual(incrementDraw('p1'), { wins: 4, losses: 3, draws: 1, games: 8 });

  delete (globalThis as any).localStorage;
});
