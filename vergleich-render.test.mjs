// ============================================================================
// WindFoil — vergleich.html rendert vollständig
// ----------------------------------------------------------------------------
// Die Seite hatte bisher nur einen Syntax-Check. Ihr Datenpfad läuft jetzt über
// /api/forecast/batch mit Rückfall auf den Direktabruf — ein Pfadwechsel, den
// eine statische Prüfung nicht abdeckt. Dieser Test führt das Inline-Skript mit
// gestubbtem DOM, Leaflet und Netz aus, ruft loadAll() und prüft die Tabelle.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.WF = require('./js/wf-scoring.js');

const HTML = readFileSync(new URL('./vergleich.html', import.meta.url), 'utf8');
const INLINE = HTML.slice(HTML.lastIndexOf('<script>') + 8, HTML.lastIndexOf('</script>'));

function forecast(seed, hours) {
  const h = { time: [], windspeed_10m: [], windgusts_10m: [], winddirection_10m: [], temperature_2m: [] };
  for (let i = 0; i < hours; i++) {
    h.time.push(new Date(Date.UTC(2026, 10, 9, i)).toISOString().slice(0, 16));
    h.windspeed_10m.push(4 + 5 * Math.abs(Math.sin((i + seed) / 5)));
    h.windgusts_10m.push(9 + (i % 7));
    h.winddirection_10m.push((i * 13 + seed * 37) % 360);
    h.temperature_2m.push(12 + (i % 11));
  }
  return { hourly: h };
}

/** Browser-Umgebung so weit nachbauen, wie das Inline-Skript sie anfasst. */
function stubEnv(net) {
  const nodes = {}, calls = {};
  // firstChild: renderTable schreibt die Tages-Labels in den ersten Kindknoten
  // der Spalten-Header, nicht in das <th> selbst.
  const node = () => ({
    innerHTML: '', textContent: '', style: {}, dataset: {},
    firstChild: { textContent: '' },
    classList: { add() {}, remove() {}, toggle() {} },
  });

  globalThis.document = {
    getElementById: id => (nodes[id] ||= node()),
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  globalThis.AbortSignal = { timeout: () => null };
  globalThis.setInterval = () => 0;
  globalThis.L = {
    map: () => ({ addLayer() {} }),
    tileLayer: () => ({ addTo() { return this; } }),
    divIcon: o => o,
    marker: () => ({ addTo() { return this; }, setIcon() {}, bindPopup() {}, openPopup() {}, getPopup: () => null }),
  };
  globalThis.fetch = async url => {
    const u = String(url);
    const tag = u.includes('/api/forecast/batch') ? 'batch'
      : u.includes('/api/forecast/marine') ? 'sstBatch'
      : u.includes('/api/') ? 'api'
      : u.includes('marine-api') ? 'marine' : 'wind';
    calls[tag] = (calls[tag] || 0) + 1;
    return net(tag, calls);
  };

  // Das Inline-Skript ist ein klassisches Script ohne Exporte — der angehängte
  // return ist die einzige Naht, über die der Test an loadAll() kommt.
  const api = new Function(`${INLINE}\nreturn { loadAll, ALL_SPOTS, getTableData: () => tableData };`)();
  return { nodes, calls, api };
}

const miss = { ok: false, status: 404, json: async () => ({}) };

function batchNet(opts = {}) {
  return (tag, calls) => {
    if (tag === 'batch') {
      if (opts.batchFails) return { ok: false, status: 502, json: async () => ({ error: 'upstream_unavailable' }) };
      return { ok: true, status: 200, json: async () => ({ spots: body(opts.omit, id => forecast(id.length, 120)) }) };
    }
    if (tag === 'sstBatch') return { ok: true, status: 200, json: async () => ({ sst: body(opts.omit, () => 15.2) }) };
    if (tag === 'wind') return { ok: true, status: 200, json: async () => forecast(calls.wind, 120) };
    if (tag === 'marine') return { ok: true, status: 200, json: async () => ({ hourly: { sea_surface_temperature: Array(24).fill(15.2) } }) };
    return miss;
  };
}

// ALL_SPOTS lebt im Inline-Skript; die IDs kommen darum aus spots.json.
const SPOTS = JSON.parse(readFileSync(new URL('./spots.json', import.meta.url), 'utf8'));
const ALL_IDS = [...Object.values(SPOTS.regions).flatMap(r => r.spots), ...SPOTS.unpagedSpots].map(s => s.id);

function body(omit, make) {
  const out = {};
  for (const id of ALL_IDS) if (id !== omit) out[id] = make(id);
  return out;
}

test('loadAll(): zwei Requests statt 79, Tabelle vollständig', async () => {
  const { nodes, calls, api } = stubEnv(batchNet());
  await api.loadAll();

  assert.strictEqual(calls.batch, 1, 'ein Forecast-Request für alle Spots');
  assert.strictEqual(calls.sstBatch, 1, 'ein Marine-Request für alle Spots');
  assert.strictEqual(calls.wind || 0, 0, 'trotz Batch direkt bei Open-Meteo geholt');
  assert.strictEqual(calls.marine || 0, 0, 'trotz Batch direkt bei marine-api geholt');

  const n = api.ALL_SPOTS.length;
  const rows = nodes['compare-body'].innerHTML;
  assert.strictEqual((rows.match(/<tr/g) || []).length, n, `${n} Tabellenzeilen erwartet`);
  assert.ok(!rows.includes('undefined'), 'undefined in der Tabelle');
  assert.ok(!rows.includes('NaN'), 'NaN in der Tabelle');
  // Alle fünf Tage müssen einen Score tragen, sonst war die Stundenreihe zu kurz.
  for (const r of api.getTableData()) {
    for (const k of ['avg', 'd0', 'd1', 'd2', 'd3', 'd4']) {
      assert.ok(Number.isFinite(r[k]), `${r.spot.id}.${k} ist ${r[k]}`);
    }
    assert.strictEqual(r.sst, 15.2, `${r.spot.id}: Wassertemperatur fehlt`);
  }
  assert.ok(nodes['winners'].innerHTML.length > 0, 'Gewinner-Box leer');
  assert.match(nodes['load-status'].textContent, new RegExp(`${n} Spots geladen`));
  assert.ok(nodes['rider-note'].textContent.length > 0, 'Fahrerhinweis leer');
});

test('loadAll(): fällt der Proxy aus, holt die Seite direkt bei Open-Meteo', async () => {
  const { nodes, calls, api } = stubEnv(batchNet({ batchFails: true }));
  await api.loadAll();

  assert.strictEqual(calls.wind, api.ALL_SPOTS.length, 'Direktabrufe fehlen');
  assert.strictEqual((nodes['compare-body'].innerHTML.match(/<tr/g) || []).length, api.ALL_SPOTS.length);
  for (const r of api.getTableData()) assert.ok(Number.isFinite(r.avg), `${r.spot.id}: kein Score`);
});

test('loadAll(): ein im Batch fehlender Spot löst den Direktabruf aus', async () => {
  // Der Server-Cache kann älter sein als spots.json — dann fehlt ein neuer Spot.
  const { calls, api } = stubEnv(batchNet({ omit: ALL_IDS[0] }));
  await api.loadAll();

  assert.strictEqual(calls.batch, 1);
  assert.strictEqual(calls.wind, api.ALL_SPOTS.length, 'Teilantwort hätte nicht genügen dürfen');
});
