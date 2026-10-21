/**
 * Dijalankan GitHub Actions secara terjadwal.
 * Membaca RSS feed channel Info BMKG (tanpa API key), memilih video terbaru
 * (opsional: hanya judul berawalan TITLE_PREFIX), lalu menulis hasilnya ke video.json.
 *
 * - File hanya ditulis bila isinya berubah (agar tidak ada commit/deploy sia-sia).
 * - Bila feed gagal diambil atau tidak ada judul yang cocok, video.json lama
 *   dibiarkan, sehingga situs tetap memutar video terakhir yang diketahui.
 *
 * Menulis "changed=true|false" ke $GITHUB_OUTPUT untuk langkah berikutnya.
 */

import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { parseFeed, selectLatest } from './youtube.mjs';

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

async function main() {
  let xml;
  try {
    xml = await fetchFeed();
  } catch (err) {
    // Tidak menggagalkan workflow: situs tetap memakai video.json terakhir.
    console.log(`::warning::RSS YouTube tidak dapat diambil (${err.message}). video.json tidak diubah.`);
    return setOutput('changed', 'false');
  }

  const entries = parseFeed(xml);
  const videos  = selectLatest(entries, {
    prefix: TITLE_PREFIX, max: MAX_VIDEOS, includeShorts: INCLUDE_SHORTS, forecastPrefix: FORECAST_PREFIX,
  });
  console.log(`Feed berisi ${entries.length} video, ${videos.length} terpilih${TITLE_PREFIX ? ` (awalan "${TITLE_PREFIX}")` : ''}.`);

  if (!videos.length) {
    console.log(`::warning::Tidak ada video yang cocok di ${entries.length} upload terakhir. video.json tidak diubah.`);
    return setOutput('changed', 'false');
  }

  const current = await readCurrent();
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
