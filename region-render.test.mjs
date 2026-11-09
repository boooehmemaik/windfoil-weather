// ============================================================================
// WindFoil — Regionsseiten rendern vollständig
// ----------------------------------------------------------------------------
// Statik-Checks hätten e9f86c4 nicht gefunden: dort war der Code syntaktisch
// in Ordnung und nur zur Laufzeit kaputt. Dieser Test fährt init() für alle
// vier Regionen gegen die echte spots.json durch — mit gestubbtem DOM,
// Leaflet und Netz — und prüft, dass am Ende Karten, Ranking, Verlauf und
// Marker tatsächlich befüllt sind.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WF = require('./js/wf-scoring.js');
globalThis.WF = WF;

const SPOTS_JSON = readFileSync(new URL('./spots.json', import.meta.url), 'utf8');
const REGIONS = JSON.parse(SPOTS_JSON).regions;

function forecast(seed) {
  const h = { time: [], windspeed_10m: [], windgusts_10m: [], winddirection_10m: [], temperature_2m: [] };
  for (let i = 0; i < 72; i++) {
    h.time.push(new Date(Date.UTC(2026, 10, 9, i)).toISOString().slice(0, 16));
    h.windspeed_10m.push(4 + 5 * Math.abs(Math.sin((i + seed) / 5)));
    h.windgusts_10m.push(9 + (i % 7));
    h.winddirection_10m.push((i * 13 + seed * 37) % 360);
    h.temperature_2m.push(12 + (i % 11));
  }
  return { hourly: h };
}

function archive() {
  const h = { time: [], windspeed_10m: [], windgusts_10m: [], winddirection_10m: [], temperature_2m: [] };
  for (let d = 1; d <= 14; d++) for (let hr = 0; hr < 24; hr++) {
    h.time.push(`2026-10-${String(d).padStart(2, '0')}T${String(hr).padStart(2, '0')}:00`);
    h.windspeed_10m.push(3 + 6 * Math.abs(Math.cos((d * 24 + hr) / 9)));
    h.windgusts_10m.push(10 + hr % 5);
    h.winddirection_10m.push((d * 29 + hr * 7) % 360);
    h.temperature_2m.push(8 + d % 13);
  }
  return { hourly: h };
}

/** Browser-Umgebung so weit nachbauen, wie init() sie anfasst. */
function stubEnv() {
  const nodes = {}, popups = [], calls = {};
  const node = () => ({ innerHTML: '', textContent: '', style: {}, classList: { toggle() {} } });

  globalThis.fetch = async url => {
    const u = String(url);
    const tag = u.includes('/spots.json') ? 'spots'
      : u.includes('/api/') ? 'api'
      : u.includes('archive-api') ? 'archive'
      : u.includes('marine-api') ? 'marine'
      : u.includes('weathercode') ? 'wx' : 'wind';
    calls[tag] = (calls[tag] || 0) + 1;
    const body = tag === 'spots' ? JSON.parse(SPOTS_JSON)
      : tag === 'api' ? { ok: false }
      : tag === 'archive' ? archive()
      : tag === 'marine' ? { hourly: { sea_surface_temperature: Array(24).fill(13.7) } }
      : tag === 'wx' ? { hourly: { weathercode: Array(72).fill(1) } }
      : forecast(calls.wind);
    return { ok: tag !== 'api', status: tag === 'api' ? 401 : 200, json: async () => body };
  };
  globalThis.AbortSignal = { timeout: () => null };
  globalThis.setInterval = () => 0;
  globalThis.document = { getElementById: id => (nodes[id] ||= node()), querySelector: () => null };
  globalThis.L = {
    map: () => ({ addLayer() {} }),
    tileLayer: () => ({ addTo() { return this; } }),
    divIcon: o => o,
    marker: () => ({ addTo() { return this; }, setIcon() {}, bindPopup(h) { popups.push(h); }, openPopup() {} }),
  };
  return { nodes, popups, calls };
}

const R = (() => { stubEnv(); return require('./js/wf-region.js'); })();

