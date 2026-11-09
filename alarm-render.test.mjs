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
  return {
    innerHTML: '', textContent: '', className: '', disabled: false, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, closest: () => null, querySelector: () => null,
    setAttribute() {}, getAttribute: () => null,
  };
}

/** Browserumgebung, soweit alarm.html sie anfasst. */
function stub({ cfg, status = 200, ua = 'Mozilla/5.0 (X11; Linux x86_64)', push = true } = {}) {
  const nodes = {}, log = { requests: [], redirects: [] };

  globalThis.document = {
    getElementById: id => (nodes[id] ||= node()),
    addEventListener() {},
  };
  globalThis.fetch = async (url, opts) => {
    log.requests.push({ url: String(url), method: opts?.method || 'GET' });
    if (String(url).includes('/spots.json')) {
      return { ok: true, status: 200, json: async () => SPOTS };
    }
    return { ok: status === 200, status, json: async () => (status === 200 ? cfg : { error: 'unauthenticated' }) };
  };
  const nav = {
    userAgent: ua, platform: 'Linux x86_64', maxTouchPoints: 0,
    ...(push ? { serviceWorker: { getRegistration: async () => null, register: async () => ({}) } } : {}),
  };
  // globalThis.navigator ist in Node nur ein Getter — überschreiben geht nur
  // über defineProperty.
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  globalThis.window = {
    matchMedia: () => ({ matches: false }),
    navigator: nav,
    ...(push ? { PushManager: function () {} } : {}),
  };
  if (push) globalThis.Notification = { permission: 'default', requestPermission: async () => 'granted' };
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
  pushEnabled: true, reason: null, publicKey: 'BKxQ', defaultMinScore: 70,
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
