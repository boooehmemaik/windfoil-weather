// ============================================================================
// WindFoil — Neural MOS + Meltemi-Klassifikator (reines JS, keine npm-Deps)
// File version: 2.0.0  |  App target: v3.28.4
// ----------------------------------------------------------------------------
// Zwei Modelle auf einer gemeinsamen MLP-Architektur:
//
//   (a) Neural MOS — Regression: lernt den stundenweisen Modell-Bias aus
//       mehreren Forecast-Features statt nur aus dem Windwert (wie der lineare
//       MOS). Ergebnis: pro Stunde und pro Vorlaufzeit (0/24/48h) eine
//       neural_bias_ms-Korrektur.
//
//   (b) Meltemi-Klassifikator — Binary Classification: für LGPZ-Stationen
//       wird aus den Forecast-Features die Wahrscheinlichkeit berechnet, dass
//       der beobachtete Wind den Meltemi-Schwellwert überschreitet (≥7 m/s
//       am Flughafen ≙ wahrscheinlich ≥12 m/s am Strand Kathisma).
//
// Architektur: 10 Inputs → 16 Hidden (ReLU) → 1 Output (linear/sigmoid)
//   Feature 10 (neu): fc_lead_hours / 48 → [0, 0.5, 1.0]
// Optimizer:   Adam (lr=0.001, β1=0.9, β2=0.999)
// Training:    200 Epochen, Batch 32, Shuffle je Epoche
// Gewichte:    in app_meta als JSON (key: neural_mos:{station} / meltemi_clf:{station})
// Predictions: neural_mos_pred:{s} (lead=0), neural_mos_pred24:{s}, neural_mos_pred48:{s}
// ============================================================================

export const NEURAL_MIN_SAMPLES = 60;   // darunter kein Training — zu wenig Daten
export const MELTEMI_THRESHOLD_MS = 7.0; // LGPZ-obs ≥ 7 m/s → "Meltemi stark"
export const MELTEMI_STATION_KEY = 'LGPZ';

// ── Normalisierung ───────────────────────────────────────────────────────────
const WIND_MAX   = 20;
const PRESS_MIN  = 970, PRESS_MAX  = 1040;
const TEMP_MIN   = -5,  TEMP_MAX   = 45;
const CAPE_MAX   = 2000;

function norm(v, lo, hi) { return hi === lo ? 0 : 2 * (v - lo) / (hi - lo) - 1; }

export function featureVector(sample) {
  const dir  = sample.fc_dir_deg ?? 180;
  const rad  = dir * Math.PI / 180;
  const h    = sample.hour_local ?? 12;
  const mo   = (sample.month ?? 7) - 1;
  const cape = Math.min(sample.fc_cape ?? 0, CAPE_MAX);
  const lead = (sample.fc_lead_hours ?? 0) / 48; // 0→0, 24→0.5, 48→1.0
  return new Float64Array([
    norm(sample.fc_wind_ms ?? 0,  0, WIND_MAX),
    Math.sin(rad),
    Math.cos(rad),
    norm(sample.fc_pressure_hpa ?? 1013, PRESS_MIN, PRESS_MAX),
    norm(sample.fc_temp_c ?? 20,  TEMP_MIN, TEMP_MAX),
    norm(cape, 0, CAPE_MAX),
    Math.sin(2 * Math.PI * h  / 24),
    Math.cos(2 * Math.PI * h  / 24),
    Math.sin(2 * Math.PI * mo / 12),
    lead,
  ]);
}
const N_FEATURES = 10;

// ── MLP ─────────────────────────────────────────────────────────────────────
class MLP {
  constructor(n_h = 16) {
    const ni = N_FEATURES, no = 1;
    const s1 = Math.sqrt(2 / ni), s2 = Math.sqrt(2 / n_h);
    this.W1 = Float64Array.from({ length: ni * n_h }, () => (Math.random()*2-1) * s1);
    this.b1 = new Float64Array(n_h);
    this.W2 = Float64Array.from({ length: n_h * no }, () => (Math.random()*2-1) * s2);
    this.b2 = new Float64Array(no);
    this.n_h = n_h;
    const nparams = this.W1.length + n_h + this.W2.length + no;
    this.m = new Float64Array(nparams);
    this.v = new Float64Array(nparams);
    this.t = 0;
  }

