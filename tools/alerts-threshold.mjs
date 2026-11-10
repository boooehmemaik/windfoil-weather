// ============================================================================
// WindFoil — Score-Schwelle bestehender Alarm-Regeln setzen
// ----------------------------------------------------------------------------
// DEFAULT_MIN_SCORE gilt nur für NEUE Regeln. Schon gespeicherte Regeln tragen
// ihren damaligen Wert in der Spalte min_score und bleiben davon unberührt —
// deshalb dieses Werkzeug.
//
// Standardmäßig TROCKENLAUF. Erst `--apply` schreibt.
//
//   node tools/alerts-threshold.mjs 40
//   node tools/alerts-threshold.mjs 40 --apply
// ============================================================================
import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');
const target = Number(process.argv.find(a => /^\d+$/.test(a)));

if (!Number.isInteger(target) || target < 1 || target > 100) {
  console.error('Aufruf: node tools/alerts-threshold.mjs <1..100> [--apply]');
  process.exit(1);
}

const db = new Database(process.env.WINDFOIL_DB_PATH || join(root, 'data', 'windfoil.db'),
                        { readonly: !apply });

const rows = db.prepare(`
  SELECT a.rowid AS rid, a.user_id, a.spot_id, a.min_score, u.email
  FROM wind_alerts a LEFT JOIN user u ON u.id = a.user_id
  ORDER BY u.email, a.spot_id`).all();

console.log(`Ziel-Schwelle: ${target}`);
console.log(apply ? '\nMODUS: SCHREIBEN\n' : '\nMODUS: Trockenlauf (--apply zum Schreiben)\n');

const update = db.prepare('UPDATE wind_alerts SET min_score = ? WHERE rowid = ?');
let changed = 0;

db.transaction(() => {
  for (const r of rows) {
    const same = r.min_score === target;
    console.log(`  ${r.email || r.user_id}  ${r.spot_id}  ${r.min_score}`
      + (same ? '  (unverändert)' : ` → ${target}`));
    if (same) continue;
    if (apply) update.run(target, r.rid);
    changed++;
  }
})();

console.log(`\n${rows.length} Regel(n), ${apply ? 'geändert' : 'zu ändern'}: ${changed}`);
