import { QueryClient } from '@tanstack/react-query';
import { clearAuthCache } from './auth';

export async function handleInvalidSession(queryClient?: QueryClient, options?: { navigateTo?: string }) {
  try {
    // Clear persisted session
    try { localStorage.removeItem('playerId'); localStorage.removeItem('playerName'); } catch {}

    // Clear in-memory auth cache
    try { clearAuthCache(); } catch {}

    // Invalidate important queries so UI reflects logged-out state
    try {
      if (queryClient) {
        // invalidate game and player-stats caches
        try { queryClient.invalidateQueries({ queryKey: ['/api/game'] }); } catch {}
        try { queryClient.invalidateQueries({ queryKey: ['/api/player-stats'] }); } catch {}
      }
    } catch (err) {}

    // Navigation is intentionally owned by App-level guard.
  } catch (err) {
    // best-effort only
  }
}

export default handleInvalidSession;
