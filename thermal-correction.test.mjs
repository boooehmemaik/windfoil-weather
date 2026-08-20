/**
 * thermal-correction.test.mjs
 * Stufe 5 — die Doppelzählungs-Sperre (siehe Plan "Wetter-KI & Machine Learning").
 *
 * Ansatz wie ensemble.test.mjs / wing-scoring.test.mjs: index.html lesen, die
 * relevanten Blöcke extrahieren, in einer vm-Sandbox ausführen.
 *
 * Bewusst werden hier die ECHTEN seaBreeze/measuredWeight verwendet, nicht
 * Stubs. Die Property "addMs liegt zwischen den beiden Summanden" ist wertlos,
 * wenn sie gegen eine nachgebaute seaBreeze bewiesen wird — die Doppelzählung
 * entstünde ja gerade aus der echten.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const HTML = fs.readFileSync('/var/www/windfoil/index.html', 'utf8');

/** Schneidet den Inhalt zwischen `// <<name>>` und `// <</name>>` heraus. */
function sentinel(name) {
  const a = `// <<${name}>>`, b = `// <</${name}>>`;
  const i = HTML.indexOf(a), j = HTML.indexOf(b);
  assert(i !== -1, `Sentinel <<${name}>> nicht gefunden in index.html`);
  assert(j !== -1, `Sentinel <</${name}>> nicht gefunden in index.html`);
  assert(i < j, `Sentinels <<${name}>> in falscher Reihenfolge`);
  return HTML.slice(i + a.length, j);
}

/** Schneidet eine freistehende Funktion zwischen zwei Textmarken heraus. */
function slice(from, to) {
  const i = HTML.indexOf(from), j = HTML.indexOf(to, i);
  assert(i !== -1 && j !== -1, `Quelltext-Bereich "${from}" nicht gefunden`);
  return HTML.slice(i, j);
}

// angDiff und seaBreeze liegen ausserhalb jedes Sentinel-Blocks; sie werden
// wörtlich mitgenommen, damit der Test bei einer seaBreeze-Änderung mitläuft.
const angDiffSrc   = slice('function angDiff(', '\n') + '\n';
const seaBreezeSrc = slice('function seaBreeze(', '// <<wing-scoring>>');

const ctx = vm.createContext({ console });
const api = vm.runInContext(
  `${angDiffSrc}\n${seaBreezeSrc}\n${sentinel('measured-correction')}\n${sentinel('thermal-correction')}
   ;({ thermalCorrection, mosWeight, seaBreeze, measuredWeight, clamp01,
       MOS_MIN_SAMPLES, MOS_W_K, STATION_TRUST_AT_SPOT, STATION_MAX_KM })`, ctx);

const {
  thermalCorrection, mosWeight, seaBreeze, measuredWeight, clamp01,
  MOS_MIN_SAMPLES, MOS_W_K, STATION_TRUST_AT_SPOT, STATION_MAX_KM,
} = api;

/** Baut eine /api/station/mos-Antwort mit EINER belegten Stunde. */
const mosOf = (hour, n, biasShrunkMs, km) => ({
  ok: true, stationKey: 'test', hours: Object.assign(new Array(24).fill(null), {
    [hour]: { biasMs: biasShrunkMs, biasShrunkMs, madMs: 0.5, n },
  }),
  station: { key: 'test', label: 'Test', km },
});

// ── Konstanten: die Kompoundierung ist beabsichtigt, aber nur bei diesen Werten
test('Konstanten spiegeln den Serverwert bzw. den Plan', () => {
  assert.equal(MOS_MIN_SAMPLES, 8, 'muss MOS_MIN_SAMPLES aus src/mos.mjs spiegeln');
  assert.equal(MOS_W_K, 8, 'MOS_W_K=15 macht MOS faktisch nie wirksam (Plan Stufe 5)');
});

// ── mosWeight ────────────────────────────────────────────────────────────────

test('mosWeight: unter MOS_MIN_SAMPLES exakt 0 — nicht "klein"', () => {
  for (let n = 0; n < MOS_MIN_SAMPLES; n++) assert.equal(mosWeight(n, 0), 0, `n=${n}`);
  assert.equal(mosWeight(null, 0), 0);
  assert.equal(mosWeight(undefined, 0), 0);
});

test('mosWeight: Station am Spot (0 km) ⇒ reine n-Dämpfung n/(n+8)', () => {
  assert.equal(mosWeight(8, 0), 8 / 16);
  // Der im Kommentar dokumentierte Referenzwert: n=13, km=0 ⇒ 0.62.
  assert.equal(Math.round(mosWeight(13, 0) * 100) / 100, 0.62);
});

