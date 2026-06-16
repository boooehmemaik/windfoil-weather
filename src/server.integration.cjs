// ============================================================================
// WindFoil — Server integration bridge (CommonJS host)
// File version: 2.1.0  |  App target: v3.6.0
// ----------------------------------------------------------------------------
// Your existing server is CommonJS; Better Auth + the v2.5.0 routers are ESM.
// CJS can load ESM only via dynamic import(), so this bridge does exactly that
// and exposes a single mountWindfoil(app) you call from your existing server.
//
// USAGE in your existing CJS entry (e.g. server.js):
//
//   const express = require('express');
//   const { mountWindfoil } = require('./src/server.integration.cjs');
//
//   (async () => {
//     const app = express();
//     await mountWindfoil(app);          // adds auth + all /api/* routes
//     // ... your existing routes (Weatherbit proxy, static files) ...
//     app.use(express.static('public'));
//     app.listen(process.env.PORT || 8505,
//       () => console.log('WindFoil v2.5.0 listening'));
//   })();
//
// IMPORTANT: do NOT add your own global express.json() — this bridge installs a
// JSON parser that deliberately SKIPS /api/auth (Better Auth reads the raw body
// itself). A global json() in front of the auth handler breaks login.
// ============================================================================
const express = require('express');

async function mountWindfoil(app) {
  const [
    { auth },
    { toNodeHandler },
    { requireAuth },
    { runMigrations },
    { feedbackRouter },
    { profileRouter },
    { equipmentRouter },
    { analyticsRouter },
    { locationRouter },
    { prefsRouter },
  ] = await Promise.all([
    import('./auth.mjs'),
    import('better-auth/node'),
    import('./auth.middleware.mjs'),
    import('./db.mjs'),
    import('./feedback.routes.mjs'),
    import('./profile.routes.mjs'),
    import('./equipment.routes.mjs'),
    import('./analytics.routes.mjs'),
    import('./locations.routes.mjs'),
    import('./prefs.routes.mjs'),
  ]);

  // Domain migrations on boot (Better Auth tables are created by the CLI/deploy).
  runMigrations();

  // JSON for everything EXCEPT the auth routes. This decouples us from
  // registration order — the auth body stream is never consumed.
  const json = express.json();
  app.use((req, res, next) =>
    req.path.startsWith('/api/auth') ? next() : json(req, res, next));

  // Better Auth handler (Express v4 wildcard).
  app.all('/api/auth/*', toNodeHandler(auth));

  // v2.5.0 API — all behind requireAuth.
  app.use('/api/feedback',  requireAuth, feedbackRouter);
  app.use('/api/profile',   requireAuth, profileRouter);
  app.use('/api/equipment', requireAuth, equipmentRouter);
  app.use('/api/analytics', requireAuth, analyticsRouter);
  app.use('/api/locations', requireAuth, locationRouter);
  app.use('/api/prefs',     requireAuth, prefsRouter);

  return app;
}

module.exports = { mountWindfoil };
