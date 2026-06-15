// ============================================================================
// WindFoil — Better Auth schema migration (programmatic, no CLI)
// File version: 1.0.0  |  App target: v2.5.0
// Run:  node db/auth-migrate.mjs
// ----------------------------------------------------------------------------
// Creates Better Auth's tables (user, session, account, verification) directly
// from our auth instance — avoiding the CLI's config auto-discovery, which
// trips over .mjs configs in a CommonJS project. Works with the built-in
// Kysely adapter (our SQLite setup). Idempotent.
// ============================================================================
import { auth } from '../src/auth.mjs';

// The export path moved across versions; try the current one, then the fallback.
let getMigrations;
try { ({ getMigrations } = await import('better-auth/db/migration')); }
catch { ({ getMigrations } = await import('better-auth/db')); }

const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);

if (toBeCreated.length || toBeAdded.length) {
  await runMigrations();
  console.log(`[auth-migrate] applied: ${toBeCreated.length} table(s) created, `
    + `${toBeAdded.length} column group(s) added`);
} else {
  console.log('[auth-migrate] Better Auth schema already up to date');
}
process.exit(0);
