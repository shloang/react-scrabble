import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import type { GameState, Player } from '@shared/schema';

type RegisterRoutesFn = (app: Express) => Promise<Server>;
type StorageLike = {
  getGameState: () => Promise<GameState | undefined>;
  saveGameState: (gameState: GameState) => Promise<void>;
  setPlayerPassword?: (playerId: string, password: string) => Promise<void>;
};

let baseUrl = '';
let server: Server;
let app: Express;
let registerRoutes: RegisterRoutesFn;
let storage: StorageLike;

const realDateNow = Date.now;

function setFakeNow(now: number) {
  Date.now = () => now;
}

function resetDateNow() {
  Date.now = realDateNow;
}

function makePlayer(id: string, name: string, score: number): Player {
  return {
    id,
    name,
    score,
    rack: [null, null, null, null, null, null, null],
    ready: false,
  };
}

function makeState(opts?: { revision?: number; started?: boolean; players?: Player[] }): GameState {
  const players = opts?.players || [
    makePlayer('p1', 'Alice', 12),
    makePlayer('p2', 'Bob', 7),
  ];

  return {
    board: Array(15).fill(null).map(() => Array(15).fill(null)),
    tileBag: [],
    players,
    currentPlayer: opts?.started ? players[0].id : null,
    turn: opts?.started ? 1 : 0,
    moves: [],
    paused: false,
    pausedBy: null,
    turnStart: null,
    pausedAt: null,
    gameEnded: false,
    winnerId: undefined,
    endReason: undefined,
    previews: {},
    revision: opts?.revision ?? 1,
  };
}

async function getStats(path: string) {
  const resp = await fetch(`${baseUrl}${path}`);
  const body = await resp.json();
  return { status: resp.status, body };
}

