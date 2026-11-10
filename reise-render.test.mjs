// ============================================================================
// WindFoil — reise.html rendert
// ----------------------------------------------------------------------------
// Gleiches Verfahren wie logbuch-render.test.mjs: Inline-Script extrahieren,
// DOM/fetch/Leaflet stubben, init() von außen aufrufen.
//
// Die Seite ist eine Rangliste. Eine falsche Zuordnung — Entfernung des einen
// Spots neben dem Score des anderen, Pfeil des Nachbarn auf dem Marker — sieht
// im Browser vollkommen plausibel aus. Deshalb prüfen die Tests paarweise:
// jede Zahl gegen den Spot, zu dem sie gehört.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WF = require('./js/wf-scoring.js');
const WFGeo = require('./js/wf-geo.js');

const HTML = readFileSync(new URL('./reise.html', import.meta.url), 'utf8');
const INLINE = HTML.slice(HTML.lastIndexOf('<script>') + 8, HTML.lastIndexOf('</script>'));
const REAL_SPOTS = JSON.parse(readFileSync(new URL('./spots.json', import.meta.url), 'utf8'));

const DAYS = 7;

/** Stundenreihe aus Tageswerten: 24 identische Stunden je Tag.
 *  Konstante Tage machen die erwarteten Scores von Hand nachrechenbar. */
function fc(dayWinds, dayDirs) {
  const windspeed_10m = [], winddirection_10m = [], time = [];
  for (let d = 0; d < DAYS; d++) {
    for (let h = 0; h < 24; h++) {
      windspeed_10m.push(dayWinds[d]);
      winddirection_10m.push(dayDirs[d]);
      time.push(`2026-11-${String(10 + d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00`);
    }
  }
  return { hourly: { time, windspeed_10m, winddirection_10m }, utcOffsetSeconds: 3600 };
}

// Referenzfahrer 75 kg / 6 m² / intermediate → Fenster 6,6 / 7,9 / 13,1 / 17,1 m/s.
// 10 m/s liegt im Optimum (Score 100), 0 m/s ergibt 0. Keine Zwischenwerte,
// damit kein erwarteter Wert aus der getesteten Funktion selbst stammt.
const GOOD = 10, DEAD = 0;

const SPOTS_DOC = {
  regions: {
    testland: {
      title: 'Testland', page: '/testland.html',
      spots: [
        { id: 'tA', name: 'Alpha',   emoji: '🅰', lat: 41.0, lon: 9.0, offshoreDir: 180, vergleichRegion: 'Testland' },
        { id: 'tB', name: 'Bravo',   emoji: '🅱', lat: 41.5, lon: 9.0, offshoreDir: 180, vergleichRegion: 'Testland' },
        { id: 'tC', name: 'Charlie', emoji: '🇨', lat: 45.0, lon: 9.0, offshoreDir: 180, vergleichRegion: 'Testland' },
      ],
    },
  },
  unpagedSpots: [
    { id: 'tU', name: 'Uniform', emoji: '🇺', lat: 41.1, lon: 9.1, offshoreDir: 180,
      region: 'Weitland', regionUrl: '/weitland.html' },
  ],
};

// Entfernungen von Alpha (41,9): Uniform ≈ 13,9 km · Bravo ≈ 55,6 km · Charlie ≈ 444,8 km
const FORECASTS = {
  tA: fc([DEAD, GOOD, DEAD, GOOD, DEAD, DEAD, DEAD], [270, 270, 270, 270, 270, 270, 270]),
  tB: fc([GOOD, GOOD, GOOD, DEAD, DEAD, DEAD, DEAD], [90, 110, 100, 100, 100, 100, 100]),
  tC: fc([GOOD, GOOD, GOOD, GOOD, GOOD, GOOD, GOOD], [45, 45, 45, 45, 45, 45, 45]),
  tU: fc([GOOD, GOOD, DEAD, DEAD, DEAD, DEAD, DEAD], [300, 340, 340, 340, 340, 340, 340]),
};

function node() {
  return {
    innerHTML: '', textContent: '', className: '', value: '', disabled: false, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, closest: () => null, querySelector: () => null,
    setAttribute() {}, getAttribute: () => null,
  };
}

