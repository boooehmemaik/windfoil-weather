// ============================================================================
// WindFoil — alarm.html rendert
// ----------------------------------------------------------------------------
// Die Seite ist ein klassisches Inline-Script ohne Exporte. Wie bei
// vergleich.html wird es hier extrahiert, mit gestubbtem DOM ausgeführt und
// init() von außen aufgerufen — ein statischer Check würde eine kaputte
// Initialisierung nicht sehen.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('./alarm.html', import.meta.url), 'utf8');
const INLINE = HTML.slice(HTML.lastIndexOf('<script>') + 8, HTML.lastIndexOf('</script>'));
const SPOTS = JSON.parse(readFileSync(new URL('./spots.json', import.meta.url), 'utf8'));
const SPOT_COUNT = [...Object.values(SPOTS.regions).flatMap(r => r.spots), ...SPOTS.unpagedSpots].length;

function node() {
  const classes = new Set(), handlers = {};
  return {
    innerHTML: '', textContent: '', className: '', disabled: false, dataset: {},
    // Klassen und Listener werden mitgeschrieben: ob ein Knopf sichtbar ist,
    // ist bei dieser Seite die eigentliche Aussage — ein ausgeblendeter
    // „Aktivieren"-Knopf war der Bug.
    classes, handlers,
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      toggle: (c, on) => void (on === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c))
                                                : (on ? classes.add(c) : classes.delete(c))),
      contains: c => classes.has(c),
    },
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    closest: () => null, querySelector: () => null,
    setAttribute() {}, getAttribute: () => null,
  };
}

/** Einen aufgezeichneten Listener auslösen und abwarten. */
async function fire(el, type) {
  for (const fn of el.handlers[type] || []) await fn({ target: el, preventDefault() {} });
}

/** Browser-Abo, wie pushManager.getSubscription() es liefert. */
function subscription(log, endpoint = 'https://fcm.googleapis.com/fcm/send/pixel7-token') {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'p256dh-test', auth: 'auth-test' } }),
    unsubscribe: async () => { log.unsubscribed = true; return true; },
  };
}

/** Browserumgebung, soweit alarm.html sie anfasst. */
function stub({ cfg, status = 200, ua = 'Mozilla/5.0 (X11; Linux x86_64)', push = true,
                subscribed = false, testPush = () => ({ ok: true }), acceptDevice = true } = {}) {
  const nodes = {}, log = { requests: [], redirects: [], unsubscribed: false };
  const sub = subscribed ? subscription(log) : null;
  let current = cfg;
  const count = p => log.requests.filter(r => r.url.endsWith(p) && r.method === 'POST').length;

  globalThis.document = {
    getElementById: id => (nodes[id] ||= node()),
    addEventListener() {},
  };
  globalThis.fetch = async (url, opts) => {
    const u = String(url), method = opts?.method || 'GET';
    log.requests.push({ url: u, method });
    if (u.includes('/spots.json')) return { ok: true, status: 200, json: async () => SPOTS };
    if (status !== 200) return { ok: false, status, json: async () => ({ error: 'unauthenticated' }) };

    if (method === 'POST' && u.endsWith('/alerts/devices')) {
      if (acceptDevice) current = { ...current, devices: (current.devices || 0) + 1 };
      return { ok: true, status: 200, json: async () => ({ ok: true, devices: current.devices }) };
    }
    if (method === 'POST' && u.endsWith('/alerts/test')) {
      const r = testPush(count('/alerts/test'));   // 1-basiert: dieser Aufruf steht schon im Log
      return r.status === 400
        ? { ok: false, status: 400, json: async () => ({ error: 'no_devices' }) }
        : { ok: true, status: 200, json: async () => ({ ok: !!r.ok, results: [] }) };
    }
    return { ok: true, status: 200, json: async () => current };
  };
  const nav = {
    userAgent: ua, platform: 'Linux x86_64', maxTouchPoints: 0,
    ...(push ? {
      serviceWorker: {
        getRegistration: async () => ({ pushManager: { getSubscription: async () => sub } }),
        register: async () => ({ pushManager: { subscribe: async () => sub } }),
        ready: Promise.resolve({}),
      },
    } : {}),
  };
  // globalThis.navigator ist in Node nur ein Getter — überschreiben geht nur
  // über defineProperty.
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  globalThis.window = {
    matchMedia: () => ({ matches: false }),
    navigator: nav,
    ...(push ? { PushManager: function () {} } : {}),
  };
  // pushSupported() fragt 'Notification' in window ab — im Browser ist window
  // === globalThis, hier nicht. Ohne beide Zuweisungen hielte der Stub jeden
  // Browser für push-unfähig und die Tests liefen am Code vorbei.
  if (push) globalThis.window.Notification = globalThis.Notification =
    { permission: 'default', requestPermission: async () => 'granted' };
  else delete globalThis.Notification;
  globalThis.atob = s => Buffer.from(s, 'base64').toString('binary');
  globalThis.location = { set href(v) { log.redirects.push(v); }, get href() { return '/alarm.html'; } };

  return { nodes, log };
}

