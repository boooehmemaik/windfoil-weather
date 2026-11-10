// ============================================================================
// WindFoil — die Orte eines Kontos auf alle Konten verteilen
// ----------------------------------------------------------------------------
// Standardmäßig TROCKENLAUF: zeigt nur, was passieren würde. Erst `--apply`
// schreibt.
//
//   node tools/locations-spread.mjs <quell-email>
//   node tools/locations-spread.mjs <quell-email> --apply
//
// Drei Regeln, die nicht verhandelbar sind:
//   · Kopien kommen mit is_active = 0. Die Tabelle erlaubt genau einen aktiven
//     Ort je Nutzer — eine Kopie darf die eigene Auswahl anderer nicht kippen.
//   · INSERT OR IGNORE gegen UNIQUE(user_id, latitude, longitude): ein Ort, den
//     jemand schon hat, wird nicht überschrieben. Sein Name und sein
//     last_used_at bleiben seine.
//   · Beim Zusammenlegen zweier Koordinaten (MERGE) wird zuerst die neue Zeile
//     angelegt und erst danach die alte gelöscht — und ein aktiver alter Ort
//     gibt sein is_active an den Nachfolger weiter, sonst verliert jemand
//     stillschweigend seine gemerkte Auswahl.
// ============================================================================
import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

// Zwei Ammersee-Eching-Einträge lagen 100 m auseinander; der ältere, ohne
// Leerzeichen geschriebene wird aufgelöst. Auf Wunsch (08.11.2026) auch im
// Quellkonto.
const MERGE = [{ from: [48.061, 11.1207], to: [48.0619, 11.1207] }];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');
const srcEmail = process.argv.find(a => !a.startsWith('--') && a.includes('@'));
if (!srcEmail) {
  console.error('Aufruf: node tools/locations-spread.mjs <quell-email> [--apply]');
  process.exit(1);
}

const db = new Database(process.env.WINDFOIL_DB_PATH || join(root, 'data', 'windfoil.db'),
                        { readonly: !apply });
const key = (lat, lon) => `${lat},${lon}`;
const mergedAway = new Set(MERGE.map(m => key(...m.from)));

const src = db.prepare('SELECT id, email FROM user WHERE email = ?').get(srcEmail);
if (!src) { console.error(`Kein Konto ${srcEmail}`); process.exit(1); }

const all = db.prepare(
  'SELECT name, latitude, longitude, created_at FROM user_locations WHERE user_id = ? ORDER BY rowid'
).all(src.id);
// Die aufzulösende Koordinate wird nicht verteilt — sie würde direkt danach
// wieder gelöscht.
const source = all.filter(s => !mergedAway.has(key(s.latitude, s.longitude)));
const users = db.prepare('SELECT id, email FROM user ORDER BY email').all();

console.log(`Quelle: ${src.email} — ${all.length} Orte, davon ${source.length} zum Verteilen`);
for (const m of MERGE) console.log(`Zusammenlegen: ${m.from.join(', ')} → ${m.to.join(', ')}`);
console.log(apply ? '\nMODUS: SCHREIBEN\n' : '\nMODUS: Trockenlauf (--apply zum Schreiben)\n');

const rowsOf = db.prepare('SELECT id, name, latitude, longitude, is_active FROM user_locations WHERE user_id = ?');
const insert = db.prepare(`INSERT OR IGNORE INTO user_locations
  (id, user_id, name, latitude, longitude, is_active, last_used_at, created_at)
  VALUES (?,?,?,?,?,0,?,?)`);
const setActive = db.prepare('UPDATE user_locations SET is_active = 1 WHERE id = ?');
const drop = db.prepare('DELETE FROM user_locations WHERE id = ?');

const now = new Date().toISOString();
let added = 0, removed = 0, moved = 0;

const run = db.transaction(() => {
  for (const u of users) {
    const isSource = u.id === src.id;
    const have = new Map(rowsOf.all(u.id).map(r => [key(r.latitude, r.longitude), r]));
    const missing = isSource ? [] : source.filter(s => !have.has(key(s.latitude, s.longitude)));

    for (const m of missing) {
      // last_used_at = jetzt, damit der Ort in „kürzlich" auftaucht und nicht
      // unsichtbar hinten einsortiert wird. created_at bleibt das Original.
      if (apply) insert.run(randomUUID(), u.id, m.name, m.latitude, m.longitude, now, m.created_at);
      added++;
    }

    const merges = [];
    for (const m of MERGE) {
      const old = have.get(key(...m.from));
      if (!old) continue;
      merges.push(old.name);
      if (old.is_active) {
        // Der Nachfolger existiert jetzt sicher: entweder hatte der Nutzer ihn
        // schon, oder er wurde oben eingefügt.
        const heir = have.get(key(...m.to))
          ?? rowsOf.all(u.id).find(r => key(r.latitude, r.longitude) === key(...m.to));
        if (heir && apply) setActive.run(heir.id);
        if (heir) moved++;
      }
      if (apply) drop.run(old.id);
      removed++;
    }

    const parts = [];
    if (missing.length) parts.push(`+${missing.length} (${missing.map(m => m.name).join(', ')})`);
    if (merges.length) parts.push(`−${merges.length} (${merges.join(', ')})`);
    console.log(`  ${u.email}${isSource ? ' [Quelle]' : ''}: ${parts.join('  ') || 'unverändert'}`);
  }
});
run();

console.log(`\n${apply ? 'Eingefügt' : 'Einzufügen'}: ${added} · ${apply ? 'Gelöscht' : 'Zu löschen'}: ${removed}`
  + ` · aktive Auswahl übertragen: ${moved}`);

if (apply) {
  const n = db.prepare('SELECT COUNT(*) c FROM user_locations').get().c;
  const multi = db.prepare('SELECT user_id FROM user_locations WHERE is_active = 1 GROUP BY user_id HAVING COUNT(*) > 1').all();
  const none = db.prepare('SELECT id FROM user WHERE id NOT IN (SELECT user_id FROM user_locations)').all();
  console.log(`user_locations jetzt: ${n} Zeilen`);
  console.log(multi.length ? `WARNUNG: ${multi.length} Konten mit mehreren aktiven Orten` : 'Aktive Orte: eindeutig');
  console.log(none.length ? `Hinweis: ${none.length} Konten ohne Orte` : 'Jedes Konto hat Orte');
}
