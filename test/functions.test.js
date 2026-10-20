import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('/api/time: memakai offset header Date BMKG', async () => {
  const { onRequestGet } = await import('../functions/api/time.js');
  const bmkgNow = Date.now() + 120_000; // anggap jam BMKG 2 menit lebih cepat
  globalThis.fetch = async () => new Response('ok', { headers: { Date: new Date(bmkgNow).toUTCString() } });

  const body = await (await onRequestGet()).json();
  assert.equal(body.source, 'jam.bmkg.go.id');
  assert.equal(body.stale, false);
  assert.ok(Math.abs(body.epoch_ms - bmkgNow) < 1500, `selisih ${body.epoch_ms - bmkgNow} ms`);
});