/** Das Inline-Script ausführen, ohne dass init() sofort losläuft. */
function load() {
  const src = INLINE.replace(/\binit\(\);\s*$/, '');
  return new Function(`${src}\nreturn { init, state };`)();
}

const CFG = (over = {}) => ({
  // 55 ist absichtlich weder der alte (70) noch der neue (40) Standardwert:
  // nur so beweist eine Zusicherung, dass die Seite den API-Wert benutzt und
  // nicht ein einkopiertes Literal.
  pushEnabled: true, reason: null, publicKey: 'BKxQ', defaultMinScore: 55,
  lookaheadDays: 5, devices: 1, alerts: [], ...over,
});

test('init(): alle Spots werden mit ihrem Alarmzustand gerendert', async () => {
  const first = Object.values(SPOTS.regions)[0].spots[0];
  const { nodes } = stub({ cfg: CFG({ alerts: [{ spotId: first.id, minScore: 85 }] }) });
  const api = load();
  await api.init();

  const html = nodes.spots.innerHTML;
  assert.strictEqual((html.match(/class="spot"/g) || []).length, SPOT_COUNT, 'Spot-Zeilen');
  // Genau ein aktiver Alarm — und die gespeicherte Schwelle, nicht der Default.
  assert.strictEqual((html.match(/aria-pressed="true"/g) || []).length, 1);
  assert.match(html, new RegExp(`data-id="${first.id}"[\\s\\S]{0,400}value="85"`));
  assert.ok(!html.includes('undefined'), 'undefined im Markup');
  assert.match(nodes.lead.textContent, /1 Spot\(s\) überwacht · 1 Gerät/);
});

test('init(): die Schwelle ist frei editierbar und kommt aus der API', async () => {
  const { nodes } = stub({ cfg: CFG() });
  await (await load()).init();

  const m = nodes.spots.innerHTML.match(
    /<input class="thr" type="number" min="(\d+)" max="(\d+)" step="(\d+)" value="(\d+)"/);
  assert.ok(m, 'Schwellenfeld nicht gefunden');
  const [min, max, step, value] = m.slice(1).map(Number);

  assert.strictEqual(value, 55, 'Vorbelegung muss defaultMinScore sein, nicht ein Literal');
  // min="1" mit step="5" ließ nur 1, 6, 11 … zu — der Browser wies 40 ab.
  for (const want of [10, 40, 55, 70, 100]) {
    assert.ok(want >= min && want <= max && (want - min) % step === 0,
      `${want} muss eingebbar sein (min=${min} max=${max} step=${step})`);
  }
});

test('init(): ohne Server-Schlüssel bleibt der Knopf aus, mit Begründung', async () => {
  const { nodes } = stub({ cfg: CFG({ pushEnabled: false, publicKey: null, reason: 'vapid_keys_missing' }) });
  await load().init();

  assert.strictEqual(nodes['btn-enable'].disabled, true);
  assert.match(nodes['push-note'].textContent, /vapid_keys_missing/);
  // Die Spotliste muss trotzdem bedienbar sein: Abos lassen sich vorbereiten.
  assert.strictEqual((nodes.spots.innerHTML.match(/class="spot"/g) || []).length, SPOT_COUNT);
});

test('init(): iPhone im Safari-Tab bekommt den Home-Bildschirm-Hinweis', async () => {
  const { nodes } = stub({
    cfg: CFG(), push: false,
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
  });
  await load().init();

  assert.strictEqual(nodes['btn-enable'].disabled, true);
  assert.match(nodes['push-note'].textContent, /Home-Bildschirm/);
});

