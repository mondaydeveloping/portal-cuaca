import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, selectLatest, parseForecastDate, matchesPrefix } from '../scripts/youtube.mjs';

const PREFIX = 'Prakiraan Cuaca Esok Hari';

const entry = (id, title, published, path = 'watch?v=') => `
 <entry>
  <id>yt:video:${id}</id>
  <yt:videoId>${id}</yt:videoId>
  <title>${title}</title>
  <link rel="alternate" href="https://www.youtube.com/${path}${id}"/>
  <published>${published}</published>
 </entry>`;

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <title>Info BMKG</title>
 ${entry('GEMPA000001', 'Info Gempa Magnitudo 5,1', '2026-10-21T01:00:00+00:00')}
 ${entry('SHORT000001', 'Prakiraan Cuaca Esok Hari, Rabu, 21 Oktober 2026', '2026-10-20T10:30:00+00:00', 'shorts/')}
 ${entry('SELASA00020', 'Prakiraan Cuaca Esok Hari, Selasa, 20 Oktober', '2026-10-19T10:00:00+00:00')}
 ${entry('RABU0000021', 'Prakiraan Cuaca Esok Hari, Rabu, 21 Oktober 2026', '2026-10-20T10:00:00+00:00')}
 ${entry('SENIN000019', 'Prakiraan Cuaca Esok Hari, Senin, 19 Oktober 2026', '2026-10-18T10:00:00+00:00')}
 ${entry('MINGGU00018', 'Prakiraan Cuaca Esok Hari, Senin, 18 Oktober 2026', '2026-10-17T10:00:00+00:00')}
 ${entry('MINGGUAN001', 'Prakiraan Cuaca Mingguan 20-26 Oktober', '2026-10-19T12:00:00+00:00')}
</feed>`;

test('tanpa prefix: video terbaru apa pun, tanpa Shorts; label hanya untuk video prakiraan', () => {
  const videos = selectLatest(parseFeed(FEED), { prefix: '', max: 3, forecastPrefix: PREFIX });
  assert.deepEqual(videos.map(v => v.id), ['GEMPA000001', 'RABU0000021', 'MINGGUAN001']);
  assert.equal(videos[0].forecastDate, null);           // "Info Gempa" tidak diberi label prakiraan
  assert.equal(videos[1].forecastDate, '2026-10-21');
  assert.equal(videos[2].forecastDate, null);           // "Prakiraan Cuaca Mingguan" bukan prakiraan harian
});

test('Shorts bisa diikutkan bila diminta', () => {
  const videos = selectLatest(parseFeed(FEED), { includeShorts: true, max: 2 });
  assert.deepEqual(videos.map(v => v.id), ['GEMPA000001', 'SHORT000001']);
});

test('dengan prefix: hanya judul berawalan prefix, terbaru dulu, tanpa Shorts', () => {
  const videos = selectLatest(parseFeed(FEED), { prefix: PREFIX, max: 3, forecastPrefix: PREFIX });
  assert.deepEqual(videos.map(v => v.id), ['RABU0000021', 'SELASA00020', 'SENIN000019']);
  assert.equal(videos[0].forecastDate, '2026-10-21');
});

test('tanggal prakiraan: tahun opsional & nama hari diabaikan', () => {
  assert.equal(parseForecastDate('Prakiraan Cuaca Esok Hari, Selasa, 20 Oktober', '2026-10-19T10:00:00Z'), '2026-10-20');
  assert.equal(parseForecastDate('Prakiraan Cuaca Esok Hari, Senin, 18 Oktober 2026', '2026-10-17T10:00:00Z'), '2026-10-18');
  assert.equal(parseForecastDate('Prakiraan Cuaca Esok Hari, Kamis, 1 Januari', '2026-12-31T10:00:00Z'), '2027-01-01');
  assert.equal(parseForecastDate('Prakiraan Cuaca Esok Hari, 31 Februari 2026', '2026-02-01T00:00:00Z'), null);
  assert.equal(parseForecastDate('Tanpa tanggal', '2026-10-19T10:00:00Z'), null);
});

test('pencocokan prefix toleran huruf besar/kecil & spasi', () => {
  assert.ok(matchesPrefix('  PRAKIRAAN  CUACA esok hari, Rabu', PREFIX));
  assert.ok(!matchesPrefix('Update Prakiraan Cuaca Esok Hari', PREFIX));
});

test('feed rusak/kosong tidak melempar error', () => {
  assert.deepEqual(parseFeed(''), []);
  assert.deepEqual(selectLatest(parseFeed('<html>error</html>'), { prefix: PREFIX }), []);
});
