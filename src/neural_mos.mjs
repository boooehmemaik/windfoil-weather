// ============================================================================
// WindFoil — Neural MOS + Meltemi-Klassifikator (reines JS, keine npm-Deps)
// File version: 2.1.0  |  App target: v3.42.0
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
// Training:    adaptive Epochen (30–200), Batch 32, Shuffle je Epoche;
//              Daten aus ml_samples ∪ ml_history, chronologischer 20-%-Holdout,
//              Predictions nur bei Skill ≥ NEURAL_MIN_SKILL (ml_eval:{station})
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
  const leadH = Math.max(0, Math.min(48, sample.fc_lead_hours ?? 0));
  // CAPE nur für lead 0: previous-runs liefert für 24/48 keinen CAPE. Live und
  // Historie müssen dieselbe Feature-Semantik haben, sonst lernt das Netz die Quelle.
  const cape = leadH > 0 ? 0 : Math.min(sample.fc_cape ?? 0, CAPE_MAX);
  const lead = leadH / 48; // 0→0, 24→0.5, 48→1.0
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
  constructor(n_h = 16, rng = Math.random) {
    this.rng = rng;
    const ni = N_FEATURES, no = 1;
    const s1 = Math.sqrt(2 / ni), s2 = Math.sqrt(2 / n_h);
    this.W1 = Float64Array.from({ length: ni * n_h }, () => (rng()*2-1) * s1);
    this.b1 = new Float64Array(n_h);
    this.W2 = Float64Array.from({ length: n_h * no }, () => (rng()*2-1) * s2);
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
        const j = Math.floor(this.rng() * (i + 1));
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
// Zwei Quellen: ml_samples (live, 90 d) und ml_history (Backfill, ohne Pruning).
// lead>0-Zeilen aus ml_samples tragen keine Obs; sie werden mit der Obs derselben
// STUNDE gepaart. Früher war der Join exakt auf ts — Poll-ts hat aber Sekunden,
// lead-ts ist stundengenau, der Join traf deshalb praktisch nie.
function hasTable(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

const FEATURE_COLS = `fc_lead_hours, hour_local, month, fc_wind_ms, fc_dir_deg,
  fc_pressure_hpa, fc_temp_c, fc_cape`;

function loadLiveRows(db, stationKey) {
  return db.prepare(`
    WITH obs_h AS (
      SELECT substr(ts,1,13) AS hk, AVG(obs_wind_ms) AS obs
      FROM ml_samples
      WHERE station_key=? AND fc_lead_hours=0 AND obs_wind_ms IS NOT NULL
      GROUP BY hk
    )
    SELECT substr(ts,1,13) || ':00:00Z' AS ts, 0 AS fc_lead_hours, MIN(hour_local) AS hour_local,
           MIN(month) AS month, AVG(fc_wind_ms) AS fc_wind_ms, AVG(fc_dir_deg) AS fc_dir_deg,
           AVG(fc_pressure_hpa) AS fc_pressure_hpa, AVG(fc_temp_c) AS fc_temp_c, AVG(fc_cape) AS fc_cape,
           AVG(obs_wind_ms) AS obs_wind_ms,
           ROUND((AVG(obs_wind_ms) - AVG(fc_wind_ms)) * 100) / 100 AS bias_ms, 'live' AS src
    FROM ml_samples
    WHERE station_key=? AND fc_lead_hours=0 AND fc_wind_ms IS NOT NULL AND obs_wind_ms IS NOT NULL
    GROUP BY substr(ts,1,13)
    UNION ALL
    SELECT a.ts, a.fc_lead_hours, a.hour_local, a.month, a.fc_wind_ms, a.fc_dir_deg,
           a.fc_pressure_hpa, a.fc_temp_c, a.fc_cape,
           o.obs, ROUND((o.obs - a.fc_wind_ms) * 100) / 100, 'live'
    FROM ml_samples a JOIN obs_h o ON o.hk = substr(a.ts,1,13)
    WHERE a.station_key=? AND a.fc_lead_hours > 0 AND a.fc_wind_ms IS NOT NULL
  `).all(stationKey, stationKey, stationKey);
}

function loadHistoryRows(db, stationKey) {
  if (!hasTable(db, 'ml_history')) return [];
  return db.prepare(`
    SELECT ts, ${FEATURE_COLS}, obs_wind_ms, bias_ms, 'hist' AS src
    FROM ml_history
    WHERE station_key=? AND fc_wind_ms IS NOT NULL AND bias_ms IS NOT NULL
  `).all(stationKey);
}

// Live (der alte 10-min-Poller schrieb 6 Zeilen/Stunde) wird je Stunde gemittelt;
// wo dieselbe (Stunde, lead) auch in der Historie steht, gewinnt die Historie —
// sonst zählt die jüngste Zeit doppelt und dominiert den Holdout.
export function loadTrainingRows(db, stationKey, { lead0Only = false } = {}) {
  const hist = loadHistoryRows(db, stationKey);
  const histKeys = new Set(hist.map(r => `${r.ts.slice(0, 13)}|${r.fc_lead_hours}`));
  const live = loadLiveRows(db, stationKey).filter(r => !histKeys.has(`${r.ts.slice(0, 13)}|${r.fc_lead_hours}`));
  const rows = [...live, ...hist];
  const out = lead0Only ? rows.filter(r => r.fc_lead_hours === 0) : rows;
  return out.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.fc_lead_hours - b.fc_lead_hours));
}

