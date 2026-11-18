// ============================================================================
// WindFoil — Quiver: Fenster aus mehreren Wings
// ----------------------------------------------------------------------------
// Die Kette, die hier geprüft wird: alle Wings (eigene oder Harlem-Default)
// → Fenster je Größe → Score als Maximum je Stunde → passende Größe zum Wind.
// Das Gewicht kommt immer aus dem Profil; ein 95-kg-Fahrer bekommt bei
// identischem Quiver andere Fenster als ein 60-kg-Fahrer.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert';
import WF from './js/wf-scoring.js';

const HARLEM = WF.WING_BRANDS[WF.DEFAULT_WING_BRAND];
const sizes = q => q.map(x => x.wing);

/** Flacher Tag; 24 Werte, damit bestSession 9–19 Uhr abdeckt. */
const flat = ms => Array.from({ length: 24 }, () => ms);

/** Tag mit Aufbauwind: vormittags leicht, nachmittags kräftig. */
const building = (lo, hi) => Array.from({ length: 24 }, (_, h) => (h < 14 ? lo : hi));

test('defaultQuiver: die Größen kommen aus der Herstellertabelle, nicht aus einem Literal', () => {
  const fromTable = Object.keys(HARLEM.sizes).map(Number).sort((a, b) => a - b);
  assert.deepStrictEqual(WF.defaultQuiver(), fromTable);
  assert.ok(fromTable.length > 1, 'ein Default-Quiver mit einer Größe wäre kein Quiver');
  // Eine unbekannte Marke darf nicht still auf Harlem zurückfallen.
  assert.deepStrictEqual(WF.defaultQuiver('Gibt Es Nicht'), []);
});

test('riderQuiver: ohne eigenes Material gilt der volle Harlem-Satz', () => {
  assert.deepStrictEqual(sizes(WF.riderQuiver(null, null)), WF.defaultQuiver());
  assert.deepStrictEqual(sizes(WF.riderQuiver({ weight: 95 }, [])), WF.defaultQuiver(),
    'eine leere Liste ist kein Fahrer mit genau einem Wing');
  assert.deepStrictEqual(sizes(WF.guestQuiver()), WF.defaultQuiver());
});

test('riderQuiver: das Gewicht aus dem Profil verschiebt jedes Fenster', () => {
  const light = WF.riderQuiver({ weight: 60, skill: 'intermediate' }, null);
  const heavy = WF.riderQuiver({ weight: 95, skill: 'intermediate' }, null);
  assert.deepStrictEqual(sizes(light), sizes(heavy), 'gleicher Quiver, nur anderes Gewicht');
  for (let i = 0; i < light.length; i++) {
    assert.ok(heavy[i].win.minWind > light[i].win.minWind,
      `${light[i].wing} m²: 95 kg muss mehr Wind zum Angleiten brauchen als 60 kg`);
  }
});

test('riderQuiver: eigenes Material schlägt den Default und wird sortiert', () => {
  const q = WF.riderQuiver({ weight: 95, skill: 'intermediate' },
    [{ wing: '6' }, { wing: '4' }, { wing: 'kaputt' }, { wing: '0' }]);
  assert.deepStrictEqual(sizes(q), [4, 6], 'unbrauchbare Einträge müssen rausfallen');
});

test('riderQuiver: die gemessene Angleitschwelle gilt nur für ihre eigene Größe', () => {
  // Sonst bekäme jede Größe dasselbe Fenster — wingWindow gibt bei gesetzter
  // Schwelle das Physikfenster unverändert zurück, und das hängt nicht von der
  // Wing-Größe ab. Der Quiver wäre rechnerisch ein einziges Wing.
  const q = WF.riderQuiver({ weight: 95, skill: 'intermediate', wingSize: 6, planeKn: 12 }, null);
  const six = q.find(x => x.wing === 6);
  assert.strictEqual(six.win.minWind, WF.calcWindow(95, 6, 'intermediate', WF.knToMs(12)).minWind,
    'für die vermessene Größe muss die Messung gelten');
  const distinct = new Set(q.map(x => x.win.minWind));
  assert.strictEqual(distinct.size, q.length, 'alle Größen haben dasselbe Fenster bekommen');
});

