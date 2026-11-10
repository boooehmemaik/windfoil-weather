// ============================================================================
// WindFoil — Fahrerprofile und Quiver aus den Prefs lesen (nur Lesen)
// ----------------------------------------------------------------------------
// Das Profil liegt nicht in einer eigenen Tabelle, sondern als Pref-Eintrag
// wf_rider / wf_gear / wf_usegear. Wer wissen will, mit welchem Gewicht ein
// Nutzer tatsächlich bewertet wird, muss hier nachsehen.
//
//   node tools/rider-report.mjs
//   node tools/rider-report.mjs <email>
// ============================================================================
import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv[2];

const db = new Database(process.env.WINDFOIL_DB_PATH || join(root, 'data', 'windfoil.db'),
                        { readonly: true });

const KEYS = ['wf_rider', 'wf_gear', 'wf_usegear'];

const rows = db.prepare(`
  SELECT u.email, p.key, p.value
  FROM user_prefs p JOIN user u ON u.id = p.user_id
  WHERE p.key IN (${KEYS.map(() => '?').join(',')})
  ORDER BY u.email, p.key`).all(...KEYS);

const byUser = new Map();
for (const r of rows) {
  if (only && r.email !== only) continue;
  if (!byUser.has(r.email)) byUser.set(r.email, {});
  try { byUser.get(r.email)[r.key] = JSON.parse(r.value); }
  catch { byUser.get(r.email)[r.key] = r.value; }
}

if (!byUser.size) { console.log(only ? `keine Prefs für ${only}` : 'keine Profile gespeichert'); process.exit(0); }

for (const [email, p] of byUser) {
  const r = p.wf_rider || {};
  console.log(`\n${email}`);
  console.log(`  Gewicht ${r.weight ?? '—'} kg · Wing ${r.wingSize ?? '—'} m² · ${r.skill ?? '—'}`
    + (r.planeKn ? ` · Angleitschwelle ${r.planeKn} kn` : ''));
  const gear = Array.isArray(p.wf_gear) ? p.wf_gear : [];
  console.log(`  Quiver: ${gear.length ? gear.map(g => `${g.wing} m²`).join(', ') : '— leer, es gilt die eine Wing-Größe —'}`);
  console.log(`  useGear: ${p.wf_usegear === true ? 'an' : 'aus'}`);
}
