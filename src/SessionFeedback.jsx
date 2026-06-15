// ============================================================================
// WindFoil — Post-session feedback form
// File version: 1.0.0  |  App target: v3.3.5
// ----------------------------------------------------------------------------
// Drop-in React component. In your app, render <SessionFeedback> with real
// props and set demo={false}. The default export below is a DEMO wrapper so the
// artifact preview shows Gialova data with no backend.
//
//   <SessionFeedback
//      demo={false}
//      spotId={spot.id} spotName="Gialova / Navarino Bay"
//      timezone="Europe/Athens" isToday={selectedDayIsToday}
//      equipment={equipmentList}
//      currentForecast={{ source:'foil-score', predictedScore:68,
//        predictedWindKt:12, windowStart, windowEnd, stationModelConfidence:0.82 }}
//      onAcceptCalibration={(kt)=>{/* PATCH rider profile threshold */}} />
//
// No <form> tag, no localStorage (per artifact constraints). Plain CSS scoped
// under .wf-feedback so it drops into a Babel-in-browser setup without Tailwind.
// ============================================================================
import React, { useState, useEffect, useCallback } from 'react';

const STYLES = `
.wf-feedback{
  --deep:#0C2A30; --panel:#123A41; --panel-2:#0F333A;
  --foam:#EAF2EE; --haze:#7FA6AC; --line:rgba(234,242,238,.10);
  --lift:#34D399; --lift-dim:rgba(52,211,153,.16);
  --coral:#FF6B5C; --coral-dim:rgba(255,107,92,.14);
  background:var(--deep); color:var(--foam);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  max-width:520px; margin:0 auto; padding:22px; border-radius:18px;
  border:1px solid var(--line);
  box-shadow:0 24px 60px -28px rgba(0,0,0,.7);
}
.wf-feedback *{box-sizing:border-box;}
.wf-eyebrow{font-size:11px; letter-spacing:.18em; text-transform:uppercase;
  color:var(--haze); font-weight:600;}
.wf-head{display:flex; justify-content:space-between; align-items:flex-start;
  gap:12px; margin-bottom:20px;}
.wf-spot{font-size:19px; font-weight:650; margin:3px 0 0;}
.wf-date{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:12px; color:var(--haze); text-align:right; white-space:nowrap;}
.wf-q{margin:0 0 22px;}
.wf-label{display:block; font-size:14px; font-weight:600; margin:0 0 10px;}

/* planing toggle — the signature element */
.wf-plane{display:grid; grid-template-columns:1fr 1fr; gap:10px;}
.wf-plane button{appearance:none; cursor:pointer; padding:16px 12px;
  border-radius:12px; border:1px solid var(--line); background:var(--panel-2);
  color:var(--foam); font-size:15px; font-weight:600; transition:.18s;}
.wf-plane button:hover{border-color:var(--haze);}
.wf-plane button[aria-pressed="true"].yes{
  background:var(--lift-dim); border-color:var(--lift); color:var(--lift);
  box-shadow:0 0 0 1px var(--lift), 0 0 24px -6px var(--lift);}
.wf-plane button[aria-pressed="true"].no{
  background:var(--coral-dim); border-color:var(--coral); color:var(--coral);}

/* lift-off instrument readout */
.wf-gauge{margin-top:14px; padding:18px; border-radius:12px;
  border:1px solid var(--lift); background:
   radial-gradient(120% 140% at 50% -20%, var(--lift-dim), transparent 60%), var(--panel-2);}
.wf-gauge-row{display:flex; align-items:center; justify-content:space-between; gap:14px;}
.wf-readout{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:46px; font-weight:700; line-height:1; letter-spacing:-.02em;
  font-variant-numeric:tabular-nums; color:var(--lift);
  text-shadow:0 0 22px var(--lift-dim);}
.wf-unit{font-size:15px; color:var(--haze); margin-left:6px; font-weight:600;}
.wf-step{display:flex; gap:8px;}
.wf-step button{width:44px; height:44px; border-radius:11px; cursor:pointer;
  border:1px solid var(--line); background:var(--panel); color:var(--foam);
  font-size:22px; line-height:1;}
.wf-step button:hover{border-color:var(--lift);}
.wf-hint{font-size:12px; color:var(--haze); margin-top:10px;}

/* segmented meter (rating + match) */
.wf-meter{display:flex; gap:6px;}
.wf-meter button{flex:1; height:38px; border-radius:8px; cursor:pointer;
  border:1px solid var(--line); background:var(--panel-2); transition:.14s;}
.wf-meter button:hover{border-color:var(--haze);}
.wf-meter button.on{background:var(--lift); border-color:var(--lift);}
.wf-ends{display:flex; justify-content:space-between; margin-top:7px;
  font-size:11px; color:var(--haze);}

.wf-gear{display:grid; grid-template-columns:1fr 1fr; gap:10px;}
.wf-feedback select, .wf-feedback textarea{width:100%; background:var(--panel-2);
  color:var(--foam); border:1px solid var(--line); border-radius:10px;
  padding:11px 12px; font-size:14px; font-family:inherit;}
.wf-feedback textarea{resize:vertical; min-height:74px;}
.wf-feedback select:focus, .wf-feedback textarea:focus,
.wf-feedback button:focus-visible{outline:2px solid var(--lift); outline-offset:2px;}

.wf-submit{width:100%; padding:15px; border-radius:12px; cursor:pointer;
  border:none; background:var(--lift); color:#05221B; font-size:15px;
  font-weight:700; transition:.16s;}
.wf-submit:hover{filter:brightness(1.06);}
.wf-submit:disabled{opacity:.5; cursor:not-allowed;}
.wf-error{color:var(--coral); font-size:13px; margin:0 0 14px;}

/* states */
.wf-locked, .wf-done{text-align:center; padding:30px 16px;}
.wf-done-mark{width:54px; height:54px; border-radius:50%; margin:0 auto 14px;
  display:grid; place-items:center; background:var(--lift-dim);
  border:1px solid var(--lift); color:var(--lift); font-size:26px;}
.wf-calib{margin-top:16px; padding:14px; border-radius:12px;
  background:var(--panel-2); border:1px solid var(--line); text-align:left;}
.wf-calib strong{color:var(--lift); font-family:ui-monospace,monospace;}
.wf-calib button{margin-top:10px; padding:9px 14px; border-radius:9px;
  cursor:pointer; border:1px solid var(--lift); background:transparent;
  color:var(--lift); font-weight:600; font-size:13px;}
@media (prefers-reduced-motion: reduce){ .wf-feedback *{transition:none !important;} }
@media (max-width:440px){ .wf-plane,.wf-gear{grid-template-columns:1fr;} }
`;