test('bestWingForWind: kleiner Wind großes Wing, starker Wind kleines Wing', () => {
  const q = WF.riderQuiver({ weight: 75, skill: 'intermediate' }, null);
  const big = Math.max(...WF.defaultQuiver()), small = Math.min(...WF.defaultQuiver());
  assert.strictEqual(WF.bestWingForWind(q, 6).wing, big, 'bei Leichtwind muss das größte Wing kommen');
  assert.strictEqual(WF.bestWingForWind(q, 17).wing, small, 'bei Starkwind das kleinste');
  assert.strictEqual(WF.bestWingForWind([], 10), null, 'ohne Wings gibt es keine Empfehlung');
});

test('bestWingForWind: bei Gleichstand auf 100 entscheidet die Mittigkeit, nicht die Listenreihenfolge', () => {
  // Der Gleichstand ist nicht der Randfall, sondern der Normalfall: bei 95 kg
  // erreichen über ein breites Band mehrere Größen gleichzeitig 100. Ohne
  // Tiebreak entschiede die Sortierung — und die ist aufsteigend, also käme
  // bei Leichtwind das kleinste Wing, das gerade noch angleitet.
  const q = WF.riderQuiver({ weight: 95, skill: 'intermediate' }, null);
  const tied = ms => q.filter(x => WF.scoreHour(ms, x.win) === 100).map(x => x.wing);

  const LIGHT = 9.5, STRONG = 15.5;
  assert.ok(tied(LIGHT).length > 1, `Fixture nutzlos: bei ${LIGHT} m/s gibt es keinen Gleichstand`);
  assert.ok(tied(STRONG).length > 1, `Fixture nutzlos: bei ${STRONG} m/s gibt es keinen Gleichstand`);

  assert.strictEqual(WF.bestWingForWind(q, LIGHT).wing, Math.max(...tied(LIGHT)),
    'am unteren Rand des Bandes muss das größte gleichwertige Wing kommen');
  assert.strictEqual(WF.bestWingForWind(q, STRONG).wing, Math.min(...tied(STRONG)),
    'am oberen Rand das kleinste');

  // Über das ganze Gleichstandsband darf die Empfehlung nur kleiner werden.
  let prev = Infinity;
  for (let ms = LIGHT; ms <= STRONG; ms += 0.25) {
    const wing = WF.bestWingForWind(q, ms).wing;
    assert.ok(wing <= prev, `bei ${ms} m/s wurde von ${prev} auf ${wing} hochgegriffen`);
    prev = wing;
  }
});

test('scoreHourQuiver: nie schlechter als das beste einzelne Wing — und nie besser', () => {
  const q = WF.riderQuiver({ weight: 95, skill: 'intermediate' }, null);
  for (let ms = 3; ms <= 22; ms += 0.5) {
    const single = Math.max(...q.map(x => WF.scoreHour(ms, x.win)));
    assert.strictEqual(WF.scoreHourQuiver(ms, q), single, `${ms} m/s`);
  }
  assert.strictEqual(WF.scoreHourQuiver(10, []), 0, 'ohne Wings kein Score');
});

test('scoreHourQuiver: ein lückenhafter Quiver behauptet keinen Wind, den keiner trägt', () => {
  // Genau der Grund gegen ein Union-Rechteck: 3 + 9 m² lässt dazwischen eine
  // Lücke, ein Rechteck von kleinster minWind bis größter maxWind würde sie
  // zudecken. Das Maximum über die Einzelfenster kann das nicht.
  const gappy = WF.riderQuiver({ weight: 75, skill: 'intermediate' }, [{ wing: '3' }, { wing: '9' }]);
  assert.deepStrictEqual(sizes(gappy), [3, 9]);
  for (let ms = 3; ms <= 25; ms += 0.5) {
    const single = Math.max(...gappy.map(x => WF.scoreHour(ms, x.win)));
    assert.ok(WF.scoreHourQuiver(ms, gappy) <= single, `${ms} m/s wurde überschätzt`);
  }
});

