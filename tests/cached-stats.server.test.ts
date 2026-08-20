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
  savePlayerStats?: (stats: Record<string, { wins: number; losses: number; draws?: number; games: number; updatedAt: number; lastGameKey?: string }>) => Promise<void>;
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

async function postJson(path: string, body: unknown) {
  const resp = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  return { status: resp.status, body: data };
}

async function getText(path: string) {
  const resp = await fetch(`${baseUrl}${path}`);
  const text = await resp.text();
  return { status: resp.status, text, contentType: resp.headers.get('content-type') || '' };
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
  if (storage.savePlayerStats) await storage.savePlayerStats({});
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

test('keeps lifetime stats when cache metadata expires', async () => {
  if (storage.savePlayerStats) {
    await storage.savePlayerStats({
      p1: { wins: 3, losses: 2, games: 5, updatedAt: 1_699_999_000_000 },
    });
  }

  setFakeNow(1_700_000_100_000);
  const first = await getStats('/api/player-stats/p1');
  assert.equal(first.status, 200);
  assert.equal(first.body.wins, 3);
  assert.equal(first.body.losses, 2);
  assert.equal(first.body.draws, 0);
  assert.equal(first.body.games, 5);

  setFakeNow(Number(first.body.expiresAt) + 1);
  const second = await getStats('/api/player-stats/p1');
  assert.equal(second.status, 200);
  assert.equal(second.body.cacheStatus, 'fresh');
  assert.equal(second.body.wins, 3);
  assert.equal(second.body.losses, 2);
  assert.equal(second.body.draws, 0);
  assert.equal(second.body.games, 5);
});

test('records ended game stats once and reuses them after reset', async () => {
  const endedState = makeState({
    revision: 19,
    started: true,
    players: [
      makePlayer('p1', 'Alice', 50),
      makePlayer('p2', 'Bob', 20),
    ],
  });
  endedState.gameEnded = true;
  endedState.winnerId = 'p1';
  endedState.endReason = 'test-ended';
  endedState.sessionCreatedAt = 1_700_001_000_000;
  endedState.moves = [{ playerId: 'p1', playerName: 'Alice', words: ['TEST'], score: 50, turn: 1, timestamp: 1_700_001_010_000, type: 'play' }];
  await storage.saveGameState(endedState);

  setFakeNow(1_700_001_020_000);
  const winnerStats = await getStats('/api/player-stats/p1');
  assert.equal(winnerStats.status, 200);
  assert.equal(winnerStats.body.wins, 1);
  assert.equal(winnerStats.body.losses, 0);
  assert.equal(winnerStats.body.games, 1);

  const reset = await postJson('/api/game/reset-session', { requesterId: 'p2', preservePlayers: true });
  assert.equal(reset.status, 200);

  const afterReset = await getStats('/api/player-stats/p1');
  assert.equal(afterReset.status, 200);
  assert.equal(afterReset.body.wins, 1);
  assert.equal(afterReset.body.losses, 0);
  assert.equal(afterReset.body.games, 1);

  const loserStats = await getStats('/api/player-stats/p2');
  assert.equal(loserStats.status, 200);
  assert.equal(loserStats.body.wins, 0);
  assert.equal(loserStats.body.losses, 1);
  assert.equal(loserStats.body.games, 1);
});

test('records tied leaders as draws while lower-scoring players receive a loss', async () => {
  if (storage.savePlayerStats) {
    await storage.savePlayerStats({
      p1: { wins: 3, losses: 2, games: 5, updatedAt: 1_700_001_000_000 },
    });
  }

  const endedState = makeState({
    revision: 20,
    started: true,
    players: [
      makePlayer('p1', 'Alice', 42),
      makePlayer('p2', 'Bob', 42),
      makePlayer('p3', 'Carol', 31),
    ],
  });
  endedState.gameEnded = true;
  endedState.winnerId = undefined;
  endedState.drawPlayerIds = ['p1', 'p2'];
  endedState.endReason = 'all_skipped_twice';
  endedState.sessionCreatedAt = 1_700_001_100_000;
  endedState.moves = [
    { playerId: 'p3', playerName: 'Carol', words: [], score: 0, turn: 9, timestamp: 1_700_001_110_000, type: 'skip' },
  ];
  await storage.saveGameState(endedState);

  setFakeNow(1_700_001_120_000);
  const alice = await getStats('/api/player-stats/p1');
  const bob = await getStats('/api/player-stats/p2');
  const carol = await getStats('/api/player-stats/p3');

  assert.deepEqual(
    { wins: alice.body.wins, losses: alice.body.losses, draws: alice.body.draws, games: alice.body.games },
    { wins: 3, losses: 2, draws: 1, games: 6 },
  );
  assert.deepEqual(
    { wins: bob.body.wins, losses: bob.body.losses, draws: bob.body.draws, games: bob.body.games },
    { wins: 0, losses: 0, draws: 1, games: 1 },
  );
  assert.deepEqual(
    { wins: carol.body.wins, losses: carol.body.losses, draws: carol.body.draws, games: carol.body.games },
    { wins: 0, losses: 1, draws: 0, games: 1 },
  );

  const aliceAgain = await getStats('/api/player-stats/p1');
  assert.equal(aliceAgain.body.games, 6);
});

test('reuses lifetime stats when the same player rejoins with a new id', async () => {
  if (storage.savePlayerStats) {
    await storage.savePlayerStats({
      oldAliceId: { wins: 2, losses: 1, games: 3, updatedAt: 1_700_001_000_000 },
    });
  }
  await storage.saveGameState(makeState({
    revision: 21,
    players: [
      makePlayer('oldAliceId', 'Alice', 0),
      makePlayer('p2', 'Bob', 0),
    ],
  }));

  const migrated = await getStats('/api/player-stats/oldAliceId');
  assert.equal(migrated.status, 200);
  assert.equal(migrated.body.wins, 2);
  assert.equal(migrated.body.losses, 1);
  assert.equal(migrated.body.games, 3);

  await storage.saveGameState(makeState({
    revision: 22,
    players: [
      makePlayer('newAliceId', 'Alice', 0),
      makePlayer('p2', 'Bob', 0),
    ],
  }));

  const rejoined = await getStats('/api/player-stats/newAliceId');
  assert.equal(rejoined.status, 200);
  assert.equal(rejoined.body.wins, 2);
  assert.equal(rejoined.body.losses, 1);
  assert.equal(rejoined.body.games, 3);
});

test('participant can remove stale players from a non-active lobby', async () => {
  await storage.saveGameState(makeState({
    revision: 23,
    players: [
      makePlayer('host', 'Host', 0),
      makePlayer('stale', 'Stale', 0),
      makePlayer('ready', 'Ready', 0),
    ],
  }));

  const removed = await postJson('/api/game/kick', { requesterId: 'ready', targetPlayerId: 'stale' });
  assert.equal(removed.status, 200);
  assert.deepEqual(
    removed.body.gameState.players.map((p: Player) => p.id),
    ['host', 'ready'],
  );
});

test('outsiders and active games cannot remove lobby players', async () => {
  await storage.saveGameState(makeState({
    revision: 24,
    players: [
      makePlayer('host', 'Host', 0),
      makePlayer('guest', 'Guest', 0),
    ],
  }));

  const denied = await postJson('/api/game/kick', { requesterId: 'outsider', targetPlayerId: 'host' });
  assert.equal(denied.status, 403);

  await storage.saveGameState(makeState({
    revision: 25,
    started: true,
    players: [
      makePlayer('host', 'Host', 0),
      makePlayer('guest', 'Guest', 0),
    ],
  }));

  const active = await postJson('/api/game/kick', { requesterId: 'host', targetPlayerId: 'guest' });
  assert.equal(active.status, 409);
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

test('ended-game reset preserves player identities and returns them to a fresh lobby', async () => {
  const endedState = makeState({
    revision: 20,
    started: true,
    players: [
      {
        ...makePlayer('p1', 'Alice', 99),
        rack: ['А', null, null, null, null, null, null],
        ready: true,
        voiceEnabled: true,
        originalScore: 120,
        tilePenalty: 21,
      },
      {
        ...makePlayer('p2', 'Bob', 70),
        rack: ['Б', null, null, null, null, null, null],
        ready: true,
        voiceEnabled: true,
        originalScore: 80,
        tilePenalty: 10,
      },
    ],
  });
  endedState.gameEnded = true;
  endedState.winnerId = 'p1';
  endedState.endReason = 'test-ended';

  await storage.saveGameState(endedState);

  const reset = await postJson('/api/game/reset-session', { requesterId: 'p2', preservePlayers: true });

  assert.equal(reset.status, 200);
  assert.equal(reset.body.success, true);
  assert.equal(reset.body.gameState.gameEnded, false);
  assert.equal(reset.body.gameState.currentPlayer, null);
  assert.equal(reset.body.gameState.turn, 0);
  assert.deepEqual(reset.body.gameState.moves, []);
  assert.deepEqual(reset.body.gameState.players.map((p: Player) => p.id), ['p1', 'p2']);

  const alice = reset.body.gameState.players.find((p: Player) => p.id === 'p1');
  const bob = reset.body.gameState.players.find((p: Player) => p.id === 'p2');
  assert.equal(alice.name, 'Alice');
  assert.equal(bob.name, 'Bob');
  assert.equal(alice.score, 0);
  assert.equal(bob.score, 0);
  assert.equal(alice.ready, false);
  assert.equal(bob.ready, false);
  assert.equal(alice.voiceEnabled, false);
  assert.equal(bob.voiceEnabled, false);
  assert.equal(alice.originalScore, undefined);
  assert.equal(alice.tilePenalty, undefined);
  assert.equal(alice.rack.length, 7);
  assert.equal(bob.rack.length, 7);

  const validate = await fetch(`${baseUrl}/api/player/p2`);
  assert.equal(validate.status, 200);
  const validatedPlayer = await validate.json();
  assert.equal(validatedPlayer.id, 'p2');
});

test('ended-game lobby return is idempotent for host after players are preserved', async () => {
  const endedState = makeState({
    revision: 21,
    started: true,
    players: [
      { ...makePlayer('p1', 'Alice', 44), ready: true, voiceEnabled: true },
      { ...makePlayer('p2', 'Bob', 33), ready: true, voiceEnabled: true },
    ],
  });
  endedState.gameEnded = true;
  endedState.winnerId = 'p1';
  endedState.endReason = 'test-ended';

  await storage.saveGameState(endedState);

  const firstReset = await postJson('/api/game/reset-session', { requesterId: 'p2', preservePlayers: true });
  assert.equal(firstReset.status, 200);
  assert.deepEqual(firstReset.body.gameState.players.map((p: Player) => p.id), ['p1', 'p2']);
  assert.equal(firstReset.body.gameState.gameEnded, false);

  const hostReturn = await postJson('/api/game/reset-session', { requesterId: 'p1', preservePlayers: true });
  assert.equal(hostReturn.status, 200);
  assert.deepEqual(hostReturn.body.gameState.players.map((p: Player) => p.id), ['p1', 'p2']);
  assert.equal(hostReturn.body.gameState.gameEnded, false);
  assert.equal(hostReturn.body.gameState.currentPlayer, null);

  const validateHost = await fetch(`${baseUrl}/api/player/p1`);
  const validateGuest = await fetch(`${baseUrl}/api/player/p2`);
  assert.equal(validateHost.status, 200);
  assert.equal(validateGuest.status, 200);
});

test('rejects removal or replacement of committed board tiles', async () => {
  const committedState = makeState({ started: true, revision: 30 });
  committedState.board[7][7] = { letter: 'A', blank: false };
  await storage.saveGameState(committedState);

  const removedState = structuredClone(committedState);
  removedState.board[7][7] = null;
  const removed = await postJson('/api/game/update', removedState);

  assert.equal(removed.status, 400);
  assert.match(String(removed.body.error || ''), /committed board tiles/i);

  const replacedState = structuredClone(committedState);
  replacedState.board[7][7] = { letter: 'B', blank: false };
  const replaced = await postJson('/api/game/update', replacedState);

  assert.equal(replaced.status, 400);
  assert.match(String(replaced.body.error || ''), /committed board tiles/i);

  const persisted = await storage.getGameState();
  assert.deepEqual(persisted?.board[7][7], { letter: 'A', blank: false });
});

test('rejects a timeout skip that carries unsubmitted board tiles', async () => {
  const activeState = makeState({ started: true, revision: 31 });
  await storage.saveGameState(activeState);

  const hybridSkip = structuredClone(activeState);
  hybridSkip.board[7][7] = { letter: 'A', blank: false };
  hybridSkip.currentPlayer = 'p2';
  hybridSkip.turn = 2;
  hybridSkip.moves = [{
    playerId: 'p1',
    playerName: 'Alice',
    words: [],
    score: 0,
    turn: 2,
    timestamp: Date.now(),
    type: 'skip',
    meta: null,
  }];

  const response = await postJson('/api/game/update', hybridSkip);

  assert.equal(response.status, 400);
  assert.match(String(response.body.error || ''), /cannot place board tiles/i);
  const persisted = await storage.getGameState();
  assert.equal(persisted?.board[7][7], null);
  assert.equal(persisted?.currentPlayer, 'p1');
  assert.equal(persisted?.moves.length, 0);
});

test('rejects a late skip from the player whose play already advanced the turn', async () => {
  const acceptedPlay = makeState({ started: true, revision: 32 });
  acceptedPlay.board[7][7] = { letter: 'A', blank: false };
  acceptedPlay.currentPlayer = 'p2';
  acceptedPlay.turn = 2;
  acceptedPlay.moves = [{
    playerId: 'p1',
    playerName: 'Alice',
    words: ['A'],
    score: 1,
    turn: 2,
    timestamp: Date.now() - 1,
    type: 'play',
    meta: { placedTiles: [{ row: 7, col: 7, letter: 'A' }] },
  }];
  await storage.saveGameState(acceptedPlay);

  const lateSkip = structuredClone(acceptedPlay);
  lateSkip.turn = 3;
  lateSkip.moves.push({
    playerId: 'p1',
    playerName: 'Alice',
    words: [],
    score: 0,
    turn: 3,
    timestamp: Date.now(),
    type: 'skip',
    meta: null,
  });

  const response = await postJson('/api/game/update', lateSkip);

  assert.equal(response.status, 409);
  assert.match(String(response.body.error || ''), /no longer owns/i);
  const persisted = await storage.getGameState();
  assert.equal(persisted?.moves.length, 1);
  assert.equal(persisted?.currentPlayer, 'p2');
  assert.deepEqual(persisted?.board[7][7], { letter: 'A', blank: false });
});

test('accepts a normal skip with an unchanged board and current move actor', async () => {
  const activeState = makeState({ started: true, revision: 33 });
  await storage.saveGameState(activeState);

  const validSkip = structuredClone(activeState);
  validSkip.currentPlayer = 'p2';
  validSkip.turn = 2;
  validSkip.moves = [{
    playerId: 'p1',
    playerName: 'Alice',
    words: [],
    score: 0,
    turn: 2,
    timestamp: Date.now(),
    type: 'skip',
    meta: null,
  }];

  const response = await postJson('/api/game/update', validSkip);

  assert.equal(response.status, 200);
  assert.equal(response.body.gameState.currentPlayer, 'p2');
  assert.equal(response.body.gameState.moves.at(-1)?.type, 'skip');
  assert.equal(response.body.gameState.board[7][7], null);
});

test('serves local word list without CommonJS __dirname', async () => {
  const out = await getText('/api/wordlist');

  assert.equal(out.status, 200);
  assert.match(out.contentType, /text\/plain/);
  assert.ok(out.text.length > 1000);
});
