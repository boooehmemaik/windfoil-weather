// ============================================================================
// WindFoil — js/wf-geo.js
// ----------------------------------------------------------------------------
// Die Radiussuche entscheidet, welche Spots der Reiseplaner überhaupt zeigt.
// Ein Vorzeichenfehler im Kurs oder eine Mercator-Näherung in der Entfernung
// fällt im Browser nicht auf — die Liste wäre nur still falsch.
// Referenzwerte: Großkreis, geprüft gegen die Haversine-Formel von Hand.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const G = require('./js/wf-geo.js');

const SPOTS = JSON.parse(readFileSync(new URL('./spots.json', import.meta.url), 'utf8'));
const ALL = [...Object.values(SPOTS.regions).flatMap(r => r.spots), ...SPOTS.unpagedSpots];
const byId = id => ALL.find(s => s.id === id);

const near = (got, exp, tol, msg) =>
  assert.ok(Math.abs(got - exp) <= tol, `${msg}: ${got} ≉ ${exp} (±${tol})`);

test('haversineKm: Referenzstrecken auf dem Großkreis', () => {
  // Nullstrecke und ein Meridiangrad: 1° Breite ≈ 111,195 km.
  assert.strictEqual(G.haversineKm({ lat: 10, lon: 20 }, { lat: 10, lon: 20 }), 0);
  near(G.haversineKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 111.195, 0.01, '1° Breite');

  // Ein Längengrad schrumpft mit dem Cosinus der Breite — der Test, den eine
  // flache Näherung nicht besteht.
  near(G.haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), 111.195, 0.01, '1° Länge am Äquator');
  near(G.haversineKm({ lat: 60, lon: 0 }, { lat: 60, lon: 1 }), 55.60, 0.05, '1° Länge bei 60°N');

  // Viertel des Umfangs.
  near(G.haversineKm({ lat: 0, lon: 0 }, { lat: 90, lon: 0 }), 10007.5, 1, 'Äquator → Nordpol');

  // Echte Spots, nachgerechnet mit einer unabhängigen Haversine-Implementierung.
  near(G.haversineKm(byId('s_porto_pollo'), byId('k_viganj')), 689.4, 0.5, 'Porto Pollo → Viganj');
  // Tarifa → Valdoviño, quer über die iberische Halbinsel.
  near(G.haversineKm(byId('p_tarifa'), byId('n_valdovino')), 868.5, 0.5, 'Tarifa → Valdoviño');
});

test('haversineKm: symmetrisch und über die Datumsgrenze stabil', () => {
  const a = { lat: 41.13, lon: 9.32 }, b = { lat: 56.65, lon: 16.42 };
  assert.strictEqual(G.haversineKm(a, b), G.haversineKm(b, a));
  // −179° und +179° sind 2° auseinander, nicht 358°.
  near(G.haversineKm({ lat: 0, lon: 179 }, { lat: 0, lon: -179 }), 222.39, 0.1, 'Datumsgrenze');
});

test('haversineKm: fehlende Koordinate ergibt null, nicht 0', () => {
  // 0 würde „gleicher Ort" behaupten und den Spot in jedem Radius ganz vorn
  // einsortieren.
  const ok = { lat: 41, lon: 9 };
  for (const bad of [null, undefined, {}, { lat: 41 }, { lon: 9 },
                     { lat: 'x', lon: 9 }, { lat: NaN, lon: 9 }]) {
    assert.strictEqual(G.haversineKm(ok, bad), null, `${JSON.stringify(bad)} als Ziel`);
    assert.strictEqual(G.haversineKm(bad, ok), null, `${JSON.stringify(bad)} als Start`);
  }
});

