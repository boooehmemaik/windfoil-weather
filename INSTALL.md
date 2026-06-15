# WindFoil Weather Intelligence — v2.5.0 Installation & Deployment

> Doc version: 1.0.0 · Target: Ubuntu 24.04 LXC (`1p-WindBot-ubuLXC`, `192.168.99.113`) · Node 22+

This release adds **user management (Better Auth)**, the **post-session feedback loop**,
a **SQLite database**, **profile/equipment/analytics endpoints**, and the **score-drift chart**.

---

## 1. What's new in this release

| Area | Files (all v1.0.0 unless noted) |
|------|------|
| Database | `db/migrations/001_init.sql`, `src/db.js`, `db/seed.mjs` |
| Auth (backend) | `src/auth.js`, `src/auth.middleware.js` |
| API routes | `src/feedback.routes.js`, `src/profile.routes.js`, `src/equipment.routes.js`, `src/analytics.routes.js` |
| Server wiring | `src/server.integration.js` (v1.1.0) |
| Auth (frontend) | `src/auth-client.js`, `src/AuthGate.jsx` |
| Feedback UI | `src/SessionFeedback.jsx` |
| Analytics UI | `src/DriftChart.jsx` |
| Tests | `db/schema.test.mjs`, `db/routes.test.mjs` |

---

## 2. Prerequisites

- Node.js 22+ (`node --version`)
- The existing WindFoil app + its `windfoil.env` (holds the Weatherbit token)
- Build tools for the native SQLite module: `sudo apt-get install -y build-essential python3`

---

## 3. Install dependencies

```bash
cd /path/to/windfoil
npm i better-auth better-sqlite3 express
npm i -D @better-auth/cli esbuild        # CLI for auth tables, esbuild for the client bundle
```

---

## 4. Directory layout

```
windfoil/
├── data/                       # SQLite file lives here (created on first run)
│   └── windfoil.db
├── db/
│   ├── migrations/001_init.sql
│   ├── seed.mjs
│   ├── schema.test.mjs
│   └── routes.test.mjs
├── src/
│   ├── auth.js  auth.middleware.js  auth-client.js
│   ├── db.js
│   ├── feedback.routes.js  profile.routes.js  equipment.routes.js  analytics.routes.js
│   ├── server.integration.js
│   ├── AuthGate.jsx  SessionFeedback.jsx  DriftChart.jsx
└── public/                     # your existing frontend (app-react-local.html + vendor libs)
```

```bash
mkdir -p data
```

---

## 5. Secrets — add to `windfoil.env`

```bash
BETTER_AUTH_SECRET=$(openssl rand -base64 32)     # paste the generated value
BETTER_AUTH_URL=https://ik3acymjxllpensn.myfritz.net:8505
WINDFOIL_DB_PATH=/path/to/windfoil/data/windfoil.db
```

Keep file permissions tight: `chmod 600 windfoil.env`.

---

## 6. Create the database (ORDER MATTERS)

SQLite checks foreign keys at INSERT time, not at table creation — but the cleanest
order is auth tables first, then domain tables, then seed.

```bash
# 6a. Better Auth creates its own tables: user, session, account, verification
npx @better-auth/cli@latest migrate          # reads src/auth.js for the DB path

# 6b. Domain tables (sessions, feedback, equipment, entitlements, …)
#     runMigrations() also runs automatically on server boot; this is just to do it now:
node -e "import('./src/db.js').then(m => m.runMigrations())"

# 6c. Seed the shared Gialova spot
node db/seed.mjs
```

Verify (optional): `sqlite3 data/windfoil.db ".tables"` should list both auth and domain tables.

---

## 7. Wire into your existing server

`src/server.integration.js` is a **reference** — copy its structure into your current
Node proxy. The two things that must be exact:

1. **Mount the Better Auth catch-all _before_ `express.json()`.** The handler reads the
   raw body; a JSON parser in front of it breaks login.
2. Mount every v2.5.0 router behind `requireAuth`:

```js
app.all('/api/auth/*splat', toNodeHandler(auth));   // Express v5 syntax; v4: '/api/auth/*'
app.use(express.json());
app.use('/api/weather',   weatherProxyRouter);       // your existing Weatherbit proxy
app.use('/api/feedback',  requireAuth, feedbackRouter);
app.use('/api/profile',   requireAuth, profileRouter);
app.use('/api/equipment', requireAuth, equipmentRouter);
app.use('/api/analytics', requireAuth, analyticsRouter);
```

---

## 8. Frontend integration

### 8a. The one wrinkle: bundling the auth client (stay CDN-free)

