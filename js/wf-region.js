/* ============================================================================
 * WindFoil — Spot-Regionsseiten
 * ----------------------------------------------------------------------------
 * EINE Implementierung für sardinia/sizilien/spanien/skandinavien. Die vier
 * Seiten lagen als Kopien vor und waren schon auseinandergelaufen (Ranking-
 * Zellen, rankLabel-Arrays von Hand auf die Spot-Anzahl gepolstert). Alles
 * Regionsspezifische steht in spots.json, nicht hier.
 *
 * Die Renderer sind absichtlich pur: sie bekommen das Fahrerfenster als
 * Argument und greifen auf keinen Modulzustand zu. Nur so lässt sich das
 * erzeugte Markup im Test gegen die alten Seiten diffen.
 *
 * Klassisches Script (kein ES-Modul) — die Seiten haben keinen Build-Step.
 * ==========================================================================*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;  // Node-Tests
  root.WFRegion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const WFS = typeof WF !== 'undefined' ? WF
    : (typeof require === 'function' ? require('./wf-scoring.js') : null);

  const msToKn = WFS.msToKn;

  const COMPASS16 = ['N','NNO','NO','ONO','O','OSO','SO','SSO','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const compass = deg => deg == null ? '?' : COMPASS16[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

  const scoreColor = s => s >= 70 ? '#3ddc84' : s >= 40 ? '#f5b942' : '#e84040';
  const scoreEmoji = s => s >= 70 ? '🟢' : s >= 40 ? '🟡' : '🔴';

  function tempColor(t) {
    if (t < 10) return '#4a9ed8';
    if (t < 15) return '#74bcd5';
    if (t < 19) return '#98d4c5';
    if (t < 23) return '#c8d882';
    if (t < 27) return '#f5c842';
    if (t < 31) return '#f07820';
    return '#e84040';
  }

  function sstColor(t) {
    if (t == null) return '#5a7a96';
    if (t < 8) return '#4a9ed8';
    if (t < 14) return '#74bcd5';
    if (t < 18) return '#98d4c5';
    if (t < 22) return '#c8d882';
    if (t < 26) return '#f5c842';
    return '#f07820';
  }

  /** Koordinaten mit Himmelsrichtung. Die alten Seiten hatten "°E" hart
   *  verdrahtet (Tarifa wurde als "-5.598°E" angezeigt); spanien.html hatte
   *  die Richtung, aber ohne Math.abs → "-5.598°W". */
  const coord = (lat, lon, digits) =>
    `${Math.abs(lat).toFixed(digits)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(digits)}°${lon >= 0 ? 'E' : 'W'}`;

  function wmoIcon(code) {
    if (code == null) return '';
    if (code === 95 || code === 96 || code === 99) return '⛈';
    if (code >= 61 && code <= 67) return '🌧';
    if (code >= 80 && code <= 82) return '🌧';
    if (code >= 51 && code <= 57) return '🌦';
    if (code >= 71 && code <= 77) return '🌨';
    if (code === 85 || code === 86) return '🌨';
    return '';
  }

  // ── Daten ────────────────────────────────────────────────────────────────

  /** Das weathercode-Feld wird getrennt geholt: regionale Hochauflösungs-
   *  modelle (AROME) liefern es nicht, nur Wind. */
  async function fetchForecast(lat, lon, cfg) {
    const base = { latitude: lat, longitude: lon, forecast_days: 3, timezone: 'auto' };
    const windParams = new URLSearchParams({
      ...base,
      hourly: 'windspeed_10m,windgusts_10m,winddirection_10m,temperature_2m',
      wind_speed_unit: 'ms',
    });
    if (cfg && cfg.model) windParams.set('models', cfg.model);
    const wxParams = new URLSearchParams({ ...base, hourly: 'weathercode' });

    const [windR, wxR] = await Promise.all([
      fetch(`https://api.open-meteo.com/v1/forecast?${windParams}`, { signal: AbortSignal.timeout(10000) }),
      fetch(`https://api.open-meteo.com/v1/forecast?${wxParams}`, { signal: AbortSignal.timeout(10000) }),
    ]);
    if (!windR.ok) throw new Error(`HTTP ${windR.status}`);
    const fc = await windR.json();
    if (!fc?.hourly?.windspeed_10m) throw new Error('Unexpected API response structure');
    if (wxR.ok) {
      try {
        const wx = await wxR.json();
        if (wx.hourly?.weathercode) fc.hourly.weathercode = wx.hourly.weathercode;
      } catch { /* weathercode ist optional */ }
    }
    return fc;
  }

  /** Wassertemperatur, Tagesmittel 9–18 Uhr. Nur Regionen mit sst:true. */
  async function fetchMarine(lat, lon) {
    const p = new URLSearchParams({ latitude: lat, longitude: lon, hourly: 'sea_surface_temperature', forecast_days: 1, timezone: 'auto' });
    try {
      const r = await fetch(`https://marine-api.open-meteo.com/v1/marine?${p}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const j = await r.json();
      const vals = j?.hourly?.sea_surface_temperature;
      if (!vals) return null;
      const valid = vals.slice(9, 18).filter(v => v != null);
      return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    } catch { return null; }
  }

  /** Ein Request für die ganze Region statt einem pro Spot — der Server bündelt
   *  und cacht. Schlägt er fehl, holen die Spots ihre Daten wieder direkt bei
   *  Open-Meteo: die Seite soll nicht an unserem Proxy hängen. */
  async function loadForecasts(key, spots, cfg) {
    try {
      const r = await fetch(`/api/forecast/batch?region=${encodeURIComponent(key)}&days=3`,
                            { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      // Ein fehlender Spot heißt: spots.json ist neuer als der Server-Cache.
      if (!j.spots || spots.some(s => !(s.id in j.spots))) throw new Error('Batch unvollständig');
      return j.spots;
    } catch (e) {
      console.warn('[wf-region] Batch-Forecast nicht verfügbar, Direktabruf:', e.message);
      const out = {};
      await Promise.all(spots.map(async s => {
        try { out[s.id] = await fetchForecast(s.lat, s.lon, cfg); }
        catch (err) { console.error(`[wf-region] ${s.id}:`, err); out[s.id] = null; }
      }));
      return out;
    }
  }

  async function loadSst(key, spots) {
    try {
      const r = await fetch(`/api/forecast/marine?region=${encodeURIComponent(key)}`,
                            { signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!j.sst || spots.some(s => !(s.id in j.sst))) throw new Error('Marine unvollständig');
      return j.sst;
    } catch (e) {
      console.warn('[wf-region] Batch-Marine nicht verfügbar, Direktabruf:', e.message);
      const m = await Promise.allSettled(spots.map(s => s.noMarine ? Promise.resolve(null) : fetchMarine(s.lat, s.lon)));
      const sst = {};
      spots.forEach((s, i) => { sst[s.id] = m[i].status === 'fulfilled' ? m[i].value : null; });
      return sst;
    }
  }

  /** Der Rückblick kommt gebündelt und auf 9–18 Uhr beschnitten; aggregateHistory
   *  filtert dasselbe Fenster, arbeitet also auf beiden Quellen gleich. */
  async function loadHistory(key, spots, win) {
    try {
      const r = await fetch(`/api/forecast/history?region=${encodeURIComponent(key)}`,
                            { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!j.spots || spots.some(s => !(s.id in j.spots))) throw new Error('Verlauf unvollständig');
      return spots.map(s => j.spots[s.id] ? aggregateHistory(j.spots[s.id], win) : null);
    } catch (e) {
      console.warn('[wf-region] Batch-Verlauf nicht verfügbar, Direktabruf:', e.message);
      const h = await Promise.allSettled(spots.map(s => fetchSpotHistoryERA5(s.lat, s.lon, win)));
      return h.map(x => x.status === 'fulfilled' ? x.value : null);
    }
  }

  async function fetchSpotHistoryERA5(lat, lon, win, days) {
    const n = days || 14;
    const end = new Date(); end.setDate(end.getDate() - 1);
    const start = new Date(end); start.setDate(end.getDate() - n + 1);
    const fmt = d => d.toISOString().slice(0, 10);
    const p = new URLSearchParams({
      latitude: lat, longitude: lon,
      start_date: fmt(start), end_date: fmt(end),
      hourly: 'windspeed_10m,windgusts_10m,winddirection_10m,temperature_2m',
      wind_speed_unit: 'ms', timezone: 'auto',
    });
    const r = await fetch(`https://archive-api.open-meteo.com/v1/archive?${p}`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (!j?.hourly?.time) throw new Error('no data');
    return aggregateHistory(j, win);
  }

  /** ERA5-Stundenreihe → Tageswerte (nur 9–18 Uhr). Getrennt vom Fetch,
   *  damit der Test sie ohne Netz prüfen kann. */
  function aggregateHistory(j, win) {
    const dayMap = {};
    j.hourly.time.forEach((t, i) => {
      const date = t.slice(0, 10), hour = parseInt(t.slice(11, 13), 10);
      if (hour < 9 || hour > 18) return;
      if (!dayMap[date]) dayMap[date] = { winds: [], gusts: [], dirs: [], temps: [] };
      const w = j.hourly.windspeed_10m[i];
      if (w != null) {
        dayMap[date].winds.push(w);
        dayMap[date].gusts.push(j.hourly.windgusts_10m?.[i] ?? w);
        const dir = j.hourly.winddirection_10m?.[i];
        if (dir != null) dayMap[date].dirs.push(dir);
      }
      const temp = j.hourly.temperature_2m?.[i];
      if (temp != null) dayMap[date].temps.push(temp);
    });
    return Object.entries(dayMap).map(([date, d]) => {
      const avgWind = d.winds.length ? d.winds.reduce((a, b) => a + b, 0) / d.winds.length : 0;
      const maxGust = d.gusts.length ? Math.max(...d.gusts) : 0;
      const scores = d.winds.map(w => WFS.scoreHour(w, win));
      const score = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
      const avgTemp = d.temps.length ? d.temps.reduce((a, b) => a + b, 0) / d.temps.length : null;
      return { date, avgWind, maxGust, score, avgWindKn: msToKn(avgWind), avgTemp };
    }).sort((a, b) => a.date.localeCompare(b.date));
  }

  // ── Auswertung ───────────────────────────────────────────────────────────

  const EMPTY_STATS = () => ({ avgWind: 0, maxGust: 0, avgDir: 0, score: 0, spark: Array(10).fill(0), sparkCodes: Array(10).fill(null), avgWindKn: 0 });

  function dayStats(fc, dayIdx, spot, win) {
    if (!fc?.hourly?.windspeed_10m) return EMPTY_STATS();
    const h = fc.hourly;
    const start = dayIdx * 24;
    const winds = h.windspeed_10m, gusts = h.windgusts_10m, dirs = h.winddirection_10m;
    const sOpts = { start, dirs, offshoreDir: spot?.offshoreDir ?? null };
    const sw = winds.slice(start + 9, start + 19).filter(v => v != null);
    const sg = (gusts || []).slice(start + 9, start + 19).filter(v => v != null);
    const sd = (dirs || []).slice(start + 9, start + 19).filter(v => v != null);
    const avgWind = sw.length ? sw.reduce((a, b) => a + b, 0) / sw.length : 0;
    const maxGust = sg.length ? Math.max(...sg) : 0;
    // 0 statt null bei leerer Reihe, damit die Form von dayStats stabil bleibt;
    // ohne Richtungsdaten kommt die Seite ohnehin nicht an einen Score.
    const avgDir = WFS.meanDirection(sd) ?? 0;
    const codes = h.weathercode;
    const sparkCodes = [];
    for (let h2 = 9; h2 <= 18; h2++) sparkCodes.push(codes ? (codes[start + h2] ?? null) : null);
    return {
      avgWind, maxGust, avgDir,
      score: WFS.scoreDay(winds, win, sOpts),
      spark: WFS.hourlyScores(winds, win, sOpts),
      sparkCodes,
      avgWindKn: msToKn(avgWind),
    };
  }

  function dayLabel(fc, dayIdx) {
    const t = fc?.hourly?.time?.[dayIdx * 24];
    if (!t) return `Tag ${dayIdx + 1}`;
    if (dayIdx === 0) return 'Heute';
    if (dayIdx === 1) return 'Morgen';
    return new Date(t).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });
  }

  /** 3-Tage-Ranking, bester Spot zuerst. */
  function rankSpots(spots, results, win) {
    return spots.map(spot => {
      if (!results[spot.id]) return { spot, avg: 0, days: [0, 0, 0], winds: [0, 0, 0], dirs: [0, 0, 0] };
      const days = [0, 1, 2].map(d => dayStats(results[spot.id], d, spot, win));
      return {
        spot,
        avg: Math.round(days.reduce((a, ds) => a + ds.score, 0) / 3),
        days: days.map(d => d.score),
        winds: days.map(d => d.avgWindKn),
        dirs: days.map(d => d.avgDir),
      };
    }).sort((a, b) => b.avg - a.avg);
  }

  // ── Markup ───────────────────────────────────────────────────────────────

  /** Spitze zeigt dorthin, WOHER der Wind kommt. Ohne Richtung lieber nichts
   *  als ein ungedrehter Pfeil — der behauptete Nord. */
  function windArrowSvg(deg, color = '#3a9ad9', size = 20) {
    if (deg == null) return '';
    return `<svg width="${size}" height="${size}" viewBox="0 0 20 20" style="display:inline-block;vertical-align:middle;transform:rotate(${deg}deg)">`
      + `<polygon points="10,2 14,16 10,13 6,16" fill="${color}" opacity=".85"/>`
      + `</svg>`;
  }

  // Vorher lagen diese beiden als handgepflegte Arrays in jeder Seite, auf die
  // jeweilige Spot-Anzahl gepolstert — eine Fehlerquelle bei jedem neuen Spot.
  const RANK_LABELS = [
    '🥇 Bester Spot — ideal für heutige Session',
    '🥈 Gut — lohnend bei gutem Timing',
    '🥉 Mittel — nur bei optimalem Wetter',
    '⬇️ Weniger empfehlenswert',
  ];
  const rankClass = i => `rank-${Math.min(i + 1, 4)}`;
  const rankLabel = i => RANK_LABELS[Math.min(i, RANK_LABELS.length - 1)];

  function buildCard(spot, forecasts, bestId, ctx) {
    const { win, sstData } = ctx;
    const isBest = spot.id === bestId;
    const sst = sstData ? sstData[spot.id] : null;
    if (!forecasts[spot.id]) return `
    <div class="spot-card" id="card-${spot.id}">
      <div class="spot-head">
        <div><div class="spot-name">${spot.emoji} ${spot.name}</div></div>
      </div>
      <div style="padding:20px;text-align:center;color:#5a7a96;font-size:11px;font-family:monospace">
        ⚠ Forecast nicht verfügbar
      </div>
    </div>`;

    const days = [0, 1, 2].map(d => dayStats(forecasts[spot.id], d, spot, win));
    const labels = [0, 1, 2].map(d => dayLabel(forecasts[spot.id], d));

    const tabsHtml = days.map((ds, i) => `
    <div class="day-tab ${i === 0 ? 'active' : ''}" onclick="WFRegion.switchDay('${spot.id}', ${i})" id="tab-${spot.id}-${i}">
      <span class="score-mini" style="color:${scoreColor(ds.score)}">${ds.score}</span>
      ${labels[i]}
    </div>`).join('');

    const detailHtml = days.map((ds, i) => {
      const sparkHtml = ds.spark.map((s, si) => {
        const icon = wmoIcon(ds.sparkCodes ? ds.sparkCodes[si] : null);
        return `<div class="spark-col"><div class="spark-bar" style="background:${scoreColor(s)};height:${Math.max(4, s)}%;opacity:.8"></div>${icon ? `<span class="spark-icon">${icon}</span>` : ''}</div>`;
      }).join('');

      return `<div class="day-detail" id="detail-${spot.id}-${i}" style="${i === 0 ? '' : 'display:none'}">
      <div class="score-row" style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <div>
          <div class="score-big" style="color:${scoreColor(ds.score)}">${ds.score}</div>
          <div class="score-label">Foil-Score</div>
        </div>
        <div style="flex:1">
          <div style="background:#1e2d3d;border-radius:4px;height:6px;overflow:hidden;margin-bottom:4px">
            <div style="width:${ds.score}%;height:6px;border-radius:4px;background:${scoreColor(ds.score)}"></div>
          </div>
          <div style="font-family:monospace;font-size:9px;color:#5a7a96">9–18 Uhr Fenster</div>
        </div>
      </div>
      <div class="wind-row">
        <div class="wind-stat">
          <div class="wind-stat-label">Ø Wind</div>
          <div class="wind-stat-val">${ds.avgWindKn.toFixed(1)}<span class="wind-stat-unit"> kn</span></div>
        </div>
        <div class="wind-stat">
          <div class="wind-stat-label">Max Böe</div>
          <div class="wind-stat-val">${msToKn(ds.maxGust).toFixed(1)}<span class="wind-stat-unit"> kn</span></div>
        </div>${sstData ? `
        <div class="wind-stat">
          <div class="wind-stat-label">🌊 Wassertemp</div>
          <div class="wind-stat-val" style="color:${sstColor(sst)}">${sst != null ? sst.toFixed(1) + '°C' : '–'}</div>
        </div>` : ''}
      </div>
      <div class="dir-row">
        ${windArrowSvg(ds.avgDir, '#3a9ad9', 18)}
        <span class="dir-label">Windrichtung:</span>
        <span class="dir-val">${compass(ds.avgDir)} (${Math.round(ds.avgDir)}°)</span>
      </div>
      <div class="spark" title="Stündlicher Score 9–18 Uhr">${sparkHtml}</div>
      <div style="font-family:monospace;font-size:9px;color:#5a7a96;margin-top:3px">▲ Score-Profil 9–18 Uhr</div>
    </div>`;
    }).join('');

    return `
    <div class="spot-card ${isBest ? 'best' : ''}" id="card-${spot.id}">
      <div class="spot-head">
        <div>
          <div class="spot-name">${spot.emoji} ${spot.name}</div>
          <div class="spot-desc">${spot.desc}</div>
          <div class="spot-coords">${coord(spot.lat, spot.lon, 3)}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
          ${isBest ? '<div class="spot-best-badge">⭐ BEST</div>' : ''}
          ${spot.camper ? '<div class="camper-badge" title="' + spot.camperNote + '">🚐 Camper</div>' : ''}
        </div>
      </div>
      <div class="day-tabs">${tabsHtml}</div>
      ${detailHtml}
    </div>`;
  }

  function buildRankingRows(ranking, results, ctx) {
    const { sstData } = ctx;
    return ranking.map((r, i) => {
      const sst = sstData ? sstData[r.spot.id] : null;
      const sstCell = sstData
        ? `\n      <td class="temp-cell">${sst != null ? `<b style="color:${sstColor(sst)}">${sst.toFixed(1)}°C</b>` : '–'}</td>`
        : '';
      return `<tr>
      <td class="${rankClass(i)}">${i + 1}</td>
      <td class="${rankClass(i)}">${r.spot.emoji} <b>${r.spot.name}</b></td>
      <td><span style="color:${scoreColor(r.days[0])}">${r.days[0]}</span></td>
      <td><span style="color:${scoreColor(r.days[1])}">${r.days[1]}</span></td>
      <td><span style="color:${scoreColor(r.days[2])}">${r.days[2]}</span></td>
      <td><b style="color:${scoreColor(r.avg)}">${r.avg}</b></td>
      <td>${r.winds[0].toFixed(1)} kn</td>
      <td>${windArrowSvg(r.dirs[0], '#3a9ad9', 13)} ${compass(r.dirs[0])}</td>${sstCell}
      <td style="font-size:10px;color:${i < 2 ? scoreColor(r.avg) : '#5a7a96'}">${rankLabel(i)}</td>
    </tr>`;
    }).join('');
  }

  function buildHistCard(spot, histData) {
    if (!histData || !histData.length) {
      return `<div class="hist-card"><div class="hist-card-title" style="color:${spot.color}">${spot.emoji} ${spot.name}</div><div style="font-size:11px;color:#5a7a96;padding:8px 0">ERA5-Daten nicht verfügbar</div></div>`;
    }
    const maxWK = Math.max(...histData.map(d => d.avgWindKn), 4);
    const roundedMax = Math.max(10, Math.ceil(maxWK / 5) * 5);
    const half = Math.round(roundedMax / 2);
    const W = 100, H = 68, bw = W / histData.length - 0.8;
    const grid50y = (H * 0.5).toFixed(1);
    const grid75y = (H * 0.25).toFixed(1);
    const dmy = date => new Date(date + 'T12:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' });

    const bars = histData.map((d, i) => {
      const h = Math.max(1, (d.avgWindKn / roundedMax) * H);
      return `<rect x="${(i * (W / histData.length)).toFixed(2)}" y="${(H - h).toFixed(2)}" width="${bw.toFixed(2)}" height="${h.toFixed(2)}" fill="${scoreColor(d.score)}" opacity="0.85" rx="1"><title>${dmy(d.date)}: Ø ${d.avgWindKn.toFixed(1)} kn · Score ${d.score}</title></rect>`;
    }).join('');
    const tempStrip = histData.map(d => {
      const col = d.avgTemp != null ? tempColor(d.avgTemp) : '#1e2d3d';
      const lbl = d.avgTemp != null ? `${dmy(d.date)}: Ø ${d.avgTemp.toFixed(1)}°C` : 'keine Temp-Daten';
      return `<div style="flex:1;background:${col};border-radius:1px;opacity:.85" title="${lbl}"></div>`;
    }).join('');

    const best = histData.reduce((a, b) => b.score > a.score ? b : a, histData[0]);
    const avgScore = Math.round(histData.reduce((a, b) => a + b.score, 0) / histData.length);
    const avgKn = (histData.reduce((a, b) => a + b.avgWindKn, 0) / histData.length).toFixed(1);
    const temps = histData.filter(d => d.avgTemp != null);
    const avgTempVal = temps.length ? temps.reduce((a, b) => a + b.avgTemp, 0) / temps.length : null;

    return `<div class="hist-card">
    <div class="hist-card-title" style="color:${spot.color}">${spot.emoji} ${spot.name}</div>
    <div class="hist-chart-wrap">
      <div class="hist-yaxis"><span>${roundedMax} kn</span><span>${half}</span><span>0</span></div>
      <svg class="hist-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <line x1="0" y1="${grid75y}" x2="${W}" y2="${grid75y}" stroke="#1e2d3d" stroke-width="0.6" stroke-dasharray="2,3"/>
        <line x1="0" y1="${grid50y}" x2="${W}" y2="${grid50y}" stroke="#243040" stroke-width="0.8" stroke-dasharray="2,2"/>
        ${bars}
      </svg>
    </div>
    <div class="hist-temp-strip" title="Tagestemperatur 9–18 Uhr (blau=kalt · gelb=warm · rot=heiß)">${tempStrip}</div>
    <div class="hist-axis"><span>${dmy(histData[0].date)}</span><span>${dmy(histData[histData.length - 1].date)}</span></div>
    <div class="hist-stats">
      <span>Ø Score: <b style="color:${scoreColor(avgScore)}">${avgScore}</b></span>
      <span>Best: <b style="color:#3ddc84">${dmy(best.date)} · ${best.score}</b></span>
      <span>Ø Wind: <b style="color:#d8e4f0">${avgKn} kn</b></span>
      ${avgTempVal != null ? `<span>Ø Temp: <b style="color:${tempColor(avgTempVal)}">${avgTempVal.toFixed(1)}°C</b></span>` : ''}
    </div>
  </div>`;
  }

  // ── Seitensteuerung ──────────────────────────────────────────────────────

  function switchDay(spotId, dayIdx) {
    for (let i = 0; i < 3; i++) {
      const tab = document.getElementById(`tab-${spotId}-${i}`);
      const det = document.getElementById(`detail-${spotId}-${i}`);
      if (tab) tab.classList.toggle('active', i === dayIdx);
      if (det) det.style.display = i === dayIdx ? '' : 'none';
    }
  }

  function tickClock() {
    const el = document.getElementById('hdr-clock');
    if (el) el.textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function placeholderMarker(spot, map) {
    const icon = L.divIcon({
      className: '',
      html: `<div style="position:relative;width:20px;height:20px"><div style="width:16px;height:16px;border-radius:50%;background:${spot.color};border:2px solid rgba(255,255,255,.8);box-shadow:0 1px 6px rgba(0,0,0,.6);margin:2px"></div></div>`,
      iconSize: [20, 20], iconAnchor: [10, 10],
    });
    const m = L.marker([spot.lat, spot.lon], { icon }).addTo(map);
    m.bindPopup(`<b>${spot.emoji} ${spot.name}</b>${spot.camper ? ' <span style="color:#6de8c0;font-size:10px">🚐</span>' : ''}<br><span style="color:#5a7a96;font-size:10px">${spot.desc}</span><br><span style="font-family:monospace;font-size:9px;color:#5a7a96">${coord(spot.lat, spot.lon, 4)}</span><br><i style="color:#5a7a96;font-size:10px">Lade Forecast…</i>`);
    return m;
  }

  function updateMarker(marker, spot, ds, isBest, sst) {
    const col = scoreColor(ds.score);
    marker.setIcon(L.divIcon({
      className: '',
      html: `<div style="position:relative;width:90px;height:64px;pointer-events:none">
        <svg style="position:absolute;top:0;left:0;width:90px;height:64px;overflow:visible;pointer-events:none"><line x1="10" y1="54" x2="70" y2="16" stroke="${col}" stroke-width="1.5" stroke-opacity="0.75"/></svg>
        <div class="lm-dot" style="background:${col}"></div>
        <div class="lm-badge" style="color:${col};border-color:${col}">${windArrowSvg(ds.avgDir, '#3a9ad9', 12)}${ds.score}</div>
      </div>`,
      iconSize: [90, 64], iconAnchor: [10, 54],
    }));
    marker.bindPopup(`
      <b>${spot.emoji} ${spot.name}</b>${isBest ? ' ⭐' : ''}<br>
      <span style="color:${col};font-size:13px;font-weight:700">Score ${ds.score}</span>
      <span style="color:#5a7a96;font-size:10px"> (Heute 9–18 Uhr)</span><br>
      <span style="font-size:11px">Ø <b>${ds.avgWindKn.toFixed(1)} kn</b> · ${windArrowSvg(ds.avgDir, '#3a9ad9', 14)} <b>${compass(ds.avgDir)}</b></span><br>
      ${sst != null ? `<span style="font-size:11px">🌊 <b style="color:${sstColor(sst)}">${sst.toFixed(1)}°C</b> SST</span><br>` : ''}
      <span style="font-family:monospace;font-size:9px;color:#5a7a96">${coord(spot.lat, spot.lon, 4)} · ${spot.desc}</span>
    `);
  }

  /** spots.json ist seit dem Shell-Umbau der einzige Spot-Lieferant. Fällt er
   *  aus, darf die Seite nicht stumm im Ladezustand hängen. */
  function showFailure(err) {
    const name = document.getElementById('winner-name');
    if (name) name.textContent = '⚠ Spot-Daten nicht ladbar';
    const why = document.getElementById('winner-why');
    if (why) why.textContent = 'Bitte Seite neu laden. Details in der Browser-Konsole.';
    const grid = document.getElementById('spots-grid');
    if (grid) grid.innerHTML = `<div class="loading">⚠ ${err.message}</div>`;
    const loading = document.getElementById('rec-loading');
    if (loading) loading.textContent = '⚠ Ranking nicht verfügbar';
  }

  async function init(key) {
    setInterval(tickClock, 1000); tickClock();
    try {
      await render(key);
    } catch (e) {
      console.error('[wf-region]', e);
      showFailure(e);
      throw e;
    }
  }

  /** Holt die Region aus spots.json und baut Karte, Marker, Spot-Karten,
   *  Ranking und Verlauf. */
  async function render(key) {
    if (!key) throw new Error('WFRegion.init: keine Region angegeben');

    const cfg = (await (await fetch('/spots.json', { cache: 'no-cache' })).json()).regions[key];
    if (!cfg) throw new Error(`WFRegion.init: Region "${key}" nicht in spots.json`);
    const SPOTS = cfg.spots;

    const map = L.map('map', { center: cfg.center, zoom: cfg.zoom, zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 18 }).addTo(map);
    const markers = {};
    SPOTS.forEach(s => { markers[s.id] = placeholderMarker(s, map); });

    const prof = await WFS.loadRider();
    const win = prof.win;
    const rn = document.getElementById('rider-note');
    if (rn) rn.textContent = WFS.describeRider(prof.rider);

    const grid = document.getElementById('spots-grid');
    grid.innerHTML = SPOTS.map(() => '<div class="loading"><span class="spin">⟳</span></div>').join('');

    const results = await loadForecasts(key, SPOTS, cfg);
    const sstData = cfg.sst ? await loadSst(key, SPOTS) : null;
    const ctx = { win, sstData };

    const ranking = rankSpots(SPOTS, results, win);
    const bestId = ranking[0].spot.id;
    const winner = ranking[0];
    document.getElementById('winner-name').textContent = `${winner.spot.emoji} ${winner.spot.name} — Score ${winner.avg}`;
    document.getElementById('winner-why').innerHTML = `
    ${scoreEmoji(winner.avg)} Bester 3-Tage-Ø Score ·
    Ø ${winner.winds[0].toFixed(1)} kn heute ·
    ${compass(winner.dirs[0])} Hauptrichtung ·
    ${winner.spot.shoreNote}`;

    SPOTS.forEach(spot => {
      if (!results[spot.id]) return;
      updateMarker(markers[spot.id], spot, dayStats(results[spot.id], 0, spot, win),
                   spot.id === bestId, sstData ? sstData[spot.id] : null);
      if (spot.id === bestId) markers[spot.id].openPopup();
    });

    grid.innerHTML = SPOTS.map(spot => buildCard(spot, results, bestId, ctx)).join('');

    document.getElementById('rec-loading').style.display = 'none';
    document.getElementById('rec-table').style.display = '';
    document.getElementById('rec-body').innerHTML = buildRankingRows(ranking, results, ctx);

    const histGrid = document.getElementById('hist-grid');
    if (histGrid) {
      const hist = await loadHistory(key, SPOTS, win);
      histGrid.innerHTML = SPOTS.map((s, i) => buildHistCard(s, hist[i])).join('');
    }
  }

  return {
    COMPASS16, compass, coord, scoreColor, scoreEmoji, tempColor, sstColor, wmoIcon,
    fetchForecast, fetchMarine, fetchSpotHistoryERA5, aggregateHistory,
    loadForecasts, loadSst, loadHistory,
    dayStats, dayLabel, rankSpots, windArrowSvg, rankClass, rankLabel, RANK_LABELS,
    buildCard, buildRankingRows, buildHistCard,
    switchDay, tickClock, placeholderMarker, updateMarker, init,
  };
});