before(async () => {
  process.env.USE_FILE_STORAGE = 'false';

  const expressModule = await import('express');
  const routesModule = await import('../server/routes.ts');
  const storageModule = await import('../server/storage.ts');

  registerRoutes = routesModule.registerRoutes;
  storage = storageModule.storage as StorageLike;

  app = expressModule.default();
  app.use(expressModule.default.json());
  app.use(expressModule.default.urlencoded({ extended: false }));

  server = await registerRoutes(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  resetDateNow();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
});

beforeEach(async () => {
  resetDateNow();
  await storage.saveGameState(makeState({ revision: 10 }));
});

test('returns fresh stats and reuses cached entry on immediate follow-up', async () => {
  setFakeNow(1_700_000_000_000);

  const first = await getStats('/api/player-stats/p1');
  assert.equal(first.status, 200);
  assert.equal(first.body.cacheStatus, 'fresh');
  assert.equal(first.body.isStale, false);
  assert.equal(first.body.isExpired, false);
  assert.equal(first.body.cachedAt, 1_700_000_000_000);

  setFakeNow(1_700_000_000_500);
  const second = await getStats('/api/player-stats/p1');

  assert.equal(second.status, 200);
  assert.equal(second.body.cacheStatus, 'fresh');
  assert.equal(second.body.cachedAt, first.body.cachedAt);
  assert.equal(second.body.ageMs, 500);
});

test('marks stats as stale once staleAt threshold is crossed without expiration', async () => {
  setFakeNow(1_700_000_100_000);
  const first = await getStats('/api/player-stats/p1');
  assert.equal(first.status, 200);

  const staleAt = Number(first.body.staleAt);
  const expiresAt = Number(first.body.expiresAt);
  assert.ok(Number.isFinite(staleAt));
  assert.ok(Number.isFinite(expiresAt));

  const nextNow = Math.min(expiresAt - 1, staleAt + 1);
  setFakeNow(nextNow);

  const second = await getStats('/api/player-stats/p1');
  assert.equal(second.status, 200);
  assert.equal(second.body.cacheStatus, 'stale');
  assert.equal(second.body.isStale, true);
  assert.equal(second.body.isExpired, false);
  assert.equal(second.body.cachedAt, first.body.cachedAt);
});

test('rebuilds cache when score or state revision drifts', async () => {
  setFakeNow(1_700_000_200_000);
  const first = await getStats('/api/player-stats/p1');
  assert.equal(first.status, 200);

  const updated = makeState({
    revision: 11,
    players: [
      makePlayer('p1', 'Alice', 99),
      makePlayer('p2', 'Bob', 7),
    ],
  });
  await storage.saveGameState(updated);

  setFakeNow(1_700_000_201_000);
  const second = await getStats('/api/player-stats/p1');

  assert.equal(second.status, 200);
  assert.equal(second.body.cacheStatus, 'fresh');
  assert.equal(second.body.score, 99);
  assert.equal(second.body.cachedAt, 1_700_000_201_000);
  assert.notEqual(second.body.cachedAt, first.body.cachedAt);
});

test('rebuilds cache when only state revision drifts while score stays the same', async () => {
  setFakeNow(1_700_000_210_000);
  const first = await getStats('/api/player-stats/p1');
  assert.equal(first.status, 200);
  assert.equal(first.body.score, 12);

  const updated = makeState({
    revision: 11,
    players: [
      makePlayer('p1', 'Alice', 12),
      makePlayer('p2', 'Bob', 7),
    ],
  });
  await storage.saveGameState(updated);

  setFakeNow(1_700_000_211_000);
  const second = await getStats('/api/player-stats/p1');

  assert.equal(second.status, 200);
  assert.equal(second.body.cacheStatus, 'fresh');
  assert.equal(second.body.score, 12);
  assert.equal(second.body.cachedAt, 1_700_000_211_000);
  assert.notEqual(second.body.cachedAt, first.body.cachedAt);
});

test('rebuilds cache when only score drifts while state revision stays the same', async () => {
  setFakeNow(1_700_000_220_000);
  const first = await getStats('/api/player-stats/p1');
  assert.equal(first.status, 200);
  assert.equal(first.body.score, 12);

  const updated = makeState({
    revision: 10,
    players: [
      makePlayer('p1', 'Alice', 42),
      makePlayer('p2', 'Bob', 7),
    ],
  });
  await storage.saveGameState(updated);

  setFakeNow(1_700_000_221_000);
  const second = await getStats('/api/player-stats/p1');

  assert.equal(second.status, 200);
  assert.equal(second.body.cacheStatus, 'fresh');
  assert.equal(second.body.score, 42);
  assert.equal(second.body.cachedAt, 1_700_000_221_000);
  assert.notEqual(second.body.cachedAt, first.body.cachedAt);
});

test('returns 404 when game state is unavailable', async () => {
  await storage.saveGameState(undefined as unknown as GameState);
  const out = await getStats('/api/player-stats/p1');

  assert.equal(out.status, 404);
  assert.equal(out.body.error, 'No game state');
});

test('returns 401 when anonymous stats read is attempted after game starts', async () => {
  await storage.saveGameState(makeState({ started: true, revision: 12 }));

  const out = await getStats('/api/player-stats/p1');

  assert.equal(out.status, 401);
  assert.match(String(out.body.error || ''), /requesterId required/i);
});

test('returns 403 when requester is not a participant', async () => {
  await storage.saveGameState(makeState({ started: true, revision: 13 }));

  const out = await getStats('/api/player-stats/p1?requesterId=outsider');

  assert.equal(out.status, 403);
  assert.match(String(out.body.error || ''), /not a participant/i);
});

test('returns 401 for invalid requester password', async () => {
  await storage.saveGameState(makeState({ started: true, revision: 14 }));
  if (storage.setPlayerPassword) {
    await storage.setPlayerPassword('p2', 'correct-password');
  }

  const out = await getStats('/api/player-stats/p1?requesterId=p2&requesterPassword=wrong-password');

  assert.equal(out.status, 401);
  assert.match(String(out.body.error || ''), /invalid requester credentials/i);
});
