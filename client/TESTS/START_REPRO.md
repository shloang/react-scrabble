Reproducing start crash (race between start and client navigation)

Steps to reproduce manually:

1. Open two browser windows/tabs to the running app (localhost).
2. In one window, join as Player A (host). In the other, join as Player B.
3. In Player A (host), mark both players ready and click "Начать игру".
4. Immediately (or within ~100-300ms) in Player B window, click "Войти в игру" or observe auto-enter behavior.
5. If navigation happens before the server has added Player B to the authoritative game state, the Game UI may attempt to dereference the missing player and crash.

Quick automated snippet (run in browser console of the joining client to simulate fast navigation):

// 1) Trigger server start as host (run in host console)
fetch('/api/game/start', { method: 'POST' }).then(r => r.json()).then(console.log).catch(console.error);

// 2) Immediately navigate the joining client to the Game route (run in joining client's console)
// This simulates the window navigating before server state is fully visible.
setTimeout(() => { window.location.href = '/'; }, 50);

Notes:
- No external dependencies required; run these snippets from DevTools console.
- The fixes in client code add defensive checks and a short wait/refetch before navigating, which mitigates this race.