test('bestSession nimmt einen Quiver an und bewertet den Tag besser als ein Wing', () => {
  const rider = { weight: 75, skill: 'intermediate' };
  const q = WF.riderQuiver(rider, null);
  const oneWing = q.find(x => x.wing === Math.max(...WF.defaultQuiver())).win;

  // Starkwind, den das große Wing nicht mehr trägt, das kleine aber schon.
  const strong = flat(17);
  const withQuiver = WF.bestSession(strong, q).score;
  const withOne = WF.bestSession(strong, oneWing).score;
  assert.ok(withQuiver > withOne,
    `der Quiver muss hier helfen: Quiver ${withQuiver} vs ${Math.max(...WF.defaultQuiver())} m² ${withOne}`);

  // Bei Wind im Optimum des großen Wings darf der Quiver nichts verschlechtern.
  const easy = flat(8);
  assert.ok(WF.bestSession(easy, q).score >= WF.bestSession(easy, oneWing).score);
});

test('hourlyScores nimmt einen Quiver an', () => {
  const q = WF.riderQuiver({ weight: 75, skill: 'intermediate' }, null);
  const rows = WF.hourlyScores(flat(17), q);
  assert.strictEqual(rows.length, 10, '9–18 Uhr');
  assert.ok(rows.every(s => s === WF.scoreHourQuiver(17, q)), 'flacher Tag, gleiche Stundenwerte');
});

test('scorerFor unterscheidet Fenster und Quiver', () => {
  const q = WF.riderQuiver({ weight: 75, skill: 'intermediate' }, null);
  assert.strictEqual(WF.scorerFor(q)(17), WF.scoreHourQuiver(17, q));
  assert.strictEqual(WF.scorerFor(q[0].win)(17), WF.scoreHour(17, q[0].win));
});

test('sessionWings + wingAdvice: ein Aufbautag nennt zwei Größen in Fahrreihenfolge', () => {
  const q = WF.riderQuiver({ weight: 75, skill: 'intermediate' }, null);
  const day = building(7, 17);
  const best = WF.bestSession(day, q);
  const wings = WF.sessionWings(day, q, WF.FIRST_START, WF.LAST_END, 0);
  assert.strictEqual(wings.length, WF.LAST_END - WF.FIRST_START, 'je Stunde eine Größe');

  const seq = [...new Set(wings.map(w => w.wing))];
  assert.ok(seq.length >= 2, `ein Aufbautag muss die Größe wechseln, war ${seq.join('/')}`);
  // Mit zunehmendem Wind darf die Empfehlung nur kleiner werden, nie größer.
  for (let i = 1; i < wings.length; i++) {
    if (day[wings[i].hour] >= day[wings[i - 1].hour]) {
      assert.ok(wings[i].wing <= wings[i - 1].wing,
        `bei mehr Wind wurde ein größeres Wing empfohlen: ${wings[i - 1].wing} → ${wings[i].wing}`);
    }
  }
  assert.match(WF.wingAdvice(wings), /^\d+(\.\d+)? → \d+(\.\d+)? m²$/);
  assert.ok(best.score > 0);
});

test('wingAdvice: eine Größe bleibt eine Größe, keine Session bleibt null', () => {
  const q = WF.riderQuiver({ weight: 75, skill: 'intermediate' }, null);
  const steady = WF.sessionWings(flat(8), q, WF.FIRST_START, WF.LAST_END, 0);
  assert.match(WF.wingAdvice(steady), /^\d+(\.\d+)? m²$/, 'ohne Wechsel kein Pfeil');
  assert.strictEqual(WF.wingAdvice([]), null);
  assert.strictEqual(WF.wingAdvice(null), null);
});

test('loadRider: liefert den Quiver mit und respektiert useGear=false', async () => {
  const prefs = body => async () => ({ ok: true, json: async () => body });

  const own = await WF.loadRider(prefs({
    wf_rider: { weight: 95, wingSize: 5, skill: 'intermediate' },
    wf_gear: [{ wing: '5' }, { wing: '4' }], wf_usegear: true,
  }));
  assert.strictEqual(own.rider.weight, 95);
  assert.deepStrictEqual(sizes(own.quiver), [4, 5], 'eigenes Material muss gelten');
  assert.strictEqual(own.isGuest, false);

  const off = await WF.loadRider(prefs({
    wf_rider: { weight: 95, wingSize: 5, skill: 'intermediate' },
    wf_gear: [{ wing: '5' }, { wing: '4' }], wf_usegear: false,
  }));
  assert.deepStrictEqual(sizes(off.quiver), WF.defaultQuiver(),
    'abgeschaltetes Material muss auf den Harlem-Satz fallen, nicht auf eine Größe');
  // Das Gewicht gilt weiter — nur die Größen kommen aus der Tabelle.
  assert.strictEqual(off.quiver[0].win.minWind,
    WF.riderQuiver({ weight: 95, skill: 'intermediate' }, null)[0].win.minWind);

  const guest = await WF.loadRider(async () => ({ ok: false }));
  assert.strictEqual(guest.isGuest, true);
  assert.deepStrictEqual(sizes(guest.quiver), WF.defaultQuiver());
});