  forward(x) {
    const h = new Float64Array(this.n_h);
    for (let j = 0; j < this.n_h; j++) {
      let s = this.b1[j];
      for (let i = 0; i < N_FEATURES; i++) s += x[i] * this.W1[i * this.n_h + j];
      h[j] = s > 0 ? s : 0;
    }
    let out = this.b2[0];
    for (let j = 0; j < this.n_h; j++) out += h[j] * this.W2[j];
    return { h, out };
  }

  _backward(x, h, out, target, task, g) {
    let grad_out, loss;
    if (task === 'cls') {
      const p = 1 / (1 + Math.exp(-out));
      loss = -(target * Math.log(p + 1e-9) + (1 - target) * Math.log(1 - p + 1e-9));
      grad_out = p - target;
    } else {
      const err = out - target;
      loss = err * err;
      grad_out = 2 * err;
    }
    for (let j = 0; j < this.n_h; j++) {
      g.W2[j] += h[j] * grad_out;
      const dh = this.W2[j] * grad_out * (h[j] > 0 ? 1 : 0);
      g.b1[j] += dh;
      for (let i = 0; i < N_FEATURES; i++) g.W1[i * this.n_h + j] += x[i] * dh;
    }
    g.b2[0] += grad_out;
    return loss;
  }

  _adamStep(grad, param, offset) {
    const lr = 0.001, b1 = 0.9, b2 = 0.999, eps = 1e-8;
    const bc1 = 1 - Math.pow(b1, this.t), bc2 = 1 - Math.pow(b2, this.t);
    for (let i = 0; i < param.length; i++, offset++) {
      const g = grad[i];
      this.m[offset] = b1 * this.m[offset] + (1-b1) * g;
      this.v[offset] = b2 * this.v[offset] + (1-b2) * g * g;
      param[i] -= lr * (this.m[offset]/bc1) / (Math.sqrt(this.v[offset]/bc2) + eps);
    }
    return offset;
  }

  train(samples, { epochs = 200, batchSize = 32, task = 'reg' } = {}) {
    const results = [];
    for (let ep = 0; ep < epochs; ep++) {
      for (let i = samples.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [samples[i], samples[j]] = [samples[j], samples[i]];
      }
      let epochLoss = 0, n = 0;
      for (let b = 0; b < samples.length; b += batchSize) {
        const batch = samples.slice(b, b + batchSize);
        const g = {
          W1: new Float64Array(this.W1.length),
          b1: new Float64Array(this.n_h),
          W2: new Float64Array(this.W2.length),
          b2: new Float64Array(1),
        };
        let bLoss = 0;
        for (const s of batch) {
          const { h, out } = this.forward(s.x);
          bLoss += this._backward(s.x, h, out, s.y, task, g);
          n++;
        }
        epochLoss += bLoss;
        const bs = batch.length;
        for (let i = 0; i < g.W1.length; i++) g.W1[i] /= bs;
        for (let i = 0; i < g.b1.length; i++) g.b1[i] /= bs;
        for (let i = 0; i < g.W2.length; i++) g.W2[i] /= bs;
        g.b2[0] /= bs;
        this.t++;
        let off = 0;
        off = this._adamStep(g.W1, this.W1, off);
        off = this._adamStep(g.b1, this.b1, off);
        off = this._adamStep(g.W2, this.W2, off);
        this._adamStep(g.b2, this.b2, off);
      }
      if ((ep + 1) % 50 === 0) results.push({ ep: ep+1, loss: epochLoss / n });
    }
    return results;
  }

  predict(x, task = 'reg') {
    const { out } = this.forward(x);
    return task === 'cls' ? 1 / (1 + Math.exp(-out)) : out;
  }

  toJSON() {
    return {
      n_h: this.n_h, t: this.t, n_features: N_FEATURES,
      W1: Array.from(this.W1), b1: Array.from(this.b1),
      W2: Array.from(this.W2), b2: Array.from(this.b2),
      m: Array.from(this.m),   v: Array.from(this.v),
    };
  }