test('mosWeight: Distanz dämpft — Vasiliki/LGPZ bei 35.5 km ist Rauschen', () => {
  // Der Distanz-Deckel ist measuredWeight(35.5)/0.8 = 1 - 35.5/50 = 0.29;
  // die n-Dämpfung drückt darunter. Selbst bei n→∞ bleibt der MOS-Anteil unter
  // einem Drittel — ein Flughafen 35 km entfernt hat den Eric nicht gemessen.
  assert.ok(mosWeight(1e6, 35.5) <= 0.29 + 1e-9, `Deckel verletzt: ${mosWeight(1e6, 35.5)}`);
  const w = mosWeight(100, 35.5);
  assert.ok(w > 0.26 && w < 0.29, `erwartet ~0.27, war ${w}`);
  // Bei einem LGPZ-Bias von ~+0.5 m/s bleiben davon ~0.13 m/s. Das ist Rauschen.
  assert.ok(w * 0.5 < 0.15);
});

test('mosWeight: ab STATION_MAX_KM exakt 0', () => {
  assert.equal(mosWeight(100, STATION_MAX_KM), 0);
  assert.equal(mosWeight(100, 999), 0);
});

test('mosWeight: fehlende Distanz zählt als "am Spot" (measuredWeight-Vertrag)', () => {
  assert.equal(mosWeight(100, null), mosWeight(100, 0));
});

test('mosWeight: liegt immer in [0,1]', () => {
  for (const n of [8, 13, 50, 1e9]) for (const km of [0, 1, 12.5, 49.9, 50, 1e6]) {
    const w = mosWeight(n, km);
    assert.ok(w >= 0 && w <= 1, `n=${n} km=${km} → ${w}`);
  }
});

// ── thermalCorrection: Vertrag ───────────────────────────────────────────────

test('ohne MOS: reines seaBreeze, source="seabreeze", n=0', () => {
  const regime = { dir: 195, peakHour: 14 };
  for (const mos of [null, undefined, {}, { ok: true }, { ok: true, hours: new Array(24).fill(null) }]) {
    const tc = thermalCorrection(14, 195, 8, regime, mos);
    const sb = seaBreeze(195, 14, 8, regime);
    assert.equal(tc.addMs, sb.boost);
    assert.equal(tc.source, 'seabreeze');
    assert.equal(tc.mosWeight, 0);
    assert.equal(tc.n, 0);
  }
});

test('MOS mit n < MOS_MIN_SAMPLES: seaBreeze bleibt, n wird aber durchgereicht', () => {
  // Die UI braucht n für "lernt noch, 5/8 Tage" — deshalb darf es nicht auf 0
  // fallen, nur weil die Korrektur noch nicht greift.
  const regime = { dir: 195, peakHour: 14 };
  const tc = thermalCorrection(14, 195, 8, regime, mosOf(14, 5, 2.0, 0));
  assert.equal(tc.source, 'seabreeze');
  assert.equal(tc.n, 5);
  assert.equal(tc.mosWeight, 0);
  assert.equal(tc.addMs, seaBreeze(195, 14, 8, regime).boost);
});

test('sb wird IMMER mitgeliefert — dayData.sb wird an zwei UI-Stellen gelesen', () => {
  const regime = { dir: 195, peakHour: 14 };
  for (const mos of [null, mosOf(14, 5, 2.0, 0), mosOf(14, 30, 2.0, 0)]) {
    const tc = thermalCorrection(14, 195, 8, regime, mos);
    assert.ok(tc.sb && typeof tc.sb.boost === 'number' && typeof tc.sb.active === 'boolean',
      'tc.sb fehlt oder hat die falsche Form');
  }
});

test('NEGATIVER Bias überlebt — der teure Fehler ist versprochener Abendwind', () => {
  // Talamone 21h: Modell 1.84 m/s, gemessen 0.22. Ein raise-only-Clamp hier
  // würde weiter Wind versprechen, der nicht da ist.
  const regime = { dir: 250, peakHour: 15 };
  const tc = thermalCorrection(21, 250, 8, regime, mosOf(21, 14, -1.52, 0));
  assert.equal(seaBreeze(250, 21, 8, regime).boost, 0, 'seaBreeze ist ab 20h inaktiv');
  assert.ok(tc.addMs < 0, `erwartet negativ, war ${tc.addMs}`);
  assert.equal(tc.source, 'blend');   // n=14 ⇒ w=0.64, siehe Schwellen-Test unten
});