test('describeRider nennt den Quiver, nicht eine einzelne Größe', () => {
  const q = WF.riderQuiver({ weight: 95, skill: 'intermediate' }, null);
  const txt = WF.describeRider({ weight: 95, skill: 'intermediate' }, q);
  assert.match(txt, /95 kg/);
  assert.match(txt, /Quiver 3\/4\/5\/6 m²/);
  assert.match(WF.describeRider(null, q), /Referenzfahrer/);
});

// ── Wing-Wahl nach oberem Mittelfeld der Fahrstunden ────────────────────────
test('ridingWind: 65. Perzentil über 09–18 Uhr, Nacht und Lücken zählen nicht', () => {
  const day = Array.from({ length: 24 }, (_, h) => (h >= 9 && h <= 18 ? h - 8 : 99));
  // 10 Fahrstunden mit 1..10 → Index floor(10*0.65)=6 → 7
  assert.strictEqual(WF.ridingWind(day), 7);
  const gaps = day.slice(); gaps[10] = null; gaps[11] = NaN; gaps[12] = undefined;
  assert.strictEqual(WF.ridingWind(gaps), 8, '7 gültige Werte: floor(7*0.65)=4 → fünftkleinster');
  assert.strictEqual(WF.ridingWind(Array(24).fill(0)), 0, 'echte 0 ist ein Wert');
  assert.strictEqual(WF.ridingWind(Array(24).fill(null)), null);
  assert.strictEqual(WF.ridingWind([]), null);
});

test('ridingWind: baut der Wind nachmittags auf, wählt es das kleinere Wing als der 12–16-Uhr-Mittelwert', () => {
  const q = WF.riderQuiver({ weight: 78, skill: 'intermediate' }, null);
  const day = building(7.5, 12.5);              // bis 13 Uhr 7,5 m/s, ab 14 Uhr 12,5 m/s
  const mean1216 = day.slice(12, 16).reduce((a, b) => a + b, 0) / 4;
  const ride = WF.ridingWind(day);
  assert.ok(ride > mean1216, `${ride} muss über dem Mittagsmittel ${mean1216} liegen`);
  const oldPick = WF.bestWingForWind(q, mean1216).wing;
  const newPick = WF.bestWingForWind(q, ride).wing;
  assert.ok(newPick < oldPick, `neu ${newPick} m² muss kleiner sein als alt ${oldPick} m²`);
});

const KN = kn => kn / 1.94384;

test('bestWingForWind: Ammersee-Fall — Mittel 17,4 kn, Böen 28 kn, 78 kg → 5 m², nicht 6', () => {
  const q = WF.riderQuiver({ weight: 78, skill: 'intermediate' }, null);
  assert.strictEqual(WF.bestWingForWind(q, KN(17.4)).wing, 6, 'ohne Böenangabe bleibt die Mittigkeit maßgeblich');
  assert.strictEqual(WF.bestWingForWind(q, KN(17.4), KN(28)).wing, 5, 'Böen über dem Optimalband der 6 müssen auf die 5 führen');
  assert.strictEqual(WF.bestWingForWind(q, KN(17.4), KN(22)).wing, 6, 'moderate Böen ändern die Wahl nicht');
});

test('bestWingForWind: Böen sind nur Tiebreak — sie heben nie ein schlechter bewertetes Wing', () => {
  const q = WF.riderQuiver({ weight: 78, skill: 'intermediate' }, null);
  for (let kn = 8; kn <= 32; kn += 0.5) {
    const calm = WF.bestWingForWind(q, KN(kn));
    const gusty = WF.bestWingForWind(q, KN(kn), KN(kn * 1.8));
    assert.strictEqual(gusty.score, calm.score, `${kn} kn: Böen haben den Score verändert`);
  }
});

