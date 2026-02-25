export type PlayerStats = { wins: number; losses: number; games: number };

const STORAGE_KEY = 'rs_player_stats';

function safeParse(raw: string | null): Record<string, PlayerStats> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, PlayerStats> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (typeof val !== 'object' || val === null) continue;
      const wins = Number((val as any).wins) || 0;
      const losses = Number((val as any).losses) || 0;
      const games = Number((val as any).games) || 0;
      out[key] = { wins, losses, games };
    }
    return out;
  } catch {
    return {};
  }
}

export function loadAll(): Record<string, PlayerStats> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return safeParse(raw);
  } catch {
    return {};
  }
}

export function saveAll(all: Record<string, PlayerStats>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // ignore storage errors
  }
}

export function getStats(playerId: string): PlayerStats {
  const all = loadAll();
  return all[playerId] ?? { wins: 0, losses: 0, games: 0 };
}

export function incrementWin(playerId: string): PlayerStats {
  const all = loadAll();
  const prev = all[playerId] ?? { wins: 0, losses: 0, games: 0 };
  const next: PlayerStats = { wins: prev.wins + 1, losses: prev.losses, games: prev.games + 1 };
  all[playerId] = next;
  saveAll(all);
  return next;
}

export function incrementLoss(playerId: string): PlayerStats {
  const all = loadAll();
  const prev = all[playerId] ?? { wins: 0, losses: 0, games: 0 };
  const next: PlayerStats = { wins: prev.wins, losses: prev.losses + 1, games: prev.games + 1 };
  all[playerId] = next;
  saveAll(all);
  return next;
}

export function getAllStats(): Record<string, PlayerStats> {
  return loadAll();
}
