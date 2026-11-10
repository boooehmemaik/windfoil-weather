// ============================================================================
// WindFoil — Bestandsaufnahme: wer hat welche Orte?
// ----------------------------------------------------------------------------
// Nur lesend. Grundlage für das Verteilen der eigenen Orte auf alle Konten.
//
//   node tools/locations-report.mjs [quell-email]
// ============================================================================
import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = new Database(process.env.WINDFOIL_DB_PATH || join(root, 'data', 'windfoil.db'),
                        { readonly: true });

console.log('── Schema ────────────────────────────────────────────────────');
console.log(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'user_locations'").get().sql);

const users = db.prepare('SELECT id, email FROM user ORDER BY email').all();
const byUser = db.prepare('SELECT COUNT(*) AS n FROM user_locations WHERE user_id = ?');

console.log('\n── Orte je Konto ─────────────────────────────────────────────');
for (const u of users) {
  console.log(`  ${String(byUser.get(u.id).n).padStart(3)}  ${u.email}`);
}

const src = process.argv[2];
if (src) {
  const u = users.find(x => x.email === src);
  if (!u) { console.log(`\nKein Konto ${src}`); process.exit(1); }
  console.log(`\n── Orte von ${src} ───────────────────────────────────────`);
  for (const r of db.prepare('SELECT * FROM user_locations WHERE user_id = ? ORDER BY rowid').all(u.id)) {
    const { user_id, ...rest } = r;
    console.log('  ' + JSON.stringify(rest));
  }
}
