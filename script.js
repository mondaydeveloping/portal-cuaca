'use strict';

/* =========================================================
   KONFIGURASI
   Tidak butuh API key. Video terbaru kanal diambil dari video.json (GitHub Actions)
   atau langsung dari playlist upload otomatis kanal, lalu diputar dengan
   YouTube IFrame Player API.
   ========================================================= */

const VIDEO = {
  CHANNEL_ID:      'UC8Do0tOnpnz1ydOZV0XKS3g',                   // @InfoBMKGIndonesia
  CHANNEL_URL:     'https://www.youtube.com/@InfoBMKGIndonesia',
  SOURCE:          'video.json',  // opsional, diisi GitHub Actions; bila kosong -> playlist upload kanal
  POLL_MINUTES:    3,             // seberapa sering halaman mengecek video baru
  FORECAST_PREFIX: 'Prakiraan Cuaca Esok Hari',  // judul yang diberi label "Prakiraan untuk …"
};

const PLAYER = {
  AUTOPLAY_MUTED:    true,   // browser hanya mengizinkan autoplay bila tanpa suara
  NATIVE_FULLSCREEN: false,  // sembunyikan tombol fullscreen YouTube agar jam & running text tetap tampil
};

const CLOCK = {
  // Endpoint waktu BMKG. Kosong = memakai waktu perangkat (GitHub Pages tidak
  // bisa menjalankan server). Isi '/api/time' bila di-hosting di Cloudflare Pages.
  ENDPOINT:       '',
  RESYNC_MINUTES: 10,
  TIMEZONE:       'Asia/Jakarta',
  ZONE_LABEL:     'WIB',       // 'WITA' (Asia/Makassar) / 'WIT' (Asia/Jayapura)
};

const WEATHER = {
  // Kode wilayah tingkat kelurahan/desa (adm4), format Kepmendagri.
  // Contoh: 31.71.03.1005 (Kec. Kemayoran, Jakarta Pusat). Nama lokasinya
  // ditampilkan otomatis dari data BMKG.
  ADM4: '31.71.03.1005',

  // Dicoba berurutan; yang kedua adalah API publik resmi BMKG (data.bmkg.go.id) sebagai cadangan.
  SOURCES: [
    'https://api-apps.bmkg.go.id/api/df/v1/forecast/adm?adm4=',
    'https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=',
  ],

  HOURS_AHEAD:     3,    // tampilkan cuaca saat ini + sekian jam ke depan
  REFRESH_MINUTES: 30,   // ambil ulang data (BMKG memperbarui prakiraan beberapa kali sehari)
};

/* ========================================================= */

const els = {
  channel:     document.getElementById('channel'),
  screen:      document.getElementById('channel-screen'),
  state:       document.getElementById('video-state'),
  channelNow:  document.getElementById('channel-now'),
  channelFor:  document.getElementById('channel-for'),
  fsBtn:       document.getElementById('fs-toggle'),
  clockTime:   document.getElementById('clock-time'),
  clockZone:   document.getElementById('clock-zone'),
  clockDate:   document.getElementById('clock-date'),
  clockStatus: document.getElementById('clock-status'),
  wxPanel:     document.getElementById('wx-panel'),
  wxIcon:      document.getElementById('wx-icon'),
  wxTime:      document.getElementById('wx-time'),
  wxTemp:      document.getElementById('wx-temp'),
  wxDesc:      document.getElementById('wx-desc'),
  wxLoc:       document.getElementById('wx-loc'),
  wxChips:     document.getElementById('wx-chips'),
  wxNext:      document.getElementById('wx-next'),
  year:        document.getElementById('year'),
  navBtn:      document.getElementById('nav-toggle'),
  nav:         document.getElementById('nav-utama'),
};

/* =========================================================
   JAM
   Setelah sinkron, jam berjalan dengan performance.now() (monotonik),
   jadi tetap benar walau jam komputer pengguna salah.
   ========================================================= */

const timeSync = { serverMs: null, perfMark: 0 };

function currentTimeMs() {
  return timeSync.serverMs === null
    ? Date.now()
    : timeSync.serverMs + (performance.now() - timeSync.perfMark);
}

function setClockStatus(state, text) {
  els.clockStatus.dataset.state = state;
  els.clockStatus.textContent = text;
  els.clockStatus.title = text;
}

