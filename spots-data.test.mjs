// ============================================================================
// WindFoil — spots.json gegen die Seiten abgleichen
// ----------------------------------------------------------------------------
// spots.json wurde aus den Spot-Seiten und vergleich.html generiert und soll
// die einzige Spot-Quelle werden. Bis die Seiten umgestellt sind, existieren
// die Daten doppelt — dieser Test stellt sicher, dass sie nicht auseinander-
// laufen, so wie es dem Scoring passiert ist.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
const SPOTS = JSON.parse(read('spots.json'));

/** Inline-Array aus einer Seite lesen (die Seiten haben keinen Build-Step,
 *  also gibt es keinen Import — das Array wird aus dem Quelltext geschnitten). */
function pageArray(file, name) {
  const js = [...read(file).matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).join('\n');
  const m = js.match(new RegExp(`const ${name}\\s*=\\s*\\[`));
  assert.ok(m, `${name} nicht in ${file} gefunden`);
  let i = js.indexOf('[', m.index), depth = 0, end = i;
  for (let k = i; k < js.length; k++) {
    if (js[k] === '[') depth++;
    else if (js[k] === ']' && --depth === 0) { end = k; break; }
  }
  return new Function(`return ${js.slice(i, end + 1)}`)();
}

const geo = s => `${s.lat.toFixed(4)},${s.lon.toFixed(4)}`;
const PAGE_FILE = { sardinia: 'sardinia.html', sizilien: 'sizilien.html', spanien: 'spanien.html', skandinavien: 'skandinavien.html' };

for (const [key, region] of Object.entries(SPOTS.regions)) {
  test(`spots.json/${key}: deckungsgleich mit ${PAGE_FILE[key]}`, () => {
    const page = pageArray(PAGE_FILE[key], 'SPOTS');
    assert.strictEqual(region.spots.length, page.length, 'Spot-Anzahl');
    const byGeo = new Map(page.map(s => [geo(s), s]));
    for (const s of region.spots) {
      const p = byGeo.get(geo(s));
      assert.ok(p, `${s.name} fehlt in ${PAGE_FILE[key]}`);
      for (const k of ['id', 'name', 'emoji', 'desc', 'shoreNote', 'color', 'offshoreDir', 'camper']) {
        assert.deepStrictEqual(s[k], p[k], `${key}/${s.name}: ${k} weicht ab`);
      }
    }
  });
}

test('spots.json: enthält alle 40 Spots aus vergleich.html', () => {
  const all = pageArray('vergleich.html', 'ALL_SPOTS');
  const known = new Set([
    ...Object.values(SPOTS.regions).flatMap(r => r.spots.map(geo)),
    ...SPOTS.unpagedSpots.map(geo),
  ]);
  assert.deepStrictEqual(all.filter(s => !known.has(geo(s))).map(s => s.name), []);
  assert.strictEqual(known.size, all.length);
});

test('spots.json: offshoreDir ist ein gültiger Kompasskurs oder null', () => {
  for (const s of [...Object.values(SPOTS.regions).flatMap(r => r.spots), ...SPOTS.unpagedSpots]) {
    if (s.offshoreDir == null) continue;
    assert.ok(Number.isFinite(s.offshoreDir) && s.offshoreDir >= 0 && s.offshoreDir < 360,
      `${s.name}: offshoreDir=${s.offshoreDir}`);
  }
});

test('spots.json: Spot-IDs sind global eindeutig', () => {
  const ids = [...Object.values(SPOTS.regions).flatMap(r => r.spots), ...SPOTS.unpagedSpots]
    .map(s => s.id).filter(Boolean);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepStrictEqual([...new Set(dupes)], []);
});

test('spots.json: jede Region verweist auf ihre existierende Seite', () => {
  for (const [key, r] of Object.entries(SPOTS.regions)) {
    assert.strictEqual(r.page, `/${PAGE_FILE[key]}`);
    assert.ok(Array.isArray(r.center) && r.center.length === 2, `${key}: center`);
    assert.ok(Number.isInteger(r.zoom), `${key}: zoom`);
  }
});

// Nur skandinavien zieht Wassertemperatur von der Marine-API. Das Flag steuert
// spaeter, ob die Template-Seite fetchMarine aufruft.
test('spots.json: sst-Flag passt zur Marine-API-Nutzung der Seite', () => {
  for (const [key, r] of Object.entries(SPOTS.regions)) {
    const usesMarine = read(PAGE_FILE[key]).includes('marine-api.open-meteo.com');
    assert.strictEqual(r.sst, usesMarine, `${key}: sst=${r.sst}, marine-api genutzt=${usesMarine}`);
  }
});

test('spots.json: model-Flag passt zur models-Angabe der Seite', () => {
  for (const [key, r] of Object.entries(SPOTS.regions)) {
    const m = read(PAGE_FILE[key]).match(/models:\s*'([^']+)'/);
    assert.strictEqual(r.model, m ? m[1] : null, `${key}: model`);
  }
});