// ── Subsampling ─────────────────────────────────────────────────────────────
// Deterministisch (Hash statt Math.random): dieselben Daten ergeben jede Nacht
// dieselbe Auswahl, Schwankungen im Eval kommen dann nur aus dem Training.
// Saisongewicht: die aktuelle Jahreszeit soll das Modell dominieren, die übrigen
// Monate halten es trotzdem stabil.
export const NEURAL_MAX_TRAIN = 12000;

function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1e6) / 1e6;
}

// Seeded PRNG (mulberry32): gleiche Daten + gleicher Seed ⇒ gleiches Netz.
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function monthDistance(a, b) {
  const d = Math.abs(a - b) % 12;
  return Math.min(d, 12 - d);
}

function seasonWeight(month, nowMonth) {
  const d = monthDistance(month, nowMonth);
  return d <= 1 ? 1 : d <= 2 ? 0.5 : 0.25;
}

export function subsampleRows(rows, { max = NEURAL_MAX_TRAIN, nowMonth } = {}) {
  if (rows.length <= max) return rows;
  const w = rows.map(r => seasonWeight(r.month, nowMonth));
  const k = max / w.reduce((a, b) => a + b, 0);
  return rows.filter((r, i) => hash01(`${r.ts}|${r.fc_lead_hours}`) < Math.min(1, k * w[i]));
}

export function adaptiveEpochs(n) {
  return Math.max(30, Math.min(200, Math.round(200 * 2000 / Math.max(n, 1))));
}

// ── Evaluation ──────────────────────────────────────────────────────────────
// Chronologischer Holdout: die jüngsten 20 % — ein zufälliger Split würde
// Nachbarstunden desselben Wetterlagen-Tages in Train und Test verteilen und
// den Skill schönrechnen.
export const NEURAL_HOLDOUT_FRAC = 0.2;
export const NEURAL_MIN_HOLDOUT  = 30;
export const NEURAL_MIN_SKILL    = 0.03;
export const NEURAL_RESTARTS     = 3;

export function chronoSplit(samples, frac = NEURAL_HOLDOUT_FRAC) {
  const cut = Math.floor(samples.length * (1 - frac));
  return { train: samples.slice(0, cut), test: samples.slice(cut) };
}

