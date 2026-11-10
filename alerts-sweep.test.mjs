// ============================================================================
// WindFoil — Windalarm: Durchlauf
// ----------------------------------------------------------------------------
// Der teure Fehler bei Benachrichtigungen ist nicht der ausgebliebene Push,
// sondern der als "verschickt" protokollierte, der nie ankam: der Alarm für
// diesen Tag ist dann verbraucht. Genau das prüfen diese Tests.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert';
import WF from './js/wf-scoring.js';
import {
  runAlertSweep, startAlertScheduler, inQuietHours, QUIET_BEFORE_HOUR, QUIET_FROM_HOUR,
} from './src/alerts.scheduler.mjs';

const DAY0 = '2026-11-10';
const NOW = new Date(`${DAY0}T05:00:00Z`);
const pad = n => String(n).padStart(2, '0');

/** Konstanter Wind über fünf Tage; 10 m/s = Score 100 für den Referenzfahrer. */
function forecast(ms = 10) {
  const h = { time: [], windspeed_10m: [], winddirection_10m: [] };
  for (let d = 0; d < 5; d++) {
    const date = new Date(Date.UTC(2026, 10, 10 + d)).toISOString().slice(0, 10);
    for (let hr = 0; hr < 24; hr++) {
      h.time.push(`${date}T${pad(hr)}:00`);
      h.windspeed_10m.push(ms); h.winddirection_10m.push(180);
    }
  }
  return { spots: { a: { hourly: h, utcOffsetSeconds: 0 } } };
}

const SPOTS = { a: { name: 'Porto Pollo', emoji: '🏄', offshoreDir: null } };
const DEV = u => ({ endpoint: `https://push.example/${u}`, p256dh: 'p', auth: 'a' });

function harness(over = {}) {
  const log = { sent: [], ok: [], failed: [], deleted: [], pruned: [], pushes: [], forecasts: 0 };
  const store = {
    deliverableAlerts: () => over.subs ?? [{ userId: 'u1', spotId: 'a', minScore: 70 }],
    riderPrefs: () => over.riders ?? {},
    sentKeys: () => over.sentKeys ?? new Set(),
    markSent: rows => log.sent.push(...rows),
    pruneSent: day => log.pruned.push(day),
    devicesOf: u => (over.devices ? (over.devices[u] ?? []) : [DEV(u)]),
    markDeviceOk: e => log.ok.push(e),
    markDeviceFail: e => log.failed.push(e),
    deleteDevice: e => log.deleted.push(e),
  };
  const send = async (dev, payload) => {
    log.pushes.push({ endpoint: dev.endpoint, payload });
    return (over.send || (() => ({ ok: true })))(dev, payload);
  };
  const loadForecast = async () => { log.forecasts++; return over.forecast ?? forecast(); };
  return { log, run: () => runAlertSweep({ store, send, loadForecast, spots: SPOTS, now: NOW }) };
}

test('ohne Abos wird der Forecast nicht angefasst', async () => {
  const { log, run } = harness({ subs: [] });
  assert.deepStrictEqual(await run(), { users: 0, pushed: 0, hits: 0, dropped: 0, failed: 0 });
  assert.strictEqual(log.forecasts, 0, 'Forecast ohne Empfänger geholt');
});

test('Treffer: ein Push, Gerät bestätigt, Tag protokolliert', async () => {
  const { log, run } = harness();
  const r = await run();

  assert.strictEqual(r.pushed, 1);
  assert.strictEqual(log.pushes.length, 1, 'ein Push je Nutzer, nicht je Spot-Tag');
  assert.match(log.pushes[0].payload.title, /Porto Pollo|Alarme/);
  assert.deepStrictEqual(log.ok, [DEV('u1').endpoint]);
  // Fünf Tage über der Schwelle → fünf Entprellungs-Zeilen.
  assert.strictEqual(log.sent.length, 5);
  assert.deepStrictEqual(log.sent[0], { userId: 'u1', spotId: 'a', date: DAY0, score: 100 });
});

test('schwacher Wind: kein Push, nichts protokolliert', async () => {
  const { log, run } = harness({ forecast: forecast(4) });
  const r = await run();
  assert.strictEqual(r.pushed, 0);
  assert.strictEqual(log.pushes.length, 0);
  assert.strictEqual(log.sent.length, 0);
});

test('fehlgeschlagener Push wird NICHT als verschickt protokolliert', async () => {
  const { log, run } = harness({ send: () => ({ error: 'timeout', status: 500 }) });
  const r = await run();

  assert.strictEqual(r.pushed, 0);
  assert.strictEqual(r.failed, 1);
  assert.deepStrictEqual(log.sent, [], 'Alarm wäre verbraucht, ohne anzukommen');
  assert.deepStrictEqual(log.failed, [DEV('u1').endpoint]);
  assert.deepStrictEqual(log.ok, []);
});

test('abgemeldetes Gerät (410) wird entsorgt, der Tag bleibt meldbar', async () => {
  const { log, run } = harness({ send: () => ({ gone: true, status: 410 }) });
  const r = await run();

  assert.strictEqual(r.dropped, 1);
  assert.strictEqual(r.pushed, 0);
  assert.deepStrictEqual(log.deleted, [DEV('u1').endpoint]);
  assert.deepStrictEqual(log.sent, []);
});

test('mehrere Geräte: ein Erfolg genügt, das tote wird trotzdem entsorgt', async () => {
  const dead = { endpoint: 'https://push.example/alt', p256dh: 'p', auth: 'a' };
  const { log, run } = harness({
    devices: { u1: [dead, DEV('u1')] },
    send: dev => (dev.endpoint === dead.endpoint ? { gone: true, status: 404 } : { ok: true }),
  });
  const r = await run();

  assert.strictEqual(r.pushed, 1);
  assert.strictEqual(r.dropped, 1);
  assert.deepStrictEqual(log.deleted, [dead.endpoint]);
  assert.strictEqual(log.sent.length, 5, 'ein erreichtes Gerät muss protokollieren');
});

