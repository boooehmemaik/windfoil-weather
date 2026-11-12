// ============================================================================
// WindFoil — Windalarm: Durchlauf
// ----------------------------------------------------------------------------
// Verbindet Auswertung (alerts.mjs), Persistenz (alerts.store.mjs) und
// Transport (push.mjs). Alle drei kommen als Argument herein, damit der
// Durchlauf ohne DB, ohne Netz und mit fester Uhr testbar ist.
// ============================================================================
import WF from '../js/wf-scoring.js';
import { evaluateAlerts, formatAlert, LOOKAHEAD_DAYS } from './alerts.mjs';

export const SWEEP_INTERVAL_MS = 60 * 60_000;

// Die Entprellung muss nur so lange zurückreichen, wie der Lookahead; 14 Tage
// sind reichlich Puffer und halten die Tabelle klein.
const KEEP_SENT_DAYS = 14;

// Kein Push mitten in der Nacht. Der Forecast für morgen ändert sich bis zum
// Morgen ohnehin kaum — das Wecken wäre reiner Schaden.
export const QUIET_BEFORE_HOUR = 7;
export const QUIET_FROM_HOUR = 21;

export const inQuietHours = (date = new Date()) =>
  date.getHours() < QUIET_BEFORE_HOUR || date.getHours() >= QUIET_FROM_HOUR;

const dayStr = d => d.toISOString().slice(0, 10);

/** Quiver je Nutzer — bewertet mit allen fahrbaren Wings, nicht nur dem Profil-Wing.
 *  Wer kein Profil hat, bekommt den Harlem-Referenzquiver (riderQuiver(null,null)). */
function windowsFor(riderPrefs) {
  const out = {};
  for (const [userId, { rider, gear }] of Object.entries(riderPrefs)) {
    out[userId] = WF.riderQuiver(rider || null, gear || null);
  }
  return out;
}

/** Ein Durchlauf: auswerten, ausliefern, protokollieren, aufräumen.
 *  store / loadForecast / send sind injiziert. */
export async function runAlertSweep({ store, loadForecast, send, spots = {},
                                      now = new Date(), lookaheadDays = LOOKAHEAD_DAYS }) {
  const subscriptions = store.deliverableAlerts();
  if (!subscriptions.length) return { users: 0, pushed: 0, hits: 0, dropped: 0, failed: 0 };

  const forecast = await loadForecast();
  const results = evaluateAlerts({
    forecast, spots, subscriptions,
    windows: windowsFor(store.riderPrefs()),
    sent: store.sentKeys(dayStr(now)),
    now, lookaheadDays,
  });

  let pushed = 0, hits = 0, dropped = 0, failed = 0;
  for (const { userId, hits: userHits } of results) {
    const devices = store.devicesOf(userId);
    if (!devices.length) continue;

    const payload = formatAlert(userHits);
    let delivered = false;
    for (const dev of devices) {
      const r = await send(dev, payload);
      if (r.ok) { delivered = true; store.markDeviceOk(dev.endpoint); }
      else if (r.gone) { dropped++; store.deleteDevice(dev.endpoint); }
      else { failed++; store.markDeviceFail(dev.endpoint); }
    }

    // Erst protokollieren, wenn wirklich ein Gerät erreicht wurde. Sonst wäre
    // der Alarm für diesen Tag verbraucht, ohne angekommen zu sein.
    if (!delivered) continue;
    pushed++;
    hits += userHits.length;
    store.markSent(userHits.map(h => ({ userId, spotId: h.spotId, date: h.date, score: h.score })));
  }

  store.pruneSent(dayStr(new Date(now.getTime() - KEEP_SENT_DAYS * 86_400_000)));
  return { users: results.length, pushed, hits, dropped, failed };
}

/** Stündlicher Durchlauf, Nachtruhe ausgenommen. Fehler werden geloggt, nicht
 *  geworfen — ein Upstream-Ausfall darf den Timer nicht beenden. */
export function startAlertScheduler(deps) {
  const tick = async () => {
    if (inQuietHours()) return;
    try {
      // spots darf eine Funktion sein: spots.json wird zur Laufzeit neu
      // gelesen, ein beim Boot eingefrorenes Objekt würde veralten.
      const spots = typeof deps.spots === 'function' ? deps.spots() : deps.spots;
      const r = await runAlertSweep({ ...deps, spots, now: new Date() });
      // Nicht nur Erfolge: ein Durchlauf, der ausschließlich scheitert, war
      // vorher unsichtbar — genau der Fall, den man im Log sucht.
      if (r.pushed || r.dropped || r.failed) console.log('[alerts]', JSON.stringify(r));
    } catch (e) {
      console.error('[alerts] Durchlauf fehlgeschlagen:', e.message);
    }
  };
  const timer = setInterval(tick, SWEEP_INTERVAL_MS);
  timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}