for (const [key, cfg] of Object.entries(REGIONS)) {
  test(`${key}: init() befüllt Karten, Ranking, Verlauf und Marker`, async () => {
    const { nodes, popups, calls } = stubEnv();
    await R.init(key);

    const n = cfg.spots.length;
    const grid = nodes['spots-grid'].innerHTML;
    const rows = nodes['rec-body'].innerHTML;
    const hist = nodes['hist-grid'].innerHTML;

    assert.strictEqual((grid.match(/class="spot-card/g) || []).length, n, 'Spot-Karten');
    assert.strictEqual((rows.match(/<tr>/g) || []).length, n, 'Ranking-Zeilen');
    assert.strictEqual((hist.match(/class="hist-card"/g) || []).length, n, 'Verlaufskarten');
    // Platzhalter + Ergebnis-Popup je Spot.
    assert.ok(popups.length >= n, `Marker-Popups: ${popups.length} < ${n}`);

    assert.strictEqual(nodes['rec-loading'].style.display, 'none', 'Ladeanzeige nicht ausgeblendet');
    assert.strictEqual(nodes['rec-table'].style.display, '', 'Ranking-Tabelle nicht eingeblendet');
    assert.match(nodes['winner-name'].textContent, /Score \d+$/, 'Gewinner-Zeile');
    assert.ok(nodes['rider-note'].textContent.length > 0, 'Fahrerhinweis leer');

    for (const [label, html] of Object.entries({ grid, rows, hist, why: nodes['winner-why'].innerHTML })) {
      assert.ok(!html.includes('undefined'), `undefined in ${label}`);
      assert.ok(!html.includes('NaN'), `NaN in ${label}`);
    }

    assert.strictEqual(/Wassertemp/.test(grid), cfg.sst, 'SST-Kachel passt nicht zum sst-Flag');
    assert.strictEqual(calls.marine || 0, cfg.sst ? cfg.spots.filter(s => !s.noMarine).length : 0,
      'Marine-API-Aufrufe');
  });
}

// ── Batch-Proxy vs. Direktabruf ─────────────────────────────────────────────
// Die vier Tests oben stubben /api/ als 401 und decken damit den Rückfall ab.
// Hier kommt der Batch-Endpunkt dazu — und die Fälle, in denen ihm nicht zu
// trauen ist.

function batchBody(cfg, omit) {
  const spots = {};
  cfg.spots.forEach((s, i) => { if (s.id !== omit) spots[s.id] = forecast(i + 1); });
  return { region: 'x', days: 3, spots };
}

function marineBody(cfg, omit) {
  const sst = {};
  cfg.spots.forEach(s => { if (s.id !== omit) sst[s.id] = s.noMarine ? null : 13.7; });
  return { region: 'x', sst };
}

function histBody(cfg, omit) {
  const spots = {};
  cfg.spots.forEach(s => { if (s.id !== omit) spots[s.id] = archive(); });
  return { region: 'x', days: 14, spots };
}

function stubWithBatch(cfg, opts = {}) {
  const env = stubEnv();
  const base = globalThis.fetch;
  globalThis.fetch = async url => {
    const u = String(url);
    if (u.includes('/api/forecast/batch')) {
      env.calls.batch = (env.calls.batch || 0) + 1;
      if (opts.batchFails) return { ok: false, status: 502, json: async () => ({ error: 'upstream_unavailable' }) };
      return { ok: true, status: 200, json: async () => batchBody(cfg, opts.omit) };
    }
    if (u.includes('/api/forecast/marine')) {
      env.calls.sstBatch = (env.calls.sstBatch || 0) + 1;
      return { ok: true, status: 200, json: async () => marineBody(cfg, opts.omit) };
    }
    if (u.includes('/api/forecast/history')) {
      env.calls.histBatch = (env.calls.histBatch || 0) + 1;
      return { ok: true, status: 200, json: async () => histBody(cfg, opts.omit) };
    }
    return base(url);
  };
  return env;
}

test('init(): der Batch-Endpunkt ersetzt die Einzelabrufe', async () => {
  const cfg = REGIONS.skandinavien;
  const { nodes, calls } = stubWithBatch(cfg);
  await R.init('skandinavien');

  assert.strictEqual(calls.batch, 1, 'ein Forecast-Request für die ganze Region');
  assert.strictEqual(calls.sstBatch, 1, 'ein Marine-Request für die ganze Region');
  assert.strictEqual(calls.histBatch, 1, 'ein Verlaufs-Request für die ganze Region');
  assert.strictEqual(calls.wind || 0, 0, 'trotz Batch direkt bei Open-Meteo geholt');
  assert.strictEqual(calls.marine || 0, 0, 'trotz Batch direkt bei marine-api geholt');
  assert.strictEqual(calls.archive || 0, 0, 'trotz Batch direkt bei archive-api geholt');
  assert.strictEqual((nodes['rec-body'].innerHTML.match(/<tr>/g) || []).length, cfg.spots.length);
  assert.strictEqual((nodes['hist-grid'].innerHTML.match(/class="hist-card"/g) || []).length, cfg.spots.length);
  assert.match(nodes['spots-grid'].innerHTML, /Wassertemp/);
  assert.match(nodes['winner-name'].textContent, /Score \d+$/);
});

test('init(): fällt der Proxy aus, holt die Seite direkt bei Open-Meteo', async () => {
  const cfg = REGIONS.sardinia;
  const { nodes, calls } = stubWithBatch(cfg, { batchFails: true });
  await R.init('sardinia');

  assert.strictEqual(calls.wind, cfg.spots.length, 'Direktabrufe fehlen');
  assert.strictEqual((nodes['rec-body'].innerHTML.match(/<tr>/g) || []).length, cfg.spots.length);
  assert.match(nodes['winner-name'].textContent, /Score \d+$/);
});

test('init(): ein im Batch fehlender Spot löst den Direktabruf aus', async () => {
  // Der Server-Cache kann älter sein als spots.json — dann fehlt ein neuer Spot.
  const cfg = REGIONS.sardinia;
  const { calls } = stubWithBatch(cfg, { omit: cfg.spots[0].id });
  await R.init('sardinia');

  assert.strictEqual(calls.batch, 1);
  assert.strictEqual(calls.wind, cfg.spots.length, 'Teilantwort hätte nicht genügen dürfen');
});

test('init(): unbekannte Region bricht laut ab, statt leer zu rendern', async () => {
  const { nodes } = stubEnv();
  await assert.rejects(() => R.init('atlantis'), /nicht in spots\.json/);
  // Ohne sichtbaren Hinweis bliebe die Seite für immer bei "⟳ lade…".
  assert.match(nodes['winner-name'].textContent, /nicht ladbar/);
  assert.match(nodes['spots-grid'].innerHTML, /atlantis/);
  await assert.rejects(() => R.init(''), /keine Region/);
});

test('init(): defektes spots.json meldet sich, statt stumm zu hängen', async () => {
  const { nodes } = stubEnv();
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => { throw new Error('kaputt'); } });
  await assert.rejects(() => R.init('sardinia'));
  assert.match(nodes['winner-name'].textContent, /nicht ladbar/);
  assert.match(nodes['rec-loading'].textContent, /nicht verfügbar/);
});
