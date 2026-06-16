// ============================================================================
// WindFoil — Better Auth configuration
// File version: 1.0.1 (ESM .mjs)  |  App target: v3.5.0
// ----------------------------------------------------------------------------
// Install:  npm i better-auth better-sqlite3
// Better Auth OWNS its tables (user, session, account, verification) and creates
// them via its CLI — they are NOT in db/migrations/001_init.sql.
//
//   Generate/apply Better Auth's tables (run BEFORE seeding any domain rows):
//     npx @better-auth/cli@latest migrate
//
//   FK note: SQLite lets the domain tables be CREATED before `user` exists, but
//   any INSERT into them needs `user` present. So run the line above before the
//   app's runMigrations() is first used to write data.
//
// Secrets live in windfoil.env (same file as the Weatherbit token):
//   BETTER_AUTH_SECRET=<openssl rand -base64 32>
//   BETTER_AUTH_URL=https://ik3acymjxllpensn.myfritz.net:8505
// ============================================================================
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.WINDFOIL_DB_PATH || join(__dirname, '..', 'data', 'windfoil.db');

// Same database file as src/db.js. WAL mode (set in db.js) keeps the two
// connections happy. Better Auth uses Kysely under the hood here.
const authDb = new Database(DB_PATH);

// Account enable/disable lives on a custom `disabled` flag on Better Auth's
// `user` table. Added defensively so it exists for both the sign-in hook below
// and the admin user-management endpoints. No-op once the column is present.
try { authDb.exec('ALTER TABLE user ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0'); }
catch { /* column already exists */ }

export const auth = betterAuth({
  database: authDb,

  emailAndPassword: {
    enabled: true,
    // For a small friends/beta circle, skip mandatory email verification for
    // now; flip to true once you wire an outbound mailer.
    requireEmailVerification: false,
    minPasswordLength: 10,
  },

  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,

  // The app is reachable via MyFritz on a non-standard port and self-signed SSL.
  // List every origin allowed to call the auth endpoints.
  trustedOrigins: [
    'https://ik3acymjxllpensn.myfritz.net:8505',
    'https://192.168.99.113:8505',
    'http://localhost:5173',
  ],

  // Cookies for the web dashboard now; bearer tokens can be added later for a
  // mobile view via tokenTransport: 'both'.
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24,      // refresh once per day of activity
  },

  // Block sign-in for disabled accounts: refuse to create their session. Admins
  // disable users via /api/admin/users/set-disabled (and existing sessions are
  // cleared there), so this closes the re-login path too.
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          try {
            const row = authDb.prepare('SELECT disabled FROM user WHERE id = ?')
              .get(session.userId);
            if (row && row.disabled) {
              throw new APIError('FORBIDDEN', { message: 'Dieses Konto ist gesperrt.' });
            }
          } catch (e) {
            if (e instanceof APIError) throw e;
            /* column/table not ready — fail open */
          }
          return { data: session };
        },
      },
    },
  },
});
