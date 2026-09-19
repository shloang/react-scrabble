import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJson } from '../client/src/lib/apiClient.ts';

test('stalled requests time out and the next request can succeed', async (t) => {
  let signal: AbortSignal | undefined;
  const fetchMock = t.mock.method(globalThis, 'fetch', (_url: string, init: RequestInit) => {
    signal = init.signal!;
    return new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  });
  await assert.rejects(requestJson('/api/game/update', { method: 'POST' }, 'Update failed', 10), /timed out/);
  assert.equal(signal?.aborted, true);
  fetchMock.mock.mockImplementation(async () => new Response(JSON.stringify({ success: true })));
  assert.deepEqual(await requestJson('/api/game', {}, 'Read failed', 1000), { success: true });
});

test('timeout also covers a response whose JSON body never completes', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }),
  }));
  await assert.rejects(requestJson('/api/game', {}, 'Read failed', 10), /timed out/);
});
