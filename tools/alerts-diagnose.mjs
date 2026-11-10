// ============================================================================
// WindFoil — Diagnose: warum kam kein Windalarm an?
// ----------------------------------------------------------------------------
// Nur lesend. Zeigt die Kette, die ein Push durchlaufen muss:
//   Nutzer → Alarm-Regel → registriertes Gerät → Zustellversuch
// Bricht die Kette, sagt dieses Skript wo. Endpunkte werden gekürzt und der
// Auth-Schlüssel nie ausgegeben.
//
//   node tools/alerts-diagnose.mjs
// ============================================================================
import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = new Database(process.env.WINDFOIL_DB_PATH || join(root, 'data', 'windfoil.db'),
                        { readonly: true });

const has = name => !!db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

/** Push-Dienst am Endpunkt erkennen — das unterscheidet Android von iOS. */
function service(endpoint) {
  if (/fcm\.googleapis\.com|android\.googleapis\.com/.test(endpoint)) return 'FCM (Android/Chrome)';
  if (/push\.apple\.com/.test(endpoint)) return 'APNs (iOS/Safari)';
  if (/mozilla|autopush/.test(endpoint)) return 'Mozilla (Firefox)';
  if (/notify\.windows|wns/.test(endpoint)) return 'WNS (Edge)';
  return 'unbekannt';
}

const short = e => e.length > 48 ? e.slice(0, 32) + '…' + e.slice(-12) : e;

console.log('── Geräte (push_subscriptions) ───────────────────────────────');
if (!has('push_subscriptions')) {
  console.log('Tabelle fehlt — es wurde nie ein Gerät registriert.');
} else {
  const cols = db.prepare('SELECT name FROM pragma_table_info(?)').all('push_subscriptions')
    .map(c => c.name);
  const pick = n => cols.includes(n) ? n : null;
  const rows = db.prepare('SELECT * FROM push_subscriptions').all();
  console.log(`${rows.length} Gerät(e)\n`);
  for (const r of rows) {
    console.log(`  user      ${r.user_id}`);
    console.log(`  dienst    ${service(String(r.endpoint))}`);
    console.log(`  endpoint  ${short(String(r.endpoint))}`);
    if (pick('ua')) console.log(`  ua        ${r.ua || '—'}`);
    console.log(`  angelegt  ${r.created_at || '—'}`);
    if (pick('last_ok_at')) console.log(`  letzter OK ${r.last_ok_at || 'NIE ERFOLGREICH ZUGESTELLT'}`);
    if (pick('fail_count')) console.log(`  fehler    ${r.fail_count ?? 0}`);
    console.log('');
  }
}

console.log('── Alarm-Regeln (wind_alerts) ────────────────────────────────');
if (!has('wind_alerts')) {
  console.log('Tabelle fehlt.');
} else {
  const rows = db.prepare('SELECT * FROM wind_alerts').all();
  console.log(`${rows.length} Regel(n)`);
  for (const r of rows) {
    console.log(`  ${r.user_id}  spot=${r.spot_id}  minScore=${r.min_score}`);
  }
}

/** Konto zu einer user_id — zeigt, ob Regel und Gerät am selben Login hängen. */
function account(userId) {
  for (const t of ['user', 'users']) {
    if (!has(t)) continue;
    const cols = db.prepare('SELECT name FROM pragma_table_info(?)').all(t).map(c => c.name);
    if (!cols.includes('email')) continue;
    const created = cols.includes('createdAt') ? 'createdAt' : cols.includes('created_at') ? 'created_at' : null;
    const r = db.prepare(`SELECT email${created ? ', ' + created + ' AS created' : ''} FROM ${t} WHERE id = ?`).get(userId);
    if (r) return `${r.email}${r.created ? ' (angelegt ' + r.created + ')' : ''}`;
  }
  return 'KEIN Konto mit dieser ID';
}

console.log('\n── Kette je Nutzer ──────────────────────────────────────────');
if (has('wind_alerts') && has('push_subscriptions')) {
  const rows = db.prepare(`
    SELECT u.user_id AS userId,
           (SELECT COUNT(*) FROM wind_alerts a WHERE a.user_id = u.user_id) AS regeln,
           (SELECT COUNT(*) FROM push_subscriptions p WHERE p.user_id = u.user_id) AS geraete
    FROM (SELECT user_id FROM wind_alerts UNION SELECT user_id FROM push_subscriptions) u`).all();
  for (const r of rows) {
    const problem = !r.regeln ? 'Gerät registriert, aber KEINE Alarm-Regel → es wird nie ausgewertet'
      : !r.geraete ? 'Alarm-Regel vorhanden, aber KEIN Gerät → deliverableAlerts() überspringt den Nutzer'
      : 'Kette vollständig';
    console.log(`  ${account(r.userId)}`);
    console.log(`    ${r.userId}  regeln=${r.regeln}  geräte=${r.geraete}`);
    console.log(`    → ${problem}`);
  }
}

console.log('\n── Protokollierte Zustellungen (wind_alert_sent) ──────────────────');
if (!has('wind_alert_sent')) {
  console.log('Tabelle fehlt.');
} else {
  const n = db.prepare('SELECT COUNT(*) c FROM wind_alert_sent').get().c;
  console.log(`${n} Eintrag/Einträge` + (n ? '' : ' — es wurde noch nie ein Alarm zugestellt'));
  for (const r of db.prepare('SELECT * FROM wind_alert_sent ORDER BY rowid DESC LIMIT 10').all()) {
    console.log(`  ${r.sent_date || r.date}  ${r.user_id}  ${r.spot_id}  score=${r.score}`);
  }
}
