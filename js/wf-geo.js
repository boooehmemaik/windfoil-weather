/* ============================================================================
 * WindFoil — Geodäsie für die Radiussuche
 * ----------------------------------------------------------------------------
 * Entfernung und Kurs zwischen zwei Koordinaten. Eigene Datei, weil das weder
 * Scoring (js/wf-scoring.js) noch Darstellung (js/wf-region.js) ist und der
 * Reiseplaner es im Browser wie im Test braucht.
 *
 * Großkreis, nicht Luftlinie auf der Karte: bei 1.000 km Radius liegt eine
 * Mercator-Näherung in Skandinavien um über 100 km daneben.
 *
 * Klassisches Script (kein ES-Modul) — die Seiten haben keinen Build-Step.
 * ==========================================================================*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;  // Node-Tests
  root.WFGeo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EARTH_R_KM = 6371.0088;   // IUGG-Mittelradius
  const rad = d => d * Math.PI / 180;
  const deg = r => r * 180 / Math.PI;

  const isCoord = p => p != null && Number.isFinite(p.lat) && Number.isFinite(p.lon);

  /** Großkreisentfernung in km, oder null wenn eine Koordinate fehlt.
   *  null statt 0: 0 km würde „gleicher Ort" behaupten und den Spot im
   *  Radiusfilter immer gewinnen lassen. */
  function haversineKm(a, b) {
    if (!isCoord(a) || !isCoord(b)) return null;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2
      + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /** Anfangskurs von a nach b in Grad [0,360).
   *  Das ist die Fahrtrichtung — nicht zu verwechseln mit der Windrichtung,
   *  die angibt, WOHER der Wind kommt. */
  function bearingDeg(a, b) {
    if (!isCoord(a) || !isCoord(b)) return null;
    const dLon = rad(b.lon - a.lon);
    const y = Math.sin(dLon) * Math.cos(rad(b.lat));
    const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat))
      - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }

  /** Spots innerhalb von radiusKm um center, aufsteigend nach Entfernung.
   *  radiusKm = null hebt den Filter auf; Spots ohne Koordinate fallen raus,
   *  statt als Entfernung 0 vorne zu stehen. */
  function withinRadius(center, spots, radiusKm) {
    return (spots || [])
      .map(s => ({ spot: s, distanceKm: haversineKm(center, s), bearing: bearingDeg(center, s) }))
      .filter(r => r.distanceKm != null && (radiusKm == null || r.distanceKm <= radiusKm))
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  return { EARTH_R_KM, haversineKm, bearingDeg, withinRadius };
});
