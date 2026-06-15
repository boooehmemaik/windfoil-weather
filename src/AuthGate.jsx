// ============================================================================
// WindFoil — Auth gate (login / signup / signout)
// File version: 1.0.0  |  App target: v3.3.5
// ----------------------------------------------------------------------------
// Wrap your dashboard:   <AuthGate><Dashboard /></AuthGate>
// Signed out  -> shows the login/create-account card.
// Signed in   -> renders children plus a slim header (email + sign out).
//
// NOTE: imports better-auth/react, so this renders inside your app, not in the
// artifact preview. Visual language matches SessionFeedback.jsx.
// ============================================================================
import React, { useState } from 'react';
import { authClient, useSession } from './auth-client.js';

const STYLES = `
.wf-auth{--deep:#0C2A30;--panel:#123A41;--panel-2:#0F333A;--foam:#EAF2EE;
  --haze:#7FA6AC;--line:rgba(234,242,238,.10);--lift:#34D399;--coral:#FF6B5C;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--foam);}
.wf-auth-screen{min-height:100vh;display:grid;place-items:center;
  background:radial-gradient(120% 90% at 50% -10%,#10434C,#071e23);padding:20px;}
.wf-auth-card{width:100%;max-width:380px;background:var(--deep);
  border:1px solid var(--line);border-radius:18px;padding:26px;
  box-shadow:0 30px 70px -30px rgba(0,0,0,.75);}
.wf-auth-brand{font-size:11px;letter-spacing:.2em;text-transform:uppercase;
  color:var(--lift);font-weight:700;}
.wf-auth-title{font-size:21px;font-weight:680;margin:6px 0 2px;}
.wf-auth-sub{font-size:13px;color:var(--haze);margin:0 0 20px;}
.wf-tabs{display:flex;gap:6px;background:var(--panel-2);padding:4px;
  border-radius:11px;margin-bottom:18px;}
.wf-tabs button{flex:1;padding:9px;border:none;border-radius:8px;cursor:pointer;
  background:transparent;color:var(--haze);font-weight:600;font-size:13px;}
.wf-tabs button[aria-selected="true"]{background:var(--panel);color:var(--foam);}
.wf-field{margin-bottom:12px;}
.wf-field label{display:block;font-size:12px;color:var(--haze);margin-bottom:6px;}
.wf-auth input{width:100%;box-sizing:border-box;background:var(--panel-2);
  color:var(--foam);border:1px solid var(--line);border-radius:10px;
  padding:11px 12px;font-size:14px;}
.wf-auth input:focus,.wf-auth button:focus-visible{outline:2px solid var(--lift);
  outline-offset:2px;}
.wf-auth-submit{width:100%;margin-top:6px;padding:13px;border:none;
  border-radius:11px;cursor:pointer;background:var(--lift);color:#05221B;
  font-weight:700;font-size:14px;}
.wf-auth-submit:disabled{opacity:.5;cursor:not-allowed;}
.wf-auth-err{color:var(--coral);font-size:13px;margin:0 0 12px;}
.wf-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:10px 16px;background:var(--deep);border-bottom:1px solid var(--line);}
.wf-bar-id{font-size:13px;color:var(--haze);}
.wf-bar-id b{color:var(--foam);font-weight:600;}
.wf-bar button{padding:7px 13px;border-radius:9px;cursor:pointer;
  border:1px solid var(--line);background:transparent;color:var(--foam);
  font-size:13px;font-weight:600;}
.wf-bar button:hover{border-color:var(--coral);color:var(--coral);}
`;

export default function AuthGate({ children }) {
  const { data: session, isPending } = useSession();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setError(''); setBusy(true);
    try {
      const fn = mode === 'signup'
        ? authClient.signUp.email({ name, email, password })
        : authClient.signIn.email({ email, password });
      const { error: err } = await fn;
      if (err) setError(err.message || 'That didn\u2019t work \u2014 check your details.');
    } catch {
      setError('Couldn\u2019t reach the server. Try again.');
    } finally { setBusy(false); }
  }

  if (isPending) {
    return (<><style>{STYLES}</style>
      <div className="wf-auth"><div className="wf-auth-screen">
        <p style={{ color: '#7FA6AC' }}>Checking your session\u2026</p>
      </div></div></>);
  }

  // ---- signed in: slim header + the app ----
  if (session?.user) {
    return (<><style>{STYLES}</style>
      <div className="wf-auth">
        <div className="wf-bar">
          <span className="wf-bar-id">Signed in as <b>{session.user.email}</b></span>
          <button type="button" onClick={() => authClient.signOut()}>Sign out</button>
        </div>
        {children}
      </div></>);
  }

  // ---- signed out: login / create account ----
  return (<><style>{STYLES}</style>
    <div className="wf-auth"><div className="wf-auth-screen">
      <div className="wf-auth-card">
        <div className="wf-auth-brand">WindFoil</div>
        <h1 className="wf-auth-title">
          {mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
        <p className="wf-auth-sub">
          {mode === 'signup'
            ? 'Track your sessions and sharpen your scores.'
            : 'Sign in to log sessions and see your spot.'}</p>

        <div className="wf-tabs" role="tablist">
          <button role="tab" aria-selected={mode === 'signin'}
            onClick={() => { setMode('signin'); setError(''); }}>Sign in</button>
          <button role="tab" aria-selected={mode === 'signup'}
            onClick={() => { setMode('signup'); setError(''); }}>Create account</button>
        </div>

        {error && <p className="wf-auth-err" role="alert">{error}</p>}

        {mode === 'signup' && (
          <div className="wf-field">
            <label htmlFor="wf-name">Name</label>
            <input id="wf-name" value={name} onChange={e => setName(e.target.value)}
              autoComplete="name" />
          </div>
        )}
        <div className="wf-field">
          <label htmlFor="wf-email">Email</label>
          <input id="wf-email" type="email" value={email}
            onChange={e => setEmail(e.target.value)} autoComplete="email" />
        </div>
        <div className="wf-field">
          <label htmlFor="wf-pw">Password</label>
          <input id="wf-pw" type="password" value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            onKeyDown={e => e.key === 'Enter' && submit()} />
        </div>

        <button className="wf-auth-submit" type="button" disabled={busy} onClick={submit}>
          {busy ? 'One moment\u2026' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
      </div>
    </div></div></>);
}
