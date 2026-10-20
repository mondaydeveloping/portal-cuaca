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