/** Browserumgebung, soweit reise.html sie anfasst. */
function stub(opts = {}) {
  const { spotsDoc = SPOTS_DOC, forecasts = FORECASTS, batchStatus = 200,
          spotsStatus = 200, geo = null, start = 'tA',
          radius = '300', trip = '2', min = '70' } = opts;

  const nodes = {}, cap = { icons: [], popups: [], circles: [], rings: [], removed: [], views: [], requests: [] };

  globalThis.document = { getElementById: id => (nodes[id] ||= node()), addEventListener() {} };

  const mapObj = {
    removeLayer: l => cap.removed.push(l),
    fitBounds: (pts, o) => cap.views.push({ fit: pts, opts: o }),
    setView: (p, z) => cap.views.push({ center: p, zoom: z }),
  };
  const layer = extra => ({ addTo: () => layer(extra), bindPopup() {}, ...extra });

  globalThis.L = {
    map: () => mapObj,
    tileLayer: () => ({ addTo: () => ({}) }),
    divIcon: o => ({ ...o }),
    marker(latlng, o) {
      const m = {
        latlng, icon: o?.icon,
        addTo: () => m,
        bindPopup(html) { cap.popups.push({ latlng, html }); return m; },
        setIcon(i) { m.icon = i; },
      };
      cap.icons.push({ latlng, html: o?.icon?.html || '' });
      return m;
    },
    circle(latlng, o) { cap.rings.push({ latlng, radius: o.radius }); return layer({ latlng }); },
    circleMarker(latlng, o) {
      const c = { latlng, addTo: () => c, bindPopup(html) { cap.circles.push({ latlng, html }); return c; } };
      return c;
    },
  };

  // navigator ist in Node ein Getter — einfache Zuweisung wirft.
  Object.defineProperty(globalThis, 'navigator', {
    value: geo ? { geolocation: geo } : {}, configurable: true, writable: true,
  });

  globalThis.fetch = async (url) => {
    const u = String(url);
    cap.requests.push(u);
    if (u.includes('/api/prefs')) return { ok: false, status: 401, json: async () => ({}) };
    if (u.includes('/spots.json')) {
      return spotsStatus === 200
        ? { ok: true, status: 200, json: async () => spotsDoc }
        : { ok: false, status: spotsStatus, json: async () => ({}) };
    }
    if (u.includes('/api/forecast/batch')) {
      return batchStatus === 200
        ? { ok: true, status: 200, json: async () => ({ region: 'all', days: 7, spots: forecasts }) }
        : { ok: false, status: batchStatus, json: async () => ({ error: 'upstream_unavailable' }) };
    }
    throw new Error('unerwarteter Request: ' + u);
  };

  // Ohne vorbelegte Felder stünde readOptions() auf '' — im Browser wählt das
  // selected-Attribut diese Werte, der Stub muss es nachbilden.
  nodes['f-radius'] = { ...node(), value: radius };
  nodes['f-trip'] = { ...node(), value: trip };
  nodes['f-min'] = { ...node(), value: min };
  nodes['f-start'] = { ...node(), value: start };

  return { nodes, cap };
}

/** Das Inline-Script registriert beim Laden seine Event-Listener — ohne
 *  gestubbtes document scheitert schon der Import, nicht erst init(). */
function load() {
  const src = INLINE.replace(/\binit\(\);\s*$/, '');
  return new Function(`${src}\nreturn { init, state, search, rankSpots, spotDays, flattenSpots,
    windArrowSvg, labelDate, readOptions, useGeolocation, setCenterFromSelect, renderMap, renderResults };`)();
}

const rotations = html => [...html.matchAll(/transform:rotate\(([-\d.e]+)deg\)/g)].map(m => Number(m[1]));
const near = (got, exp, tol, msg) => assert.ok(Math.abs(got - exp) <= tol, `${msg}: ${got} ≉ ${exp} (±${tol})`);

// ── Reines Ranking ──────────────────────────────────────────