test('init(): Browser ohne Push-Unterstützung sagt das auch so', async () => {
  const { nodes } = stub({ cfg: CFG(), push: false });
  await load().init();
  assert.match(nodes['push-note'].textContent, /keine Web-Benachrichtigungen/);
});

test('init(): ohne Anmeldung wird zur Hauptseite geschickt', async () => {
  const { log, nodes } = stub({ cfg: null, status: 401 });
  await load().init();

  assert.deepStrictEqual(log.redirects, ['/?alarm=login']);
  // Kein halbfertiges Rendering: ohne Konto gibt es nichts zu konfigurieren.
  assert.strictEqual(nodes.spots.innerHTML, '');
});

// ── Abo und Server laufen auseinander ───────────────────────────────────────
// Am 10.11.2026 hat ein Pixel 7 sein Abo angelegt, der Push-Dienst hat den
// Endpunkt 3 s später als „weg" gemeldet, der Server hat die Zeile gelöscht —
// und der Browser hielt sein Abo weiter für gültig. Ergebnis: „Aktivieren" war
// ausgeblendet, „Probe senden" lief ins Leere. Diese drei Tests halten den
// Ausweg fest.

test('init(): kennt der Server das Abo nicht, wird es neu angemeldet', async () => {
  const { nodes, log } = stub({ cfg: CFG({ devices: 0 }), subscribed: true });
  const api = await load();
  await api.init();

  assert.strictEqual(log.requests.filter(r => r.method === 'POST' && r.url.endsWith('/alerts/devices')).length, 1,
    'genau eine Neuanmeldung');
  assert.match(nodes['push-note'].textContent, /neu verbunden/);
  assert.strictEqual(nodes['btn-enable'].classes.has('hide'), true, 'Gerät gilt wieder als aktiv');
  assert.strictEqual(log.unsubscribed, false, 'ein brauchbares Abo wird nicht weggeworfen');
});

test('init(): bleibt die Neuanmeldung ohne Wirkung, wird kein Erfolg behauptet', async () => {
  // Der Server nimmt das Gerät an, führt es danach aber trotzdem nicht —
  // dann darf die Seite nicht „neu verbunden" melden und Ruhe vorgeben.
  const { nodes } = stub({ cfg: CFG({ devices: 0 }), subscribed: true, acceptDevice: false });
  await (await load()).init();

  assert.match(nodes['push-note'].textContent, /nicht angemeldet.*neu aktivieren/);
  assert.ok(!/neu verbunden/.test(nodes['push-note'].textContent));
});

test('Probe: ein verlorenes Abo wird neu angemeldet, statt den Nutzer abzuweisen', async () => {
  // Erster Versuch: der Server hat die Zeile schon gelöscht (400 no_devices).
  // Nach der Neuanmeldung muss der zweite Versuch durchgehen.
  const { nodes, log } = stub({
    cfg: CFG({ devices: 1 }), subscribed: true,
    testPush: attempt => (attempt === 1 ? { status: 400 } : { ok: true }),
  });
  await (await load()).init();
  await fire(nodes['btn-test'], 'click');

  assert.strictEqual(log.requests.filter(r => r.method === 'POST' && r.url.endsWith('/alerts/test')).length, 2,
    'genau ein Wiederholungsversuch');
  assert.strictEqual(log.requests.filter(r => r.method === 'POST' && r.url.endsWith('/alerts/devices')).length, 1);
  assert.match(nodes['push-note'].textContent, /Probe verschickt/);
  assert.strictEqual(log.unsubscribed, false);
});

test('Probe: ein endgültig abgelehntes Abo wird aufgegeben, nicht endlos wiederholt', async () => {
  const { nodes, log } = stub({
    cfg: CFG({ devices: 1 }), subscribed: true,
    testPush: () => ({ ok: false }),
  });
  const api = await load();
  await api.init();
  await fire(nodes['btn-test'], 'click');

  assert.strictEqual(log.requests.filter(r => r.method === 'POST' && r.url.endsWith('/alerts/test')).length, 2,
    'kein dritter Versuch');
  assert.strictEqual(log.unsubscribed, true, 'das tote Browser-Abo wird abgemeldet');
  assert.strictEqual(api.state.sub, null);
  // Der Ausweg aus der Sackgasse: der Aktivieren-Knopf ist wieder da.
  assert.strictEqual(nodes['btn-enable'].classes.has('hide'), false);
  assert.match(nodes['push-note'].textContent, /neu aktivieren/);
});
