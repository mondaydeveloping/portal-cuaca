/**
 * Ambil upload terbaru kanal lewat YouTube Data API v3 (dipakai bila secret
 * YOUTUBE_API_KEY tersedia). Key hanya dipakai di GitHub Actions — tidak pernah
 * masuk ke file situs.
 *
 * Kuota per pemanggilan: playlistItems.list (1 unit) + videos.list (1 unit) = 2 unit.
 * Jadwal tiap 5 menit ≈ 576 unit/hari dari jatah gratis 10.000 unit/hari.
 */

const API_BASE  = 'https://www.googleapis.com/youtube/v3';
const MAX_ITEMS = 15;

async function callApi(endpoint, params, apiKey) {
  const url = `${API_BASE}/${endpoint}?${new URLSearchParams({ ...params, key: apiKey })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Pesan error dari Google tidak memuat key; aman untuk dicatat di log.
    const reason = data?.error?.errors?.[0]?.reason || `HTTP ${res.status}`;
    const err = new Error(`${endpoint}: ${reason} — ${data?.error?.message || ''}`.trim());
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Upload terbaru dalam bentuk yang sama dengan parseFeed():
 * [{ id, title, publishedAt, isShort }], hanya video publik, bisa di-embed,
 * dan bukan siaran live/terjadwal.
 */
export async function fetchLatestFromApi(channelId, apiKey) {
  const suffix = channelId.slice(2);

  // UULF = playlist upload video biasa (tanpa Shorts & live). Cadangan: UU = semua upload.
  let items;
  let isLongFormList = true;
  try {
    items = (await callApi('playlistItems', {
      part: 'contentDetails', playlistId: `UULF${suffix}`, maxResults: String(MAX_ITEMS),
    }, apiKey)).items;
  } catch (err) {
    if (err.status !== 404) throw err;
    isLongFormList = false;
    items = (await callApi('playlistItems', {
      part: 'contentDetails', playlistId: `UU${suffix}`, maxResults: String(MAX_ITEMS),
    }, apiKey)).items;
  }

  const ids = (items || []).map(i => i.contentDetails?.videoId).filter(Boolean);
  if (!ids.length) return [];

  // Detail video: judul, status embed, jenis siaran
  const videos = (await callApi('videos', {
    part: 'snippet,status', id: ids.join(','), maxResults: String(MAX_ITEMS),
  }, apiKey)).items || [];

  return videos
    .filter(v => v.status?.privacyStatus === 'public'
      && v.status?.embeddable !== false
      && (v.snippet?.liveBroadcastContent ?? 'none') === 'none')
    .map(v => ({
      id: v.id,
      title: v.snippet.title,
      publishedAt: v.snippet.publishedAt,
      // Daftar UU bisa memuat Shorts; API tidak menandainya, jadi hanya UULF yang dijamin bebas Shorts.
      isShort: false,
      fromLongFormList: isLongFormList,
    }));
}