test('source="mos" verlangt n>=46 UND km<=1.8 — das Badge sagt lange "blend"', () => {
  // Nicht offensichtlich und für die UI von Stufe 6 relevant: die 0.85-Schwelle
  // ist an einer Station am Spot erst ab n/(n+8) >= 0.85 erreichbar, also ab 46
  // Tagen. Bei MOS_LOOKBACK_D=60 ist das erreichbar, aber erst nach ~7 Wochen.
  assert.equal(thermalCorrection(14, 195, 8, { dir: 195 }, mosOf(14, 45, 2, 0)).source, 'blend');
  assert.equal(thermalCorrection(14, 195, 8, { dir: 195 }, mosOf(14, 46, 2, 0)).source, 'mos');
  // Und die Distanz deckelt zusätzlich: bei n=60 (Fenstermaximum) reicht es nur
  // bis ~1.8 km. Talamone (0.9 km) schafft es, eine Station bei 3 km nie.
  assert.equal(thermalCorrection(14, 195, 8, { dir: 195 }, mosOf(14, 60, 2, 1.5)).source, 'mos');
  assert.equal(thermalCorrection(14, 195, 8, { dir: 195 }, mosOf(14, 60, 2, 3.0)).source, 'blend');
});

test('source: mos ab w>=0.85, sonst blend', () => {
  const regime = { dir: 195, peakHour: 14 };
  const hi = thermalCorrection(14, 195, 8, regime, mosOf(14, 1000, 2.0, 0));
  assert.ok(hi.mosWeight >= 0.85);
  assert.equal(hi.source, 'mos');
  const mid = thermalCorrection(14, 195, 8, regime, mosOf(14, 13, 2.0, 0));
  assert.ok(mid.mosWeight < 0.85 && mid.mosWeight > 0);
  assert.equal(mid.source, 'blend');
});

test('Distanz allein kann source nie auf "mos" heben', () => {
  // measuredWeight(km)/0.8 <= 1, und n/(n+8) < 1 — bei 12.5 km ist der Deckel
  // 0.75, also strukturell unter der 0.85-Schwelle.
  const regime = { dir: 195, peakHour: 14 };
  const tc = thermalCorrection(14, 195, 8, regime, mosOf(14, 1e6, 2.0, 12.5));
  assert.equal(tc.source, 'blend');
});

// ── Die Property: keine Doppelzählung ────────────────────────────────────────

test('PROPERTY: addMs ∈ [min(mosBias,sbBoost), max(mosBias,sbBoost)] — 20000 Fälle', () => {
  // Das ist die eigentliche Zusicherung von Stufe 5. Eine Konvexkombination
  // w*a + (1-w)*b kann per Konstruktion nicht über max(a,b) hinaus, egal wie w
  // steht — solange w wirklich in [0,1] liegt. Genau das wird hier erschöpfend
  // ausgereizt, inklusive der Ränder, an denen mosWeight kippt.
  const EPS = 0.011;   // addMs wird auf 2 Nachkommastellen gerundet
  let seed = 20260820;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = a => a[Math.floor(rnd() * a.length)];

  let blends = 0, mosWins = 0, negatives = 0, worst = 0;

  for (let i = 0; i < 20000; i++) {
    const hour   = Math.floor(rnd() * 24);
    const dir    = rnd() * 360;
    const month  = 1 + Math.floor(rnd() * 12);
    const regime = { dir: pick([195, 250, 300, 20]), peakHour: pick([13, 14, 15, 16]) };
    // n auch unter der Schwelle und weit darüber; km auch jenseits STATION_MAX_KM.
    const n      = pick([0, 1, 7, 8, 9, 13, 14, 30, 200, 1e6]);
    const km     = pick([0, 0.5, 3.8, 12.5, 35.5, 49.9, 50, 120, null]);
    // Bias in beide Richtungen bis an den Server-Clamp ±3.0.
    const bias   = Math.round((rnd() * 6 - 3) * 100) / 100;

    const tc  = thermalCorrection(hour, dir, month, regime, mosOf(hour, n, bias, km));
    const sb  = seaBreeze(dir, hour, month, regime);
    const sbB = sb.active ? sb.boost : 0;
    // Greift MOS an dieser Stunde nicht, ist die einzige zulässige Antwort sbB.
    const applies = n >= MOS_MIN_SAMPLES && mosWeight(n, km) > 0;
    const lo = applies ? Math.min(bias, sbB) : sbB;
    const hi = applies ? Math.max(bias, sbB) : sbB;

    assert.ok(tc.addMs >= lo - EPS && tc.addMs <= hi + EPS,
      `Doppelzählung bei hour=${hour} dir=${dir.toFixed(1)} month=${month} ` +
      `n=${n} km=${km} bias=${bias} sbB=${sbB}: addMs=${tc.addMs} ∉ [${lo}, ${hi}]`);
    assert.ok(tc.mosWeight >= 0 && tc.mosWeight <= 1, `mosWeight ausserhalb [0,1]: ${tc.mosWeight}`);

    if (tc.source === 'blend') blends++;
    if (tc.source === 'mos') mosWins++;
    if (tc.addMs < 0) negatives++;
    worst = Math.max(worst, tc.addMs);
  }

  // Ein Test, der die Property erfüllt, weil MOS nie greift, beweist nichts.
  assert.ok(blends  > 500, `zu wenige blend-Fälle (${blends}) — Stichprobe deckt Stufe 5 nicht ab`);
  assert.ok(mosWins > 100, `zu wenige mos-Fälle (${mosWins}) — Stichprobe deckt Stufe 5 nicht ab`);
  assert.ok(negatives > 100, `zu wenige negative addMs (${negatives}) — der Vorzeichenfall fehlt`);
  // Die alte Stapelung hätte hier bis ~6.5 m/s erreicht (3.5 seaBreeze + 3.0 MOS).
  assert.ok(worst <= 3.5 + EPS, `Obergrenze verletzt: ${worst}`);
});

