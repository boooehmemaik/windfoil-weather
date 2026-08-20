/**
 * ensemble.test.mjs
 * Stufe 1 — Ensemble-Kombinierer (siehe Plan "Wetter-KI & Machine Learning").
 *
 * Ansatz wie wing-scoring.test.mjs: index.html lesen, den Block zwischen
 * // <<ensemble>> und // <</ensemble>> extrahieren, in einer vm-Sandbox
 * ausführen. pickForecastModel liegt außerhalb des Blocks und wird gestubbt.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

// ── Setup: Block aus index.html extrahieren ───────────────────────────────────
const html = fs.readFileSync('/var/www/windfoil/index.html', 'utf8');
const startMarker = '// <<ensemble>>';
const endMarker   = '// <</ensemble>>';
const startIdx = html.indexOf(startMarker);
const endIdx   = html.indexOf(endMarker);
assert(startIdx !== -1, 'Sentinel <<ensemble>> nicht gefunden in index.html');
assert(endIdx   !== -1, 'Sentinel <</ensemble>> nicht gefunden in index.html');
assert(startIdx < endIdx, 'Sentinels in falscher Reihenfolge');

const block = html.slice(startIdx + startMarker.length, endIdx);

// pickForecastModel spiegelt die echte Implementierung (index.html:271) —
// AROME nur im italienischen Fenster.
const ctx = vm.createContext({
  console,
  pickForecastModel: (lat, lon) =>
    (lat >= 36 && lat <= 47.2 && lon >= 6.5 && lon <= 16) ? 'meteofrance_arome_france_hd' : '',
});
// `function`-Deklarationen landen auf dem Context-Objekt, `const` NICHT (die
// leben im lexikalischen Scope des Skripts). Deshalb am Ende des Blocks ein
// Objektliteral auswerten — das sieht beides.
const api = vm.runInContext(`${block}
;({ ensembleMembers, admitMembers, quantile, median, combineEnsemble,
    rescaleGusts, ensembleGridMatches, ENS_CORE, ENS_MIN_MEMBERS, ENS_LONG_RANGE })`, ctx);

const {
  ensembleMembers, admitMembers, quantile, median,
  combineEnsemble, rescaleGusts, ensembleGridMatches,
  ENS_CORE, ENS_MIN_MEMBERS,
} = api;

// ── Helfer ────────────────────────────────────────────────────────────────────
const TIME = n => Array.from({ length: n }, (_, i) => `2026-08-20T${String(i).padStart(2, '0')}:00`);

/** Baut ein hourly-Objekt aus {model: [werte]}. */
function hourlyOf(n, byModel) {
  const h = { time: TIME(n) };
  for (const [m, arr] of Object.entries(byModel)) h[`windspeed_10m_${m}`] = arr;
  return h;
}
const fill = (n, v) => new Array(n).fill(v);

// ── ensembleMembers ───────────────────────────────────────────────────────────

test('ensembleMembers: Torbole bekommt AROME zusätzlich zum Kern', () => {
  const m = ensembleMembers(45.869, 10.873);
  assert.equal(m.length, 6);
  assert.equal(m[0], 'meteofrance_arome_france_hd');
  for (const c of ENS_CORE) assert(m.includes(c), `${c} fehlt`);
});

test('ensembleMembers: Lefkada bekommt nur den Kern (AROME deckt dort nicht ab)', () => {
  const m = ensembleMembers(38.6297, 20.6103);
  assert.deepEqual(m, ENS_CORE);
});

test('ensembleMembers: best_match ist nie Member (würde icon_eu doppelt zählen)', () => {
  for (const [lat, lon] of [[45.869, 10.873], [38.6297, 20.6103]]) {
    const m = ensembleMembers(lat, lon);
    assert(!m.includes('best_match'), 'best_match darf nicht Member sein');
    assert(!m.includes(''), 'Leerstring darf nicht Member sein');
  }
});

test('ensembleMembers liefert eine Kopie — Aufrufer kann ENS_CORE nicht mutieren', () => {
  const m = ensembleMembers(38.6297, 20.6103);
  m.push('mutiert');
  assert(!ENS_CORE.includes('mutiert'), 'ENS_CORE wurde durch den Aufrufer verändert');
});

// ── quantile / median ─────────────────────────────────────────────────────────

test('median: ungerade Anzahl → mittleres Element', () => {
  assert.equal(median([5, 1, 3]), 3);
});

