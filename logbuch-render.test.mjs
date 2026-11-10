// ============================================================================
// WindFoil — logbuch.html rendert
// ----------------------------------------------------------------------------
// Gleiches Verfahren wie alarm-render.test.mjs: das Inline-Script wird
// extrahiert, mit gestubbtem DOM ausgeführt und init() von außen aufgerufen.
// Ein statischer Check würde eine kaputte Initialisierung nicht sehen.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('./logbuch.html', import.meta.url), 'utf8');
const INLINE = HTML.slice(HTML.lastIndexOf('<script>') + 8, HTML.lastIndexOf('</script>'));
const SPOTS = JSON.parse(readFileSync(new URL('./spots.json', import.meta.url), 'utf8'));
const SPOT_COUNT = [...Object.values(SPOTS.regions).flatMap(r => r.spots), ...SPOTS.unpagedSpots].length;

function node() {
  return {
    innerHTML: '', textContent: '', className: '', value: '', disabled: false, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, closest: () => null, querySelector: () => null,
    setAttribute() {}, getAttribute: () => null,
  };
}

const WINDOW = {
  spotId: 's_porto_pollo', timezone: 'Europe/Rome', today: '2026-11-10',
  dates: ['2026-11-10', '2026-11-09', '2026-11-08', '2026-11-07',
          '2026-11-06', '2026-11-05', '2026-11-04', '2026-11-03'],
  maxBackfillDays: 7,
};

/** Browserumgebung, soweit logbuch.html sie anfasst. */
function stub({ list, status = 200, windowBody = WINDOW } = {}) {
  const nodes = {}, log = { requests: [], redirects: [] };

  globalThis.document = { getElementById: id => (nodes[id] ||= node()), addEventListener() {} };
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    log.requests.push({ url: u, method: opts?.method || 'GET', body: opts?.body });
    if (u.includes('/spots.json')) return { ok: true, status: 200, json: async () => SPOTS };
    if (u.includes('/api/sessions/window')) return { ok: true, status: 200, json: async () => windowBody };
    if (status !== 200) {
      return { ok: false, status, json: async () => ({ error: 'unauthenticated' }) };
    }
    return { ok: true, status: 200, json: async () => list };
  };
  globalThis.location = { set href(v) { log.redirects.push(v); }, get href() { return '/logbuch.html'; } };

  return { nodes, log };
}

function load() {
  const src = INLINE.replace(/\binit\(\);\s*$/, '');
  return new Function(`${src}\nreturn { init, state, failText, labelDate };`)();
}

const SESSION = (over = {}) => ({
  id: 'sess-1', spot_id: 's_porto_pollo', spot_name: 'Porto Pollo',
  session_date: '2026-11-08', wing_m2: 5, rating: 4, planed: 1,
  range_low_kt: 14, range_high_kt: 19, notes: null, backfilled: 0, ...over,
});

const LIST = (over = {}) => ({
  sessions: [], nextBefore: null, maxBackfillDays: 7, matchTolerance: 8,
  stats: { total: 0, spots: 0, backfilled: 0, avgRating: null, firstDate: null, lastDate: null },
  ...over,
});

const ENTRY = (over = {}) => ({
  session: SESSION(over.session), spot: { name: 'Porto Pollo' }, date: '2026-11-08',
  predicted: { score: 84, windKn: 18, startHour: 11, endHour: 15, source: 'snapshot' },
  actual: { score: 80, windKn: 17, startHour: 11, endHour: 15, source: 'era5' },
  match: { deltaScore: -4, deltaWindKn: -1, verdict: 'getroffen', tolerance: 8 },
  ...over,
});

test('init(): leeres Logbuch erklärt sich, statt leer zu bleiben', async () => {
  const { nodes } = stub({ list: LIST() });
  await load().init();

  assert.match(nodes.entries.innerHTML, /Noch keine Session/);
  assert.match(nodes.entries.innerHTML, /bis 7 Tage/);
  assert.match(nodes.lead.textContent, /Trage deine Sessions ein/);
  // Die Bilanz steht trotzdem — mit Nullen, nicht mit „undefined".
  assert.match(nodes.stats.innerHTML, /<b>0<\/b>/);
  assert.ok(!nodes.stats.innerHTML.includes('undefined'));
});

test('init(): ein Eintrag zeigt Soll, Ist und das Urteil', async () => {
  const { nodes } = stub({
    list: LIST({
      sessions: [ENTRY()],
      stats: { total: 1, spots: 1, backfilled: 0, avgRating: 4, firstDate: '2026-11-08', lastDate: '2026-11-08' },
    }),
  });
  await load().init();

  const html = nodes.entries.innerHTML;
  assert.match(html, /So, 08\.11\./, 'Wochentag UTC-fest — 2026-11-08 ist ein Sonntag');
  assert.match(html, /Porto Pollo/);
  assert.match(html, /<b>84<\/b>/, 'Soll');
  assert.match(html, /<b>80<\/b>/, 'Ist');
  assert.match(html, /class="tag hit">getroffen/);
  assert.match(html, /5 m² Wing · 14–19 kn gemessen · angefoilt · ★★★★/);
  assert.ok(!html.includes('nachgetragen'), 'nicht nachgetragen → kein Marker');
  assert.ok(!html.includes('undefined'));
  assert.match(nodes.lead.textContent, /1 Session\(en\) seit So, 08\.11\./);
});

test('init(): nachgetragene Einträge sind erkennbar', async () => {
  const { nodes } = stub({ list: LIST({ sessions: [ENTRY({ session: { backfilled: 1 } })] }) });
  await load().init();
  assert.match(nodes.entries.innerHTML, /class="tag">nachgetragen/);
});

