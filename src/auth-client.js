// ============================================================================
// WindFoil — Auth client (frontend)
// File version: 1.0.0  |  App target: v3.7.0
// ----------------------------------------------------------------------------
// Used by AuthGate.jsx and anywhere the UI needs the session.
// baseURL points at the same origin the dashboard is served from; the auth
// endpoints live under /api/auth (mounted in server.integration.js).
// ============================================================================
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  // Same-origin in production; this is here so MyFritz + non-standard port work.
  baseURL: typeof window !== 'undefined' ? window.location.origin : undefined,
});

export const { signIn, signUp, signOut, useSession } = authClient;
