// ============================================================================
// WindFoil — konsistentes Backup der laufenden SQLite-Datenbank
// ----------------------------------------------------------------------------
// Kein `cp`: der Dienst schreibt weiter, und eine Dateikopie mitten in einer
// Transaktion ist unbrauchbar. SQLites Online-Backup-API kopiert einen
// konsistenten Stand, während der Server läuft.
//
//   node tools/db-backup.mjs            → data/backups/windfoil-<ISO>.db
// ============================================================================
import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, statSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcPath = process.env.WINDFOIL_DB_PATH || join(root, 'data', 'windfoil.db');
const dir = join(root, 'data', 'backups');
mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dest = join(dir, `windfoil-${stamp}.db`);

const db = new Database(srcPath, { readonly: true });
await db.backup(dest);
db.close();

const mb = n => (n / 1048576).toFixed(1) + ' MB';
console.log(`Quelle:  ${srcPath}  ${mb(statSync(srcPath).size)}`);
console.log(`Backup:  ${dest}  ${mb(statSync(dest).size)}`);

// Gegenprobe: ein Backup, das SQLite nicht öffnen kann, ist keins.
const check = new Database(dest, { readonly: true });
const rows = check.prepare('SELECT COUNT(*) c FROM user_locations').get().c;
const integrity = check.pragma('integrity_check', { simple: true });
check.close();
console.log(`Prüfung: integrity_check=${integrity} · user_locations=${rows} Zeilen`);
