import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchLatestFromApi } from '../scripts/youtube-api.mjs';
import { selectLatest } from '../scripts/youtube.mjs';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const CHANNEL = 'UC8Do0tOnpnz1ydOZV0XKS3g';
const KEY = 'TEST_KEY_123';

const video = (id, title, publishedAt, { embeddable = true, live = 'none', privacy = 'public' } = {}) => ({
  id, snippet: { title, publishedAt, liveBroadcastContent: live }, status: { embeddable, privacyStatus: privacy },
});

function mockApi({ uulfStatus = 200, items, videos }) {
  const calls = [];
  globalThis.fetch = async url => {
    const u = new URL(url);
    calls.push(u);
    if (u.pathname.endsWith('/playlistItems')) {
      if (u.searchParams.get('playlistId').startsWith('UULF') && uulfStatus !== 200) {
        return new Response(JSON.stringify({ error: { message: 'not found', errors: [{ reason: 'playlistNotFound' }] } }), { status: uulfStatus });
      }
      return Response.json({ items: items.map(id => ({ contentDetails: { videoId: id } })) });
    }
    return Response.json({ items: videos });
  };
  return calls;
}

test('API: pakai UULF, saring live/terjadwal, non-embed, non-publik; terbaru dulu', async () => {
  const calls = mockApi({
    items: ['KAMIS000022', 'LIVENOW0001', 'NOEMBED0001', 'RABU0000021'],
    videos: [
      video('KAMIS000022', 'Prakiraan Cuaca Esok Hari, Kamis, 22 Oktober 2026', '2026-10-21T08:53:00Z'),
      video('LIVENOW0001', 'Siaran langsung', '2026-10-21T09:00:00Z', { live: 'upcoming' }),
      video('NOEMBED0001', 'Tidak boleh embed', '2026-10-21T07:00:00Z', { embeddable: false }),
      video('RABU0000021', 'Prakiraan Cuaca Esok Hari Rabu, 21 Oktober 2026', '2026-10-20T08:16:08Z'),
    ],
  });

  const entries = await fetchLatestFromApi(CHANNEL, KEY);
  const picked  = selectLatest(entries, { max: 3, forecastPrefix: 'Prakiraan Cuaca Esok Hari' });

  assert.deepEqual(picked.map(v => v.id), ['KAMIS000022', 'RABU0000021']);
  assert.equal(picked[0].forecastDate, '2026-10-22');
  assert.equal(picked[0].publishedAt, '2026-10-21T08:53:00.000Z');
  assert.equal(calls[0].searchParams.get('playlistId'), 'UULF8Do0tOnpnz1ydOZV0XKS3g');
  assert.equal(calls[1].searchParams.get('id'), 'KAMIS000022,LIVENOW0001,NOEMBED0001,RABU0000021');
});

test('API: UULF tidak ada -> pakai UU', async () => {
  const calls = mockApi({ uulfStatus: 404, items: ['AAAAAAAAAAA'], videos: [video('AAAAAAAAAAA', 'X', '2026-10-21T00:00:00Z')] });
  const entries = await fetchLatestFromApi(CHANNEL, KEY);
  assert.deepEqual(entries.map(v => v.id), ['AAAAAAAAAAA']);
  assert.equal(calls[1].searchParams.get('playlistId'), 'UU8Do0tOnpnz1ydOZV0XKS3g');
});

test('API: error kuota/key dilempar (agar updater jatuh ke RSS) tanpa memuat key di pesan', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'API key not valid.', errors: [{ reason: 'badRequest' }] } }), { status: 400 });
  await assert.rejects(fetchLatestFromApi(CHANNEL, KEY), err => {
    assert.match(err.message, /badRequest/);
    assert.ok(!err.message.includes(KEY));
    return true;
  });
});

test('format tanggal RSS dan API diseragamkan', () => {
  const a = selectLatest([{ id: 'AAAAAAAAAAA', title: 'X', publishedAt: '2026-10-20T08:16:08+00:00' }], {});
  const b = selectLatest([{ id: 'AAAAAAAAAAA', title: 'X', publishedAt: '2026-10-20T08:16:08Z' }], {});
  assert.deepEqual(a, b);
});
