'use strict';

/* =========================================================
   KONFIGURASI
   Tidak butuh API key. Video diputar langsung dari playlist YouTube
   lewat YouTube IFrame Player API (pemutar resmi, gratis, tanpa key).
   ========================================================= */

const VIDEO = {
  // Playlist "Prakiraan Cuaca Indonesia" — Info BMKG
  // https://www.youtube.com/playlist?list=PL-k2VTQGAjdeCDZ-T9e6YJfdaRt28E-ym
  PLAYLIST_ID: 'PL-k2VTQGAjdeCDZ-T9e6YJfdaRt28E-ym',

  // Urutan playlist di YouTube:
  //   'newest-first' = video terbaru ada di PALING ATAS playlist
  //   'oldest-first' = video terbaru ada di PALING BAWAH playlist
  PLAYLIST_ORDER: 'newest-first',

  // 'latest'   = putar video terbaru saja, berulang-ulang (loop)
  // 'playlist' = putar seluruh playlist dari video teratas, lalu ulang dari awal
  MODE: 'latest',

  // Mode 'latest': setiap kali video selesai, cek apakah ada video baru
  // di playlist bila sudah lewat sekian menit sejak pengecekan terakhir.
  REFRESH_MINUTES: 30,
};

const PLAYER = {
  AUTOPLAY_MUTED:    true,   // browser hanya mengizinkan autoplay bila tanpa suara
  NATIVE_FULLSCREEN: false,  // sembunyikan tombol fullscreen YouTube agar jam & running text tetap tampil
};

