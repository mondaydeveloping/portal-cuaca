# Portal Cuaca — Kanal Video Prakiraan Cuaca (GitHub Pages)

Memutar **video terbaru** dari kanal YouTube
[Info BMKG](https://www.youtube.com/@InfoBMKGIndonesia) secara berulang, ditambah panel cuaca
saat ini dari API BMKG. Gratis, tanpa API key, di-hosting di GitHub Pages.

## Cara kerja

```
GitHub Actions (tiap ±5 menit)
  └─ scripts/update-video.mjs
       ├─ ambil upload terbaru: YouTube Data API (key di GitHub Secrets)
       │   → bila key kosong/gagal: RSS kanal (tanpa key)
       ├─ pilih video dengan tanggal upload terbaru (judul apa pun)
       │   (Shorts diabaikan; 2 video sebelumnya disimpan sebagai cadangan)
       └─ bila berubah: commit video.json + deploy ulang situs
Halaman (script.js)
  ├─ sumber video: video.json → bila kosong/tidak ada: playlist upload otomatis kanal
  │   (UULF… = video biasa tanpa Shorts/live, cadangan UU… = semua upload)
  ├─ putar video terbaru berulang-ulang
  ├─ cek ulang tiap 3 menit → ada video baru = langsung pindah
  └─ label "Prakiraan untuk <hari, tanggal>" khusus video "Prakiraan Cuaca Esok Hari, …"
```

- Label tanggal: tahun yang tidak tertulis di judul diambil dari tanggal upload; nama hari di judul
  diabaikan dan dihitung dari tanggalnya.
- Video terakhir tetap diputar sampai ada upload baru.
- Bila semua sumber gagal, `video.json` tidak diubah (situs tetap jalan).
- `video.json` tidak pernah mundur ke video yang lebih lama (mis. saat RSS cadangan masih telat).
- Video siaran live/terjadwal dan video yang tidak boleh di-embed otomatis dilewati (mode API).

**Jeda update:** jadwal GitHub Actions minimal 5 menit dan sering molor. Dengan API key, video baru
biasanya tampil **±10–20 menit** setelah diunggah. Tanpa key (RSS saja), bisa jauh lebih lama karena
RSS YouTube kadang baru terbarui setelah berjam-jam.

> **Tanpa GitHub Actions pun situs tetap jalan.** Bila `video.json` kosong, halaman langsung membaca
> playlist upload otomatis kanal — playlist ini diperbarui YouTube sendiri setiap ada upload baru.
> GitHub Actions hanya lapisan tambahan; boleh dilewati bila situs di-deploy dari branch biasa.

## Struktur repo

```
index.html, style.css, script.js   situs
video.json                         daftar video terbaru (ditulis otomatis — jangan diedit manual)
scripts/update-video.mjs           pengambil daftar video (dijalankan GitHub Actions)
scripts/youtube-api.mjs            sumber YouTube Data API
scripts/youtube.mjs                logika parsing & pemilihan judul
.github/workflows/update-video.yml jadwal + deploy
test/                              unit test (node --test test/*.mjs)
```

## Pemasangan (sekali saja)

1. Unggah **seluruh isi** folder ini ke root repo GitHub (publik), termasuk folder `.github`.
   > Folder `.github` diawali titik; di Windows/macOS pastikan ikut terunggah. Cara paling aman:
   > `git add . && git commit -m "Portal cuaca" && git push`.
2. **Settings → Pages → Build and deployment → Source:** pilih **GitHub Actions**
   (bukan "Deploy from a branch").
3. **Settings → Actions → General → Workflow permissions:** pilih **Read and write permissions** → Save.
4. Tab **Actions** → workflow **Update video & deploy** → **Run workflow**.
   Tunggu ±1 menit sampai hijau. Situs aktif di `https://<akun>.github.io/<repo>/`.

Setelah itu semuanya otomatis.

## Memasang YouTube API key (disarankan)

Key hanya dipakai GitHub Actions dan disimpan sebagai **Secret** — tidak pernah masuk ke kode situs,
repo, atau browser pengunjung.

1. **Buat key** di https://console.cloud.google.com:
   *APIs & Services → Library* → **YouTube Data API v3** → *Enable* →
   *APIs & Services → Credentials → Create credentials → API key*.
2. **Batasi key** (klik nama key):
   - *Application restrictions*: **None** (server GitHub tidak punya alamat tetap, jadi pembatasan
     website/IP tidak bisa dipakai).
   - *API restrictions*: **Restrict key** → centang **YouTube Data API v3** saja → *Save*.
3. **Simpan di GitHub**: repo → *Settings → Secrets and variables → Actions →
   New repository secret* → Name: `YOUTUBE_API_KEY`, Secret: tempel key → *Add secret*.
4. Tab **Actions** → **Update video & deploy** → **Run workflow**. Di log langkah
   *Ambil video terbaru dari YouTube* harus muncul `Sumber: YouTube Data API`.

Kuota: ±576 unit/hari dari jatah gratis 10.000 unit/hari. Jangan tempel key di file mana pun di repo;
bila pernah tidak sengaja ter-commit, hapus key itu di Google Cloud dan buat yang baru.

## Mengecek

- Tab **Actions** → buka run terakhir → langkah *Ambil video terbaru dari YouTube*.
  Log menampilkan judul video terpilih, mis. `Video terbaru: <judul> (xxxxxxxxxxx)`.
- Buka `https://<akun>.github.io/<repo>/video.json` untuk melihat daftar yang dipakai situs.

## Pengaturan

| Yang diubah | Di mana |
|---|---|
| Hanya judul tertentu (mis. `'Prakiraan Cuaca Esok Hari'`) | `scripts/update-video.mjs` → `TITLE_PREFIX` (kosong = semua video) |
| Ikutkan Shorts | `scripts/update-video.mjs` → `INCLUDE_SHORTS = true` |
| Channel | `scripts/update-video.mjs` → `CHANNEL_ID` |
| Frekuensi cek di browser | `script.js` → `VIDEO.POLL_MINUTES` |
| Channel (sisi browser) | `script.js` → `VIDEO.CHANNEL_ID` |
| Lokasi panel cuaca | `script.js` → `WEATHER.ADM4` |

## Catatan

- Tanpa API key (mode RSS), jadwal siaran live/premiere yang belum dimulai ikut tercatat sebagai upload
  terbaru; pemutar menampilkan halaman tunggu YouTube sampai siaran dimulai.
- GitHub menonaktifkan jadwal di repo publik setelah 60 hari tanpa aktivitas. Commit otomatis
  `video.json` setiap hari menjaga repo tetap aktif; bila tetap dinonaktifkan, GitHub mengirim email
  dan cukup klik **Enable workflow** di tab Actions.
- Jam memakai waktu perangkat (GitHub Pages tidak bisa menjalankan server untuk jam BMKG).
