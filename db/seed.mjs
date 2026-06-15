// ============================================================================
// WindFoil — Seed (production, better-sqlite3)
// File version: 1.0.0  |  App target: v3.3.5
// Run once after migrations:  node db/seed.mjs
// Idempotent: safe to run repeatedly. Adds the shared Gialova spot (user_id NULL)
// that every rider sees by default.
// ============================================================================
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.WINDFOIL_DB_PATH || join(__dirname, '..', 'data', 'windfoil.db');

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

const GIALOVA = { name: 'Gialova / Navarino Bay', lat: 36.9485, lon: 21.6953, tz: 'Europe/Athens' };

const exists = db.prepare(
  'SELECT id FROM spots WHERE name = ? AND user_id IS NULL').get(GIALOVA.name);

if (exists) {
  console.log('[seed] Gialova spot already present:', exists.id);
} else {
  const id = randomUUID();
  db.prepare(`INSERT INTO spots (id,user_id,name,latitude,longitude,timezone,created_at)
              VALUES (?,?,?,?,?,?,?)`)
    .run(id, null, GIALOVA.name, GIALOVA.lat, GIALOVA.lon, GIALOVA.tz, new Date().toISOString());
  console.log('[seed] inserted Gialova spot:', id);
}
db.close();