`auth-client.js` / `AuthGate.jsx` import `better-auth/react`, which is an npm ESM
module — unlike React/Recharts it has no browser-global build, so your Babel-in-browser
setup can't load it from a bare import. Bundle it **once** into a local vendor file
(no CDN, fully self-hosted):

```bash
npx esbuild src/auth-client.js \
  --bundle --format=esm \
  --outfile=public/vendor/auth-client.bundle.js
```

Then in your HTML import map (or however you already reference local vendor libs), point
`better-auth/react` usage at the bundle. *Alternative with zero bundler:* skip the client
library and call Better Auth's REST endpoints directly with `fetch`
(`POST /api/auth/sign-in/email`, `/sign-up/email`, `/sign-out`, `GET /api/auth/get-session`) —
say the word and I'll hand you a ~30-line `auth-client` that needs no build step.

### 8b. Gate the dashboard

Wrap your existing dashboard root in `AuthGate`:

```jsx
import AuthGate from './AuthGate.jsx';

root.render(
  <AuthGate>
    <Dashboard />     {/* your existing app */}
  </AuthGate>
);
```

Signed out → login/create-account card. Signed in → slim header (email + sign out) + app.

### 8c. Add the feedback form + drift chart

Inside the dashboard, render the feedback form for the **currently selected day**
(pass `isToday` so it locks on non-today views) and feed it the forecast snapshot
that's on screen:

```jsx
<SessionFeedback
  demo={false}
  spotId={spot.id} spotName={spot.name} timezone={spot.timezone}
  isToday={selectedDayIsToday}
  equipment={equipmentFromApi}
  currentForecast={{ source:'foil-score', predictedScore, predictedWindKt,
                     windowStart, windowEnd, stationModelConfidence }}
  onAcceptCalibration={async (kt) => {
    await fetch('/api/profile/threshold', { method:'PATCH', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ planingThresholdKt: kt, source:'calibrated' }) });
  }}
/>
```

```jsx
const { series, meanAbsWindErrorKt } = await fetch(
  `/api/analytics/drift?spot=${spot.id}`, { credentials:'include' }).then(r => r.json());
<DriftChart data={series} mae={meanAbsWindErrorKt} thresholdKt={profile.planing_threshold_kt} />
```

> `DriftChart.jsx` imports from `recharts` — since you already serve Recharts locally,
> adapt the import to your global the same way you do in the rest of the app.

---

## 9. Restart the service

```bash
sudo systemctl restart windfoil       # your existing systemd unit
journalctl -u windfoil -f             # watch for "WindFoil v2.5.0 listening on :8505"
```

No nginx/SSL changes needed — the self-signed cert and MyFritz port mapping are unchanged.

---

## 10. Smoke test

```bash
BASE=https://ik3acymjxllpensn.myfritz.net:8505

# create an account
curl -k -c jar.txt -X POST $BASE/api/auth/sign-up/email \
  -H 'Content-Type: application/json' \
  -d '{"name":"Maik","email":"maik@example.com","password":"<10+ chars>"}'

# session check (uses the cookie jar)
curl -k -b jar.txt $BASE/api/auth/get-session

# log today's feedback (spot id from: sqlite3 data/windfoil.db "SELECT id FROM spots;")
curl -k -b jar.txt -X POST $BASE/api/feedback \
  -H 'Content-Type: application/json' \
  -d '{"spotId":"<gialova-id>","planed":true,"planingWindKt":11.5,"rating":4}'
```

`-k` accepts the self-signed cert. A successful feedback POST returns
`{ ok:true, sessionId, calibration:{ rolling, samples, applied } }`.

Run the offline logic tests anytime:

```bash
node --experimental-sqlite db/schema.test.mjs
node --experimental-sqlite db/routes.test.mjs
```

---

## 11. Backup

The whole app state is one file. With WAL enabled, back it up with the SQLite backup
command (don't just `cp` a live WAL DB):

```bash
sqlite3 data/windfoil.db ".backup '/backups/windfoil-$(date +%F).db'"
```

Add to cron and you're covered. When you outgrow SQLite (commercial scale), the same
schema migrates to Postgres — change only the adapter in `db.js` and `auth.js`.

---

## 12. Commercial groundwork (dormant)

The `entitlements` table and the `/api/feedback/forecast` gate are already in place but
inactive. When you add per-feature payments later: pick a Merchant-of-Record (Paddle is
the most mature for EU VAT), point its webhook at a new `/api/billing/webhook` route that
upserts `entitlements`, and the existing `hasEntitlement()` check unlocks features
server-side. No schema change required.