test('PROPERTY-Gegenprobe: die naive Addition VERLETZT dieselbe Schranke', () => {
  // Sicherung gegen einen Test, der auch dann grün wäre, wenn die Sperre fehlte.
  const regime = { dir: 195, peakHour: 14 };
  const sbB = seaBreeze(195, 14, 8, regime).boost;
  assert.ok(sbB > 0, 'Vorbedingung: seaBreeze ist hier aktiv');
  const bias = 2.5;
  assert.ok(sbB + bias > Math.max(sbB, bias) + 0.011,
    'Testaufbau kaputt: die naive Addition müsste die Schranke sprengen');
  const tc = thermalCorrection(14, 195, 8, regime, mosOf(14, 1e6, bias, 0));
  assert.ok(tc.addMs <= Math.max(sbB, bias) + 0.011,
    `thermalCorrection stapelt: ${tc.addMs} > max(${sbB}, ${bias})`);
});

// ── Abnahmekriterium aus dem Plan ────────────────────────────────────────────

test('Abnahme Stufe 5: Torbole 14:00 ≈ 2.4, NICHT ~4.8 (alte Stapelung)', () => {
  // Gardasee-Ora ~195°, Station am Spot (0 km), n=13 wie real gemessen.
  const regime = { dir: 195, peakHour: 14 };
  const sbB = seaBreeze(195, 14, 8, regime).boost;
  const tc  = thermalCorrection(14, 195, 8, regime, mosOf(14, 13, 2.25, 0));
  assert.ok(tc.addMs < sbB + 2.25 - 0.5, `stapelt: ${tc.addMs} vs. naiv ${sbB + 2.25}`);
  assert.ok(tc.addMs > 0 && tc.addMs <= Math.max(sbB, 2.25),
    `addMs=${tc.addMs} ausserhalb [0, max(${sbB}, 2.25)]`);
});

test('clamp01 ist der Grund, warum die Schranke hält', () => {
  assert.equal(clamp01(-5), 0);
  assert.equal(clamp01(0.42), 0.42);
  assert.equal(clamp01(5), 1);
});

// ── Kanarienvogel gegen Drift in index.html ──────────────────────────────────

test('index.html verdrahtet thermalCorrection, nicht mehr seaBreeze direkt', () => {
  // v3.19.0 war exakt ein Bug dieser Klasse: Thermik in manchen Scoring-Pfaden
  // angewendet, in anderen nicht. Bleibt ein direkter seaBreeze-Aufruf in einem
  // Scoring-Pfad stehen, ist die Sperre dort umgangen.
  // Kommentarzeilen zählen nicht mit — im Block-Kommentar von thermal-correction
  // steht seaBreeze() als Prosa.
  const code = HTML.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const calls = [...code.matchAll(/\bseaBreeze\(/g)].length;
  assert.equal(calls, 2,
    `seaBreeze( ${calls}× im Code — erlaubt sind genau 2 (Definition + Aufruf in ` +
    `thermalCorrection). Ein zusätzlicher Aufruf umgeht die Doppelzählungs-Sperre.`);
});
