// ============================================================================
// WindFoil — Auth middleware
// File version: 1.0.1 (ESM .mjs)  |  App target: v3.7.0
// ----------------------------------------------------------------------------
// requireAuth resolves the Better Auth session from the incoming request and
// puts the user on req.user (what feedback.routes.js expects). 401 if absent.
// ============================================================================
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from './auth.mjs';
import { db } from './db.mjs';

export async function requireAuth(req, res, next) {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) {
      return res.status(401).json({ error: 'unauthenticated' });
    }
    // Disabled accounts keep their cookie but lose all data access.
    try {
      const row = db.prepare('SELECT disabled FROM user WHERE id = ?').get(session.user.id);
      if (row && row.disabled) {
        return res.status(403).json({ error: 'account_disabled' });
      }
    } catch { /* disabled column not present yet — allow */ }
    req.user = session.user;     // { id, email, name, ... }
    req.session = session.session;
    next();
  } catch (err) {
    next(err);
  }
}

// Optional variant: attaches req.user if present but never blocks. Useful for
// endpoints that show more when logged in but still work for guests.
export async function withOptionalAuth(req, _res, next) {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (session?.user) { req.user = session.user; req.session = session.session; }
  } catch { /* ignore — treat as guest */ }
  next();
}