// --- tiny demo backend so the artifact renders without a server ---------------
function makeDemoApi() {
  let stored = null; // in-memory "today" session
  return {
    async getToday() { return { session: stored, today: demoToday() }; },
    async submit(body) {
      stored = body;
      // simulate the rolling calibration the real API returns
      return { ok: true, sessionId: 'demo-' + Date.now(),
        calibration: { rolling: 11.2, samples: 6, applied: false } }; // manual override case
    },
  };
}
const demoToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(new Date());

function Meter({ value, onChange, lowLabel, highLabel }) {
  return (
    <div>
      <div className="wf-meter" role="radiogroup">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} type="button" role="radio" aria-checked={value === n}
            aria-label={`${n} of 5`} className={value >= n && value ? 'on' : ''}
            onClick={() => onChange(n)} />
        ))}
      </div>
      <div className="wf-ends"><span>{lowLabel}</span><span>{highLabel}</span></div>
    </div>
  );
}

export function SessionFeedback({
  demo = true, spotId = 'gialova', spotName = 'Gialova / Navarino Bay',
  timezone = 'Europe/Athens', isToday = true, equipment = DEMO_EQUIPMENT,
  currentForecast = DEMO_FORECAST, apiBase = '/api/feedback',
  fetchImpl, onAcceptCalibration,
}) {
  const [planed, setPlaned] = useState(null);
  const [windKt, setWindKt] = useState(12);
  const [rating, setRating] = useState(0);
  const [match, setMatch] = useState(0);
  const [wingId, setWingId] = useState('');
  const [foilId, setFoilId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const wings = equipment.filter(e => e.kind === 'wing');
  const foils = equipment.filter(e => e.kind === 'foil');
  const api = demo ? makeDemoApi() : realApi(apiBase, fetchImpl);

  useEffect(() => {
    if (!isToday) return;
    api.getToday(spotId).then(r => {
      if (r?.session) {
        const s = r.session;
        setPlaned(s.planed === 1 || s.planed === true ? true : s.planed === 0 ? false : null);
        if (s.planing_wind_kt) setWindKt(s.planing_wind_kt);
        setRating(s.rating || 0); setMatch(s.conditions_matched || 0);
        setNotes(s.notes || ''); setWingId(s.wing_id || ''); setFoilId(s.foil_id || '');
      }
    }).catch(() => {});
  }, [isToday, spotId]); // eslint-disable-line

  const step = useCallback(d =>
    setWindKt(w => Math.min(35, Math.max(5, Math.round((w + d) * 2) / 2))), []);

  async function submit() {
    if (planed === null) { setError('Pick whether you got up on the foil first.'); return; }
    setBusy(true); setError('');
    try {
      const r = await api.submit({
        spotId, sessionDate: demo ? demoToday() : undefined,
        planed, planingWindKt: planed ? windKt : null,
        rating: rating || null, conditionsMatched: match || null,
        notes: notes.trim() || null, wingId: wingId || null, foilId: foilId || null,
        forecast: currentForecast,
      });
      setResult(r);
    } catch {
      setError("Couldn't save — check the connection and try again.");
    } finally { setBusy(false); }
  }

  const dateLabel = new Intl.DateTimeFormat('en-GB',
    { timeZone: timezone, weekday: 'short', day: '2-digit', month: 'short' }).format(new Date());

  // ---- render ----
  const shell = body => (<><style>{STYLES}</style><div className="wf-feedback">{body}</div></>);

  if (!isToday) return shell(
    <div className="wf-locked">
      <div className="wf-eyebrow">Session debrief</div>
      <p className="wf-spot" style={{ marginBottom: 8 }}>Feedback opens on the day you ride</p>
      <p style={{ color: 'var(--haze)', fontSize: 14, margin: 0 }}>
        Come back after your session at {spotName} to log how it went.</p>
    </div>);

  if (result) {
    const c = result.calibration || {};
    return shell(
      <div className="wf-done">
        <div className="wf-done-mark">✓</div>
        <p className="wf-spot" style={{ marginBottom: 4 }}>Logged for {dateLabel}</p>
        <p style={{ color: 'var(--haze)', fontSize: 14, margin: 0 }}>
          Thanks — this sharpens your scores for {spotName}.</p>
        {c.rolling != null && (
          <div className="wf-calib">
            {c.applied ? (
              <span>Calibrated. Your planing threshold is now <strong>{c.rolling} kt</strong>,
                from {c.samples} sessions.</span>
            ) : (
              <span>Your real lift-offs average <strong>{c.rolling} kt</strong> over {c.samples} sessions.
                Your threshold is set manually.
                <br />
                <button type="button"
                  onClick={() => onAcceptCalibration && onAcceptCalibration(c.rolling)}>
                  Use {c.rolling} kt</button></span>
            )}
          </div>
        )}
      </div>);
  }

  return shell(<>
    <div className="wf-head">
      <div>
        <div className="wf-eyebrow">Session debrief</div>
        <h3 className="wf-spot">{spotName}</h3>
      </div>
      <div className="wf-date">{dateLabel}</div>
    </div>

    {error && <p className="wf-error" role="alert">{error}</p>}

    <div className="wf-q">
      <span className="wf-label">Did you get up on the foil?</span>
      <div className="wf-plane">
        <button type="button" className="yes" aria-pressed={planed === true}
          onClick={() => setPlaned(true)}>Yes, planed</button>
        <button type="button" className="no" aria-pressed={planed === false}
          onClick={() => setPlaned(false)}>No plane today</button>
      </div>

      {planed === true && (
        <div className="wf-gauge">
          <div className="wf-gauge-row">
            <div>
              <span className="wf-eyebrow">Wind at lift-off</span>
              <div><span className="wf-readout">{windKt.toFixed(1)}</span>
                <span className="wf-unit">kt</span></div>
            </div>
            <div className="wf-step">
              <button type="button" aria-label="Less wind" onClick={() => step(-0.5)}>−</button>
              <button type="button" aria-label="More wind" onClick={() => step(0.5)}>+</button>
            </div>
          </div>
          <p className="wf-hint">The wind when your board first came up — this is what
            calibrates your planing threshold.</p>
        </div>
      )}
    </div>

    <div className="wf-q">
      <span className="wf-label">How was the session?</span>
      <Meter value={rating} onChange={setRating} lowLabel="Rough" highLabel="Epic" />
    </div>

    <div className="wf-q">
      <span className="wf-label">How close was the forecast?</span>
      <Meter value={match} onChange={setMatch} lowLabel="Way off" highLabel="Spot on" />
    </div>

    <div className="wf-q">
      <span className="wf-label">Gear</span>
      <div className="wf-gear">
        <select value={wingId} onChange={e => setWingId(e.target.value)} aria-label="Wing">
          <option value="">Wing…</option>
          {wings.map(w => <option key={w.id} value={w.id}>{w.name} · {w.size} m²</option>)}
        </select>
        <select value={foilId} onChange={e => setFoilId(e.target.value)} aria-label="Foil">
          <option value="">Front foil…</option>
          {foils.map(f => <option key={f.id} value={f.id}>{f.name} · {f.size} cm²</option>)}
        </select>
      </div>
    </div>

    <div className="wf-q">
      <span className="wf-label">Notes</span>
      <textarea value={notes} onChange={e => setNotes(e.target.value)}
        placeholder="Thermik timing, gusts, anything worth remembering" />
    </div>

    <button className="wf-submit" type="button" disabled={busy} onClick={submit}>
      {busy ? 'Saving…' : 'Log session'}
    </button>
  </>);
}

// --- real API binding (used when demo={false}) --------------------------------
function realApi(apiBase, fetchImpl) {
  const f = fetchImpl || ((...a) => fetch(...a));
  return {
    async getToday(spotId) {
      const res = await f(`${apiBase}/today?spot=${encodeURIComponent(spotId)}`,
        { credentials: 'include' });
      if (!res.ok) throw new Error('today');
      return res.json();
    },
    async submit(body) {
      const res = await f(apiBase, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('submit');
      return res.json();
    },
  };
}

const DEMO_EQUIPMENT = [
  { id: 'w6', kind: 'wing', name: '6.0 Wing', size: 6.0 },
  { id: 'w4', kind: 'wing', name: '4.5 Wing', size: 4.5 },
  { id: 'f1085', kind: 'foil', name: '1085 Front', size: 1085 },
  { id: 'f850', kind: 'foil', name: '850 Front', size: 850 },
];
const DEMO_FORECAST = {
  source: 'foil-score', predictedScore: 68, predictedWindKt: 12,
  windowStart: null, windowEnd: null, stationModelConfidence: 0.82,
};

// Default export: demo wrapper so the preview renders standalone.
export default function FeedbackDemo() {
  return (
    <div style={{ minHeight: '100vh', background: '#071e23', padding: '28px 14px' }}>
      <SessionFeedback demo onAcceptCalibration={kt => alert(`Would set threshold to ${kt} kt`)} />
    </div>
  );
}
