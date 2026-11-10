/* ============================================================================
 * WindFoil — kanonisches Scoring
 * ----------------------------------------------------------------------------
 * EINZIGE Quelle der Wahrheit für Windfenster und Foil-Score. Wird von
 * index.html (React/Babel), den Spot-Seiten, vergleich.html, watcher.html
 * und den Node-Tests konsumiert.
 *
 * Vorher lag dieser Code in 6 Dateien parallel und ist auseinandergelaufen:
 * die Spot-Seiten rechneten ein überholtes Modell (Foil-Fläche als Parameter,
 * Tages-Score als Mittel über 9–18 Uhr) und wichen bis zu 46 Punkte von der
 * Hauptapp ab. Änderungen gehören ausschließlich hierher.
 *
 * Klassisches Script (kein ES-Modul), weil die Spot-Seiten ohne Build-Step
 * ausgeliefert werden und index.html in-browser Babel nutzt.
 * ==========================================================================*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;  // Node-Tests
  root.WF = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const msToKn = ms => ms * 1.94384;
  const knToMs = kn => kn / 1.94384;

  // = altes foilF*0.8 beim Referenz-Foil 1800 cm². Die Foil-Fläche ist kein
  // Eingabeparameter mehr; sie wird von der gemessenen Planing-Schwelle
  // (knownPlaneMs) weit besser abgedeckt.
  const REF_FOIL_TERM = 0.8;

  const SKILL_MIN = { beginner: 1.50, intermediate: 1.25, advanced: 1.00, pro: 0.85 };
  const SKILL_OPT = { beginner: 1.60, intermediate: 2.00, advanced: 2.60, pro: 3.20 };
  const SKILL_MAX = { beginner: 2.00, intermediate: 2.60, advanced: 3.50, pro: 4.50 };

  const r1 = x => Math.round(x * 10) / 10;

  /** Physikalisches Windfenster in m/s. knownPlaneMs (gemessene Angleit-
   *  Schwelle des Fahrers) schlägt das Modell, wenn vorhanden. */
  function calcWindow(weight, wingM2, skill, knownPlaneMs) {
    const sMin = SKILL_MIN[skill] ?? 1.15;
    const sOpt = SKILL_OPT[skill] ?? 2.00;
    const sMax = SKILL_MAX[skill] ?? 2.60;
    const minW = (knownPlaneMs && knownPlaneMs > 0)
      ? knownPlaneMs
      : Math.max(2.5, (3.5 + (weight / wingM2) * 0.15 + REF_FOIL_TERM) * sMin * 0.85);
    return { minWind: r1(minW), optMin: r1(minW * 1.2), optMax: r1(minW * sOpt), maxWind: r1(minW * sMax) };
  }

  /** Hersteller-/Feedback-Windrange (kn) → Fenster (m/s). */
  function rangeToWindow(minKn, maxKn) {
    const lo = knToMs(minKn), hi = knToMs(maxKn);
    return { minWind: r1(lo), optMin: r1(lo + 0.25 * (hi - lo)), optMax: r1(lo + 0.75 * (hi - lo)), maxWind: r1(hi) };
  }

  /** Kantenweiser Blend zweier Fenster; w = Gewicht von b. */
  function blendWindows(a, b, w) {
    const p = 1 - w;
    return { minWind: r1(p * a.minWind + w * b.minWind), optMin: r1(p * a.optMin + w * b.optMin),
             optMax:  r1(p * a.optMax  + w * b.optMax),  maxWind: r1(p * a.maxWind + w * b.maxWind) };
  }

  /** Foil-Score 0–100 für eine Stunde. */
  function scoreHour(w, win) {
    if (w < win.minWind) return Math.max(0, Math.round((w / win.minWind) * 45));
    if (w < win.optMin)  return Math.round(55 + ((w - win.minWind) / (win.optMin - win.minWind)) * 30);
    if (w <= win.optMax) return 100;
    if (w <= win.maxWind) return Math.round(100 - ((w - win.optMax) / (win.maxWind - win.optMax)) * 50);
    return Math.max(0, Math.round(50 - (w - win.maxWind) * 10));
  }

  /** offshoreDir = Kompasskurs, der vom Wasser weg landeinwärts zeigt.
   *  Liegt der Wind innerhalb 45° davon, ist der Spot unfahrbar → 0. */
  function offshoreMultiplier(windDir, offshoreDir) {
    if (windDir == null || offshoreDir == null) return 1;
    const diff = ((windDir - offshoreDir + 540) % 360) - 180;
    return Math.cos(diff * Math.PI / 180) > 0.7 ? 0 : 1;
  }

  /** Dominante Windrichtung einer Stundenreihe als Kreismittel.
   *  Das arithmetische Mittel liefert bei Nordwind (350°/10°) sonst Süd.
   *  Leere Reihe → null; 0 wäre hier Nord und damit eine erfundene Richtung. */
  function meanDirection(dirs) {
    let sx = 0, sy = 0, n = 0;
    for (const d of dirs || []) {
      if (d == null || !Number.isFinite(d)) continue;
      sx += Math.cos(d * Math.PI / 180);
      sy += Math.sin(d * Math.PI / 180);
      n++;
    }
    if (!n) return null;
    return ((Math.atan2(sy / n, sx / n) * 180 / Math.PI) + 360) % 360;
  }

  const SESSION_H = 4;        // Sessionlänge in Stunden
  const FIRST_START = 9;      // frühester sinnvoller Start
  const LAST_END = 19;        // spätestes Ende

  /** Bestes zusammenhängendes 4h-Fenster des Tages.
   *  opts: { start=0 (Tagesoffset im Stundenarray), dirs=null, offshoreDir=null } */
  function bestSession(winds, win, opts) {
    const o = opts || {};
    const start = o.start || 0;
    const best = { score: 0, startHour: null, endHour: null };
    for (let s = FIRST_START; s + SESSION_H <= LAST_END; s++) {
      const hrs = [];
      for (let h = s; h < s + SESSION_H; h++) {
        const v = winds[start + h];
        if (v === undefined || v === null) continue;
        const dir = o.dirs ? (o.dirs[start + h] ?? null) : null;
        hrs.push(scoreHour(v, win) * offshoreMultiplier(dir, o.offshoreDir ?? null));
      }
      if (!hrs.length) continue;
      const avg = Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);
      if (avg > best.score) { best.score = avg; best.startHour = s; best.endHour = s + SESSION_H; }
    }
    return best;
  }

  /** Tages-Score = Score der besten Session. Ein schwacher Vormittag drückt
   *  den Tag damit nicht mehr; es zählt, ob überhaupt eine Session drin ist. */
  function scoreDay(winds, win, opts) {
    return bestSession(winds, win, opts).score;
  }

  /** Stundenweise Score-Reihe für Sparklines (9–18 Uhr), inkl. Offshore-Penalty. */
  function hourlyScores(winds, win, opts) {
    const o = opts || {};
    const start = o.start || 0;
    const out = [];
    for (let h = FIRST_START; h <= 18; h++) {
      const v = winds[start + h];
      if (v === undefined || v === null) { out.push(0); continue; }
      const dir = o.dirs ? (o.dirs[start + h] ?? null) : null;
      out.push(scoreHour(v, win) * offshoreMultiplier(dir, o.offshoreDir ?? null));
    }
    return out;
  }

  // Referenzfahrer für nicht eingeloggte Besucher der Spot-/Vergleichsseiten.
  const GUEST_RIDER = { weight: 75, wingM2: 6, skill: 'intermediate' };

  const guestWindow = () => calcWindow(GUEST_RIDER.weight, GUEST_RIDER.wingM2, GUEST_RIDER.skill);

  /** Rider-Objekt der Hauptapp ({weight,wingSize,skill,planeKn}) → Fenster. */
  function windowFromRider(rider) {
    if (!rider) return null;
    const planeMs = Number(rider.planeKn) > 0 ? knToMs(Number(rider.planeKn)) : null;
    return calcWindow(Number(rider.weight) || GUEST_RIDER.weight,
                      Number(rider.wingSize) || GUEST_RIDER.wingM2,
                      rider.skill || GUEST_RIDER.skill, planeMs);
  }

  /** Lädt das Fahrerprofil aus derselben Quelle wie die Hauptapp (Pref-Key
   *  wf_rider; localStorage zuerst, Server überschreibt). Scheitert nie —
   *  Gäste und Offline-Fälle bekommen den Referenzfahrer.
   *  → { rider, win, isGuest } */
  async function loadRider(fetchImpl) {
    const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    let rider = null;
    try {
      const raw = globalThis.localStorage?.getItem('wf_rider');
      if (raw) rider = JSON.parse(raw);
    } catch { /* privater Modus / kaputter Eintrag */ }
    if (f) {
      try {
        const res = await f('/api/prefs', { credentials: 'include', signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const d = await res.json();
          if (d && typeof d.wf_rider === 'object' && d.wf_rider) rider = d.wf_rider;
        }
      } catch { /* nicht eingeloggt oder offline */ }
    }
    const win = windowFromRider(rider);
    return { rider, win: win || guestWindow(), isGuest: !win };
  }

  /** Setzt den Profil-Hinweis in ein Element, falls vorhanden. */
  function describeRider(rider) {
    return rider
      ? `Scores für ${rider.weight} kg · ${rider.wingSize} m² · ${rider.skill}`
      : `Scores für Referenzfahrer ${GUEST_RIDER.weight} kg · ${GUEST_RIDER.wingM2} m² — anmelden für dein Profil`;
  }

  return { msToKn, knToMs, REF_FOIL_TERM, SESSION_H, FIRST_START, LAST_END, GUEST_RIDER,
           calcWindow, rangeToWindow, blendWindows, scoreHour, offshoreMultiplier,
           meanDirection, bestSession, scoreDay, hourlyScores,
           guestWindow, windowFromRider, loadRider, describeRider };
});
