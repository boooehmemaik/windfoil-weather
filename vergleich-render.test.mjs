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
  const nodes = {}, calls = {}, icons = [], popups = [];
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
    marker: () => ({
      addTo() { return this; }, setIcon(i) { icons.push(i); },
      bindPopup(h) { popups.push(h); }, openPopup() {}, getPopup: () => null,
    }),
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
  const api = new Function(`${INLINE}\nreturn { loadAll, ALL_SPOTS, getTableData: () => tableData, windArrowSvg };`)();
  return { nodes, calls, icons, popups, api };
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

const rotationOf = html => {
  const m = html.match(/transform:rotate\(([-\d.]+)deg\)/);
  return m ? Number(m[1]) : null;
};

test('loadAll(): Marker und Ø-Wind-Spalte tragen den Windrichtungspfeil', async () => {
  const { nodes, icons, popups, api } = stubEnv(batchNet());
  await api.loadAll();

  const rows = api.getTableData();
  assert.strictEqual(icons.length, rows.length, 'je Spot ein Icon-Update');

  rows.forEach((r, i) => {
    assert.ok(Number.isFinite(r.dir0), `${r.spot.id}: dir0 fehlt`);
    assert.ok(Number.isFinite(r.dirAvg), `${r.spot.id}: dirAvg fehlt`);
    // Der Marker zeigt den Heute-Score, also muss der Pfeil dir0 tragen —
    // dirAvg wäre die Fünf-Tage-Richtung und damit ein anderer Zeitraum.
    assert.strictEqual(rotationOf(icons[i].html), r.dir0,
      `${r.spot.id}: Marker-Pfeil zeigt nicht die Heute-Richtung`);
    assert.match(icons[i].html, /class="lm-score"[^>]*>\s*<svg/, 'Pfeil steht nicht vor der Zahl');
  });

  // Die Spalte mittelt fünf Tage — ihr Pfeil muss das auch tun.
  const cellRots = [...nodes['compare-body'].innerHTML.matchAll(/transform:rotate\(([-\d.]+)deg\)/g)]
    .map(m => Number(m[1]));
  assert.strictEqual(cellRots.length, rows.length, 'je Zeile genau ein Pfeil');
  assert.deepStrictEqual(cellRots, rows.map(r => r.dirAvg), 'Spaltenpfeil ≠ Fünf-Tage-Richtung');
  assert.strictEqual((nodes['compare-body'].innerHTML.match(/class="dir-sub"/g) || []).length,
    rows.length, 'Kompass-Kürzel unter dem kn-Wert fehlt');

  // Beide Pfeile müssen unterscheidbar sein, sonst prüfen die Zeilen oben nichts.
  assert.ok(rows.some(r => Math.abs(r.dir0 - r.dirAvg) > 1),
    'Testdaten liefern für Heute und Ø dieselbe Richtung — der Vergleich wäre blind');

  assert.ok(popups.some(p => /Ø 5 Tage: .* aus <svg/.test(p)), 'Popup ohne Richtungspfeil');
});

test('windArrowSvg(): identische Konvention in vergleich.html und js/wf-region.js', () => {
  // Zwei Implementierungen, eine Bedeutung: die Spitze zeigt dorthin, WOHER
  // der Wind kommt. Läuft eine davon weg, zeigen Karte und Regionsseite für
  // denselben Wind in verschiedene Richtungen — ohne dass etwas kaputt wirkt.
  const { api } = stubEnv(batchNet());
  const region = require('./js/wf-region.js');
  for (const deg of [0, 45, 90, 180, 270, 359.4]) {
    assert.strictEqual(
      api.windArrowSvg(deg, '#3a9ad9', 13).replace(/\s+/g, ' '),
      region.windArrowSvg(deg, '#3a9ad9', 13).replace(/\s+/g, ' '),
      `Pfeil bei ${deg}° weicht ab`);
  }
  assert.strictEqual(api.windArrowSvg(null), '', 'ohne Richtung kein Pfeil');
  assert.strictEqual(region.windArrowSvg(null), '', 'ohne Richtung kein Pfeil');
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
