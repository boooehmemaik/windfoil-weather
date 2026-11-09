// ============================================================================
// WindFoil — Statik-Check der buildfreien Seiten
// ----------------------------------------------------------------------------
// Die Seiten haben keinen Build-Step. Ein Refactor (e9f86c4) hat deshalb
// unbemerkt vier Renderer und das return von dayStats aus zwei Seiten
// gelöscht — beide waren live kaputt, ohne dass ein Test rot wurde.
//
// Seit dem Shell-Umbau tragen die Regionsseiten keine Logik mehr: sie laden
// js/wf-region.js und rufen init(region). Geprüft wird darum sinngemäß
// dasselbe, nur an der neuen Nahtstelle:
//   1. jede Shell lädt Modul + Stylesheet und ruft init mit gültiger Region
//   2. die Platzhalter-IDs, die init() befüllt, existieren im Markup
//   3. die Spaltenzahl der Ranking-Tabelle passt zu den erzeugten Zellen
//   4. vergleich.html (noch mit Inline-Script) bleibt statisch geprüft
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = f => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');

const WF = require('./js/wf-scoring.js');
globalThis.WF = WF;
const R = require('./js/wf-region.js');

const SPOTS = JSON.parse(read('spots.json'));
const REGION_PAGES = { sardinia: 'sardinia.html', sizilien: 'sizilien.html', spanien: 'spanien.html', skandinavien: 'skandinavien.html' };

// IDs, die init() per getElementById befüllt. Fehlt eine, bricht init() ab —
// genau die Klasse Fehler, die der Shell-Umbau einführen könnte.
const REQUIRED_IDS = ['hdr-clock', 'rider-note', 'winner-name', 'winner-why', 'map',
  'spots-grid', 'rec-loading', 'rec-table', 'rec-body', 'hist-grid'];

for (const [key, page] of Object.entries(REGION_PAGES)) {
  const html = read(page);

  test(`${page}: lädt wf-region.js/.css und initialisiert "${key}"`, () => {
    assert.match(html, /<script src="\/js\/wf-region\.js"><\/script>/, 'Modul nicht geladen');
    assert.match(html, /<script src="\/js\/wf-scoring\.js"><\/script>/, 'Scoring nicht geladen');
    assert.match(html, /<link rel="stylesheet" href="\/css\/wf-region\.css" \/>/, 'Stylesheet nicht geladen');
    const m = html.match(/WFRegion\.init\('([a-z]+)'\)/);
    assert.ok(m, 'WFRegion.init-Aufruf fehlt');
    assert.strictEqual(m[1], key, 'init-Region passt nicht zur Seite');
    assert.ok(SPOTS.regions[m[1]], `Region "${m[1]}" nicht in spots.json`);
  });

  test(`${page}: keine Inline-Logik mehr (nur der init-Aufruf)`, () => {
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .map(m => m[1].trim());
    assert.deepStrictEqual(inline, [`WFRegion.init('${key}');`]);
  });

  test(`${page}: alle von init() befüllten IDs existieren`, () => {
    const missing = REQUIRED_IDS.filter(id => !html.includes(`id="${id}"`));
    assert.deepStrictEqual(missing, []);
  });

  // Vorher wurden die Ranking-Zellen je Seite von Hand gepflegt und waren
  // auseinandergelaufen. Header und Zellen kommen jetzt aus zwei Quellen
  // (Shell-Markup vs. Modul) — die müssen zusammenpassen.
  test(`${page}: Ranking-Header passt zur Spaltenzahl von buildRankingRows`, () => {
    const thead = html.match(/<thead>([\s\S]*?)<\/thead>/)[1];
    const thCount = (thead.match(/<th>/g) || []).length;

    const cfg = SPOTS.regions[key];
    const spots = cfg.spots;
    const results = {}, sstData = cfg.sst ? {} : null;
    spots.forEach((s, i) => { results[s.id] = synthForecast(i); if (sstData) sstData[s.id] = 12 + i; });
    const win = WF.guestWindow();
    const rows = R.buildRankingRows(R.rankSpots(spots, results, win), results, { win, sstData });

    const perRow = rows.split('<tr>').filter(Boolean)
      .map(tr => (tr.match(/<td[ >]/g) || []).length);
    assert.strictEqual(perRow.length, spots.length, 'Zeilenzahl != Spot-Zahl');
    for (const n of perRow) assert.strictEqual(n, thCount, `td=${n} vs th=${thCount}`);
  });

  test(`${page}: Wassertemperatur-Spalte genau dann, wenn sst:true`, () => {
    const thead = html.match(/<thead>([\s\S]*?)<\/thead>/)[1];
    assert.strictEqual(thead.includes('Wassertemp'), SPOTS.regions[key].sst);
  });
}

