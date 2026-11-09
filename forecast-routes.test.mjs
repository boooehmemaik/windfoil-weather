// ============================================================================
// WindFoil — Forecast-Batch-Proxy
// ----------------------------------------------------------------------------
// Der Cache ist der ganze Zweck dieser Routen: ohne ihn verbraucht ein
// Seitenaufruf von vergleich.html 79 Open-Meteo-Calls. Die Tests zählen darum
// die Upstream-Aufrufe, nicht nur die Antwortform.
// ============================================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { readFileSync } from 'node:fs';

const SPOTS = JSON.parse(readFileSync(new URL('./spots.json', import.meta.url), 'utf8'));

// ── Upstream-Stub ───────────────────────────────────────────────────────────

let upstream = [];
let upstreamFails = false;

function hourly(n, extra) {
  const h = { time: [], windspeed_10m: [], windgusts_10m: [], winddirection_10m: [], temperature_2m: [] };
  for (let i = 0; i < n; i++) {
    h.time.push(new Date(Date.UTC(2026, 10, 9, i)).toISOString().slice(0, 16));
    h.windspeed_10m.push(6); h.windgusts_10m.push(9);
    h.winddirection_10m.push(180); h.temperature_2m.push(15);
  }
  return { ...h, ...extra };
}

function archiveHourly(days) {
  const h = { time: [], windspeed_10m: [], windgusts_10m: [], winddirection_10m: [], temperature_2m: [] };
  for (let d = 1; d <= days; d++) for (let hr = 0; hr < 24; hr++) {
    h.time.push(`2026-10-${String(d).padStart(2, '0')}T${String(hr).padStart(2, '0')}:00`);
    h.windspeed_10m.push(hr); h.windgusts_10m.push(hr + 2);
    h.winddirection_10m.push(180); h.temperature_2m.push(10 + d);
  }
  return h;
}

// Stundenweise ansteigende Wassertemperatur: ein konstanter Wert könnte nicht
// zeigen, über welches Tagesfenster die Route mittelt.
const SST_SERIES = Array.from({ length: 24 }, (_, i) => i + 0.44);
const SST_MEAN_9_18 = 13.4;

const realFetch = globalThis.fetch;

globalThis.fetch = async url => {
  const u = new URL(String(url));
  // Nur Open-Meteo abfangen — die Tests sprechen über fetch() mit dem eigenen Server.
  if (!u.host.endsWith('open-meteo.com')) return realFetch(url);
  const n = u.searchParams.get('latitude').split(',').length;
  upstream.push({ host: u.host, hourly: u.searchParams.get('hourly'), models: u.searchParams.get('models'), n });

  // Antwortet der Stub ohne Verzögerung, ist eine Anfrage fertig bevor die
  // nächste geparst ist — die In-flight-Deduplizierung käme nie zum Tragen.
  await new Promise(r => setTimeout(r, 15));
  if (upstreamFails) return { ok: false, status: 503, json: async () => ({}) };

  const days = Number(u.searchParams.get('forecast_days') || 3);
  const vars = u.searchParams.get('hourly');
  const body = Array.from({ length: n }, (_, i) => {
    if (u.host.startsWith('archive')) return { hourly: archiveHourly(14) };
    if (u.host.startsWith('marine')) return { hourly: { sea_surface_temperature: [...SST_SERIES] } };
    if (vars === 'weathercode') return { hourly: { time: [], weathercode: Array(days * 24).fill(3) } };
    const extra = vars.includes('weathercode') ? { weathercode: Array(days * 24).fill(61) } : {};
    // Je Spot ein anderer Offset — ein konstanter Wert würde eine vertauschte
    // Zuordnung von Koordinate zu Antwort nicht zeigen.
    return { utc_offset_seconds: 3600 + i * 60, hourly: hourly(days * 24, extra) };
  });
  return { ok: true, status: 200, json: async () => body };
};

// ── Server ──────────────────────────────────────────────────────────────────

let base, server, internals;