test('median: gerade Anzahl → Mittel der beiden mittleren', () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test('median mutiert die Eingabe nicht', () => {
  const a = [3, 1, 2];
  median(a);
  assert.deepEqual(a, [3, 1, 2]);
});

test('median sortiert numerisch, nicht lexikografisch', () => {
  // Der klassische .sort()-Fehler ergäbe hier 100 statt 9.
  assert.equal(median([9, 100, 8]), 9);
});

test('quantile interpoliert zwischen Rängen', () => {
  const v = [1, 2, 3, 4, 5];
  assert.equal(quantile(v, 0), 1);
  assert.equal(quantile(v, 1), 5);
  assert.equal(quantile(v, 0.5), 3);
  // pos = 4*0.1 = 0.4 → 1 + (2-1)*0.4
  assert(Math.abs(quantile(v, 0.10) - 1.4) < 1e-9);
});

test('quantile: leeres Array → null', () => {
  assert.equal(quantile([], 0.5), null);
  assert.equal(median([]), null);
});

// ── admitMembers ──────────────────────────────────────────────────────────────

test('admitMembers: alle 5 Member vollständig → alle zugelassen', () => {
  const n = 24;
  const h = hourlyOf(n, Object.fromEntries(ENS_CORE.map(m => [m, fill(n, 5)])));
  assert.equal(admitMembers(h, ENS_CORE, n).length, 5);
});

test('admitMembers: fehlender Key (AROME an Lefkada) wird still übersprungen', () => {
  const n = 24;
  const h = hourlyOf(n, Object.fromEntries(ENS_CORE.map(m => [m, fill(n, 5)])));
  const members = ['meteofrance_arome_france_hd', ...ENS_CORE];
  const adm = admitMembers(h, members, n);
  assert.equal(adm.length, 5);
  assert(!adm.some(a => a.model.includes('arome')), 'AROME darf nicht zugelassen sein');
});

test('admitMembers: Kurzfristmodell bleibt drin — Abdeckung entscheidet nicht global', () => {
  // Der reale Fall: AROME rechnet ~48 h von 168, ICON-EU ~120 h. Eine globale
  // Schwelle würde beide rauswerfen. Sie müssen für ihre Stunden zählen.
  const n = 168;
  const upTo = k => Array.from({ length: n }, (_, i) => (i < k ? 5 : null));
  const h = hourlyOf(n, {
    meteofrance_arome_france_hd: upTo(48),  // 29 %
    icon_eu: upTo(120),                     // 71 %
    ecmwf_ifs025: fill(n, 4), icon_global: fill(n, 5),
    gfs_seamless: fill(n, 6), ecmwf_aifs025_single: fill(n, 5),
  });
  const adm = admitMembers(h, ['meteofrance_arome_france_hd', ...ENS_CORE], n);
  const got = adm.map(a => a.model);
  assert.equal(got.length, 6, 'alle sechs Member müssen zugelassen sein');
  assert(got.includes('meteofrance_arome_france_hd'), 'AROME (29 %) wurde rausgeworfen');
  assert(got.includes('icon_eu'), 'ICON-EU (71 %) wurde rausgeworfen');
  const arome = adm.find(a => a.model === 'meteofrance_arome_france_hd');
  assert(Math.abs(arome.coverage - 48 / 168) < 1e-9, 'coverage falsch berechnet');
});

test('admitMembers: komplett aus NULL bestehender Member fliegt raus', () => {
  const n = 24;
  const h = hourlyOf(n, {
    ecmwf_ifs025: fill(n, 4), icon_eu: fill(n, null), icon_global: fill(n, 5),
    gfs_seamless: fill(n, 6), ecmwf_aifs025_single: fill(n, 5),
  });
  assert.equal(admitMembers(h, ENS_CORE, n).length, 4);
});

test('combineEnsemble: Kurzfristmodell trägt nur seine Stunden, danach übernimmt der Rest', () => {
  const n = 168;
  const upTo = (k, v) => Array.from({ length: n }, (_, i) => (i < k ? v : null));
  const h = hourlyOf(n, {
    meteofrance_arome_france_hd: upTo(48, 20),  // deutlich abweichend, damit sichtbar
    ecmwf_ifs025: fill(n, 4), icon_eu: upTo(120, 4),
    icon_global: fill(n, 4), gfs_seamless: fill(n, 4), ecmwf_aifs025_single: fill(n, 4),
  });
  const e = combineEnsemble(h, ['meteofrance_arome_france_hd', ...ENS_CORE]);
  assert.equal(e.nMembers[0], 6, 'Stunde 0: alle sechs');
  assert.equal(e.nMembers[60], 5, 'Stunde 60: AROME ist raus');
  assert.equal(e.nMembers[160], 4, 'Stunde 160: auch ICON-EU ist raus');
  assert(e.wind[160] != null, 'ferne Stunden müssen trotzdem einen Wert haben');
  // Spread ins Host-Realm: deepStrictEqual prüft auch die Prototype-Identität,
  // und Arrays aus der vm-Sandbox haben ein anderes Array.prototype.
  assert.deepEqual([...e.membersLong].sort(), [
    'ecmwf_aifs025_single', 'ecmwf_ifs025', 'gfs_seamless', 'icon_global',
  ], 'membersLong darf nur die durchgehenden Modelle enthalten');
  assert(e.spread[0] > e.spread[160], 'AROME-Ausreißer muss die frühe Streuung erhöhen');
});

test('admitMembers: zu kurzes Array fliegt raus (Teil-Response)', () => {
  const n = 24;
  const h = hourlyOf(n, {
    ecmwf_ifs025: fill(n, 4), icon_eu: fill(12, 5), icon_global: fill(n, 5),
    gfs_seamless: fill(n, 6), ecmwf_aifs025_single: fill(n, 5),
  });
  const got = admitMembers(h, ENS_CORE, n).map(a => a.model);
  assert(!got.includes('icon_eu'));
});

test('admitMembers: NaN zählt nicht als Abdeckung', () => {
  const n = 10;
  const h = hourlyOf(n, { icon_eu: fill(n, NaN) });
  assert.equal(admitMembers(h, ['icon_eu'], n).length, 0);
});

// ── combineEnsemble ───────────────────────────────────────────────────────────

test('combineEnsemble: Median der 5 Member, nicht das Mittel', () => {
  const n = 1;
  // Die echten Lefkada-Zahlen aus dem Plan.
  const h = hourlyOf(n, {
    ecmwf_ifs025: [2.99], icon_global: [3.06], icon_eu: [3.56],
    ecmwf_aifs025_single: [4.18], gfs_seamless: [5.41],
  });
  const ens = combineEnsemble(h, ENS_CORE);
  assert.equal(ens.wind[0], 3.56, 'Median muss icon_eu (mittlerer Rang) sein');
  // Das Mittel läge bei 3.84 — der GFS-Ausreißer zöge es hoch.
  assert.notEqual(ens.wind[0], 3.84);
  assert.equal(ens.members.length, 5);
});

test('combineEnsemble: p10 < median < p90 und spread = p90 - p10', () => {
  const n = 1;
  const h = hourlyOf(n, {
    ecmwf_ifs025: [2.99], icon_global: [3.06], icon_eu: [3.56],
    ecmwf_aifs025_single: [4.18], gfs_seamless: [5.41],
  });
  const e = combineEnsemble(h, ENS_CORE);
  assert(e.p10[0] < e.wind[0], 'p10 muss unter dem Median liegen');
  assert(e.p90[0] > e.wind[0], 'p90 muss über dem Median liegen');
  assert(Math.abs(e.spread[0] - (e.p90[0] - e.p10[0])) < 0.02);
  assert(e.p10[0] > 2.99, 'p10 darf bei 5 Membern nicht auf dem Minimum kleben');
  assert(e.p90[0] < 5.41, 'p90 darf bei 5 Membern nicht auf dem Maximum kleben');
});

test('combineEnsemble: nur 2 verwertbare Member → null', () => {
  const n = 24;
  const h = hourlyOf(n, { ecmwf_ifs025: fill(n, 4), icon_eu: fill(n, 5) });
  assert.equal(combineEnsemble(h, ENS_CORE), null);
});

test('combineEnsemble: gerade Anzahl Member (6, mit AROME) mittelt die Mitte', () => {
  const n = 1;
  const h = hourlyOf(n, {
    meteofrance_arome_france_hd: [1], ecmwf_ifs025: [2], icon_eu: [3],
    icon_global: [4], gfs_seamless: [5], ecmwf_aifs025_single: [6],
  });
  const e = combineEnsemble(h, ensembleMembers(45.869, 10.873));
  assert.equal(e.members.length, 6);
  assert.equal(e.wind[0], 3.5);
});

test('combineEnsemble: Stunde mit zu wenigen Membern bleibt null (kein erfundener Wert)', () => {
  // Alle 5 Member kommen durch die Abdeckungsprüfung (90 % bzw. 100 %), aber in
  // Stunde 9 haben nur zwei einen Wert. Der Loch-Fall ist damit von der
  // Member-Ablehnung entkoppelt — genau das soll hier geprüft werden.
  const n = 10;
  const holed = v => Array.from({ length: n }, (_, i) => (i === 9 ? null : v));
  const h = hourlyOf(n, {
    ecmwf_ifs025: fill(n, 4), icon_eu: fill(n, 5),
    icon_global: holed(6), gfs_seamless: holed(7), ecmwf_aifs025_single: holed(8),
  });
  const e = combineEnsemble(h, ENS_CORE);
  assert.equal(e.members.length, 5, 'alle 5 Member erfüllen ≥80 % Abdeckung');
  assert(e.wind[0] != null, 'Stunde 0 muss einen Wert haben');
  assert.equal(e.wind[9], null, 'Stunde 9 muss null bleiben statt aus 2 Membern zu raten');
  assert.equal(e.p90[9], null);
  assert.equal(e.spread[9], null);
});

test('combineEnsemble: leere/fehlende Zeitachse → null', () => {
  assert.equal(combineEnsemble({ time: [] }, ENS_CORE), null);
  assert.equal(combineEnsemble({}, ENS_CORE), null);
  assert.equal(combineEnsemble(null, ENS_CORE), null);
});

test('combineEnsemble: Median liegt immer zwischen min und max der Member', () => {
  // Zufallseingaben — der Median darf die Modellspanne nie verlassen.
  for (let t = 0; t < 2000; t++) {
    const vals = ENS_CORE.map(() => Math.round(Math.random() * 200) / 10);
    const h = hourlyOf(1, Object.fromEntries(ENS_CORE.map((m, i) => [m, [vals[i]]])));
    const e = combineEnsemble(h, ENS_CORE);
    assert(e.wind[0] >= Math.min(...vals) - 1e-9 && e.wind[0] <= Math.max(...vals) + 1e-9,
      `Median ${e.wind[0]} außerhalb [${Math.min(...vals)}, ${Math.max(...vals)}]`);
    assert(e.p10[0] <= e.wind[0] + 1e-9 && e.wind[0] <= e.p90[0] + 1e-9,
      'p10 <= median <= p90 verletzt');
  }
});

// ── rescaleGusts ──────────────────────────────────────────────────────────────

test('rescaleGusts: Ensemble über Träger → Böe wird mitgezogen', () => {
  assert.deepEqual(rescaleGusts([10], [5], [6]), [12]); // Faktor 1.2
});

test('rescaleGusts: Ensemble unter Träger → Böe sinkt mit', () => {
  assert.deepEqual(rescaleGusts([10], [5], [4]), [8]);  // Faktor 0.8
});

test('rescaleGusts: Faktor wird bei 1.35 / 0.75 gedeckelt', () => {
  assert.deepEqual(rescaleGusts([10], [5], [50]), [13.5]);
  assert.deepEqual(rescaleGusts([10], [5], [0.5]), [7.5]);
});

test('rescaleGusts: Trägerwind unter 1 m/s bleibt unangetastet (Division explodiert sonst)', () => {
  assert.deepEqual(rescaleGusts([10], [0.1], [5]), [10]);
  assert.deepEqual(rescaleGusts([10], [0], [5]), [10]);
});

test('rescaleGusts: nulls bleiben null, kein NaN', () => {
  const out = rescaleGusts([null, 10, 10], [5, null, 5], [6, 6, null]);
  assert.deepEqual(out, [null, 10, 10]);
  assert(!out.some(v => Number.isNaN(v)), 'NaN im Ergebnis');
});

test('rescaleGusts: Nicht-Array wird unverändert durchgereicht', () => {
  assert.equal(rescaleGusts(null, [5], [6]), null);
  assert.equal(rescaleGusts(undefined, [5], [6]), undefined);
});

test('rescaleGusts mutiert die Eingabe nicht', () => {
  const g = [10, 20];
  rescaleGusts(g, [5, 5], [6, 6]);
  assert.deepEqual(g, [10, 20]);
});

// ── ensembleGridMatches ───────────────────────────────────────────────────────

test('ensembleGridMatches: gleiche Achse → true', () => {
  assert.equal(ensembleGridMatches({ time: TIME(24) }, { time: TIME(24) }), true);
});

test('ensembleGridMatches: andere Länge → false', () => {
  assert.equal(ensembleGridMatches({ time: TIME(24) }, { time: TIME(12) }), false);
});

test('ensembleGridMatches: andere Startstunde → false (Timezone-Drift)', () => {
  const a = TIME(24), b = TIME(24).map(t => t.replace('2026-08-20', '2026-08-21'));
  assert.equal(ensembleGridMatches({ time: a }, { time: b }), false);
});

test('ensembleGridMatches: fehlende/leere Achse → false', () => {
  assert.equal(ensembleGridMatches({ time: TIME(24) }, {}), false);
  assert.equal(ensembleGridMatches({}, { time: TIME(24) }), false);
  assert.equal(ensembleGridMatches(null, null), false);
  assert.equal(ensembleGridMatches({ time: [] }, { time: [] }), false);
});