// ── vergleich.html trägt weiterhin Inline-Logik ─────────────────────────────

test('vergleich.html: Inline-Script ist syntaktisch gültig', () => {
  const js = [...read('vergleich.html').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).join('\n;\n');
  assert.ok(js.trim().length > 0, 'kein Inline-Script gefunden');
  assert.doesNotThrow(() => new Function(js));
});

// ── Modul-Invarianten ───────────────────────────────────────────────────────

test('wf-region.js: rankLabel/rankClass sind für jede Spot-Zahl definiert', () => {
  // Vorher lagen das als handgepflegte Arrays je Seite, auf die jeweilige
  // Spot-Anzahl gepolstert — bei einem neuen Spot wurde undefined gerendert.
  const max = Math.max(...Object.values(SPOTS.regions).map(r => r.spots.length));
  for (let i = 0; i < max + 5; i++) {
    assert.match(R.rankClass(i), /^rank-[1-4]$/, `rankClass(${i})`);
    assert.ok(R.rankLabel(i) && !/undefined/.test(R.rankLabel(i)), `rankLabel(${i})`);
  }
});

test('wf-region.js: dayStats liefert die vollständige Form', () => {
  const ds = R.dayStats(synthForecast(0), 0, { offshoreDir: null }, WF.guestWindow());
  for (const k of ['avgWind', 'maxGust', 'avgDir', 'score', 'avgWindKn']) {
    assert.strictEqual(typeof ds[k], 'number', `${k} fehlt oder ist keine Zahl`);
  }
  assert.strictEqual(ds.spark.length, 10);
  assert.strictEqual(ds.sparkCodes.length, 10);
});

test('wf-region.js: coord() schreibt die Himmelsrichtung, nicht das Vorzeichen', () => {
  assert.strictEqual(R.coord(36.0, -5.598, 3), '36.000°N 5.598°W');  // Tarifa
  assert.strictEqual(R.coord(41.1, 9.07, 3), '41.100°N 9.070°E');    // Porto Pollo
});

test('wf-region.js: buildCard rendert Score, drei Tage und den Tag-Umschalter', () => {
  const spot = { id: 'x', name: 'Test', emoji: '🌊', desc: 'd', lat: 40, lon: 9, offshoreDir: null, color: '#fff' };
  const html = R.buildCard(spot, { x: synthForecast(1) }, 'x', { win: WF.guestWindow(), sstData: null });
  assert.strictEqual((html.match(/class="day-tab /g) || []).length, 3);
  assert.strictEqual((html.match(/class="day-detail"/g) || []).length, 3);
  assert.strictEqual((html.match(/WFRegion\.switchDay\('x', \d\)/g) || []).length, 3);
  assert.match(html, /class="score-big"/);
  assert.ok(!html.includes('undefined'), 'undefined im Markup');
  assert.ok(!html.includes('Wassertemp'), 'SST ohne sstData gerendert');
});

test('wf-region.js: buildCard rendert die Wassertemperatur nur mit sstData', () => {
  const spot = { id: 'x', name: 'Test', emoji: '🌊', desc: 'd', lat: 57, lon: 16, offshoreDir: null, color: '#fff' };
  const ctx = { win: WF.guestWindow(), sstData: { x: 12.4 } };
  const html = R.buildCard(spot, { x: synthForecast(2) }, 'x', ctx);
  assert.match(html, /🌊 Wassertemp/);
  assert.match(html, /12\.4°C/);
  assert.ok(!html.includes('undefined'));
});

function synthForecast(seed) {
  const h = { time: [], windspeed_10m: [], windgusts_10m: [], winddirection_10m: [], temperature_2m: [], weathercode: [] };
  for (let i = 0; i < 72; i++) {
    h.time.push(new Date(Date.UTC(2026, 10, 9, i)).toISOString().slice(0, 16));
    h.windspeed_10m.push(4 + 5 * Math.abs(Math.sin((i + seed) / 5)));
    h.windgusts_10m.push(9 + (i % 7));
    h.winddirection_10m.push((i * 13 + seed * 37) % 360);
    h.temperature_2m.push(12 + (i % 11));
    h.weathercode.push([0, 1, 3, 61, 95, 71][(i + seed) % 6]);
  }
  return { hourly: h };
}
