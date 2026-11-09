// ============================================================================
// WindFoil — Windalarm: HTTP
// ----------------------------------------------------------------------------
// Mount: app.use('/api/alerts', requireAuth, alertsRouter)
// Ein Alarm braucht ein Konto — anonyme Abos wären nicht zustellbar und nicht
// löschbar.
// ============================================================================
import { Router } from 'express';
import { spotsById } from './forecast.routes.mjs';
import { pushState, sendPush } from './push.mjs';
import { DEFAULT_MIN_SCORE, LOOKAHEAD_DAYS } from './alerts.mjs';
import {
  listAlerts, upsertAlert, deleteAlert,
  saveDevice, deleteDevice, devicesOf, countDevices, markDeviceOk,
} from './alerts.store.mjs';

export const alertsRouter = Router();

const MAX_ALERTS_PER_USER = 20;
const MAX_ENDPOINT_LEN = 1024;

// GET /api/alerts — Zustand für die UI: Schlüssel, Abos, Gerätezahl.
alertsRouter.get('/', (req, res) => {
  const { enabled, reason, publicKey } = pushState();
  res.json({
    pushEnabled: enabled,
    reason,
    publicKey,
    defaultMinScore: DEFAULT_MIN_SCORE,
    lookaheadDays: LOOKAHEAD_DAYS,
    devices: countDevices(req.user.id),
    alerts: listAlerts(req.user.id),
  });
});

// PUT /api/alerts/:spotId  body: { minScore }
alertsRouter.put('/:spotId', (req, res) => {
  const spotId = String(req.params.spotId);
  // Die ID muss aus spots.json kommen: ein Tippfehler würde sonst ein Abo
  // erzeugen, das nie auslöst, und der Nutzer sucht den Fehler bei sich.
  if (!spotsById()[spotId]) return res.status(404).json({ error: 'unknown_spot' });

  const raw = req.body?.minScore;
  const minScore = raw === undefined ? DEFAULT_MIN_SCORE : Number(raw);
  if (!Number.isInteger(minScore) || minScore < 1 || minScore > 100) {
    return res.status(400).json({ error: 'min_score_out_of_range' });
  }

  const existing = listAlerts(req.user.id);
  if (existing.length >= MAX_ALERTS_PER_USER && !existing.some(a => a.spotId === spotId)) {
    return res.status(409).json({ error: 'too_many_alerts', max: MAX_ALERTS_PER_USER });
  }

  upsertAlert(req.user.id, spotId, minScore);
  res.json({ ok: true, spotId, minScore });
});

alertsRouter.delete('/:spotId', (req, res) => {
  const changes = deleteAlert(req.user.id, String(req.params.spotId));
  res.json({ ok: true, removed: changes });
});

// POST /api/alerts/devices  body: { endpoint, keys: { p256dh, auth } }
alertsRouter.post('/devices', (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > MAX_ENDPOINT_LEN) {
    return res.status(400).json({ error: 'bad_endpoint' });
  }
  if (!keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'bad_keys' });

  saveDevice(req.user.id, {
    endpoint, p256dh: String(keys.p256dh), auth: String(keys.auth),
    ua: String(req.get('user-agent') || '').slice(0, 200),
  });
  res.json({ ok: true, devices: countDevices(req.user.id) });
});

// DELETE /api/alerts/devices  body: { endpoint }
alertsRouter.delete('/devices', (req, res) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint !== 'string') return res.status(400).json({ error: 'bad_endpoint' });
  // Nur eigene Geräte: ohne die user_id-Prüfung könnte jeder eingeloggte Nutzer
  // fremde Abos abmelden, wenn er den Endpunkt kennt.
  const mine = devicesOf(req.user.id).some(d => d.endpoint === endpoint);
  if (!mine) return res.status(404).json({ error: 'unknown_device' });
  res.json({ ok: true, removed: deleteDevice(endpoint) });
});

// POST /api/alerts/test — Probe-Push an alle Geräte des Nutzers.
alertsRouter.post('/test', async (req, res) => {
  if (!pushState().enabled) return res.status(503).json({ error: 'push_disabled', reason: pushState().reason });
  const devices = devicesOf(req.user.id);
  if (!devices.length) return res.status(400).json({ error: 'no_devices' });

  const payload = {
    title: '🌬️ WindFoil-Alarm steht',
    body: `Du wirst benachrichtigt, sobald ein Spot ${DEFAULT_MIN_SCORE}+ erreicht.`,
    url: '/vergleich.html', tag: 'wf-alert-test',
  };
  const results = await Promise.all(devices.map(async d => {
    const r = await sendPush(d, payload);
    if (r.ok) markDeviceOk(d.endpoint);
    else if (r.gone) deleteDevice(d.endpoint);
    return { ok: !!r.ok, status: r.status || 200 };
  }));
  res.json({ ok: results.some(r => r.ok), results });
});
