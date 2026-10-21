/**
 * Logika murni (tanpa jaringan) untuk memilih video prakiraan terbaru
 * dari RSS feed channel YouTube. Dipakai oleh scripts/update-video.mjs dan diuji di test/.
 */

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const VIDEO_ID_PATTERN = /^[\w-]{11}$/;

const MONTHS = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
};

export function decodeXml(text = '') {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const isHex = code[1].toLowerCase() === 'x';
      const point = parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function elementText(block, name) {
  const n = escapeRegExp(name);
  const match = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`));
  return match ? decodeXml(match[1].trim()) : '';
}

function attributeValue(block, tagName, attrName) {
  const match = block.match(
    new RegExp(`<${escapeRegExp(tagName)}\\b[^>]*\\b${escapeRegExp(attrName)}="([^"]*)"`),
  );
  return match ? decodeXml(match[1]) : '';
}

/**
 * Parse RSS/Atom feed https://www.youtube.com/feeds/videos.xml?channel_id=UC...
 * @returns {{ id: string, title: string, publishedAt: string, isShort: boolean }[]}
 */
export function parseFeed(xml) {
  const entries = String(xml).match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries
    .map(entry => ({
      id: elementText(entry, 'yt:videoId'),
      title: elementText(entry, 'title'),
      publishedAt: elementText(entry, 'published'),
      isShort: attributeValue(entry, 'link', 'href').includes('/shorts/'),
    }))
    .filter(v => VIDEO_ID_PATTERN.test(v.id) && v.title);
}

const normalize = text => String(text).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

/** Judul diawali prefix (tidak peka huruf besar/kecil & spasi berlebih). */
export function matchesPrefix(title, prefix) {
  return normalize(title).startsWith(normalize(prefix));
}

/**
 * Ambil tanggal prakiraan dari judul, mis.
 *   "Prakiraan Cuaca Esok Hari, Senin, 19 Oktober 2026" -> "2026-10-19"
 *   "Prakiraan Cuaca Esok Hari, Selasa, 20 Oktober"     -> tahun dari tanggal upload
 * Nama hari di judul diabaikan (kadang tidak sesuai tanggal).
 * @returns {string|null} YYYY-MM-DD
 */
export function parseForecastDate(title, publishedAt) {
  const m = String(title).match(
    /(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)(?:\s+(\d{4}))?/i,
  );
  if (!m) return null;

  const day   = Number(m[1]);
  const month = MONTHS[m[2].toLowerCase()];
  let year    = m[3] ? Number(m[3]) : null;

  if (!year) {
    const published = new Date(publishedAt);
    if (Number.isNaN(published.getTime())) return null;
    year = published.getUTCFullYear();
    const pubMonth = published.getUTCMonth() + 1;
    if (pubMonth === 12 && month === 1) year += 1;      // upload Des untuk prakiraan Jan
    else if (pubMonth === 1 && month === 12) year -= 1; // kasus sebaliknya
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1) return null; // mis. 31 Februari
  return date.toISOString().slice(0, 10);
}

/**
 * Pilih video terbaru lebih dulu (berdasarkan tanggal upload).
 * prefix kosong = semua video; forecastPrefix = judul yang diberi label tanggal prakiraan.
 * @returns {{ id: string, title: string, publishedAt: string, forecastDate: string|null }[]}
 */
export function selectLatest(entries, { prefix = '', max = 3, includeShorts = false, forecastPrefix = '' }) {
  return entries
    .filter(v => (includeShorts || !v.isShort) && matchesPrefix(v.title, prefix))
    .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0))
    .slice(0, max)
    .map(v => ({
      id: v.id,
      title: v.title,
      publishedAt: v.publishedAt,
      // Label tanggal prakiraan hanya untuk video prakiraan harian
      forecastDate: forecastPrefix && matchesPrefix(v.title, forecastPrefix)
        ? parseForecastDate(v.title, v.publishedAt)
        : null,
    }));
}