  static fromJSON(j) {
    const n_h = j.n_h ?? 16;
    // Verwerfe Modelle mit falscher Eingabedimension (z.B. alte 9-Feature-Gewichte)
    if (j.W1?.length !== N_FEATURES * n_h) return null;
    const net = new MLP(n_h);
    net.W1 = new Float64Array(j.W1); net.b1 = new Float64Array(j.b1);
    net.W2 = new Float64Array(j.W2); net.b2 = new Float64Array(j.b2);
    net.m  = new Float64Array(j.m);  net.v  = new Float64Array(j.v);
    net.t  = j.t ?? 0;
    return net;
  }
}

// ── Persistenz ───────────────────────────────────────────────────────────────
function loadModel(db, metaKey) {
  const row = db.prepare("SELECT value FROM app_meta WHERE key=?").get(metaKey);
  if (!row) return null;
  try { return MLP.fromJSON(JSON.parse(row.value)); } catch { return null; }
}

function saveModel(db, metaKey, model) {
  const json = JSON.stringify(model.toJSON());
  const now  = new Date().toISOString();
  db.prepare(`INSERT INTO app_meta(key, value, updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run(metaKey, json, now);
}

function savePred(db, metaKey, hourlyBias) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO app_meta(key, value, updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run(metaKey, JSON.stringify(hourlyBias), now);
}

// ── Trainings-Samples aus DB laden ──────────────────────────────────────────
// Für Neural MOS: lead=0 direkt + lead=24/48 retrospektiv (join mit späterer Obs)
function loadMlSamplesAllLeads(db, stationKey, { minSamples = NEURAL_MIN_SAMPLES } = {}) {
  const rows = db.prepare(`
    SELECT fc_lead_hours, hour_local, month, obs_wind_ms, fc_wind_ms, fc_dir_deg,
           fc_pressure_hpa, fc_temp_c, fc_cape, bias_ms
    FROM ml_samples
    WHERE station_key=? AND fc_lead_hours=0 AND fc_wind_ms IS NOT NULL AND bias_ms IS NOT NULL
    UNION ALL
    SELECT a.fc_lead_hours, a.hour_local, a.month, b.obs_wind_ms, a.fc_wind_ms, a.fc_dir_deg,
           a.fc_pressure_hpa, a.fc_temp_c, a.fc_cape,
           ROUND((b.obs_wind_ms - a.fc_wind_ms) * 100) / 100
    FROM ml_samples a
    JOIN ml_samples b ON b.station_key=a.station_key
                     AND b.ts=a.ts
                     AND b.fc_lead_hours=0
                     AND b.obs_wind_ms IS NOT NULL
    WHERE a.station_key=? AND a.fc_lead_hours > 0 AND a.fc_wind_ms IS NOT NULL
  `).all(stationKey, stationKey);
  if (rows.length < minSamples) return null;
  return rows;
}

// Für Meltemi-Klassifikator: nur lead=0 mit Beobachtung
function loadMlSamplesLead0(db, stationKey, { minSamples = NEURAL_MIN_SAMPLES } = {}) {
  const rows = db.prepare(
    `SELECT hour_local, month, obs_wind_ms, fc_wind_ms, fc_dir_deg,
            fc_pressure_hpa, fc_temp_c, fc_cape, bias_ms
     FROM ml_samples WHERE station_key=? AND fc_lead_hours=0
       AND fc_wind_ms IS NOT NULL AND obs_wind_ms IS NOT NULL
     ORDER BY ts`
  ).all(stationKey);
  if (rows.length < minSamples) return null;
  return rows;
}

// ── Neuronales MOS: Training ─────────────────────────────────────────────────
export function trainNeuralMos(db, stationKey) {
  const rows = loadMlSamplesAllLeads(db, stationKey);
  if (!rows) return { ok: false, reason: 'too_few_samples' };

  const samples = rows
    .filter(r => r.bias_ms != null && Math.abs(r.bias_ms) < 8)
    .map(r => ({ x: featureVector(r), y: r.bias_ms }));
  if (samples.length < NEURAL_MIN_SAMPLES) return { ok: false, reason: 'too_few_valid' };

  const metaKey = `neural_mos:${stationKey}`;
  let model = loadModel(db, metaKey) ?? new MLP(16);

  const lossLog = model.train(samples, { epochs: 200, batchSize: 32, task: 'reg' });
  saveModel(db, metaKey, model);

  // Per-Stunde-Vorhersage für jede Vorlaufzeit (0, 24, 48h)
  const byHour = new Array(24).fill(null).map(() => []);
  for (const r of rows) byHour[r.hour_local]?.push(r);

  for (const lead of [0, 24, 48]) {
    const hourlyBias = [];
    for (let h = 0; h < 24; h++) {
      const hr = byHour[h];
      if (!hr.length) { hourlyBias.push(null); continue; }
      const repr = {
        fc_lead_hours: lead,
        hour_local: h,
        month: hr[Math.floor(hr.length/2)].month,
        fc_wind_ms:      _median(hr.map(r=>r.fc_wind_ms).filter(Number.isFinite)),
        fc_dir_deg:      _circMedian(hr.map(r=>r.fc_dir_deg).filter(Number.isFinite)),
        fc_pressure_hpa: _median(hr.map(r=>r.fc_pressure_hpa).filter(Number.isFinite)),
        fc_temp_c:       _median(hr.map(r=>r.fc_temp_c).filter(Number.isFinite)),
        fc_cape:         _median(hr.map(r=>r.fc_cape).filter(Number.isFinite)),
      };
      hourlyBias.push(Math.round(model.predict(featureVector(repr), 'reg') * 100) / 100);
    }
    const predKey = lead === 0
      ? `neural_mos_pred:${stationKey}`
      : `neural_mos_pred${lead}:${stationKey}`;
    savePred(db, predKey, hourlyBias);
  }

  return { ok: true, n: samples.length, lossLog };
}

// ── Meltemi-Klassifikator: Training ─────────────────────────────────────────
export function trainMeltemClassifier(db, stationKey = MELTEMI_STATION_KEY) {
  const rows = loadMlSamplesLead0(db, stationKey, { minSamples: NEURAL_MIN_SAMPLES });
  if (!rows) return { ok: false, reason: 'too_few_samples' };

  const pos = rows.filter(r => r.obs_wind_ms >= MELTEMI_THRESHOLD_MS).length;
  const neg = rows.length - pos;
  if (pos < 5 || neg < 5) return { ok: false, reason: 'too_few_positive_or_negative' };

  const samples = rows.map(r => ({
    x: featureVector(r),  // fc_lead_hours defaults to 0 for Meltemi (always current)
    y: r.obs_wind_ms >= MELTEMI_THRESHOLD_MS ? 1 : 0,
  }));

  const metaKey = `meltemi_clf:${stationKey}`;
  let model = loadModel(db, metaKey) ?? new MLP(12);
  const lossLog = model.train(samples, { epochs: 200, batchSize: 32, task: 'cls' });
  saveModel(db, metaKey, model);

  return { ok: true, n: samples.length, pos, neg, lossLog };
}

// ── Inference ────────────────────────────────────────────────────────────────
export function getNeuralHourlyBias(db, stationKey, leadHours = 0) {
  const key = leadHours === 0
    ? `neural_mos_pred:${stationKey}`
    : `neural_mos_pred${leadHours}:${stationKey}`;
  const row = db.prepare("SELECT value FROM app_meta WHERE key=?").get(key);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

export function getMeltemProb(db, fcFeatures, stationKey = MELTEMI_STATION_KEY) {
  const model = loadModel(db, `meltemi_clf:${stationKey}`);
  if (!model) return null;
  const x = featureVector(fcFeatures); // fc_lead_hours=0 by default → Meltemi jetzt
  const p = model.predict(x, 'cls');
  return Math.round(p * 100) / 100;
}

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────
function _median(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a,b)=>a-b);
  const n = s.length;
  return n % 2 ? s[(n-1)/2] : (s[n/2-1]+s[n/2])/2;
}
function _circMedian(angles) {
  if (!angles.length) return 180;
  const rads = angles.map(a => a * Math.PI / 180);
  const sx = rads.reduce((a,r)=>a+Math.sin(r),0)/rads.length;
  const sy = rads.reduce((a,r)=>a+Math.cos(r),0)/rads.length;
  return ((Math.atan2(sx, sy) * 180 / Math.PI) + 360) % 360;
}
