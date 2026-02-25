const TTL = 5 * 60 * 1000; // 5 minutes
type CacheVal = { ok: boolean; player?: any };
type CacheEntry = { ts: number; val: CacheVal };
const cache = new Map<string, CacheEntry>();

export async function validatePlayerId(playerId: string, force = false): Promise<CacheVal> {
  if (!playerId) return { ok: false };
  const now = Date.now();
  const cached = cache.get(playerId);
  // if not forcing and cached value within TTL, return it
  if (!force && cached && (now - cached.ts) <= TTL) return cached.val;
  // if cached and expired, remove it
  if (cached && (now - cached.ts) > TTL) cache.delete(playerId);

  try {
    const resp = await fetch(`/api/player/${encodeURIComponent(playerId)}`);
    if (!resp.ok) {
      // Don't mutate localStorage here; let callers decide how to handle invalid sessions.
      const out = { ok: false };
      cache.set(playerId, { ts: now, val: out });
      return out;
    }
    const data = await resp.json();
    const out = { ok: true, player: data };
    cache.set(playerId, { ts: now, val: out });
    return out;
  } catch (err) {
    const out = { ok: false };
    cache.set(playerId, { ts: now, val: out });
    return out;
  }
}

// Clear cached validation entries. If `playerId` is provided only that entry
// is removed, otherwise the entire cache is cleared.
export function clearAuthCache(playerId?: string) {
  try {
    if (playerId) cache.delete(playerId);
    else cache.clear();
  } catch (err) {
    // ignore
  }
}