test('bearingDeg: Himmelsrichtungen stimmen und wrappen korrekt', () => {
  const o = { lat: 0, lon: 0 };
  near(G.bearingDeg(o, { lat: 1, lon: 0 }), 0, 0.01, 'Nord');
  near(G.bearingDeg(o, { lat: 0, lon: 1 }), 90, 0.01, 'Ost');
  near(G.bearingDeg(o, { lat: -1, lon: 0 }), 180, 0.01, 'Süd');
  near(G.bearingDeg(o, { lat: 0, lon: -1 }), 270, 0.01, 'West — nicht −90');

  // Ergebnis immer in [0,360).
  for (const b of [{ lat: -1, lon: -1 }, { lat: -5, lon: -0.1 }, { lat: 1, lon: -1 }]) {
    const r = G.bearingDeg(o, b);
    assert.ok(r >= 0 && r < 360, `${JSON.stringify(b)} → ${r}`);
  }

  // Hin- und Rückkurs sind auf dem Großkreis fast, aber nicht exakt 180°
  // auseinander — die Konvergenz der Meridiane macht den Rest.
  const a = byId('s_porto_pollo'), c = byId('z_messina');
  const apart = Math.abs(((G.bearingDeg(a, c) - G.bearingDeg(c, a) + 540) % 360) - 180);
  assert.ok(Math.abs(apart - 180) < 5, `Gegenkurs liegt ${apart}° auseinander, erwartet ~180°`);

  assert.strictEqual(G.bearingDeg(null, a), null);
});

test('withinRadius: filtert, sortiert und behandelt null als „kein Filter"', () => {
  const center = byId('s_porto_pollo');

  const r300 = G.withinRadius(center, ALL, 300);
  assert.ok(r300.length > 0, 'kein Spot in 300 km — Testdaten unbrauchbar');
  assert.ok(r300.every(x => x.distanceKm <= 300), 'Spot außerhalb des Radius');
  // Aufsteigend sortiert, der Startspot selbst mit 0 km vorne.
  for (let i = 1; i < r300.length; i++) {
    assert.ok(r300[i].distanceKm >= r300[i - 1].distanceKm, 'nicht nach Entfernung sortiert');
  }
  assert.strictEqual(r300[0].spot.id, center.id);
  assert.strictEqual(r300[0].distanceKm, 0);

  // Ein größerer Radius darf nur Spots hinzufügen, nie welche verlieren.
  const ids300 = new Set(r300.map(x => x.spot.id));
  const r1000 = G.withinRadius(center, ALL, 1000);
  assert.ok(r1000.length > r300.length, '1000 km liefert nicht mehr als 300 km');
  for (const id of ids300) assert.ok(r1000.some(x => x.spot.id === id), `${id} bei 1000 km verloren`);

  assert.strictEqual(G.withinRadius(center, ALL, null).length, ALL.length, 'null muss alle liefern');
  assert.deepStrictEqual(G.withinRadius(center, ALL, 0).map(x => x.spot.id), [center.id],
    'Radius 0 lässt nur den Startpunkt übrig');
  assert.deepStrictEqual(G.withinRadius(center, [], 300), []);
  assert.deepStrictEqual(G.withinRadius(center, null, 300), []);
});

test('withinRadius: Spots ohne Koordinate fallen raus, statt vorne zu stehen', () => {
  const center = { lat: 41.13, lon: 9.32 };
  const spots = [{ id: 'kaputt' }, { id: 'gut', lat: 41.2, lon: 9.4 }];
  assert.deepStrictEqual(G.withinRadius(center, spots, 300).map(x => x.spot.id), ['gut']);
});

test('withinRadius: unbrauchbares Zentrum liefert nichts, statt alles', () => {
  // Scheitert die Geolokalisierung, darf die Seite nicht „40 Spots in 0 km"
  // behaupten.
  for (const bad of [null, {}, { lat: NaN, lon: 9 }]) {
    assert.deepStrictEqual(G.withinRadius(bad, ALL, 300), [], `${JSON.stringify(bad)}`);
  }
});

test('jeder Spot aus spots.json ist für die Radiussuche brauchbar', () => {
  for (const s of ALL) {
    assert.ok(Number.isFinite(G.haversineKm({ lat: 50, lon: 10 }, s)), `${s.id}: keine Entfernung`);
  }
});
