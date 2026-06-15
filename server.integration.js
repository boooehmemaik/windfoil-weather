// ============================================================================
// WindFoil — Server integration reference
// File version: 1.1.0  |  App target: v2.5.0
// ----------------------------------------------------------------------------
// This is NOT a new server — it shows how to MERGE auth + all v2.5.0 API routes
// into your existing Node proxy (the one holding the Weatherbit token). The
// ORDER of the middleware below is the part that bites people; copy it exactly.
// ============================================================================
import express from 'express';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './auth.js';
import { requireAuth } from './auth.middleware.js';
import { runMigrations } from './db.js';
import { feedbackRouter } from './feedback.routes.js';
import { profileRouter } from './profile.routes.js';
import { equipmentRouter } from './equipment.routes.js';
import { analyticsRouter } from './analytics.routes.js';

const app = express();

// 1) Apply domain migrations on boot. (Run `npx @better-auth/cli migrate` and
//    `node db/seed.mjs` once beforehand — see INSTALL.md.)
runMigrations();

// 2) CRITICAL ORDER: mount the Better Auth catch-all BEFORE express.json().
//    toNodeHandler reads the raw body itself; a json parser in front would
//    consume the stream and auth requests would hang/fail.
//    Express v5 wildcard syntax shown; for Express v4 use '/api/auth/*'.
app.all('/api/auth/*splat', toNodeHandler(auth));

// 3) NOW the json parser, for all the normal API routes.
app.use(express.json());

// 4) Existing routes stay as they are, e.g.:
//    app.use('/api/weather', weatherProxyRouter);   // your Weatherbit proxy

// 5) v2.5.0 API — all behind requireAuth.
app.use('/api/feedback',  requireAuth, feedbackRouter);
app.use('/api/profile',   requireAuth, profileRouter);
app.use('/api/equipment', requireAuth, equipmentRouter);
app.use('/api/analytics', requireAuth, analyticsRouter);

// 6) Static frontend (app-react-local.html + local vendor libs) as before.
//    app.use(express.static('public'));

const PORT = process.env.PORT || 8505;
app.listen(PORT, () => console.log(`WindFoil v2.5.0 listening on :${PORT}`));
