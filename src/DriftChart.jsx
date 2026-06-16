// ============================================================================
// WindFoil — Score-drift chart
// File version: 1.0.0  |  App target: v3.8.1
// ----------------------------------------------------------------------------
// Visualizes the feedback loop: what the model predicted vs. what the rider
// actually experienced, per session. Default export is a demo wrapper so the
// artifact preview renders. In your app:
//
//   const { series, meanAbsWindErrorKt } = await fetch(
//      `/api/analytics/drift?spot=${spotId}`, {credentials:'include'}).then(r=>r.json());
//   <DriftChart data={series} mae={meanAbsWindErrorKt} thresholdKt={11} />
// ============================================================================
import React from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts';

const C = {
  deep: '#0C2A30', panel: '#0F333A', foam: '#EAF2EE', haze: '#7FA6AC',
  line: 'rgba(234,242,238,.10)', lift: '#34D399', coral: '#FF6B5C', model: '#5BB4D6',
};

function fmtDay(d) {
  try { return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' })
    .format(new Date(d)); } catch { return d; }
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div style={{ background: C.deep, border: `1px solid ${C.line}`, borderRadius: 10,
      padding: '10px 12px', color: C.foam, fontSize: 12 }}>
      <div style={{ color: C.haze, marginBottom: 6 }}>{fmtDay(label)}</div>
      <div style={{ color: C.model }}>Predicted {row.predicted_wind_kt ?? '—'} kt</div>
      <div style={{ color: C.lift }}>
        Actual lift-off {row.actual_liftoff_kt ?? (row.planed ? '—' : 'no plane')} kt</div>
      {row.wind_error_kt != null && (
        <div style={{ color: Math.abs(row.wind_error_kt) > 2 ? C.coral : C.haze, marginTop: 4 }}>
          Error {row.wind_error_kt > 0 ? '+' : ''}{row.wind_error_kt} kt</div>)}
      {row.rating != null && <div style={{ color: C.haze }}>Rated {row.rating}/5</div>}
    </div>
  );
}

export function DriftChart({ data = DEMO_SERIES, mae = DEMO_MAE, thresholdKt = 11,
  spotName = 'Gialova / Navarino Bay' }) {
  const planed = data.filter(d => d.actual_liftoff_kt != null).length;
  return (
    <div style={{ background: C.deep, border: `1px solid ${C.line}`, borderRadius: 18,
      padding: 22, maxWidth: 680, margin: '0 auto', color: C.foam,
      fontFamily: 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between',
        alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase',
            color: C.haze, fontWeight: 600 }}>Forecast accuracy</div>
          <h3 style={{ margin: '3px 0 0', fontSize: 18, fontWeight: 650 }}>{spotName}</h3>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
            fontSize: 30, fontWeight: 700, color: mae != null && mae <= 1.5 ? C.lift : C.coral,
            lineHeight: 1 }}>{mae ?? '—'}<span style={{ fontSize: 13, color: C.haze,
              marginLeft: 4 }}>kt</span></div>
          <div style={{ fontSize: 11, color: C.haze }}>mean wind error · {planed} sessions</div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke={C.line} vertical={false} />
          <XAxis dataKey="session_date" tickFormatter={fmtDay}
            tick={{ fill: C.haze, fontSize: 11 }} stroke={C.line} />
          <YAxis tick={{ fill: C.haze, fontSize: 11 }} stroke={C.line}
            domain={['dataMin - 2', 'dataMax + 2']} unit=" kt" width={56} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12, color: C.haze }} />
          <ReferenceLine y={thresholdKt} stroke={C.haze} strokeDasharray="4 4"
            label={{ value: `threshold ${thresholdKt} kt`, fill: C.haze,
              fontSize: 10, position: 'insideTopRight' }} />
          <Line type="monotone" dataKey="predicted_wind_kt" name="Predicted (model)"
            stroke={C.model} strokeWidth={2} dot={{ r: 3 }} connectNulls />
          <Line type="monotone" dataKey="actual_liftoff_kt" name="Actual lift-off"
            stroke={C.lift} strokeWidth={2.5} dot={{ r: 4 }} connectNulls />
        </LineChart>
      </ResponsiveContainer>

      <p style={{ fontSize: 12, color: C.haze, margin: '14px 0 0' }}>
        Green is where you actually came up on the foil; blue is what the model called.
        The gap is what your feedback closes — every logged session pulls the score
        toward reality.
      </p>
    </div>
  );
}

const DEMO_SERIES = [
  { session_date: '2026-06-08', predicted_wind_kt: 14, actual_liftoff_kt: 11.5, planed: 1, rating: 4, wind_error_kt: 2.5 },
  { session_date: '2026-06-09', predicted_wind_kt: 9,  actual_liftoff_kt: null, planed: 0, rating: 2, wind_error_kt: null },
  { session_date: '2026-06-11', predicted_wind_kt: 13, actual_liftoff_kt: 10.5, planed: 1, rating: 5, wind_error_kt: 2.5 },
  { session_date: '2026-06-12', predicted_wind_kt: 12, actual_liftoff_kt: 11,   planed: 1, rating: 4, wind_error_kt: 1.0 },
  { session_date: '2026-06-13', predicted_wind_kt: 13, actual_liftoff_kt: 10.5, planed: 1, rating: 5, wind_error_kt: 2.5 },
  { session_date: '2026-06-14', predicted_wind_kt: 12, actual_liftoff_kt: 11.5, planed: 1, rating: 4, wind_error_kt: 0.5 },
];
const DEMO_MAE = 1.8;

export default function DriftChartDemo() {
  return (
    <div style={{ minHeight: '100vh', background: '#071e23', padding: '28px 14px' }}>
      <DriftChart />
    </div>
  );
}