async function syncClock() {
  if (!CLOCK.ENDPOINT) {
    setClockStatus('fallback', 'Waktu perangkat');
    return;
  }
  const t0 = performance.now();
  try {
    const res  = await fetch(`${CLOCK.ENDPOINT}?_=${Date.now()}`, { cache: 'no-store' });
    const t1   = performance.now();
    const data = (res.headers.get('Content-Type') || '').includes('application/json')
      ? await res.json()
      : null;
    if (!res.ok || !data?.ok || !Number.isFinite(data.epoch_ms)) {
      throw new Error('Endpoint waktu tidak tersedia.');
    }

    // Kompensasi latensi jaringan (RTT/2)
    timeSync.serverMs = data.epoch_ms + (t1 - t0) / 2;
    timeSync.perfMark = t1;

    if (data.source !== 'jam.bmkg.go.id') {
      setClockStatus('stale', 'Waktu server — jam BMKG tidak terjangkau');
    } else if (data.stale) {
      setClockStatus('stale', 'Sumber: jam.bmkg.go.id (sinkron tertunda)');
    } else {
      setClockStatus('ok', 'Sumber: jam.bmkg.go.id');
    }
  } catch (err) {
    console.warn('[Jam]', err.message);
    if (timeSync.serverMs === null) setClockStatus('fallback', 'Waktu perangkat');
  }
}

function startClock() {
  els.clockZone.textContent = CLOCK.ZONE_LABEL;

  const timeFmt = new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', timeZone: CLOCK.TIMEZONE,
  });
  const dayFmt = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: CLOCK.TIMEZONE,
  });

  const render = () => {
    const now   = new Date(currentTimeMs());
    const parts = Object.fromEntries(timeFmt.formatToParts(now).map(p => [p.type, p.value]));
    els.clockTime.textContent = `${parts.hour}:${parts.minute}:${parts.second}`;
    els.clockTime.dateTime    = now.toISOString();
    els.clockDate.textContent = dayFmt.format(now);
  };

  // Tick diselaraskan ke pergantian detik
  const tick = () => {
    render();
    setTimeout(tick, 1000 - (currentTimeMs() % 1000) + 5);
  };

  tick();
  syncClock();
  setInterval(syncClock, CLOCK.RESYNC_MINUTES * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncClock();
  });
}

/* =========================================================
   PEMUTAR VIDEO (YouTube IFrame Player API — tanpa API key)
   Sumber video terbaru, dicoba berurutan:
   1. video.json  — disiapkan GitHub Actions dari RSS kanal (bila workflow aktif)
   2. Playlist upload otomatis kanal (UULF… = video biasa tanpa Shorts/live,
      lalu UU… = semua upload). Diperbarui YouTube sendiri, terbaru di urutan pertama.
   Video terbaru diputar berulang; bila ada yang lebih baru, langsung pindah.
   ========================================================= */

const VIDEO_ID_PATTERN = /^[\w-]{11}$/;
const CHANNEL_SUFFIX   = VIDEO.CHANNEL_ID.slice(2);   // "UCxxxx" -> "xxxx"
const UPLOAD_LISTS     = [`UULF${CHANNEL_SUFFIX}`, `UU${CHANNEL_SUFFIX}`];

const tv = {
  YT: null,
  player: null,
  videos: [],   // terbaru lebih dulu: [{ id, title, forecastDate }]
  pos: 0,       // indeks video yang sedang diputar
  source: '',   // 'video.json' | 'uploads'
};

const forecastDateFmt = new Intl.DateTimeFormat('id-ID', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

const MONTHS = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
};

/**
 * Tanggal prakiraan dari judul "Prakiraan Cuaca Esok Hari, …, 21 Oktober [2026]".
 * (Versi browser dari parseForecastDate di scripts/youtube.mjs; tahun kosong = tahun berjalan.)
 */
function forecastDateFromTitle(title) {
  const normalized = String(title).replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized.startsWith(VIDEO.FORECAST_PREFIX.toLowerCase())) return null;

  const m = normalized.match(/(\d{1,2}) (januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)(?: (\d{4}))?/);
  if (!m) return null;

  const now   = new Date(currentTimeMs());
  const day   = Number(m[1]);
  const month = MONTHS[m[2]];
  let year    = m[3] ? Number(m[3]) : now.getFullYear();
  if (!m[3] && now.getMonth() === 11 && month === 1) year += 1;

  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
}

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);

  return new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === 'function') previous();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => reject(new Error('Pemutar YouTube gagal dimuat. Periksa koneksi internet.'));
    document.head.appendChild(script);
  });
}