test('init(): fehlendes Ist bleibt eine Lücke, kein Nullwert', async () => {
  // Für den heutigen Tag endet das ERA5-Archiv noch gestern. Eine erfundene 0
  // würde als „Vorhersage komplett daneben" gelesen.
  const { nodes } = stub({
    list: LIST({ sessions: [ENTRY({ actual: null, match: null })] }),
  });
  await load().init();

  const html = nodes.entries.innerHTML;
  assert.match(html, /<b>—<\/b><small>Archiv noch nicht verfügbar/,
    'die Lücke muss ein Strich sein, keine Zahl');
  assert.ok(!/class="tag (hit|over|under)"/.test(html), 'ohne Ist kein Urteil-Tag');
  assert.match(html, /<b>84<\/b>/, 'das Soll steht weiter da');
});

test('init(): fehlt die Vorhersage, steht dort auch kein Wert', async () => {
  // Bei einem selbst angelegten Spot ohne Snapshot gibt es kein Soll. Eine 0
  // würde behaupten, der Forecast habe die Session ausgeschlossen.
  const { nodes } = stub({
    list: LIST({ sessions: [ENTRY({ predicted: null, match: null })] }),
  });
  await load().init();

  assert.match(nodes.entries.innerHTML, /<b>—<\/b><small>keine Vorhersage gespeichert/);
  assert.match(nodes.entries.innerHTML, /<b>80<\/b>/, 'das Ist steht weiter da');
});

test('init(): die Urteile bekommen unterscheidbare Farben', async () => {
  for (const [verdict, cls] of [['zu optimistisch', 'over'], ['zu pessimistisch', 'under']]) {
    const { nodes } = stub({ list: LIST({ sessions: [ENTRY({ match: { verdict, deltaScore: 20 } })] }) });
    await load().init();
    assert.match(nodes.entries.innerHTML, new RegExp(`class="tag ${cls}">${verdict}`));
  }
});

test('init(): Notizen werden escaped, nicht als Markup ausgeführt', async () => {
  const { nodes } = stub({
    list: LIST({ sessions: [ENTRY({ session: { notes: '<img src=x onerror=alert(1)>' } })] }),
  });
  await load().init();
  assert.ok(!nodes.entries.innerHTML.includes('<img'), 'rohes Markup im Logbuch');
  assert.match(nodes.entries.innerHTML, /&lt;img src=x/);
});

test('init(): alle Spots stehen zur Auswahl, gruppiert nach Region', async () => {
  const { nodes } = stub({ list: LIST() });
  await load().init();

  const html = nodes['f-spot'].innerHTML;
  assert.strictEqual((html.match(/<option /g) || []).length, SPOT_COUNT);
  assert.strictEqual((html.match(/<optgroup /g) || []).length,
    Object.keys(SPOTS.regions).length + 1, 'je Region eine Gruppe plus „Weitere Spots"');
  assert.ok(!html.includes('undefined'));
});

test('init(): die Tagesauswahl kommt vom Server, nicht aus der Browseruhr', async () => {
  // Der Spot-Tag kann vom Tag des Browsers abweichen; nur den Servertag
  // akzeptiert POST /api/feedback.
  const { nodes, log } = stub({ list: LIST() });
  await load().init();

  assert.ok(log.requests.some(r => r.url.includes('/api/sessions/window?spot=')),
    'das Schreibfenster muss erfragt werden');
  const html = nodes['f-date'].innerHTML;
  assert.strictEqual((html.match(/<option /g) || []).length, 8, 'heute plus 7 Tage zurück');
  assert.match(html, /value="2026-11-10">Di, 10\.11\. \(heute\)/);
  assert.match(html, /value="2026-11-03">Di, 03\.11\.</);
});

test('failText(): ein gesperrter Tag klingt nach Regel, nicht nach Serverfehler', async () => {
  stub({ list: LIST() });
  const api = load();

  assert.match(api.failText({ message: 'feedback_locked', body: { reason: 'future_day' } }),
    /noch in der Zukunft/);
  assert.match(api.failText({ message: 'feedback_locked', body: { reason: 'too_old', maxBackfillDays: 7 } }),
    /bis 7 Tage zurück/);
  // Unbekannte Fehler dürfen nicht verschluckt werden.
  assert.match(api.failText({ message: 'invalid_wing_m2', body: {} }), /invalid_wing_m2/);
});

test('init(): ohne Anmeldung wird zur Hauptseite geschickt', async () => {
  const { log, nodes } = stub({ list: null, status: 401 });
  await load().init();

  assert.deepStrictEqual(log.redirects, ['/?logbuch=login']);
  // Kein halbfertiges Rendering: ohne Konto gibt es kein Logbuch.
  assert.strictEqual(nodes.entries.innerHTML, '');
  assert.strictEqual(nodes['f-spot'].innerHTML, '');
});

test('init(): weitere Seiten nur, wenn der Server einen Cursor liefert', async () => {
  // Der Client darf das Ende nicht aus der Seitenlänge raten — eine kurze
  // Seite kann auch nur eine kurze Seite sein.
  stub({ list: LIST({ sessions: [ENTRY()], nextBefore: '2026-11-08' }) });
  const withCursor = load();
  await withCursor.init();
  assert.strictEqual(withCursor.state.before, '2026-11-08');

  stub({ list: LIST({ sessions: [ENTRY()] }) });
  const atEnd = load();
  await atEnd.init();
  assert.strictEqual(atEnd.state.before, null, 'kein Cursor → keine weitere Seite');
});
