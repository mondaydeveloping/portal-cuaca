/**
 * Dijalankan GitHub Actions secara terjadwal.
 * Mengambil upload terbaru kanal Info BMKG, memilih video terbaru
 * (opsional: hanya judul berawalan TITLE_PREFIX), lalu menulis hasilnya ke video.json.
 *
 * Sumber:
 *   1. YouTube Data API — bila env YOUTUBE_API_KEY (GitHub Secret) tersedia; lebih cepat terbarui.
 *   2. RSS feed kanal (tanpa key) — cadangan bila API gagal atau key belum diisi.
 *
 * - File hanya ditulis bila isinya berubah (agar tidak ada commit/deploy sia-sia).
 * - Bila feed gagal diambil atau tidak ada judul yang cocok, video.json lama
 *   dibiarkan, sehingga situs tetap memutar video terakhir yang diketahui.
 *
 * Menulis "changed=true|false" ke $GITHUB_OUTPUT untuk langkah berikutnya.
 */

import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { parseFeed, selectLatest } from './youtube.mjs';
import { fetchLatestFromApi } from './youtube-api.mjs';

const CHANNEL_ID   = 'UC8Do0tOnpnz1ydOZV0XKS3g';            // @InfoBMKGIndonesia
// Kosong = tampilkan video terbaru apa pun. Isi (mis. 'Prakiraan Cuaca Esok Hari')
// untuk hanya memilih judul dengan awalan tersebut.
const TITLE_PREFIX    = '';
const INCLUDE_SHORTS  = false;                                  // Shorts (video vertikal) diabaikan
const FORECAST_PREFIX = 'Prakiraan Cuaca Esok Hari';            // judul yang diberi label "Prakiraan untuk …"
const MAX_VIDEOS   = 3;                                        // cadangan bila video teratas tak bisa di-embed
const FEED_URL     = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
const OUTPUT_FILE  = new URL('../video.json', import.meta.url);
const ATTEMPTS     = 3;

async function fetchFeed() {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(FEED_URL, {
        headers: { 'User-Agent': 'portal-cuaca-updater/1.0 (+GitHub Actions)' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      console.warn(`Percobaan ${attempt}/${ATTEMPTS} gagal: ${err.message}`);
      if (attempt < ATTEMPTS) await new Promise(r => setTimeout(r, attempt * 3000));
    }
  }
  throw lastError;
}

async function readCurrent() {
  try {
    return JSON.parse(await readFile(OUTPUT_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function setOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

/** Ambil daftar upload: API (bila ada key) dengan cadangan RSS. */
async function fetchEntries() {
  const apiKey = (process.env.YOUTUBE_API_KEY || '').trim();
  if (apiKey) {
    try {
      const entries = await fetchLatestFromApi(CHANNEL_ID, apiKey);
      console.log(`Sumber: YouTube Data API (${entries.length} video publik yang bisa di-embed).`);
      return entries;
    } catch (err) {
      console.log(`::warning::YouTube Data API gagal (${err.message}). Memakai RSS sebagai cadangan.`);
    }
  } else {
    console.log('YOUTUBE_API_KEY tidak diisi — memakai RSS.');
  }

  const entries = parseFeed(await fetchFeed());
  console.log(`Sumber: RSS (${entries.length} video).`);
  return entries;
}

async function main() {
  let entries;
  try {
    entries = await fetchEntries();
  } catch (err) {
    // Tidak menggagalkan workflow: situs tetap memakai video.json terakhir.
    console.log(`::warning::Daftar video tidak dapat diambil (${err.message}). video.json tidak diubah.`);
    return setOutput('changed', 'false');
  }

  const videos  = selectLatest(entries, {
    prefix: TITLE_PREFIX, max: MAX_VIDEOS, includeShorts: INCLUDE_SHORTS, forecastPrefix: FORECAST_PREFIX,
  });
  console.log(`${videos.length} video terpilih${TITLE_PREFIX ? ` (awalan "${TITLE_PREFIX}")` : ''}.`);

  if (!videos.length) {
    console.log(`::warning::Tidak ada video yang cocok di ${entries.length} upload terakhir. video.json tidak diubah.`);
    return setOutput('changed', 'false');
  }

  const current = await readCurrent();

  // Jangan mundur: bila sumber cadangan (mis. RSS yang telat) belum memuat video
  // yang sudah tercatat, pertahankan video.json yang ada.
  const currentNewest = Date.parse(current?.videos?.[0]?.publishedAt) || 0;
  if (Date.parse(videos[0].publishedAt) < currentNewest) {
    console.log(`Sumber belum memuat video terbaru yang sudah tercatat (${current.videos[0].title}). video.json tidak diubah.`);
    return setOutput('changed', 'false');
  }

  if (JSON.stringify(current?.videos) === JSON.stringify(videos)) {
    console.log(`Tidak ada perubahan. Video terbaru: ${videos[0].title} (${videos[0].id})`);
    return setOutput('changed', 'false');
  }

  const data = { channelId: CHANNEL_ID, videos };
  await writeFile(OUTPUT_FILE, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`video.json diperbarui. Video terbaru: ${videos[0].title} (${videos[0].id})`);
  await setOutput('changed', 'true');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