// Train / Validierung (Restart-Auswahl) / Test (Gate) — chronologisch, damit die
// Auswahl nicht auf denselben Daten passiert, auf denen das Gate entscheidet.
export function chronoSplit3(samples, frac = NEURAL_HOLDOUT_FRAC) {
  const n = samples.length;
  const a = Math.floor(n * (1 - 2 * frac)), b = Math.floor(n * (1 - frac));
  return { train: samples.slice(0, a), val: samples.slice(a, b), test: samples.slice(b) };
}

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }

function hourlyLinearBaseline(train) {
  const byKey = new Map();
  for (const s of train) {
    const k = `${s.row.fc_lead_hours}|${s.row.hour_local}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(s.y);
  }
  const med = new Map([...byKey].map(([k, v]) => [k, _median(v)]));
  return s => med.get(`${s.row.fc_lead_hours}|${s.row.hour_local}`) ?? 0;
}

export function evaluateModel(model, train, test) {
  const lin = hourlyLinearBaseline(train);
  const r3 = v => Math.round(v * 1000) / 1000;
  const maeRaw    = mean(test.map(s => Math.abs(s.y)));
  const maeModel  = mean(test.map(s => Math.abs(s.y - model.predict(s.x, 'reg'))));
  const maeLinear = mean(test.map(s => Math.abs(s.y - lin(s))));
  const skill = maeRaw > 0 ? 1 - maeModel / maeRaw : 0;
  return { nTest: test.length, maeRaw: r3(maeRaw), maeModel: r3(maeModel),
           maeLinear: r3(maeLinear), skill: r3(skill) };
}

// ── Stunden-Vorhersage ──────────────────────────────────────────────────────
// Mittel der Modellvorhersage über die realen Saison-Zeilen je Stunde — nicht
// die Vorhersage für einen Median-Repräsentanten: E[f(x)] ≠ f(E[x]) bei ReLU.
const PRED_ROWS_PER_HOUR = 300;

export function hourlyPredictions(model, rows, lead, nowMonth) {
  const sameLead = rows.filter(r => r.fc_lead_hours === lead);
  const base = sameLead.length >= 24 * 5 ? sameLead : rows.filter(r => r.fc_lead_hours === 0);
  const season = base.filter(r => monthDistance(r.month, nowMonth) <= 1);
  const pool = season.length >= 24 * 5 ? season : base;
  const byHour = Array.from({ length: 24 }, () => []);
  for (const r of pool) byHour[r.hour_local]?.push(r);
  return byHour.map(hr => {
    if (!hr.length) return null;
    const step = Math.max(1, Math.floor(hr.length / PRED_ROWS_PER_HOUR));
    const pick = hr.filter((_, i) => i % step === 0);
    const p = mean(pick.map(r => model.predict(featureVector({ ...r, fc_lead_hours: lead }), 'reg')));
    return Math.round(p * 100) / 100;
  });
}

function predKeyOf(stationKey, lead) {
  return lead === 0 ? `neural_mos_pred:${stationKey}` : `neural_mos_pred${lead}:${stationKey}`;
}

function deletePreds(db, stationKey) {
  for (const lead of [0, 24, 48]) db.prepare('DELETE FROM app_meta WHERE key=?').run(predKeyOf(stationKey, lead));
}

export function getNeuralEval(db, stationKey) {
  const row = db.prepare('SELECT value FROM app_meta WHERE key=?').get(`ml_eval:${stationKey}`);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

// ── Neuronales MOS: Training ─────────────────────────────────────────────────
// Zwei Auslieferungsformen mit getrenntem Gate (beide auf dem Test-Split):
//   activeFc    — situativ: das Netz rechnet mit den echten Prognose-Features der
//                 nächsten 72 h (Richtung, Druck …). Gate: MAE je Sample.
//   activeTable — Stunden-Tabelle (Saisonmittel) als Fallback. Gate: MAE der
//                 TABELLE, denn genau die kommt im Frontend an.
// Beide müssen das Rohmodell um ≥ NEURAL_MIN_SKILL schlagen und dürfen nicht
// schlechter sein als der lineare Stunden-Bias — das Frontend nimmt Neural VOR
// linear. Ohne bewertbaren Holdout bleibt Neural aus (linear übernimmt).
function tableMae(tables, test) {
  const errs = test.map(s => {
    const t = tables[s.row.fc_lead_hours]?.[s.row.hour_local];
    return Math.abs(s.y - (t ?? 0));
  });
  return mean(errs);
}

function trainBestOf(train, val, epochs, seed0, restarts) {
  let best = null, bestMae = Infinity;
  for (let k = 0; k < restarts; k++) {
    const m = new MLP(16, seededRng(seed0 + k));
    m.train(train.slice(), { epochs, batchSize: 32, task: 'reg' });
    const mae = mean(val.map(s => Math.abs(s.y - m.predict(s.x, 'reg'))));
    if (mae < bestMae) { best = { model: m, seed: seed0 + k }; bestMae = mae; }
  }
  return best;
}

const r3 = v => (v == null ? null : Math.round(v * 1000) / 1000);

export function trainNeuralMos(db, stationKey, { now = new Date() } = {}) {
  const nowMonth = now.getUTCMonth() + 1;
  const all = loadTrainingRows(db, stationKey);
  if (all.length < NEURAL_MIN_SAMPLES) return { ok: false, reason: 'too_few_samples' };

  const rows = subsampleRows(all.filter(r => Math.abs(r.bias_ms) < 8), { nowMonth });
  const samples = rows.map(r => ({ x: featureVector(r), y: r.bias_ms, row: r }));
  if (samples.length < NEURAL_MIN_SAMPLES) return { ok: false, reason: 'too_few_valid' };

  const nHistory = all.filter(r => r.src === 'hist').length;
  const base = { n: samples.length, nAll: all.length, nHistory, nLive: all.length - nHistory,
                 trainedAt: now.toISOString() };
  const epochs = adaptiveEpochs(samples.length);
  const { train, val, test } = chronoSplit3(samples);
  if (val.length < NEURAL_MIN_HOLDOUT || test.length < NEURAL_MIN_HOLDOUT) {
    savePred(db, `ml_eval:${stationKey}`, { ...base, note: 'holdout_too_small', active: false, activeFc: false });
    deletePreds(db, stationKey);
    return { ok: true, n: samples.length, active: false, activeFc: false, skill: null, reason: 'holdout_too_small' };
  }

  const seed0 = Math.floor(hash01(stationKey) * 2 ** 31);
  const best = trainBestOf(train, val, epochs, seed0, NEURAL_RESTARTS);
  const fit = [...train, ...val];
  const ev = evaluateModel(best.model, fit, test);
  const fitRows = fit.map(s => s.row);
  const tables = Object.fromEntries([0, 24, 48].map(l => [l, hourlyPredictions(best.model, fitRows, l, nowMonth)]));
  const maeTable = tableMae(tables, test);
  const skillTable = ev.maeRaw > 0 ? 1 - maeTable / ev.maeRaw : 0;
  const activeFc = ev.skill >= NEURAL_MIN_SKILL && ev.maeModel <= ev.maeLinear;
  const activeTable = skillTable >= NEURAL_MIN_SKILL && maeTable <= ev.maeLinear;

  // Ausgeliefert wird ein Refit auf ALLEN Daten mit dem gewählten Seed: bewertet
  // wurde das Verfahren; die jüngsten 40 % wegzulassen wäre für eine saisonale
  // Korrektur teurer als das (übliche) Refit-Risiko.
  const model = new MLP(16, seededRng(best.seed));
  model.train(samples.slice(), { epochs, batchSize: 32, task: 'reg' });

  const evalRec = { ...base, epochs, ...ev, maeTable: r3(maeTable), skillTable: r3(skillTable),
                    active: activeTable, activeFc };
  savePred(db, `ml_eval:${stationKey}`, evalRec);
  saveModel(db, `neural_mos:${stationKey}`, model);

  if (activeTable) {
    for (const lead of [0, 24, 48]) savePred(db, predKeyOf(stationKey, lead), hourlyPredictions(model, rows, lead, nowMonth));
  } else {
    deletePreds(db, stationKey);
  }
  return { ok: true, n: samples.length, active: activeTable, activeFc, skill: ev.skill, eval: evalRec };
}

// ── Situative Vorhersage (nächste 72 h) ─────────────────────────────────────
// fc72: { issuedAt, hourly: { time[UTC 'YYYY-MM-DDTHH:MM'], windspeed_10m[], … } }
// → { 'YYYY-MM-DD' (Stations-TZ): [24 × Bias m/s | null] }
const tzFmt = new Map();
function localDayHourMonth(ms, tz) {
  if (!tzFmt.has(tz)) tzFmt.set(tz, new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }));
  const p = tzFmt.get(tz).formatToParts(new Date(ms)).reduce((o, x) => (o[x.type] = x.value, o), {});
  return { day: `${p.year}-${p.month}-${p.day}`, hour: parseInt(p.hour, 10) % 24, month: parseInt(p.month, 10) };
}

export function saveFc72(db, stationKey, hourly, issuedAt = new Date().toISOString()) {
  const keep = ['time', 'windspeed_10m', 'winddirection_10m', 'surface_pressure', 'temperature_2m', 'cape'];
  const h = Object.fromEntries(keep.filter(k => hourly?.[k]).map(k => [k, hourly[k]]));
  if (!h.time) return;
  savePred(db, `ml_fc72:${stationKey}`, { issuedAt, hourly: h });
}

export function loadFc72(db, stationKey) {
  const row = db.prepare('SELECT value FROM app_meta WHERE key=?').get(`ml_fc72:${stationKey}`);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

export function predictSituational(db, stationKey, fc72, { tz = 'UTC', now = Date.now() } = {}) {
  const ev = getNeuralEval(db, stationKey);
  if (!ev?.activeFc || !fc72?.hourly?.time) return null;
  const model = loadModel(db, `neural_mos:${stationKey}`);
  if (!model) return null;
  const h = fc72.hourly, issued = Date.parse(fc72.issuedAt);
  const out = {};
  for (let i = 0; i < h.time.length; i++) {
    const t = Date.parse(`${h.time[i]}:00Z`);
    if (!Number.isFinite(t) || t < now - 3600e3 || h.windspeed_10m?.[i] == null) continue;
    const { day, hour, month } = localDayHourMonth(t, tz);
    const x = featureVector({
      fc_wind_ms: h.windspeed_10m[i], fc_dir_deg: h.winddirection_10m?.[i],
      fc_pressure_hpa: h.surface_pressure?.[i], fc_temp_c: h.temperature_2m?.[i], fc_cape: h.cape?.[i],
      hour_local: hour, month, fc_lead_hours: Math.round((t - issued) / 3600e3),
    });
    (out[day] ??= new Array(24).fill(null))[hour] = Math.round(model.predict(x, 'reg') * 100) / 100;
  }
  return Object.keys(out).length ? out : null;
}

// Für Meltemi-Klassifikator: nur lead=0 mit Beobachtung
function loadMlSamplesLead0(db, stationKey, { minSamples = NEURAL_MIN_SAMPLES } = {}) {
  const rows = loadTrainingRows(db, stationKey, { lead0Only: true })
    .filter(r => r.obs_wind_ms != null);
  if (rows.length < minSamples) return null;
  return subsampleRows(rows, { nowMonth: new Date().getUTCMonth() + 1 });
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
  const lossLog = model.train(samples, { epochs: adaptiveEpochs(samples.length), batchSize: 32, task: 'cls' });
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
