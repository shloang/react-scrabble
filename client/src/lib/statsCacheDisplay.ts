export type CacheBadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

export type ServerStatsLike = {
  staleAt?: number | null;
  expiresAt?: number | null;
  isStale?: boolean;
  isExpired?: boolean;
  cacheStatus?: 'fresh' | 'stale' | 'expired';
};

export type CacheBadgeInput = {
  serverStats?: ServerStatsLike | null;
  serverStatsLoading: boolean;
  serverStatsFetching: boolean;
  serverStatsError: boolean;
  now?: number;
};

export type CacheBadgeState = {
  variant: CacheBadgeVariant;
  label: string;
  stale: boolean;
  expired: boolean;
};

export function deriveCacheBadgeState(input: CacheBadgeInput): CacheBadgeState {
  const {
    serverStats,
    serverStatsLoading,
    serverStatsFetching,
    serverStatsError,
    now = Date.now(),
  } = input;

  const stale = Boolean(
    serverStats
    && (serverStats.isStale
      || (Number.isFinite(serverStats.staleAt) && now >= Number(serverStats.staleAt))),
  );

  const expired = Boolean(
    serverStats
    && (serverStats.isExpired
      || (Number.isFinite(serverStats.expiresAt) && now >= Number(serverStats.expiresAt))),
  );

  let variant: CacheBadgeVariant = 'outline';
  let label = 'Нет данных';

  if (serverStatsError) {
    variant = 'destructive';
    label = 'Ошибка кэша';
  } else if (serverStatsLoading) {
    variant = 'outline';
    label = 'Загрузка';
  } else if (expired || serverStats?.cacheStatus === 'expired') {
    variant = 'destructive';
    label = 'Кэш истек';
  } else if (stale || serverStats?.cacheStatus === 'stale') {
    variant = 'outline';
    label = 'Кэш устарел';
  } else if (serverStatsFetching) {
    variant = 'outline';
    label = 'Обновление';
  } else {
    variant = 'secondary';
    label = 'Кэш свежий';
  }

  return {
    variant,
    label,
    stale,
    expired,
  };
}
