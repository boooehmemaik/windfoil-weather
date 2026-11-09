// ============================================================================
// WindFoil — Web Push: Transport
// ----------------------------------------------------------------------------
// Nur Auslieferung. Was gesendet wird, entscheidet src/alerts.mjs; wer
// abonniert hat, weiß src/alerts.routes.mjs.
//
// `web-push` wird dynamisch geladen und die VAPID-Konfiguration ist optional:
// ohne Paket oder ohne Schlüssel ist der Alarm abgeschaltet, aber der Server
// läuft. Ein harter Import würde maik.surf beim Deploy umlegen, falls
// `npm ci` das Paket nicht mitbringt.
// ============================================================================

let state = null;

/** Einmalige Initialisierung. Mehrfachaufrufe liefern denselben Zustand. */
export async function initPush(env = process.env) {
  if (state) return state;
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT || 'https://maik.surf';

  if (!publicKey || !privateKey) {
    state = { enabled: false, reason: 'vapid_keys_missing', publicKey: null, lib: null };
    return state;
  }
  try {
    const mod = await import('web-push');
    const lib = mod.default || mod;
    lib.setVapidDetails(subject, publicKey, privateKey);
    state = { enabled: true, reason: null, publicKey, lib };
  } catch (e) {
    state = { enabled: false, reason: `web_push_unavailable: ${e.message}`, publicKey: null, lib: null };
  }
  return state;
}

export function pushState() {
  return state || { enabled: false, reason: 'not_initialised', publicKey: null, lib: null };
}

/** Nur für Tests: erlaubt das Einsetzen eines Stubs ohne echtes Netz. */
export function _setPushState(next) {
  state = next;
}

// Der Push-Dienst meldet mit diesen Codes, dass das Abo endgültig weg ist —
// 404 (Endpunkt unbekannt) und 410 (abgemeldet). Alles andere ist vorübergehend.
const GONE = new Set([404, 410]);

/** Ein Abo beliefern. Wirft nie — der Scheduler darf an einem toten Endpunkt
 *  nicht abbrechen.
 *  → { ok } | { gone: true, status } | { error, status } */
export async function sendPush(sub, payload) {
  const { enabled, lib } = pushState();
  if (!enabled) return { error: pushState().reason, status: 0 };
  try {
    await lib.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 6 * 3600 },   // ein Windalarm ist nach ein paar Stunden wertlos
    );
    return { ok: true };
  } catch (e) {
    const status = e.statusCode || 0;
    if (GONE.has(status)) return { gone: true, status };
    return { error: String(e.message || e), status };
  }
}
