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

  // ── Wing-Herstellertabellen ────────────────────────────────────────────────
  // Je Marke/Modell: Hersteller-Windrange (kn) und Wing-Masse (kg) pro Größe.
  // Die Ranges gelten für ein Referenzgewicht, das echte Gewicht skaliert sie
  // (√-Gesetz). Lag bis v3.36.0 ausschließlich in index.html — damit rechneten
  // vergleich.html, reise.html und der Windalarm das reine Physikmodell und
  // wichen von der Hauptapp ab, obwohl diese Datei Einigkeit verspricht.
  const WING_BRANDS = {
    'Harlem Pace': {
      refWeightKg: 78,
      sizes: {
        3: { rangeKn: [20, 32], wingKg: 1.76 },
        4: { rangeKn: [16, 28], wingKg: 2.12 },
        5: { rangeKn: [14, 26], wingKg: 2.32 },
        6: { rangeKn: [10, 22], wingKg: 2.77 },
      },
    },
  };
  const DEFAULT_WING_BRAND = 'Harlem Pace';
  const TABLE_BLEND = 0.5;        // Gewicht der Tabelle gegenüber dem Physikmodell
  const FEEDBACK_BLEND = 0.5;     // Gewicht der Spot/Wing-Kalibrierung
  const FEEDBACK_MIN_SAMPLES = 1; // ab so vielen Samples greift die Kalibrierung

  /** Hersteller-Windfenster einer Wing-Größe: zwischen den Tabellenstufen
   *  interpoliert und aufs Fahrergewicht reskaliert (wind ∝ √(Gewicht/Referenz)).
   *  Größen außerhalb der Tabelle liefern { outOfRange: true } — keine stille
   *  Extrapolation über 3–6 m² hinaus. */
  function wingTableWindow(weight, wingM2, brandKey) {
    const brand = WING_BRANDS[brandKey || DEFAULT_WING_BRAND];
    if (!brand) return null;
    const stops = Object.keys(brand.sizes).map(Number).sort((a, b) => a - b);
    const lo = stops[0], hi = stops[stops.length - 1];
    if (wingM2 < lo || wingM2 > hi) {
      return { outOfRange: true, reason: `Wing ${wingM2} m² außerhalb Herstellerangabe (${lo}–${hi} m²)` };
    }
    let a = lo, b = hi;
    for (let i = 0; i < stops.length - 1; i++) {
      if (wingM2 >= stops[i] && wingM2 <= stops[i + 1]) { a = stops[i]; b = stops[i + 1]; break; }
    }
    const ra = brand.sizes[a].rangeKn, rb = brand.sizes[b].rangeKn;
    const t = (a === b) ? 0 : (wingM2 - a) / (b - a);
    const f = Math.sqrt(weight / brand.refWeightKg);
    const minMs = knToMs((ra[0] + (rb[0] - ra[0]) * t) * f);
    const maxMs = knToMs((ra[1] + (rb[1] - ra[1]) * t) * f);
    // Hersteller nennen nur die Außenränder; das Optimalband liegt in der oberen
    // Mitte (Foil-Wings tragen mittig-oben am besten). Heuristik, dokumentiert.
    return {
      minWind: r1(minMs),
      optMin: r1(minMs + 0.25 * (maxMs - minMs)),
      optMax: r1(minMs + 0.75 * (maxMs - minMs)),
      maxWind: r1(maxMs),
      outOfRange: false,
    };
  }

  /** Fenster einer Wing-Größe: Physikmodell, geblendet mit der Herstellertabelle,
   *  darüber optional die Spot/Wing-Kalibrierung aus Nutzer-Feedback. */
  function wingWindow(weight, wingM2, skill, knownPlaneMs, brandKey, spotWingRange) {
    const phys = calcWindow(weight, wingM2, skill, knownPlaneMs);
    // Eine gemessene Angleitschwelle ist Ground Truth — die wird nicht verwässert.
    if (knownPlaneMs && knownPlaneMs > 0) return phys;
    const tab = wingTableWindow(weight, wingM2, brandKey);
    const base = (!tab || tab.outOfRange) ? phys : blendWindows(phys, tab, TABLE_BLEND);
    if (spotWingRange && spotWingRange.samples >= FEEDBACK_MIN_SAMPLES
        && spotWingRange.minKn != null && spotWingRange.maxKn != null) {
      return blendWindows(base, rangeToWindow(spotWingRange.minKn, spotWingRange.maxKn), FEEDBACK_BLEND);
    }
    return base;
  }

  /** Foil-Score 0–100 für eine Stunde. */
  function scoreHour(w, win) {
    if (w < win.minWind) return Math.max(0, Math.round((w / win.minWind) * 45));
    if (w < win.optMin)  return Math.round(55 + ((w - win.minWind) / (win.optMin - win.minWind)) * 30);
    if (w <= win.optMax) return 100;
    if (w <= win.maxWind) return Math.round(100 - ((w - win.optMax) / (win.maxWind - win.optMax)) * 50);
    return Math.max(0, Math.round(50 - (w - win.maxWind) * 10));
  }

  // ── Quiver ─────────────────────────────────────────────────────────────────
  // Ein Fahrer hat selten ein Wing. Das fahrbare Windfenster ist deshalb nicht
  // das eines einzelnen Wings, sondern das, was die Tasche zusammen abdeckt —
  // und erst danach die Frage, welche Größe zu dieser Stunde passt.

  /** Die Größen der Herstellertabelle, aufsteigend. */
  function defaultQuiver(brandKey) {
    const brand = WING_BRANDS[brandKey || DEFAULT_WING_BRAND];
    return brand ? Object.keys(brand.sizes).map(Number).sort((a, b) => a - b) : [];
  }

  /** Fahrer + eingetragenes Material → [{ wing, win }], aufsteigend nach Größe.
   *
   *  Leere Materialliste heißt NICHT „ein Wing": wer nichts eingetragen hat, wird
   *  mit dem vollen Harlem-Satz bewertet. Das Gewicht kommt immer aus dem Profil,
   *  die Tabelle skaliert damit — ein 95-kg-Fahrer bekommt andere Fenster als ein
   *  60-kg-Fahrer, bei identischem Quiver.
   *
   *  opts: { brandKey, wingRanges } — wingRanges = Spot-Kalibrierung je Größe. */
  function riderQuiver(rider, gear, opts) {
    const o = opts || {};
    const weight = Number(rider?.weight) || GUEST_RIDER.weight;
    const skill = rider?.skill || GUEST_RIDER.skill;
    const own = Array.isArray(gear) ? gear : [];
    // Die gemessene Angleitschwelle des Profils gilt nur für die Größe, an der
    // sie gemessen wurde. Auf den ganzen Satz angewandt bekämen alle Größen
    // dasselbe Fenster — der Quiver wäre rechnerisch ein einziges Wing.
    const profileSize = Number(rider?.wingSize);
    const list = own.length
      ? own.map(g => ({ wing: Number.parseFloat(g.wing), planeKn: g.planeKn }))
      : defaultQuiver(o.brandKey).map(w => ({
          wing: w,
          planeKn: w === profileSize ? rider?.planeKn : null,
        }));
    return list
      .filter(g => Number.isFinite(g.wing) && g.wing > 0)
      .sort((a, b) => a.wing - b.wing)
      .map(g => ({
        wing: g.wing,
        win: wingWindow(weight, g.wing, skill,
          Number(g.planeKn) > 0 ? knToMs(Number(g.planeKn)) : null,
          o.brandKey || DEFAULT_WING_BRAND,
          o.wingRanges ? o.wingRanges[String(g.wing)] : null),
      }));
  }

  /** Welches Wing trägt diesen Wind am besten? → { wing, win, score } | null
   *
   *  Bewusst kein Union-Fenster: ein Rechteck von der kleinsten minWind bis zur
   *  größten maxWind würde Wind behaupten, den kein einzelnes Wing trägt, sobald
   *  der Quiver eine Lücke hat (3 + 9 m²). Das Maximum über die Einzelfenster
   *  kann das per Konstruktion nicht.
   *
   *  Gleichstand bei 100 entscheidet die Mittigkeit im Optimalband — sonst
   *  entschiede die Reihenfolge der Liste, und das ist keine Entscheidung. */
  function bestWingForWind(quiver, windMs) {
    let best = null;
    for (const q of quiver || []) {
      const score = scoreHour(windMs, q.win);
      const mid = (q.win.optMin + q.win.optMax) / 2;
      const center = 1 - Math.min(1, Math.abs(windMs - mid) / (q.win.optMax - q.win.optMin + 0.01));
      const rank = score * 100 + center * 10;
      if (!best || rank > best.rank) best = { wing: q.wing, win: q.win, score, rank };
    }
    return best;
  }

  /** Score einer Stunde mit dem besten Wing des Quivers. */
  function scoreHourQuiver(windMs, quiver) {
    const best = bestWingForWind(quiver, windMs);
    return best ? best.score : 0;
  }

  /** Score-Funktion für ein Fenster ODER einen Quiver (Array aus riderQuiver).
   *  Damit nehmen bestSession, scoreDay und hourlyScores beides an, ohne dass
   *  es zwei Schleifen über dieselben Stunden gibt. */
  function scorerFor(win) {
    return Array.isArray(win) ? (w => scoreHourQuiver(w, win)) : (w => scoreHour(w, win));
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
   *  win  — Fenster oder Quiver (Array aus riderQuiver)
   *  opts: { start=0 (Tagesoffset im Stundenarray), dirs=null, offshoreDir=null } */
  function bestSession(winds, win, opts) {
    const o = opts || {};
    const start = o.start || 0;
    const scoreAt = scorerFor(win);
    const best = { score: 0, startHour: null, endHour: null };
    for (let s = FIRST_START; s + SESSION_H <= LAST_END; s++) {
      const hrs = [];
      for (let h = s; h < s + SESSION_H; h++) {
        const v = winds[start + h];
        if (v === undefined || v === null) continue;
        const dir = o.dirs ? (o.dirs[start + h] ?? null) : null;
        hrs.push(scoreAt(v) * offshoreMultiplier(dir, o.offshoreDir ?? null));
      }
      if (!hrs.length) continue;
      const avg = Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);
      if (avg > best.score) { best.score = avg; best.startHour = s; best.endHour = s + SESSION_H; }
    }
    return best;
  }

  /** Trägt dieses Fenster den Wind überhaupt?
   *
   *  Unterhalb der Angleitschwelle fällt scoreHour nur linear ab und liefert bei
   *  0,5 m/s noch 4 von 100. Ohne diese Prüfung stünde neben einem windstillen
   *  Tag eine Größenempfehlung — ein Packhinweis für eine Session, die es nicht
   *  gibt. Dieselbe Regel gilt im Stundenband des Charts. */
  function carries(win, windMs) {
    return !!win && windMs >= win.minWind && windMs <= win.maxWind;
  }

  /** Welche Wing-Größe je Stunde einer Session? → [{ hour, wing, score }]
   *  „6 m² morgens, 4 m² ab 15 Uhr" ist die Information, die eine
   *  Tagesempfehlung verschweigt — und die man vor dem Packen braucht.
   *  Stunden, die kein Wing der Tasche trägt, bleiben ohne Eintrag. */
  function sessionWings(winds, quiver, fromHour, toHour, startIdx) {
    const start = startIdx || 0;
    const out = [];
    for (let h = fromHour; h < toHour; h++) {
      const v = winds[start + h];
      if (v === undefined || v === null) continue;
      const best = bestWingForWind(quiver, v);
      if (best && carries(best.win, v)) out.push({ hour: h, wing: best.wing, score: best.score });
    }
    return out;
  }

  /** Die Wing-Größen einer Session, zusammengefasst und in Fahrreihenfolge.
   *  → '6 m²' oder '6 → 4 m²'; leere Session → null. */
  function wingAdvice(wings) {
    const seq = [];
    for (const w of wings || []) if (seq[seq.length - 1] !== w.wing) seq.push(w.wing);
    if (!seq.length) return null;
    return `${seq.join(' → ')} m²`;
  }

  /** Tages-Score = Score der besten Session. Ein schwacher Vormittag drückt
   *  den Tag damit nicht mehr; es zählt, ob überhaupt eine Session drin ist. */
  function scoreDay(winds, win, opts) {
    return bestSession(winds, win, opts).score;
  }

  /** Stundenweise Score-Reihe für Sparklines (9–18 Uhr), inkl. Offshore-Penalty.
   *  win — Fenster oder Quiver. */
  function hourlyScores(winds, win, opts) {
    const o = opts || {};
    const start = o.start || 0;
    const scoreAt = scorerFor(win);
    const out = [];
    for (let h = FIRST_START; h <= 18; h++) {
      const v = winds[start + h];
      if (v === undefined || v === null) { out.push(0); continue; }
      const dir = o.dirs ? (o.dirs[start + h] ?? null) : null;
      out.push(scoreAt(v) * offshoreMultiplier(dir, o.offshoreDir ?? null));
    }
    return out;
  }

  /** Bester zusammenhängender Block aus len Tagen in einer Tages-Score-Reihe.
   *  → { startIdx, endIdx, mean, min } oder null, wenn die Reihe zu kurz ist.
   *
   *  Das Mittel entscheidet, bei Gleichstand der schlechteste Tag: zwei Blöcke
   *  mit Ø 70 sind nicht gleichwertig, wenn einer 70/70 und der andere 100/40
   *  ist — für eine Reise zählt, dass kein Tag ausfällt. */
  function bestBlock(dayScores, len) {
    const s = (dayScores || []).filter(v => Number.isFinite(v));
    const n = Number.isInteger(len) && len > 0 ? len : 1;
    if (s.length < n) return null;

    let best = null;
    for (let i = 0; i + n <= s.length; i++) {
      const part = s.slice(i, i + n);
      const mean = part.reduce((a, b) => a + b, 0) / n;
      const min = Math.min(...part);
      if (!best || mean > best.mean || (mean === best.mean && min > best.min)) {
        best = { startIdx: i, endIdx: i + n - 1, mean: Math.round(mean), min };
      }
    }
    return best;
  }

  // Referenzfahrer für nicht eingeloggte Besucher der Spot-/Vergleichsseiten.
  const GUEST_RIDER = { weight: 75, wingM2: 6, skill: 'intermediate' };

  const guestWindow = () => wingWindow(GUEST_RIDER.weight, GUEST_RIDER.wingM2, GUEST_RIDER.skill, null);

  /** Der Quiver des Referenzfahrers — der volle Harlem-Satz bei 75 kg. */
  const guestQuiver = () => riderQuiver(null, null);

  /** Rider-Objekt der Hauptapp ({weight,wingSize,skill,planeKn}) → Fenster
   *  der EINEN eingestellten Größe, mit Harlem-Blend.
   *  Für die Bewertung ist riderQuiver() die richtige Wahl; dieses Fenster
   *  beschreibt nur, was eine einzelne Größe kann (Profil-Hinweise, Chart-Band). */
  function windowFromRider(rider) {
    if (!rider) return null;
    const planeMs = Number(rider.planeKn) > 0 ? knToMs(Number(rider.planeKn)) : null;
    return wingWindow(Number(rider.weight) || GUEST_RIDER.weight,
                      Number(rider.wingSize) || GUEST_RIDER.wingM2,
                      rider.skill || GUEST_RIDER.skill, planeMs);
  }

  const readJson = raw => { try { return JSON.parse(raw); } catch { return null; } };

  /** Lädt Profil UND Materialliste aus derselben Quelle wie die Hauptapp
   *  (Pref-Keys wf_rider, wf_gear, wf_usegear; localStorage zuerst, Server
   *  überschreibt). Scheitert nie — Gäste und Offline-Fälle bekommen den
   *  Referenzfahrer mit dem Harlem-Quiver.
   *  → { rider, gear, win, quiver, isGuest } */
  async function loadRider(fetchImpl) {
    const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    let rider = null, gear = null, useGear = true;
    try {
      const ls = globalThis.localStorage;
      if (ls) {
        rider = readJson(ls.getItem('wf_rider')) || rider;
        gear = readJson(ls.getItem('wf_gear')) || gear;
        const ug = readJson(ls.getItem('wf_usegear'));
        if (ug === false) useGear = false;
      }
    } catch { /* privater Modus / kaputter Eintrag */ }
    if (f) {
      try {
        const res = await f('/api/prefs', { credentials: 'include', signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const d = await res.json();
          if (d && typeof d.wf_rider === 'object' && d.wf_rider) rider = d.wf_rider;
          if (d && Array.isArray(d.wf_gear)) gear = d.wf_gear;
          if (d && typeof d.wf_usegear === 'boolean') useGear = d.wf_usegear;
        }
      } catch { /* nicht eingeloggt oder offline */ }
    }
    const win = windowFromRider(rider);
    // useGear=false heißt „rechne nicht mit meinem Material" — dann gilt der
    // Harlem-Satz, nicht die eine Profilgröße. Ein Fahrer ohne Material ist
    // kein Fahrer mit genau einem Wing.
    return { rider, gear, win: win || guestWindow(),
             quiver: riderQuiver(rider, useGear ? gear : null), isGuest: !win };
  }

  /** Setzt den Profil-Hinweis in ein Element, falls vorhanden. */
  function describeRider(rider, quiver) {
    const sizes = (quiver || []).map(q => q.wing).join('/');
    const bag = sizes ? ` · Quiver ${sizes} m²` : '';
    return rider
      ? `Scores für ${rider.weight} kg · ${rider.skill}${bag}`
      : `Scores für Referenzfahrer ${GUEST_RIDER.weight} kg${bag} — anmelden für dein Profil`;
  }

  return { msToKn, knToMs, REF_FOIL_TERM, SESSION_H, FIRST_START, LAST_END, GUEST_RIDER,
           WING_BRANDS, DEFAULT_WING_BRAND, TABLE_BLEND, FEEDBACK_BLEND, FEEDBACK_MIN_SAMPLES,
           calcWindow, rangeToWindow, blendWindows, wingTableWindow, wingWindow,
           scoreHour, offshoreMultiplier, meanDirection, bestSession, scoreDay,
           hourlyScores, bestBlock, defaultQuiver, riderQuiver, bestWingForWind,
           scoreHourQuiver, scorerFor, carries, sessionWings, wingAdvice,
           guestWindow, guestQuiver, windowFromRider, loadRider, describeRider };
});
