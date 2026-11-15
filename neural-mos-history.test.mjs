/**
 * neural-mos-history.test.mjs  (v1.0.0 · App v3.42.0)
 * Neural-MOS v2.1: Training aus ml_samples ∪ ml_history, Lead-Join auf Stunde,
 * deterministisches Subsampling, chronologisches Eval-Gate, History-MOS.
 * Kein Netz: alle Daten werden synthetisch in eine :memory:-DB geschrieben.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadTrainingRows, subsampleRows, adaptiveEpochs, chronoSplit, monthDistance,
  trainNeuralMos, getNeuralHourlyBias, getNeuralEval, NEURAL_MAX_TRAIN,
  predictSituational, chronoSplit3,
} from './src/neural_mos.mjs';
import { computeHistoryMosRows, dayOfYearDistance } from './src/mos.mjs';

const MIG = join(dirname(fileURLToPath(import.meta.url)), 'db', 'migrations');
const MIGRATIONS = ['007_station_mos_bias', '008_ml_samples', '009_ml_leadtime', '013_ml_history'];

function freshDb() {
  const db = new Database(':memory:');
  for (const m of MIGRATIONS) db.exec(readFileSync(join(MIG, `${m}.sql`), 'utf8'));
  return db;
}

// Deterministischer Pseudo-Zufall, damit Tests nicht flackern.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 2 ** 32);
}

const insHist = db => db.prepare(`INSERT OR REPLACE INTO ml_history
  (station_key, ts, fc_lead_hours, hour_local, month, obs_wind_ms, fc_wind_ms, fc_dir_deg,
   fc_pressure_hpa, fc_temp_c, fc_cape, fc_ens_wind_ms, bias_ms, source)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'meteostat')`);

// Station mit systematischem Bias, der von der RICHTUNG abhängt: Thermik am
// Nachmittag nur bei auflandiger Lage (SW), bei ablandiger (NE) eher Abdeckung.
// Ein reiner Stunden-Bias (linearer MOS) mittelt beides weg — das MLP sieht die
// Richtung als Feature und muss ihn schlagen. mode 'hourly' = nur Stunde zählt.
function seedHistory(db, key, { days = 240, noiseOnly = false, mode = 'dir', start = '2025-03-01' } = {}) {
  const r = rng(42), ins = insHist(db);
  const t0 = Date.parse(`${start}T00:00:00Z`);
  db.transaction(() => {
    for (let d = 0; d < days; d++) {
      const onshore = r() < 0.5;
      const dir = onshore ? 225 : 45;
      for (let h = 0; h < 24; h++) {
        const t = new Date(t0 + (d * 24 + h) * 3600e3);
        const fc = 3 + 3 * r();
        const pm = h >= 12 && h <= 17;
        const sys = noiseOnly ? 0
          : mode === 'hourly' ? (pm ? 2.5 : -0.6)
          : pm ? (onshore ? 3 : -1) : -0.6;
        const obs = Math.max(0, fc + sys + (r() - 0.5) * 1.2);
        ins.run(key, t.toISOString().slice(0, 13) + ':00:00Z', 0, h, t.getUTCMonth() + 1,
                obs, fc, dir, 1012, 22, 100, fc, Math.round((obs - fc) * 100) / 100);
      }
    }
  })();
}

test('Lead-Join paart lead=24 mit der Obs derselben STUNDE (Bugfix exakter ts)', () => {
  const db = freshDb();
  const ins = db.prepare(`INSERT INTO ml_samples (station_key, ts, fc_lead_hours, hour_local, month,
    obs_wind_ms, fc_wind_ms, bias_ms) VALUES (?,?,?,?,?,?,?,?)`);
  // Zwei Polls in derselben Stunde mit Sekunden-Zeitstempel …
  ins.run('LGKL', '2026-10-02T13:03:12.511Z', 0, 16, 10, 6, 4, 2);
  ins.run('LGKL', '2026-10-02T13:13:12.904Z', 0, 16, 10, 8, 4, 4);
  // … und die stundengenaue t+24-Prognose für diese Stunde.
  ins.run('LGKL', '2026-10-02T13:00:00Z', 24, 16, 10, null, 5, null);
  const rows = loadTrainingRows(db, 'LGKL');
  const lead24 = rows.filter(r => r.fc_lead_hours === 24);
  assert.equal(lead24.length, 1, 'genau eine Zeile, keine Duplikate je Poll');
  assert.equal(lead24[0].obs_wind_ms, 7, 'Stundenmittel der Obs');
  assert.equal(lead24[0].bias_ms, 2);
});

test('loadTrainingRows vereint Live und Historie, chronologisch sortiert', () => {
  const db = freshDb();
  seedHistory(db, 'LGKL', { days: 2 });
  db.prepare(`INSERT INTO ml_samples (station_key, ts, fc_lead_hours, hour_local, month,
    obs_wind_ms, fc_wind_ms, bias_ms) VALUES ('LGKL','2026-11-01T10:00:05.000Z',0,12,11,5,4,1)`).run();
  const rows = loadTrainingRows(db, 'LGKL');
  assert.equal(rows.length, 49);
  assert.equal(rows.filter(r => r.src === 'hist').length, 48);
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].ts <= r.ts));
  assert.equal(rows.at(-1).src, 'live');
});

test('subsampleRows: deterministisch, Cap eingehalten, aktuelle Saison bevorzugt', () => {
  const rows = [];
  for (let i = 0; i < 40000; i++) {
    const month = (i % 12) + 1;
    rows.push({ ts: `2025-${String(month).padStart(2, '0')}-01T00:00:${i}Z`, fc_lead_hours: 0, month });
  }
  const a = subsampleRows(rows, { nowMonth: 11 });
  const b = subsampleRows(rows, { nowMonth: 11 });
  assert.deepEqual(a.map(r => r.ts), b.map(r => r.ts));
  assert.ok(a.length < NEURAL_MAX_TRAIN * 1.1 && a.length > NEURAL_MAX_TRAIN * 0.9, `n=${a.length}`);
  const nov = a.filter(r => r.month === 11).length, may = a.filter(r => r.month === 5).length;
  assert.ok(nov > may * 3, `Nov ${nov} vs Mai ${may}`);
  assert.equal(subsampleRows(rows.slice(0, 100), { nowMonth: 1 }).length, 100);
});

test('Helfer: adaptiveEpochs, chronoSplit, monthDistance, dayOfYearDistance', () => {
  assert.equal(adaptiveEpochs(500), 200);
  assert.equal(adaptiveEpochs(12000), 33);
  assert.equal(adaptiveEpochs(1e6), 30);
  const { train, test: te } = chronoSplit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(te, [9, 10]); assert.equal(train.length, 8);
  assert.equal(monthDistance(12, 1), 1);
  assert.equal(monthDistance(3, 9), 6);
  assert.equal(dayOfYearDistance('2025-12-30', '2026-01-02'), 3);
  assert.equal(dayOfYearDistance('2024-06-01', '2026-06-01'), 0);
});

test('Eval-Gate: richtungsabhängige Thermik ⇒ situatives Neural schlägt linear (activeFc)', () => {
  const db = freshDb();
  seedHistory(db, 'ms:16716', { days: 240 });
  const r = trainNeuralMos(db, 'ms:16716', { now: new Date('2025-10-15T12:00:00Z') });
  assert.equal(r.ok, true);
  const ev = getNeuralEval(db, 'ms:16716');
  assert.equal(r.activeFc, true, JSON.stringify(ev));
  assert.ok(ev.skill > 0.3, `skill=${ev.skill}`);
  assert.ok(ev.maeModel < ev.maeLinear, `model ${ev.maeModel} vs linear ${ev.maeLinear}`);
  assert.equal(ev.nHistory, 240 * 24);
  // Die Saison-Tabelle kann Richtung nicht abbilden → sie darf linear nicht schlagen
  assert.equal(r.active, ev.maeTable <= ev.maeLinear && ev.skillTable >= 0.03);
});

test('predictSituational: gleiche Stunde, SW-Lage vs. NE-Lage ⇒ unterschiedliche Korrektur', () => {
  const db = freshDb();
  seedHistory(db, 'ms:16716', { days: 240 });
  trainNeuralMos(db, 'ms:16716', { now: new Date('2025-10-15T12:00:00Z') });
  const time = ['2025-10-16T15:00', '2025-10-17T15:00', '2025-10-17T03:00'];
  const fc72 = { issuedAt: '2025-10-16T12:00:00Z', hourly: {
    time, windspeed_10m: [4, 4, 4], winddirection_10m: [225, 45, 225],
    surface_pressure: [1012, 1012, 1012], temperature_2m: [22, 22, 22], cape: [100, 100, 100] } };
  const out = predictSituational(db, 'ms:16716', fc72, { tz: 'UTC', now: Date.parse('2025-10-16T12:00:00Z') });
  const sw = out['2025-10-16'][15], ne = out['2025-10-17'][15], night = out['2025-10-17'][3];
  assert.ok(sw > 1.5, `SW 15h: ${sw}`);
  assert.ok(ne < 0.3, `NE 15h: ${ne}`);
  assert.ok(night < 0.2, `Nacht: ${night}`);
  assert.equal(predictSituational(db, 'NONE', fc72), null);
});

test('chronoSplit3: 60/20/20 chronologisch', () => {
  const { train, val, test: te } = chronoSplit3([...Array(10).keys()]);
  assert.deepEqual([train.length, val.length, te.length], [6, 2, 2]);
  assert.deepEqual(te, [8, 9]);
});

test('Ohne bewertbaren Holdout bleibt Neural aus (kein ungeprüftes Netz)', () => {
  const db = freshDb();
  seedHistory(db, 'SMALL', { days: 5, noiseOnly: true });   // 120 Samples → Holdout 24 < 30
  const r = trainNeuralMos(db, 'SMALL', { now: new Date('2025-03-05T12:00:00Z') });
  assert.equal(r.active, false);
  assert.equal(r.activeFc, false);
  assert.equal(getNeuralHourlyBias(db, 'SMALL', 0), null);
  assert.equal(getNeuralEval(db, 'SMALL').note, 'holdout_too_small');
});

test('Live-Duplikate: 6 Polls/Stunde zählen einmal; Historie gewinnt bei Überlappung', () => {
  const db = freshDb();
  const ins = db.prepare(`INSERT INTO ml_samples (station_key, ts, fc_lead_hours, hour_local, month,
    obs_wind_ms, fc_wind_ms, bias_ms) VALUES ('LGKL',?,0,12,3,?,4,?)`);
  for (let m = 0; m < 6; m++) ins.run(`2025-03-01T10:0${m}:00.000Z`, 5 + m * 0.2, 1 + m * 0.2);
  ins.run('2025-03-01T11:03:00.000Z', 6, 2);
  insHist(db).run('LGKL', '2025-03-01T11:00:00Z', 0, 13, 3, 7, 4, 200, 1012, 20, 0, 4, 3);
  const rows = loadTrainingRows(db, 'LGKL');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].src, 'live');
  assert.equal(rows[0].ts, '2025-03-01T10:00:00Z');
  assert.equal(Math.round(rows[0].obs_wind_ms * 100) / 100, 5.5);
  assert.equal(rows[1].src, 'hist');
});

test('Eval-Gate: rein stündlicher Bias ⇒ aktiv nur, wenn nicht schlechter als linear', () => {
  const db = freshDb();
  seedHistory(db, 'HOURLY', { days: 240, mode: 'hourly' });
  const r = trainNeuralMos(db, 'HOURLY', { now: new Date('2025-10-15T12:00:00Z') });
  const ev = getNeuralEval(db, 'HOURLY');
  assert.ok(ev.skill > 0.3, 'Rohmodell wird klar geschlagen …');
  assert.equal(r.activeFc, ev.maeModel <= ev.maeLinear, '… situativ nur, wenn nicht schlechter als linear');
  assert.equal(r.active, ev.maeTable <= ev.maeLinear);
  if (!r.active) assert.equal(getNeuralHourlyBias(db, 'HOURLY', 0), null);
});

test('Training ist deterministisch (Seed aus Stationsname)', () => {
  const a = freshDb(), b = freshDb();
  seedHistory(a, 'ms:1', { days: 60 }); seedHistory(b, 'ms:1', { days: 60 });
  const now = new Date('2025-04-15T12:00:00Z');
  assert.deepEqual(trainNeuralMos(a, 'ms:1', { now }).eval.maeModel,
                   trainNeuralMos(b, 'ms:1', { now }).eval.maeModel);
});

test('Eval-Gate: reines Rauschen ⇒ inaktiv, alte Predictions werden gelöscht', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO app_meta(key,value,updated_at) VALUES ('neural_mos_pred:NOISE','[1]','x')`).run();
  seedHistory(db, 'NOISE', { days: 120, noiseOnly: true });
  const r = trainNeuralMos(db, 'NOISE', { now: new Date('2025-05-15T12:00:00Z') });
  assert.equal(r.ok, true);
  assert.equal(r.active, false, `skill=${r.skill}`);
  assert.equal(r.activeFc, false);
  assert.equal(getNeuralHourlyBias(db, 'NOISE', 0), null);
  assert.equal(getNeuralEval(db, 'NOISE').active, false);
});

test('Zu wenig Daten ⇒ kein Training', () => {
  const db = freshDb();
  seedHistory(db, 'TINY', { days: 2 });
  assert.deepEqual(trainNeuralMos(db, 'TINY'), { ok: false, reason: 'too_few_samples' });
});

test('History-MOS: Saisonfenster über mehrere Jahre, n zählt Tage', () => {
  const db = freshDb();
  seedHistory(db, 'LGKL', { days: 60, start: '2024-09-20', mode: 'hourly' });
  seedHistory(db, 'LGKL', { days: 60, start: '2025-09-20', mode: 'hourly' });
  const rows = computeHistoryMosRows(db, { key: 'LGKL', tz: 'Europe/Athens' },
                                     { now: new Date('2026-10-20T12:00:00Z'), windowDays: 10 });
  assert.equal(rows.length, 24);
  const h16 = rows.find(r => r.hour_local === 16);
  assert.ok(h16.n_samples >= 40 && h16.n_samples <= 44, `n=${h16.n_samples}`);
  // 16 h Athen = 13–14 UTC ⇒ Thermik-Stunden im synthetischen Datensatz
  assert.ok(h16.bias_ms > 1.8, `bias=${h16.bias_ms}`);
  assert.equal(computeHistoryMosRows(db, { key: 'NONE', tz: 'Europe/Athens' }), null);
});
