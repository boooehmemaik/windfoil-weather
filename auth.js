// ============================================================================
// WindFoil — Better Auth configuration
// File version: 1.0.0  |  App target: v2.5.0
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
import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.WINDFOIL_DB_PATH || join(__dirname, '..', 'data', 'windfoil.db');

export const auth = betterAuth({
  // Same database file as src/db.js. WAL mode (set in db.js) keeps the two
  // connections happy. Better Auth uses Kysely under the hood here.
  database: new Database(DB_PATH),

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
});
