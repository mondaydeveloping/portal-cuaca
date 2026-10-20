/**
 * GET /api/time
 * Waktu resmi dari jam.bmkg.go.id (header HTTP "Date" server BMKG).
 *
 * Respons: { ok: true, epoch_ms, source: "jam.bmkg.go.id" | "cloudflare", stale }
 *  - source "jam.bmkg.go.id" : tersinkron dengan server BMKG
 *  - stale true              : memakai sinkronisasi terakhir (BMKG sedang tak terjangkau)
 *  - source "cloudflare"     : BMKG tak terjangkau > 1 jam; memakai jam server
 *                              Cloudflare (tersinkron NTP) sebagai cadangan
 */

import { json } from '../../lib/http.js';

// URL sumber ditulis tetap (bukan dari input pengguna) -> aman dari SSRF.
const SOURCE_URL       = 'https://jam.bmkg.go.id/Jam.BMKG';
const SOURCE_NAME      = 'jam.bmkg.go.id';
const FRESH_MS         = 60_000;     // BMKG dihubungi paling sering 1x/menit per instance
const STALE_MAX_MS     = 3_600_000;  // offset lama masih dipakai hingga 1 jam
const FETCH_TIMEOUT_MS = 5000;

// { offsetMs, syncedAt } — selisih waktu BMKG terhadap jam server ini
let cached = null;

export async function onRequestGet() {
  const age = cached ? Date.now() - cached.syncedAt : Infinity;
  let stale = false;

  if (age > FRESH_MS) {
    try {
      cached = await fetchSourceOffset();
    } catch (err) {
      console.warn('[api/time]', err.message);
      stale = true;
    }
  }

  const usable = cached && Date.now() - cached.syncedAt <= STALE_MAX_MS;
  if (!usable) {
    return json({ ok: true, epoch_ms: Date.now(), source: 'cloudflare', stale: true });
  }

  return json({
    ok: true,
    epoch_ms: Math.round(Date.now() + cached.offsetMs),
    source: SOURCE_NAME,
    stale,
  });
}

async function fetchSourceOffset() {
  const t0  = Date.now();
  const res = await fetch(SOURCE_URL, {
    redirect: 'manual',
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const t1 = Date.now();
  await res.body?.cancel();   // isi halaman tidak dibutuhkan, cukup header

  const header   = res.headers.get('Date');
  const sourceMs = header ? Date.parse(header) : NaN;
  if (!Number.isFinite(sourceMs)) {
    throw new Error(`Header Date tidak tersedia/valid (HTTP ${res.status})`);
  }

  // Header Date beresolusi 1 detik (dibulatkan ke bawah): pakai titik tengah
  // detik tsb (+500 ms) dan bandingkan dengan titik tengah waktu request.
  return {
    offsetMs: sourceMs + 500 - (t0 + t1) / 2,
    syncedAt: t1,
  };
}