test('rankSpots(): Radius filtert, Blockmittel sortiert, Entfernung bricht Gleichstand', () => {
  stub();
  const api = load();
  const spots = api.flattenSpots(SPOTS_DOC);
  const win = WF.guestWindow();
  const base = { center: { lat: 41.0, lon: 9.0 }, spots, forecasts: FORECASTS, win, tripLen: 2 };

  // Bravo und Uniform haben beide zwei Volltage (Ø 100); Uniform liegt näher.
  // Alpha kommt nur auf Ø 50, Charlie liegt außerhalb von 300 km.
  const r = api.rankSpots({ ...base, radiusKm: 300, minScore: 70 });
  assert.deepStrictEqual(r.map(x => x.spot.id), ['tU', 'tB'], 'Reihenfolge Ø-Score, dann Entfernung');
  assert.strictEqual(r[0].block.mean, 100);
  assert.strictEqual(r[0].block.min, 100);
  near(r[0].distanceKm, 13.9, 0.3, 'Uniform');
  near(r[1].distanceKm, 55.6, 0.3, 'Bravo');

  // Ohne Mindest-Score rutscht Alpha hinten rein, statt zu verschwinden.
  const all = api.rankSpots({ ...base, radiusKm: 300, minScore: null });
  assert.deepStrictEqual(all.map(x => x.spot.id), ['tU', 'tB', 'tA']);
  assert.strictEqual(all[2].block.mean, 50, 'Alpha: ein Volltag, ein Nulltag');

  // Radius null hebt den Filter auf — Charlie kommt dazu, als weitester der 100er.
  const open = api.rankSpots({ ...base, radiusKm: null, minScore: 70 });
  assert.deepStrictEqual(open.map(x => x.spot.id), ['tU', 'tB', 'tC']);
  near(open[2].distanceKm, 444.8, 1, 'Charlie');

  // 100 km lässt Charlie draußen, auch wenn er der beste Spot überhaupt wäre.
  assert.deepStrictEqual(api.rankSpots({ ...base, radiusKm: 100, minScore: 70 }).map(x => x.spot.id),
    ['tU', 'tB'], 'Radius schlägt Score');
});

test('rankSpots(): die Reisedauer verschiebt das Fenster, nicht nur seine Länge', () => {
  stub();
  const api = load();
  const spots = api.flattenSpots(SPOTS_DOC);
  const base = { center: { lat: 41.0, lon: 9.0 }, spots, forecasts: FORECASTS,
                 win: WF.guestWindow(), radiusKm: 300, minScore: null };

  const byId = (len, id) => api.rankSpots({ ...base, tripLen: len }).find(x => x.spot.id === id);

  // Bravo: 100/100/100/0/0/0/0
  assert.strictEqual(byId(3, 'tB').block.mean, 100, '3 Tage passen noch');
  assert.strictEqual(byId(3, 'tB').days.length, 3);
  assert.strictEqual(byId(4, 'tB').block.mean, 75, '4. Tag verwässert den Block');
  assert.strictEqual(byId(4, 'tB').block.min, 0, 'der schwächste Tag wird ausgewiesen');

  // Alpha: 0/100/0/100/0/0/0 — bei einem Tag gewinnt ein einzelner Volltag.
  const a1 = byId(1, 'tA');
  assert.strictEqual(a1.block.mean, 100);
  assert.deepStrictEqual(a1.days.map(d => d.date), ['2026-11-11'], 'Tag 2, nicht Tag 1');

  // Uniform hat nur zwei gute Tage — bei 3 Tagen verliert er gegen Bravo.
  assert.deepStrictEqual(api.rankSpots({ ...base, tripLen: 3, minScore: 70 }).map(x => x.spot.id),
    ['tB', 'tC'].slice(0, 1), 'bei 3 Tagen bleibt im Radius nur Bravo über 70');
});

