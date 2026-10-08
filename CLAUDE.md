# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run the server (dev)
node proxy-server.js

# Run all tests
node --test

# Run a single test file
node --test mos.test.mjs

# Deploy to production (always use the deploy agent, never inline)
./deploy.sh
```

Tests use Node's built-in `node:test` runner (v22). No build step for the frontend — `index.html` is deployed as-is.

## Architecture

### Two-tier: single-file frontend + CJS Express backend

**`index.html`** — the entire React app in one file. Babel runs in-browser (no build step). All UI components, scoring logic, charts (Recharts), and API calls live here. This is the production frontend; ignore `app-react.html` and `WindFoilApp.jsx` (legacy).

**`proxy-server.js`** — the Express backend (CommonJS). Holds API keys, runs the 10-min observation poller, owns all `/api/*` routes. Loaded with `require("./src/server.integration.cjs")` which bridges CJS → ESM for Better Auth and the domain routes.

### CJS/ESM bridge

`proxy-server.js` is CommonJS. All `src/*.mjs` and `src/*.routes.mjs` files are ESM. `src/server.integration.cjs` dynamic-imports the ESM modules and mounts them onto the Express app. **Do not add a global `express.json()` before the auth handler** — Better Auth reads the raw body itself.

### Database

Single SQLite file (`data/windfoil.db`, path via `WINDFOIL_DB_PATH`). Two separate handles:
- **`getObsDb()`** — WAL handle for `station_obs`, `ml_samples`, `forecast_archive`, `app_meta`. Opened lazily in `proxy-server.js`.
- **`getAdminDb()`** — WAL handle for Better Auth tables (`user`, `account`, `session`). Also in `proxy-server.js`.
- **`src/db.mjs`** — ESM handle used by domain routes (feedback, equipment, etc.).

Migrations live in `db/migrations/*.sql`, applied alphabetically by `src/db.mjs:runMigrations()`. Auth schema is applied separately via `db/auth-migrate.mjs`. Both run in `deploy.sh`.

> There are two `009_` migration files (`009_forecast_archive.sql` and `009_ml_leadtime.sql`) — both applied, sorted alphabetically.

### Station types

**`MEASURED_STATIONS`** (in `proxy-server.js`) — stations with a full hourly day series, polled via external APIs:
- `type: "addicted"` — addicted-sports / profiwetter webcam feeds
- `type: "neverin"` — Neverin/ZHMS feed (Ulcinj)
- `type: "metar"` — METAR via Open-Meteo (LGPZ Aktion, LGKL Kalamata)

**`LIVE_STATIONS`** — current-only snapshot (no day series); e.g. Talamone from velapassion.it.

### 10-minute observation poller (`pollStationObs`)

Runs every 10 min. For each station:
1. Fetches current observation → writes to `station_obs`
2. Fetches current Open-Meteo forecast → stores in `latestFcFeatures` Map
3. Writes paired obs+fc rows to `ml_samples` at lead=0, 24, and 48 h

`localPartsTZ(epochSec, tz)` returns `{ date, hour }` — **not** `{ day, hour }`. Destructuring `{ day }` silently produces `undefined` and errors are eaten by `.catch(() => {})`.

### Neural MOS (`src/neural_mos.mjs`)

MLP: 10 inputs → 16 hidden (ReLU) → 1 output. Trained every ~6 h by `runMos()`. Three separate predictions per station: lead=0, lead=24, lead=48. Weights stored in `app_meta` as JSON. Requires `NEURAL_MIN_SAMPLES = 60` rows to train. Feature 10 is `fc_lead_hours / 48`.

`thermalCorrection()` in `index.html` picks the right bias via `leadDay`: `neuralBiasMs` (day 0), `neuralBiasMs24` (day 1), `neuralBiasMs48` (day 2+).

### Auth

Better Auth handles sessions/cookies. `src/auth.middleware.mjs` exports `requireAuth` — imported dynamically in route handlers that need it. The History view (`/api/station/obs-history`) requires auth and is additionally gated to `HISTORY_EMAILS` in `index.html`.

## Key constraints

**Versioning** — version string appears in 5 places in `index.html` (title comment, header comment, changelog comment, footer div, about span) plus `VERSIONS.md`. When bumping:
- `sed -i 's/vX.Y.Z/vA.B.C/g' index.html` **also replaces the old changelog line** — always restore the old entry and add a new `// Changelog vA.B.C:` line separately.
- Add a `## vA.B.C` block to the top of `VERSIONS.md`.

**Deployment** — always via the `deploy` agent (never inline `./deploy.sh` from Claude Code directly). The deploy agent pushes, runs `deploy.sh`, restarts `windfoil-proxy`, and validates health endpoints.

**`windfoil.env`** — never commit this file. `deploy.sh` refuses to run if it appears in git. Copy from `windfoil.env.example` to set up a new host.

**Route ordering** — Express uses first-match wins. The `/api/station/obs-history` endpoint must be registered *before* any catch-all or conflicting handler. The old Weatherbit `/api/station/history` handler (requires lat/lon) is separate.

**PayPal** — the PayPal email `boehmemaik@web.de` must never appear in frontend source. The PayPal.Me link is `https://paypal.me/boehmemaik` (safe to use).

## Environment variables

| Variable | Purpose |
|---|---|
| `WEATHERBIT_KEY` | Weatherbit API key for station data |
| `WINDFOIL_DB_PATH` | Path to SQLite file (default: `data/windfoil.db`) |
| `BETTER_AUTH_SECRET` | Better Auth signing secret |
| `BETTER_AUTH_URL` | Public base URL (must match browser origin exactly) |
| `PORT` | Backend port (default: 8787) |
| `ADMIN_TOKEN` | Secures all `/api/admin/*` endpoints |
| `ADMIN_PASSWORD` | Frontend gate for the admin panel |
| `SMTP_*` | Nodemailer config for password-reset emails |
