import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveCacheBadgeState } from '../client/src/lib/statsCacheDisplay.ts';

test('shows loading state while server stats query is loading', () => {
  const out = deriveCacheBadgeState({
    serverStats: null,
    serverStatsLoading: true,
    serverStatsFetching: false,
    serverStatsError: false,
    now: 1_700_000_000_000,
  });

  assert.equal(out.variant, 'outline');
  assert.equal(out.label, 'Загрузка');
});

test('shows cache error state when query errors', () => {
  const out = deriveCacheBadgeState({
    serverStats: null,
    serverStatsLoading: false,
    serverStatsFetching: false,
    serverStatsError: true,
    now: 1_700_000_000_000,
  });

  assert.equal(out.variant, 'destructive');
  assert.equal(out.label, 'Ошибка кэша');
});

test('shows stale state when staleAt is in the past', () => {
  const out = deriveCacheBadgeState({
    serverStats: {
      staleAt: 1_700_000_000_000,
      expiresAt: 1_700_000_060_000,
      cacheStatus: 'fresh',
    },
    serverStatsLoading: false,
    serverStatsFetching: false,
    serverStatsError: false,
    now: 1_700_000_001_000,
  });

  assert.equal(out.stale, true);
  assert.equal(out.expired, false);
  assert.equal(out.variant, 'outline');
  assert.equal(out.label, 'Кэш устарел');
});

test('shows expired state when expiresAt is in the past', () => {
  const out = deriveCacheBadgeState({
    serverStats: {
      staleAt: 1_700_000_000_000,
      expiresAt: 1_700_000_010_000,
      cacheStatus: 'stale',
    },
    serverStatsLoading: false,
    serverStatsFetching: false,
    serverStatsError: false,
    now: 1_700_000_011_000,
  });

  assert.equal(out.expired, true);
  assert.equal(out.variant, 'destructive');
  assert.equal(out.label, 'Кэш истек');
});

test('shows refresh state while background fetching fresh stats', () => {
  const out = deriveCacheBadgeState({
    serverStats: {
      staleAt: 1_700_000_050_000,
      expiresAt: 1_700_000_100_000,
      cacheStatus: 'fresh',
    },
    serverStatsLoading: false,
    serverStatsFetching: true,
    serverStatsError: false,
    now: 1_700_000_001_000,
  });

  assert.equal(out.variant, 'outline');
  assert.equal(out.label, 'Обновление');
});

test('shows fresh state for healthy cache metadata', () => {
  const out = deriveCacheBadgeState({
    serverStats: {
      staleAt: 1_700_000_050_000,
      expiresAt: 1_700_000_100_000,
      cacheStatus: 'fresh',
    },
    serverStatsLoading: false,
    serverStatsFetching: false,
    serverStatsError: false,
    now: 1_700_000_001_000,
  });

  assert.equal(out.variant, 'secondary');
  assert.equal(out.label, 'Кэш свежий');
});

test('uses deterministic precedence when state signals conflict', () => {
  const errorOut = deriveCacheBadgeState({
    serverStats: {
      staleAt: 1_700_000_000_000,
      expiresAt: 1_700_000_000_000,
      cacheStatus: 'expired',
    },
    serverStatsLoading: true,
    serverStatsFetching: true,
    serverStatsError: true,
    now: 1_700_000_001_000,
  });
  assert.equal(errorOut.label, 'Ошибка кэша');
  assert.equal(errorOut.variant, 'destructive');

  const loadingOut = deriveCacheBadgeState({
    serverStats: {
      staleAt: 1_700_000_000_000,
      expiresAt: 1_700_000_000_000,
      cacheStatus: 'expired',
    },
    serverStatsLoading: true,
    serverStatsFetching: true,
    serverStatsError: false,
    now: 1_700_000_001_000,
  });
  assert.equal(loadingOut.label, 'Загрузка');
  assert.equal(loadingOut.variant, 'outline');

  const expiredOut = deriveCacheBadgeState({
    serverStats: {
      staleAt: 1_700_000_000_000,
      expiresAt: 1_700_000_000_000,
      cacheStatus: 'stale',
    },
    serverStatsLoading: false,
    serverStatsFetching: true,
    serverStatsError: false,
    now: 1_700_000_001_000,
  });
  assert.equal(expiredOut.label, 'Кэш истек');
  assert.equal(expiredOut.variant, 'destructive');
});