/* ---------- Sumber 1: video.json ---------- */

async function fetchVideoJson() {
  const res = await fetch(`${VIDEO.SOURCE}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data?.videos) ? data.videos : [])
    .filter(v => VIDEO_ID_PATTERN.test(v?.id))
    .map(v => ({
      id: v.id,
      title: String(v.title || ''),
      forecastDate: /^\d{4}-\d{2}-\d{2}$/.test(v.forecastDate) ? v.forecastDate : null,
    }));
}

/* ---------- Sumber 2: playlist upload otomatis kanal ---------- */

/** Baca daftar ID video sebuah playlist memakai pemutar tersembunyi (tidak diputar). */
function readPlaylistIds(listId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const host  = document.createElement('div');
    const mount = document.createElement('div');
    host.className = 'yt-probe';
    host.setAttribute('aria-hidden', 'true');
    host.appendChild(mount);
    document.body.appendChild(host);

    let probe;
    let poll;
    let settled = false;

    const finish = (error, ids) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      try { probe?.destroy(); } catch { /* abaikan */ }
      host.remove();
      if (error) reject(error); else resolve(ids);
    };

    const tryRead = () => {
      const ids = probe?.getPlaylist?.();
      if (Array.isArray(ids) && ids.length) finish(null, ids);
    };

    const timer = setTimeout(() => finish(new Error(`playlist ${listId} tidak terbaca`)), timeoutMs);

    probe = new tv.YT.Player(mount, {
      host: 'https://www.youtube-nocookie.com',
      width: 1,
      height: 1,
      playerVars: { listType: 'playlist', list: listId, autoplay: 0, mute: 1, origin: window.location.origin },
      events: {
        onReady: () => { tryRead(); poll = setInterval(tryRead, 250); },
        onError: tryRead,   // daftar ID tetap bisa terbaca walau video pertama bermasalah
      },
    });
  });
}

async function fetchFromUploads() {
  let lastError;
  for (const listId of UPLOAD_LISTS) {
    try {
      const ids = await readPlaylistIds(listId);
      return ids.filter(id => VIDEO_ID_PATTERN.test(id)).slice(0, 3)
        .map(id => ({ id, title: '', forecastDate: null }));
    } catch (err) {
      console.warn('[Video]', err.message);
      lastError = err;
    }
  }
  throw lastError || new Error('Playlist upload kanal tidak terbaca.');
}

/** Ambil daftar video terbaru dari sumber yang tersedia. */
async function getLatestVideos() {
  try {
    const videos = await fetchVideoJson();
    if (videos.length) return { videos, source: 'video.json' };
    console.info('[Video] video.json masih kosong — memakai playlist upload kanal.');
  } catch (err) {
    console.info('[Video] video.json tidak tersedia —', err.message, '— memakai playlist upload kanal.');
  }
  return { videos: await fetchFromUploads(), source: 'uploads' };
}

/* ---------- Tampilan ---------- */

function showState(title, message, { isError = false, withLink = false } = {}) {
  els.state.hidden = false;
  els.state.classList.toggle('is-error', isError);
  els.state.replaceChildren();

  const strong = document.createElement('strong');
  strong.textContent = title;
  const p = document.createElement('p');
  p.textContent = message;
  els.state.append(strong, p);

  if (withLink) {
    const a = document.createElement('a');
    a.href = VIDEO.CHANNEL_URL;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Buka kanal YouTube Info BMKG';
    els.state.appendChild(a);
  }
}

function renderNowPlaying(video) {
  els.channelNow.textContent = video.title || 'Video terbaru Info BMKG';
  if (video.forecastDate) {
    els.channelFor.textContent = `Prakiraan untuk ${forecastDateFmt.format(new Date(`${video.forecastDate}T00:00:00Z`))}`;
    els.channelFor.hidden = false;
  } else {
    els.channelFor.hidden = true;
  }
}

/* ---------- Pemutar ---------- */

function createPlayer(videoId) {
  const mount = document.createElement('div');
  mount.className = 'player-mount';
  els.screen.appendChild(mount);

  return new Promise(resolve => {
    const player = new tv.YT.Player(mount, {
      host: 'https://www.youtube-nocookie.com',
      videoId,
      playerVars: {
        autoplay: PLAYER.AUTOPLAY_MUTED ? 1 : 0,
        mute: PLAYER.AUTOPLAY_MUTED ? 1 : 0,
        rel: 0,
        playsinline: 1,
        fs: PLAYER.NATIVE_FULLSCREEN ? 1 : 0,
        origin: window.location.origin,
      },
      events: {
        onReady: () => {
          player.getIframe().title = 'Pemutar video prakiraan cuaca';
          els.state.hidden = true;
          resolve(player);
        },
        onStateChange: onPlayerStateChange,
        onError: onPlayerError,
      },
    });
  });
}

async function playVideo(pos) {
  const video = tv.videos[pos];
  if (!video) return;
  tv.pos = pos;
  renderNowPlaying(video);

  if (tv.player) {
    tv.player.loadVideoById(video.id);
  } else {
    tv.player = await createPlayer(video.id);
  }
}

function onPlayerStateChange(e) {
  const { PlayerState } = tv.YT;

  // Judul belum diketahui (sumber playlist upload): ambil dari pemutar
  if (e.data === PlayerState.PLAYING) {
    const video = tv.videos[tv.pos];
    const title = tv.player.getVideoData?.().title;
    if (video && !video.title && title) {
      video.title = title;
      video.forecastDate = forecastDateFromTitle(title);
      renderNowPlaying(video);
    }
  }

  // Loop: video selesai -> putar lagi dari awal
  if (e.data === PlayerState.ENDED) {
    tv.player.seekTo(0, true);
    tv.player.playVideo();
  }
}

function onPlayerError(e) {
  // 100 = video dihapus/privat, 101/150 = pemilik melarang embed
  console.warn('[YouTube Player] kode error', e.data, tv.videos[tv.pos]?.id);
  if (tv.pos + 1 < tv.videos.length) {
    playVideo(tv.pos + 1);   // coba video sebelumnya
  } else {
    showState('Video belum dapat ditampilkan', 'Video tidak dapat diputar di situs ini.', { isError: true, withLink: true });
    els.channelNow.textContent = 'Video tidak tersedia';
  }
}

/** Cek sumber; bila video terbaru berubah, langsung pindah. */
async function checkForNewVideo() {
  let result;
  try {
    result = await getLatestVideos();
  } catch (err) {
    console.warn('[Video] gagal mengecek video baru:', err.message);
    if (!tv.videos.length) {
      showState('Video belum dapat ditampilkan', 'Daftar video kanal tidak dapat dibaca. Halaman akan mencoba lagi otomatis.', { isError: true, withLink: true });
    }
    return;
  }
  if (!result.videos.length) return;

  const isNew = result.videos[0].id !== tv.videos[0]?.id;
  if (isNew) console.info(`[Video] video terbaru (${result.source}):`, result.videos[0].id);

  // Pertahankan judul yang sudah diketahui untuk video yang sama
  const known = new Map(tv.videos.map(v => [v.id, v]));
  tv.videos = result.videos.map(v => (!v.title && known.get(v.id)?.title ? known.get(v.id) : v));
  tv.source = result.source;

  if (isNew) await playVideo(0);
}

async function initVideo() {
  try {
    tv.YT = await loadYouTubeApi();
  } catch (err) {
    showState('Video belum dapat ditampilkan', err.message, { isError: true, withLink: true });
    els.channelNow.textContent = 'Video tidak tersedia';
    return;
  }
  await checkForNewVideo();
  setInterval(checkForNewVideo, VIDEO.POLL_MINUTES * 60 * 1000);
}

/* =========================================================
   CUACA SAAT INI + BEBERAPA JAM KE DEPAN
   Data BMKG: lokasi + data[0].cuaca = array per hari berisi slot prakiraan
   (field local_datetime, weather_desc, t, hu, ws, wd, wd_deg, image).
   ========================================================= */

// Arah angin BMKG (kode 16 mata angin) -> nama & derajat asal angin
const WIND = {
  N:   ['Utara', 0],               NNE: ['Utara-Timur Laut', 22.5],
  NE:  ['Timur Laut', 45],         ENE: ['Timur-Timur Laut', 67.5],
  E:   ['Timur', 90],              ESE: ['Timur-Tenggara', 112.5],
  SE:  ['Tenggara', 135],          SSE: ['Selatan-Tenggara', 157.5],
  S:   ['Selatan', 180],           SSW: ['Selatan-Barat Daya', 202.5],
  SW:  ['Barat Daya', 225],        WSW: ['Barat-Barat Daya', 247.5],
  W:   ['Barat', 270],             WNW: ['Barat-Barat Laut', 292.5],
  NW:  ['Barat Laut', 315],        NNW: ['Utara-Barat Laut', 337.5],
  VARIABLE: ['Berubah-ubah', null], CALM: ['Tenang', null],
};

const ZONE_LABELS = {
  'Asia/Jakarta': 'WIB', 'Asia/Pontianak': 'WIB',
  'Asia/Makassar': 'WITA', 'Asia/Jayapura': 'WIT',
};

const ICON_PATHS = {
  humidity: 'M12 2.5c-3.2 4.2-6.5 8-6.5 11.8a6.5 6.5 0 0 0 13 0C18.5 10.5 15.2 6.7 12 2.5z',
  wind:     'M3 9h11.5a3 3 0 1 0-3-3h2a1 1 0 1 1 1 1H3v2zm0 3h16.5a3 3 0 1 1-3 3h2a1 1 0 1 0 1-1H3v-2zm0 4h9v2H3v-2z',
  arrow:    'M12 3l6.5 8.5H14V21h-4v-9.5H5.5z',
};

const toNumber = value => {
  const n = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(n) ? null : n;
};

/** Hanya izinkan URL ikon https (data dari pihak luar tidak dipercaya mentah-mentah). */
function safeIconUrl(value) {
  try {
    const url = new URL(String(value).replace(/ /g, '%20'));
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

/** Kunci waktu (ms) dari tanggal & jam lokal — dipakai untuk membandingkan, bukan untuk ditampilkan. */
function localKey(date, hour, minute = 0) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d, hour, minute);
}

function normalizeSlot(raw) {
  const m = String(raw?.local_datetime || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;

  const code = String(raw.wd || '').toUpperCase();
  const [windName, codeDeg] = WIND[code] || [String(raw.wd || ''), null];
  const windDeg = toNumber(raw.wd_deg) ?? codeDeg;

  return {
    key:     localKey(m[1], Number(m[2]), Number(m[3])),
    time:    `${m[2]}.${m[3]}`,
    desc:    String(raw.weather_desc || '').trim(),
    temp:    toNumber(raw.t),
    humid:   toNumber(raw.hu),
    wind:    toNumber(raw.ws),
    windName,
    windDeg,
    icon:    safeIconUrl(raw.image),
  };
}

/** Ambil lokasi & daftar slot dari respons BMKG (toleran terhadap variasi struktur). */
function parseForecast(json) {
  const root   = Array.isArray(json?.data) ? json.data[0] : json?.data ?? json;
  const lokasi = [json?.lokasi, root?.lokasi].find(l => l && (l.desa || l.kecamatan || l.kotkab))
    || json?.lokasi || root?.lokasi || {};
  const raw    = root?.cuaca ?? json?.cuaca ?? [];
  const slots  = (Array.isArray(raw) ? raw.flat(2) : [])
    .map(normalizeSlot)
    .filter(Boolean)
    .sort((a, b) => a.key - b.key);

  if (!slots.length) throw new Error('Data prakiraan kosong.');
  return { lokasi, slots };
}

/** Kunci waktu "sekarang" di zona waktu lokasi (memakai jam yang sudah tersinkron). */
function nowKey(timeZone) {
  const make = zone => new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  let fmt;
  try { fmt = make(timeZone || CLOCK.TIMEZONE); } catch { fmt = make(CLOCK.TIMEZONE); }
  const p = Object.fromEntries(fmt.formatToParts(new Date(currentTimeMs())).map(x => [x.type, x.value]));
  return localKey(`${p.year}-${p.month}-${p.day}`, Number(p.hour), Number(p.minute));
}

/**
 * Slot "saat ini" = slot terakhir yang sudah dimulai (atau slot terdekat bila data
 * dimulai setelah jam sekarang), lalu slot-slot dalam HOURS_AHEAD jam berikutnya.
 */
function selectSlots(slots, timeZone) {
  const now = nowKey(timeZone);
  let idx = 0;
  slots.forEach((s, i) => { if (s.key <= now) idx = i; });

  const current = slots[idx];
  const limit   = current.key + WEATHER.HOURS_AHEAD * 3600 * 1000;
  const next    = slots.slice(idx + 1).filter(s => s.key <= limit).slice(0, WEATHER.HOURS_AHEAD);
  return { current, next };
}

function svgIcon(name, rotateDeg = null) {
  const ns  = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICON_PATHS[name]);
  svg.appendChild(path);
  if (rotateDeg !== null) svg.style.transform = `rotate(${rotateDeg}deg)`;
  return svg;
}

function chip(icon, label, value) {
  const li = document.createElement('li');
  li.className = 'wx-chip';
  li.title = `${label}: ${value}`;
  const text = document.createElement('span');
  text.className = 'wx-chip-label';
  text.textContent = `${label}:`;
  const strong = document.createElement('strong');
  strong.textContent = value;
  li.append(icon, text, strong);
  return li;
}

function setIcon(img, url, alt) {
  if (url) {
    img.src = url;
    img.alt = alt;
    img.hidden = false;
    img.onerror = () => { img.hidden = true; };
  } else {
    img.hidden = true;
  }
}

function hourCard(slot, zoneLabel) {
  const li = document.createElement('li');
  li.className = 'wx-hour';

  const time = document.createElement('span');
  time.className = 'wx-hour-time';
  time.textContent = `${slot.time} ${zoneLabel}`;
  li.appendChild(time);

  if (slot.icon) {
    const img = document.createElement('img');
    img.className = 'wx-hour-icon';
    setIcon(img, slot.icon, '');
    li.appendChild(img);
  }

  const temp = document.createElement('span');
  temp.className = 'wx-hour-temp';
  temp.textContent = slot.temp !== null ? `${Math.round(slot.temp)}°C` : '–';
  li.appendChild(temp);

  const desc = document.createElement('span');
  desc.className = 'wx-hour-desc';
  desc.textContent = slot.desc;
  desc.title = slot.desc;
  li.appendChild(desc);

  return li;
}

function renderWeather({ lokasi, slots }) {
  const { current, next } = selectSlots(slots, lokasi.timezone);
  const zoneLabel = ZONE_LABELS[lokasi.timezone] || CLOCK.ZONE_LABEL;
  const place     = String(lokasi.desa || lokasi.kecamatan || lokasi.kotkab || '').trim();
  const fullPlace = [lokasi.desa, lokasi.kecamatan, lokasi.kotkab].filter(Boolean).join(', ');

  els.wxPanel.dataset.state = 'ready';
  setIcon(els.wxIcon, current.icon, current.desc);
  els.wxTime.textContent = `· prakiraan ${current.time} ${zoneLabel}`;
  els.wxTemp.textContent = current.temp !== null ? `${Math.round(current.temp)}°C` : '–';
  els.wxDesc.textContent = current.desc || '–';
  els.wxLoc.textContent  = place ? `di ${place}` : '';
  els.wxLoc.title        = fullPlace;

  const chips = [];
  if (current.humid !== null) chips.push(chip(svgIcon('humidity'), 'Kelembapan', `${Math.round(current.humid)}%`));
  if (current.wind !== null)  chips.push(chip(svgIcon('wind'), 'Kecepatan Angin', `${Math.round(current.wind)} km/jam`));
  if (current.windName) {
    // Panah menunjuk ke arah angin bertiup (berlawanan dengan arah asalnya)
    const arrow = current.windDeg !== null ? svgIcon('arrow', current.windDeg + 180) : svgIcon('arrow');
    chips.push(chip(arrow, 'Arah Angin dari', current.windName));
  }
  els.wxChips.replaceChildren(...chips);
  els.wxNext.replaceChildren(...next.map(s => hourCard(s, zoneLabel)));
}

/** Terjemahkan error teknis menjadi penyebab yang mudah dipahami. */
function describeFetchError(err) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'server BMKG tidak merespons (timeout)';
  if (err instanceof TypeError) return 'diblokir browser (CORS) atau koneksi terputus';
  if (err instanceof SyntaxError) return 'respons bukan JSON yang valid';
  return err?.message || 'kesalahan tidak diketahui';
}

function renderWeatherError(errors = []) {
  els.wxPanel.dataset.state = 'error';
  els.wxIcon.hidden = true;
  els.wxTime.textContent = '';
  els.wxDesc.textContent = 'Prakiraan cuaca belum dapat dimuat. Informasi lengkap di www.bmkg.go.id';
  els.wxLoc.textContent = '';

  // Rincian penyebab per sumber (membantu diagnosis; detail lengkap ada di Console F12)
  const detail = document.createElement('li');
  detail.className = 'wx-error-detail';
  detail.textContent = errors
    .map(e => `${new URL(e.url).hostname}: ${describeFetchError(e.error)}`)
    .join(' | ');
  els.wxChips.replaceChildren(detail);
}

async function fetchForecast() {
  const errors = [];
  for (const base of WEATHER.SOURCES) {
    const url = base + encodeURIComponent(WEATHER.ADM4);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseForecast(await res.json());
    } catch (error) {
      console.warn('[Cuaca] gagal:', url, error);
      errors.push({ url, error });
    }
  }
  const err = new Error('Semua sumber prakiraan gagal.');
  err.details = errors;
  throw err;
}

const weather = { data: null, retryTimer: null };

async function updateWeather() {
  clearTimeout(weather.retryTimer);
  try {
    weather.data = await fetchForecast();
  } catch (err) {
    // Coba lagi lebih cepat (1 menit) daripada menunggu jadwal refresh berikutnya
    weather.retryTimer = setTimeout(updateWeather, 60 * 1000);
    if (!weather.data) return renderWeatherError(err.details);
    // gagal memperbarui: tetap tampilkan data terakhir
  }
  try {
    renderWeather(weather.data);
  } catch (err) {
    console.error('[Cuaca] gagal menampilkan data:', err, weather.data);
    renderWeatherError([{ url: location.href, error: new Error(`format data tidak dikenali (${err.message})`) }]);
  }
}

function startWeather() {
  updateWeather();
  setInterval(updateWeather, WEATHER.REFRESH_MINUTES * 60 * 1000);
  // Geser slot "saat ini" setiap menit tanpa mengambil data ulang
  setInterval(() => { if (weather.data) renderWeather(weather.data); }, 60 * 1000);
}

/* =========================================================
   LAYAR PENUH
   Fullscreen API pada seluruh kanal (jam + video + running text).
   Cadangan "pseudo fullscreen" berbasis CSS bila tidak didukung (mis. iPhone).
   ========================================================= */

function setupFullscreen() {
  const stage  = els.channel;
  const btn    = els.fsBtn;
  const native = Boolean(document.fullscreenEnabled && stage.requestFullscreen);

  const isActive = () => (native
    ? document.fullscreenElement === stage
    : stage.classList.contains('is-pseudo-fullscreen'));

  const syncUi = () => {
    const active = isActive();
    const label  = active ? 'Keluar layar penuh' : 'Layar penuh';
    stage.classList.toggle('is-fullscreen', active);
    document.body.classList.toggle('no-scroll', active && !native);
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
    btn.setAttribute('aria-label', label);
    btn.title = label;
  };

  const togglePseudo = force => {
    stage.classList.toggle('is-pseudo-fullscreen', force);
    syncUi();
  };

  btn.addEventListener('click', async () => {
    if (!native) return togglePseudo();
    try {
      if (isActive()) await document.exitFullscreen();
      else await stage.requestFullscreen({ navigationUI: 'hide' });
    } catch (err) {
      console.warn('[Fullscreen]', err);
    }
  });

  document.addEventListener('fullscreenchange', syncUi);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !native && isActive()) togglePseudo(false);
  });
}

/* ---------- Navigasi mobile ---------- */

function setupNav() {
  els.navBtn.addEventListener('click', () => {
    const open = els.navBtn.getAttribute('aria-expanded') === 'true';
    els.navBtn.setAttribute('aria-expanded', String(!open));
    els.navBtn.setAttribute('aria-label', open ? 'Buka menu' : 'Tutup menu');
    els.nav.classList.toggle('is-open', !open);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && els.nav.classList.contains('is-open')) {
      els.navBtn.click();
      els.navBtn.focus();
    }
  });
}

/* ---------- Start ---------- */

els.year.textContent = new Date().getFullYear();
startClock();
setupFullscreen();
setupNav();
initVideo();
startWeather();