const CLOCK = {
  // Endpoint waktu BMKG (functions/api/time.js). Hanya aktif bila di-hosting di
  // Cloudflare Pages. Di hosting statis murni (mis. GitHub Pages) jam otomatis
  // memakai waktu perangkat.
  ENDPOINT:       '/api/time',
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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
   PEMUTAR PLAYLIST (YouTube IFrame Player API — tanpa API key)
   ========================================================= */

const tv = {
  YT: null,
  player: null,
  candidates: [],   // ID video, terbaru lebih dulu (mode 'latest')
  pos: 0,           // indeks kandidat yang sedang diputar
  targetId: null,
  loadedAt: 0,      // waktu playlist terakhir dimuat
};

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

/** Buat pemutar baru (pemutar lama dihapus). Resolve saat pemutar siap. */
function createPlayer() {
  tv.player?.destroy();
  els.screen.querySelectorAll('iframe, .player-mount').forEach(el => el.remove());

  const mount = document.createElement('div');
  mount.className = 'player-mount';
  els.screen.appendChild(mount);

  const isPlaylistMode = VIDEO.MODE === 'playlist';

  return new Promise(resolve => {
    const player = new tv.YT.Player(mount, {
      host: 'https://www.youtube-nocookie.com',
      playerVars: {
        listType: 'playlist',
        list: VIDEO.PLAYLIST_ID,
        autoplay: isPlaylistMode && PLAYER.AUTOPLAY_MUTED ? 1 : 0,
        mute: PLAYER.AUTOPLAY_MUTED ? 1 : 0,
        loop: isPlaylistMode ? 1 : 0,
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
    tv.player = player;
  });
}

/** Tunggu sampai daftar ID video playlist tersedia di pemutar. */
async function waitForPlaylist(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ids = tv.player?.getPlaylist?.();
    if (Array.isArray(ids) && ids.length) return ids;
    await sleep(250);
  }
  throw new Error('Playlist tidak dapat dimuat. Pastikan playlist bersifat publik.');
}

/** Mode 'latest': muat playlist, tentukan video terbaru, lalu putar. */
async function loadLatest() {
  await createPlayer();
  const ids = await waitForPlaylist();

  tv.candidates = VIDEO.PLAYLIST_ORDER === 'oldest-first' ? [...ids].reverse() : [...ids];
  tv.loadedAt   = Date.now();
  playCandidate(0);
}

function playCandidate(pos) {
  tv.pos      = pos;
  tv.targetId = tv.candidates[pos];
  tv.player.loadVideoById(tv.targetId);
}

function updateNowPlaying() {
  const title = tv.player?.getVideoData?.().title;
  if (title) els.channelNow.textContent = title;
}

function onPlayerStateChange(e) {
  const { PlayerState } = tv.YT;

  if (e.data === PlayerState.PLAYING) {
    updateNowPlaying();

    // Mode 'latest': jaga agar pemutar tidak pindah ke video lain di playlist
    if (VIDEO.MODE === 'latest' && tv.targetId) {
      const currentId = tv.player.getVideoData?.().video_id;
      if (currentId && currentId !== tv.targetId) tv.player.loadVideoById(tv.targetId);
    }
  }

  if (e.data === PlayerState.ENDED && VIDEO.MODE === 'latest') {
    const dueRefresh = Date.now() - tv.loadedAt > VIDEO.REFRESH_MINUTES * 60 * 1000;
    if (dueRefresh) {
      // Muat ulang playlist agar video baru dari BMKG ikut terambil
      loadLatest().catch(handleFatal);
    } else {
      tv.player.seekTo(0, true);
      tv.player.playVideo();
    }
  }
}

function onPlayerError(e) {
  // 100 = video dihapus/privat, 101/150 = pemilik melarang embed
  console.warn('[YouTube Player] kode error', e.data);

  if (VIDEO.MODE === 'playlist') {
    tv.player.nextVideo();
    return;
  }

  const nextPos = tv.pos + 1;
  if (nextPos < Math.min(tv.candidates.length, 10)) {
    playCandidate(nextPos);   // coba video terbaru berikutnya
  } else {
    handleFatal(new Error('Video di playlist tidak dapat diputar di situs ini (embed dinonaktifkan).'));
  }
}

function handleFatal(err) {
  console.error('[Video]', err);
  els.state.hidden = false;
  els.state.classList.add('is-error');
  els.state.innerHTML = '';

  const strong = document.createElement('strong');
  strong.textContent = 'Video belum dapat ditampilkan';
  const p = document.createElement('p');
  p.textContent = err.message || 'Terjadi kesalahan.';
  const a = document.createElement('a');
  a.href = `https://www.youtube.com/playlist?list=${encodeURIComponent(VIDEO.PLAYLIST_ID)}`;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = 'Buka playlist di YouTube';
  els.state.append(strong, p, a);

  els.channelNow.textContent = 'Video tidak tersedia';
}

async function initVideo() {
  try {
    tv.YT = await loadYouTubeApi();
    if (VIDEO.MODE === 'playlist') {
      await createPlayer();
    } else {
      await loadLatest();
    }
  } catch (err) {
    handleFatal(err);
  }
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

function renderWeatherError() {
  els.wxPanel.dataset.state = 'error';
  els.wxIcon.hidden = true;
  els.wxTime.textContent = '';
  els.wxDesc.textContent = 'Prakiraan cuaca belum dapat dimuat. Informasi lengkap di www.bmkg.go.id';
  els.wxLoc.textContent = '';
}

async function fetchForecast() {
  let lastError;
  for (const base of WEATHER.SOURCES) {
    try {
      const res = await fetch(base + encodeURIComponent(WEATHER.ADM4), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseForecast(await res.json());
    } catch (err) {
      // TypeError "Failed to fetch" umumnya = diblokir CORS / jaringan
      console.warn('[Cuaca]', base, err.message);
      lastError = err;
    }
  }
  throw lastError;
}

const weather = { data: null };

async function updateWeather() {
  try {
    weather.data = await fetchForecast();
  } catch {
    if (!weather.data) return renderWeatherError();
    // gagal memperbarui: tetap tampilkan data terakhir
  }
  renderWeather(weather.data);
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