test('spotDays(): Datum, Ø-Wind und Richtung gehören zum Score desselben Tages', () => {
  stub();
  const api = load();
  const spot = SPOTS_DOC.regions.testland.spots[1];   // Bravo
  const days = api.spotDays(FORECASTS.tB, spot, WF.guestWindow());

  assert.strictEqual(days.length, DAYS, 'ein Eintrag je Vorhersagetag');
  assert.deepStrictEqual(days.map(d => d.score), [100, 100, 100, 0, 0, 0, 0]);
  assert.deepStrictEqual(days.map(d => d.date),
    ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16']);
  near(days[0].windKn, WF.msToKn(GOOD), 0.01, 'Tag 1 in Knoten');
  near(days[0].dir, 90, 0.01, 'Tag 1 aus Ost');
  near(days[1].dir, 110, 0.01, 'Tag 2 aus OSO');
  assert.strictEqual(days[0].session.startHour, 9, 'Session beginnt im Fenster');
  assert.strictEqual(days[0].session.endHour, 13);

  assert.strictEqual(api.spotDays(null, spot, WF.guestWindow()), null, 'kein Forecast → null');
  assert.strictEqual(api.spotDays({ hourly: {} }, spot, WF.guestWindow()), null, 'leeres hourly → null');
});

test('flattenSpots(): Regionsseite und Label kommen aus spots.json, nicht aus einer Kopie', () => {
  stub();
  const api = load();
  const flat = api.flattenSpots(SPOTS_DOC);
  assert.deepStrictEqual(flat.map(s => s.id), ['tA', 'tB', 'tC', 'tU']);
  const a = flat[0], u = flat[3];
  assert.strictEqual(a.region, 'Testland');
  assert.strictEqual(a.regionUrl, '/testland.html', 'gepagte Region → page aus der Region');
  assert.strictEqual(a.group, 'Testland');
  assert.strictEqual(u.region, 'Weitland');
  assert.strictEqual(u.regionUrl, '/weitland.html', 'unpaged → regionUrl des Spots');
  assert.strictEqual(u.group, 'Weitere Spots');

  // Die echte Datei muss durchlaufen: jeder Spot braucht Koordinate und Ziel.
  for (const s of api.flattenSpots(REAL_SPOTS)) {
    assert.ok(Number.isFinite(s.lat) && Number.isFinite(s.lon), `${s.id}: keine Koordinate`);
    assert.ok(s.region && s.regionUrl, `${s.id}: Region oder Link fehlt`);
  }
  assert.strictEqual(api.flattenSpots(REAL_SPOTS).length,
    [...Object.values(REAL_SPOTS.regions).flatMap(r => r.spots), ...REAL_SPOTS.unpagedSpots].length);
});

// ── Seite ───────────────────────────────────────────────────

test('init(): Liste, Karte und Startpunkt entstehen aus einem Batch-Abruf', async () => {
  const { nodes, cap } = stub();
  const api = load();
  await api.init();

  assert.ok(cap.requests.some(u => u.includes('/api/forecast/batch?region=all&days=7')),
    'Reiseplaner braucht 7 Tage aus dem Proxy');
  assert.ok(!cap.requests.some(u => u.includes('open-meteo.com')),
    'kein Direktabruf an Open-Meteo — genau das verhindert der Proxy');

  assert.deepStrictEqual(api.state.results.map(r => r.spot.id), ['tU', 'tB']);
  assert.match(nodes.lead.textContent, /Referenzfahrer 75 kg/, 'Gast bekommt den Referenzfahrer');
  assert.match(nodes['search-note'].textContent, /^2 Spot\(s\) im Radius von 300 km mit 2 passenden Tagen/);
  assert.strictEqual(nodes['search-note'].className, 'note ok');

  const html = nodes.results.innerHTML;
  assert.ok(!html.includes('undefined') && !html.includes('NaN'), 'Lücken statt Platzhaltertext');
  // Rang, Name, Ø-Score und Entfernung müssen in dieser Reihenfolge zusammen
  // in einer Karte stehen — sonst lobt die Seite den falschen Spot.
  assert.match(html, /1\.<\/span><span class="hit-spot">🇺 Uniform<\/span><span class="hit-score"[^>]*>Ø 100</);
  assert.match(html, /2\.<\/span><span class="hit-spot">🅱 Bravo<\/span><span class="hit-score"[^>]*>Ø 100</);
  assert.match(html, /<b>Di, 10\.11\. – Mi, 11\.11\.<\/b>/, '2026-11-10 ist ein Dienstag');
  assert.match(html, /14 km · Kurs NO/, 'Uniform liegt nordöstlich von Alpha');
  assert.match(html, /56 km · Kurs N/, 'Bravo liegt genau nördlich');
  assert.match(html, /href="\/weitland\.html" class="tag">Spot-Seite/);
  assert.match(html, /href="\/testland\.html" class="tag">Spot-Seite/);

  // Karte: ein Ring in Metern, ein Startpunkt, ein Marker je Treffer.
  assert.deepStrictEqual(cap.rings.map(r => r.radius), [300000], 'Leaflet rechnet in Metern');
  assert.deepStrictEqual(cap.circles.map(c => c.latlng), [[41.0, 9.0]]);
  assert.match(cap.circles[0].html, /Startpunkt<\/b><br>🅰 Alpha/);
  assert.deepStrictEqual(cap.icons.map(i => i.latlng), [[41.1, 9.1], [41.5, 9.0]],
    'Marker nur für die Treffer, in Rangfolge');
  assert.ok(cap.views.some(v => v.fit), 'Karte zoomt auf Startpunkt + Treffer');
});

test('init(): jeder Marker trägt den Windrichtungspfeil seines eigenen Spots', async () => {
  const { nodes, cap } = stub();
  const api = load();
  await api.init();

  const rs = api.state.results;
  // Uniform weht aus WNW, Bravo aus Ost — wären die Pfeile vertauscht, stimmte
  // jede Zahl auf der Seite und trotzdem zeigte der Marker in die Gegenrichtung.
  near(rs[0].dir, 320, 0.5, 'Uniform Ø-Richtung');
  near(rs[1].dir, 100, 0.5, 'Bravo Ø-Richtung');

  cap.icons.forEach((icon, i) => {
    const rot = rotations(icon.html);
    assert.strictEqual(rot.length, 1, `${rs[i].spot.name}: genau ein Pfeil im Badge`);
    assert.ok(Math.abs(rot[0] - rs[i].dir) < 1e-6,
      `${rs[i].spot.name}: Pfeil zeigt ${rot[0]}°, Ranking sagt ${rs[i].dir}°`);
    assert.match(icon.html, /<polygon points="10,2 14,16 10,13 6,16"/, 'Pfeilgeometrie fehlt');
    assert.match(icon.html, /class="lm-score"[^>]*>\s*<svg/, 'Pfeil steht nicht vor der Zahl');
    assert.ok(icon.html.includes('>' + rs[i].block.mean + '</div>'), 'Badge zeigt nicht den Blockwert');
  });

  // Popup und Trefferkarte mitteln denselben Zeitraum wie der Marker.
  assert.deepStrictEqual(cap.popups.map(p => rotations(p.html)[0]), rs.map(r => r.dir));
  assert.deepStrictEqual(rotations(nodes.results.innerHTML), rs.map(r => r.dir),
    'Listenpfeil ≠ Markerpfeil');
  assert.match(nodes.results.innerHTML, /aus <b>NW<\/b>/, '320° ist NW');
  assert.match(nodes.results.innerHTML, /aus <b>O<\/b>/);
});

test('windArrowSvg(): identische Konvention wie js/wf-region.js', () => {
  // Drei Implementierungen, eine Bedeutung: die Spitze zeigt dorthin, WOHER der
  // Wind kommt. Läuft eine weg, zeigen Reiseplaner und Regionsseite für
  // denselben Wind in verschiedene Richtungen — ohne dass etwas kaputt wirkt.
  stub();
  const api = load();
  const region = require('./js/wf-region.js');
  for (const deg of [0, 45, 90, 180, 270, 359.4]) {
    assert.strictEqual(api.windArrowSvg(deg, '#3a9ad9', 13).replace(/\s+/g, ' '),
      region.windArrowSvg(deg, '#3a9ad9', 13).replace(/\s+/g, ' '), `Pfeil bei ${deg}° weicht ab`);
  }
  assert.strictEqual(api.windArrowSvg(null), '', 'ohne Richtung kein Pfeil');
});

test('init(): leeres Ergebnis erklärt sich, statt leer zu bleiben', async () => {
  // Bravo hat drei Volltage; erst eine vierte Nacht drückt ihn unter 85.
  const { nodes, cap } = stub({ min: '85', radius: '100', trip: '4' });
  const api = load();
  await api.init();

  assert.deepStrictEqual(api.state.results, []);
  assert.match(nodes.results.innerHTML, /Kein Spot erfüllt diese Kombination/);
  assert.match(nodes.results.innerHTML, /Mehr Radius, kürzere Reise/);
  assert.strictEqual(nodes['search-note'].className, 'note warn');
  // Ring und Startpunkt bleiben — die Karte darf nicht verschwinden.
  assert.deepStrictEqual(cap.rings.map(r => r.radius), [100000]);
  assert.strictEqual(cap.icons.length, 0, 'keine Treffer, keine Marker');
  assert.ok(cap.views.some(v => v.center), 'ohne Treffer zentriert die Karte den Startpunkt');
});

test('init(): fällt der Proxy aus, sagt die Seite das — ohne Direktabruf', async () => {
  const { nodes, cap } = stub({ batchStatus: 502 });
  const api = load();
  await api.init();

  assert.match(nodes['search-note'].textContent, /Forecast nicht verfügbar: HTTP 502/);
  assert.match(nodes['search-note'].textContent, /erneut versuchen/);
  assert.strictEqual(nodes['search-note'].className, 'note err');
  assert.strictEqual(api.state.fc, null, 'kein halb gefüllter Zustand');
  assert.deepStrictEqual(api.state.results, []);
  assert.ok(!cap.requests.some(u => u.includes('open-meteo.com')),
    '40 Direktabrufe sind kein Fallback');
  // Die Startpunktwahl steht trotzdem — nachladen muss möglich bleiben.
  assert.ok(api.state.spots.length > 0);
  assert.deepStrictEqual(api.state.center, { lat: 41.0, lon: 9.0 });
});

test('init(): ohne Spotliste bleibt die Seite stumm, statt 0 Treffer zu behaupten', async () => {
  const { nodes, cap } = stub({ spotsStatus: 500 });
  const api = load();
  await api.init();

  assert.match(nodes['search-note'].textContent, /Spotliste nicht ladbar: HTTP 500/);
  assert.strictEqual(nodes.results?.innerHTML ?? '', '', 'kein „Kein Spot erfüllt…" ohne Spots');
  assert.ok(!cap.requests.some(u => u.includes('/api/forecast/batch')),
    'ohne Spots ist der Forecast sinnlos');
});

test('useGeolocation(): die eigene Position wird Startpunkt und verlässt den Browser nicht', async () => {
  const geo = {
    getCurrentPosition: (ok) => ok({ coords: { latitude: 41.5, longitude: 9.0 } }),
  };
  const { nodes, cap } = stub({ geo });
  const api = load();
  await api.init();
  cap.icons.length = 0; cap.circles.length = 0; cap.rings.length = 0;

  api.useGeolocation();

  assert.deepStrictEqual(api.state.center, { lat: 41.5, lon: 9.0 });
  assert.match(cap.circles[0].html, /Startpunkt<\/b><br>Mein Standort/);
  // Bravo liegt jetzt auf 0 km und gewinnt den Gleichstand gegen Uniform.
  assert.deepStrictEqual(api.state.results.map(r => r.spot.id), ['tB', 'tU']);
  assert.strictEqual(api.state.results[0].distanceKm, 0);
  // Entscheidend: keine Koordinate in einem Request.
  for (const u of cap.requests) {
    assert.ok(!/41\.5|latitude|lat=/.test(u), `Koordinate im Request: ${u}`);
  }
});

test('useGeolocation(): abgelehnter Standort behält den gewählten Startspot', async () => {
  const geo = {
    getCurrentPosition: (ok, err) => err({ message: 'User denied Geolocation' }),
  };
  const { nodes } = stub({ geo });
  const api = load();
  await api.init();
  const before = api.state.results.map(r => r.spot.id);

  api.useGeolocation();

  assert.match(nodes['search-note'].textContent, /Standort nicht verfügbar: User denied Geolocation/);
  assert.strictEqual(nodes['search-note'].className, 'note warn');
  assert.deepStrictEqual(api.state.center, { lat: 41.0, lon: 9.0 }, 'Startspot bleibt');
  assert.deepStrictEqual(api.state.results.map(r => r.spot.id), before);
});