before(async () => {
  const mod = await import('./src/forecast.routes.mjs');
  internals = mod._internals;
  const app = express();
  app.use('/api/forecast', mod.forecastRouter);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/forecast`;
});
after(() => server?.close());

const get = async path => {
  const r = await realFetch(base + path);
  return { status: r.status, cache: r.headers.get('x-cache'), body: await r.json().catch(() => null) };
};

function reset() { upstream = []; upstreamFails = false; internals.cache.clear(); }

// ── Eingaben ────────────────────────────────────────────────────────────────

test('unbekannte Region → 404, kein Upstream-Call', async () => {
  reset();
  assert.strictEqual((await get('/batch?region=atlantis')).status, 404);
  assert.strictEqual((await get('/batch?region=')).status, 404);
  // Koordinaten aus der Anfrage würden das hier zu einem offenen Wetter-Proxy machen.
  assert.strictEqual((await get('/batch?latitude=1&longitude=2')).status, 404);
  assert.strictEqual(upstream.length, 0);
});

test('days außerhalb 1–7 → 400', async () => {
  reset();
  for (const d of ['0', '8', '99', '2.5', 'abc']) {
    const r = await get(`/batch?region=sardinia&days=${d}`);
    assert.strictEqual(r.status, 400, `days=${d} wurde akzeptiert`);
  }
  assert.strictEqual(upstream.length, 0);
});

// ── Form ────────────────────────────────────────────────────────────────────

for (const [key, cfg] of Object.entries(SPOTS.regions)) {
  test(`/batch?region=${key}: liefert jeden Spot der Region`, async () => {
    reset();
    const r = await get(`/batch?region=${key}&days=3`);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(Object.keys(r.body.spots).sort(), cfg.spots.map(s => s.id).sort());
    for (const id of Object.keys(r.body.spots)) {
      assert.strictEqual(r.body.spots[id].hourly.windspeed_10m.length, 72, `${id}: Stundenzahl`);
      assert.ok(r.body.spots[id].hourly.weathercode, `${id}: weathercode fehlt`);
    }
    // timezone=auto liefert Ortszeit ohne Zone. Ohne diesen Offset kann der
    // Windalarm nicht entscheiden, ob eine Session schon gelaufen ist.
    cfg.spots.forEach((s, i) => assert.strictEqual(
      r.body.spots[s.id].utcOffsetSeconds, 3600 + i * 60, `${s.id}: Zeitzonen-Offset`));
  });
}

test('/batch?region=all: deckt alle 40 Spots aus vergleich.html ab', async () => {
  reset();
  const r = await get('/batch?region=all&days=5');
  const expected = [...Object.values(SPOTS.regions).flatMap(x => x.spots), ...SPOTS.unpagedSpots].length;
  assert.strictEqual(Object.keys(r.body.spots).length, expected);
  assert.strictEqual(Object.values(r.body.spots)[0].hourly.windspeed_10m.length, 120, '5 Tage');
});

test('Modell-Regionen holen weathercode getrennt, andere im selben Call', async () => {
  reset();
  await get('/batch?region=sardinia&days=3');   // model: AROME
  assert.strictEqual(upstream.length, 2, 'AROME braucht einen zweiten Call für weathercode');
  assert.strictEqual(upstream.filter(c => c.models).length, 1);
  assert.ok(upstream.some(c => c.hourly === 'weathercode' && !c.models));

  reset();
  await get('/batch?region=sizilien&days=3');   // model: null
  assert.strictEqual(upstream.length, 1, 'ohne Modell gehört weathercode in denselben Call');
  assert.match(upstream[0].hourly, /weathercode/);
});

test('/marine verdichtet auf das Tagesmittel und respektiert noMarine', async () => {
  reset();
  const r = await get('/marine?region=skandinavien');
  assert.strictEqual(r.status, 200);
  const cfg = SPOTS.regions.skandinavien;
  assert.deepStrictEqual(Object.keys(r.body.sst).sort(), cfg.spots.map(s => s.id).sort());
  for (const s of cfg.spots) {
    if (s.noMarine) assert.strictEqual(r.body.sst[s.id], null, `${s.id} ist Binnenland`);
    else assert.strictEqual(r.body.sst[s.id], SST_MEAN_9_18, `${s.id}: Tagesmittel 9–18 Uhr, auf 1 Stelle gerundet`);
  }
  // Binnenspots gehen nicht mit upstream.
  assert.strictEqual(upstream[0].n, cfg.spots.filter(s => !s.noMarine).length);
});

test('/history beschneidet auf 9–18 Uhr und bündelt die Region', async () => {
  reset();
  const cfg = SPOTS.regions.sardinia;
  const r = await get('/history?region=sardinia');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(upstream.length, 1, 'ein Archive-Call für die ganze Region');
  assert.strictEqual(upstream[0].n, cfg.spots.length);
  assert.deepStrictEqual(Object.keys(r.body.spots).sort(), cfg.spots.map(s => s.id).sort());

  const h = Object.values(r.body.spots)[0].hourly;
  assert.strictEqual(h.time.length, 14 * 10, '14 Tage × 10 Stunden (9–18)');
  // Der Stub setzt windspeed = Stundenindex, die Beschneidung ist damit prüfbar.
  assert.deepStrictEqual([...new Set(h.windspeed_10m)].sort((a, b) => a - b),
    [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  assert.strictEqual(h.temperature_2m.length, h.time.length, 'Reihen gleich lang beschnitten');
});

test('/history cacht länger als der Forecast — ERA5 ändert sich täglich', async () => {
  reset();
  await get('/history?region=spanien');
  await get('/batch?region=spanien&days=3');
  const entries = (await get('/cache')).body.entries;
  const byKey = Object.fromEntries(entries.map(e => [e.key, e.ttlSec]));
  assert.strictEqual(byKey['hist|spanien'], 6 * 3600);
  assert.strictEqual(byKey['fc|spanien|3'], 900);

  const n = upstream.length;
  await get('/history?region=spanien');
  assert.strictEqual(upstream.length, n, 'Verlauf erneut upstream geholt');
});

// ── Cache ───────────────────────────────────────────────────────────────────

test('zweiter Aufruf kommt aus dem Cache, ohne Upstream', async () => {
  reset();
  const a = await get('/batch?region=spanien&days=3');
  const n = upstream.length;
  const b = await get('/batch?region=spanien&days=3');
  assert.strictEqual(upstream.length, n, 'Upstream erneut befragt');
  assert.match(a.cache, /^MISS/);
  assert.match(b.cache, /^HIT/);
  assert.deepStrictEqual(a.body, b.body);
});

test('days und Region sind Teil des Cache-Schlüssels', async () => {
  reset();
  await get('/batch?region=spanien&days=3');
  await get('/batch?region=spanien&days=5');
  await get('/batch?region=sizilien&days=3');
  assert.strictEqual(new Set(upstream.map(c => c.n + '|' + c.hourly)).size >= 1, true);
  assert.strictEqual(upstream.length, 3, 'jede Kombination braucht genau einen Call');
});

test('parallele Anfragen teilen einen Upstream-Call', async () => {
  reset();
  // Ohne Deduplizierung löst ein Cache-Miss bei N Besuchern N Upstream-Calls aus.
  const rs = await Promise.all(Array.from({ length: 8 }, () => get('/batch?region=sizilien&days=3')));
  assert.strictEqual(upstream.length, 1, `${upstream.length} Calls statt 1`);
  for (const r of rs) assert.strictEqual(r.status, 200);
});

test('Cache-Control zählt die Restlaufzeit herunter', async () => {
  reset();
  await get('/batch?region=spanien&days=3');
  const r = await realFetch(base + '/batch?region=spanien&days=3');
  assert.match(r.headers.get('cache-control'), /^public, max-age=\d+$/);
  assert.ok(Number(r.headers.get('cache-control').match(/\d+/)[0]) <= 900);
});

test('/cache zeigt die Einträge für den Health-Check', async () => {
  reset();
  await get('/batch?region=spanien&days=3');
  const r = await get('/cache');
  assert.strictEqual(r.body.ttlSec, 900);
  assert.strictEqual(r.body.entries.length, 1);
  assert.ok(r.body.entries[0].bytes > 0);
  assert.match(r.body.entries[0].key, /^fc\|spanien\|3$/);
});

// ── Fehlerfälle ─────────────────────────────────────────────────────────────

test('Upstream-Ausfall → 502, damit der Client direkt weitermacht', async () => {
  reset();
  upstreamFails = true;
  const r = await get('/batch?region=spanien&days=3');
  assert.strictEqual(r.status, 502);
  assert.strictEqual(r.body.error, 'upstream_unavailable');
  // Der Upstream-Status muss durchschlagen, sonst ist der Fehler nicht diagnostizierbar.
  assert.match(r.body.detail, /503/);
  // Ein Fehler darf nicht als gültige Antwort zwischengespeichert werden.
  upstreamFails = false;
  const ok = await get('/batch?region=spanien&days=3');
  assert.strictEqual(ok.status, 200);
  assert.match(ok.cache, /^MISS/);
});

test('fehlendes weathercode lässt den Forecast nicht scheitern', async () => {
  reset();
  const real = globalThis.fetch;
  globalThis.fetch = async url => String(url).includes('hourly=weathercode')
    ? { ok: false, status: 500, json: async () => ({}) }
    : real(url);
  const r = await get('/batch?region=sardinia&days=3');
  globalThis.fetch = real;
  assert.strictEqual(r.status, 200);
  assert.ok(Object.values(r.body.spots)[0].hourly.windspeed_10m.length > 0);
});

test('Stückelung: mehr Koordinaten als ein Call trägt', () => {
  assert.deepStrictEqual(internals.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepStrictEqual(internals.chunk([], 50), []);
});