test('Nutzer ohne Gerät wird übersprungen, ohne Push-Versuch', async () => {
  const { log, run } = harness({ devices: {} });
  const r = await run();
  assert.strictEqual(r.users, 1, 'der Treffer wurde ausgewertet');
  assert.strictEqual(r.pushed, 0);
  assert.strictEqual(log.pushes.length, 0);
  assert.deepStrictEqual(log.sent, []);
});

test('bereits gemeldete Tage werden übersprungen', async () => {
  const sentKeys = new Set([0, 1, 2, 3].map(d =>
    `u1|a|${new Date(Date.UTC(2026, 10, 10 + d)).toISOString().slice(0, 10)}`));
  const { log, run } = harness({ sentKeys });
  await run();
  assert.strictEqual(log.sent.length, 1, 'nur der noch offene fünfte Tag');
  assert.strictEqual(log.sent[0].date, '2026-11-14');
});

test('das Fahrerprofil entscheidet mit', async () => {
  // 7 m/s: Referenzfahrer 64 (unter der Schwelle), mit 9 m² 83.
  const fc = forecast(7);
  assert.strictEqual((await harness({ forecast: fc }).run()).pushed, 0);

  const big = { weight: 75, wingSize: 9, skill: 'intermediate' };
  assert.ok(WF.windowFromRider(big).minWind < 7, 'Testannahme über das Fenster');
  const r = await harness({ forecast: fc, riders: { u1: big } }).run();
  assert.strictEqual(r.pushed, 1, 'das Profil wurde nicht angewandt');
});

test('alte Entprellungs-Zeilen werden aufgeräumt', async () => {
  const { log, run } = harness();
  await run();
  assert.deepStrictEqual(log.pruned, ['2026-10-27'], '14 Tage Rückhalt');
});

test('startAlertScheduler: spots werden pro Durchlauf neu gelesen', async () => {
  // spots.json kann sich ohne Service-Restart ändern — ein beim Boot
  // eingefrorenes Objekt würde neue Spots nie kennen.
  let reads = 0;
  const sched = startAlertScheduler({
    store: {
      deliverableAlerts: () => [{ userId: 'u1', spotId: 'a', minScore: 70 }],
      riderPrefs: () => ({}), sentKeys: () => new Set(), markSent() {}, pruneSent() {},
      devicesOf: () => [DEV('u1')], markDeviceOk() {}, markDeviceFail() {}, deleteDevice() {},
    },
    send: async () => ({ ok: true }),
    loadForecast: async () => forecast(),
    spots: () => { reads++; return SPOTS; },
  });
  try {
    await sched.tick();
    await sched.tick();
    // Nachtruhe im Testlauf möglich — dann bleibt reads 0, und der Test prüft
    // nur, dass tick() nicht wirft.
    assert.ok(reads === 0 || reads === 2, `spots-Lesevorgänge: ${reads}`);
  } finally { sched.stop(); }
});

test('startAlertScheduler: ein Upstream-Ausfall beendet den Timer nicht', async () => {
  const sched = startAlertScheduler({
    store: { deliverableAlerts() { throw new Error('DB weg'); } },
    send: async () => ({ ok: true }),
    loadForecast: async () => forecast(),
    spots: SPOTS,
  });
  try { await sched.tick(); } finally { sched.stop(); }
});

test('startAlertScheduler: ein Durchlauf ohne einen einzigen Erfolg landet trotzdem im Log', async () => {
  // Geloggt wurde vorher nur bei pushed > 0. Ein Durchlauf, in dem jedes Gerät
  // abgelehnt wird, war damit unsichtbar — genau der Zustand, der den
  // Pixel-7-Fehlschlag am 10.11.2026 nicht nachvollziehbar machte.
  const lines = [], orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  const sched = startAlertScheduler({
    store: {
      deliverableAlerts: () => [{ userId: 'u1', spotId: 'a', minScore: 70 }],
      riderPrefs: () => ({}), sentKeys: () => new Set(), markSent() {}, pruneSent() {},
      devicesOf: () => [DEV('u1')], markDeviceOk() {}, markDeviceFail() {}, deleteDevice() {},
    },
    send: async () => ({ gone: true, status: 410 }),
    loadForecast: async () => forecast(),
    spots: SPOTS,
  });
  try { await sched.tick(); } finally { sched.stop(); console.log = orig; }

  const alerts = lines.filter(l => l.startsWith('[alerts]'));
  if (inQuietHours()) {
    assert.deepStrictEqual(alerts, [], 'in der Nachtruhe läuft kein Durchlauf');
  } else {
    assert.strictEqual(alerts.length, 1, 'genau eine Zeile');
    assert.match(alerts[0], /"pushed":0/);
    assert.match(alerts[0], /"dropped":1/);
  }
});

test('Nachtruhe: zwischen 21 und 7 Uhr wird nicht geweckt', () => {
  const at = h => new Date(2026, 10, 10, h, 30);
  assert.strictEqual(inQuietHours(at(QUIET_BEFORE_HOUR - 1)), true);
  assert.strictEqual(inQuietHours(at(QUIET_BEFORE_HOUR)), false);
  assert.strictEqual(inQuietHours(at(QUIET_FROM_HOUR - 1)), false);
  assert.strictEqual(inQuietHours(at(QUIET_FROM_HOUR)), true);
});