test('hourlyWings: Hysterese hält die Vorstunden-Größe, wenn sie höchstens 3 Punkte schlechter ist', () => {
  const q = WF.riderQuiver({ weight: 78, skill: 'intermediate' }, null);
  const six = q.find(x => x.wing === 6).win;
  assert.strictEqual(WF.bestWingForWind(q, KN(18)).wing, 6, 'Fixture: Stunde 1 muss 6 m² sein');
  assert.strictEqual(WF.bestWingForWind(q, KN(22.7)).wing, 4, 'Fixture: Stunde 2 ohne Hysterese 4 m²');
  assert.ok(WF.scoreHour(KN(22.7), six) >= 100 - WF.SIZE_HYSTERESIS, 'Fixture: 6 m² liegt innerhalb der Hysterese');
  assert.deepStrictEqual(WF.hourlyWings([KN(18), KN(22.7)], q).map(h => h.wing), [6, 6]);
});

test('hourlyWings: stärkere Böen-Überschreitung hebelt die Hysterese aus', () => {
  const q = WF.riderQuiver({ weight: 78, skill: 'intermediate' }, null);
  const seq = WF.hourlyWings([KN(18), KN(22.7)], q, [KN(20), KN(30)]).map(h => h.wing);
  assert.strictEqual(seq[0], 6);
  assert.notStrictEqual(seq[1], 6, 'Böen über dem Optimalband der 6 müssen den Wechsel erzwingen');
});

test('hourlyWings: eine Lücke (null) setzt die Hysterese zurück', () => {
  const q = WF.riderQuiver({ weight: 78, skill: 'intermediate' }, null);
  const seq = WF.hourlyWings([KN(18), null, KN(22.7)], q).map(h => h && h.wing);
  assert.deepStrictEqual(seq, [6, null, 4]);
});

test('hourlyWings: Böen-Tiebreak macht die Folge im Ammersee-Fall konstant 5', () => {
  const q = WF.riderQuiver({ weight: 78, skill: 'intermediate' }, null);
  const winds = [17, 17.4, 17.6, 17.2].map(KN);
  const gusts = [26, 28, 27, 27].map(KN);
  assert.deepStrictEqual(WF.hourlyWings(winds, q, gusts).map(h => h.wing), [5, 5, 5, 5]);
});

test('hourlyWings: Stunden ohne tragenden Wind und fehlende Werte bleiben null', () => {
  const q = WF.riderQuiver({ weight: 78, skill: 'intermediate' }, null);
  const out = WF.hourlyWings([KN(2), KN(17), null, NaN, KN(70)], q);
  assert.strictEqual(out[0], null, 'Flaute');
  assert.ok(out[1] && out[1].score >= 50);
  assert.strictEqual(out[2], null);
  assert.strictEqual(out[3], null);
  assert.strictEqual(out[4], null, 'Sturm');
});

test('sessionWings und dominantWing leiten sich aus hourlyWings ab', () => {
  const q = WF.riderQuiver({ weight: 78, skill: 'intermediate' }, null);
  const day = Array.from({ length: 24 }, (_, h) => KN(h >= 10 && h < 14 ? 17.4 : 2));
  const gust = day.map(w => w * 1.6);
  const wings = WF.sessionWings(day, q, 9, 15, 0, gust);
  assert.deepStrictEqual(wings.map(w => w.hour), [10, 11, 12, 13]);
  assert.strictEqual(WF.dominantWing(wings), 5);
  assert.strictEqual(WF.dominantWing([]), null);
});

test('sessionWings: startIdx verschiebt in den richtigen Tag', () => {
  const q = WF.riderQuiver({ weight: 78, skill: 'intermediate' }, null);
  const day1 = Array.from({ length: 24 }, () => KN(2));
  const day2 = Array.from({ length: 24 }, (_, h) => KN(h >= 10 && h < 12 ? 17.4 : 2));
  const winds = [...day1, ...day2];
  assert.deepStrictEqual(WF.sessionWings(winds, q, 9, 14, 24).map(w => w.hour), [10, 11]);
  assert.deepStrictEqual(WF.sessionWings(winds, q, 9, 14, 0), []);
});
