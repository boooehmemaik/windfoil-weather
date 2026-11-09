// ============================================================================
// WindFoil — spots.json als einzige Spot-Quelle
// ----------------------------------------------------------------------------
// Die vier Regionsseiten lesen ihre Spots seit dem Shell-Umbau aus spots.json;
// das frühere Nebeneinander von Inline-Array und JSON ist aufgelöst. Geblieben
// ist vergleich.html mit eigenem ALL_SPOTS — dort kann noch Drift entstehen,
// genau wie es dem Scoring passiert ist.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
const SPOTS = JSON.parse(read('spots.json'));

/** Inline-Array aus einer Seite lesen (kein Build-Step, also kein Import). */
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
const allSpots = () => [...Object.values(SPOTS.regions).flatMap(r => r.spots), ...SPOTS.unpagedSpots];
const PAGE_FILE = { sardinia: 'sardinia.html', sizilien: 'sizilien.html', spanien: 'spanien.html', skandinavien: 'skandinavien.html' };

test('spots.json: enthält alle Spots aus vergleich.html', () => {
  const all = pageArray('vergleich.html', 'ALL_SPOTS');
  const known = new Set(allSpots().map(geo));
  assert.deepStrictEqual(all.filter(s => !known.has(geo(s))).map(s => s.name), []);
  assert.strictEqual(known.size, all.length);
});

test('spots.json: jeder Spot hat die Felder, die wf-region.js rendert', () => {
  for (const [key, r] of Object.entries(SPOTS.regions)) {
    for (const s of r.spots) {
      for (const k of ['id', 'name', 'emoji', 'desc', 'lat', 'lon', 'shoreNote', 'color']) {
        assert.ok(s[k] != null && s[k] !== '', `${key}/${s.name || s.id}: ${k} fehlt`);
      }
      assert.ok(Number.isFinite(s.lat) && Number.isFinite(s.lon), `${key}/${s.name}: Koordinate`);
      // camperNote landet als title-Attribut im Badge — ohne Text bliebe es leer.
      if (s.camper) assert.ok(s.camperNote, `${key}/${s.name}: camperNote fehlt`);
    }
  }
});

test('spots.json: offshoreDir ist ein gültiger Kompasskurs oder null', () => {
  for (const s of allSpots()) {
    if (s.offshoreDir == null) continue;
    assert.ok(Number.isFinite(s.offshoreDir) && s.offshoreDir >= 0 && s.offshoreDir < 360,
      `${s.name}: offshoreDir=${s.offshoreDir}`);
  }
});

test('spots.json: Spot-IDs sind global eindeutig', () => {
  const ids = allSpots().map(s => s.id).filter(Boolean);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepStrictEqual([...new Set(dupes)], []);
});

test('spots.json: jede Region verweist auf ihre existierende Seite', () => {
  for (const [key, r] of Object.entries(SPOTS.regions)) {
    assert.strictEqual(r.page, `/${PAGE_FILE[key]}`);
    assert.ok(Array.isArray(r.center) && r.center.length === 2, `${key}: center`);
    assert.ok(Number.isInteger(r.zoom), `${key}: zoom`);
    assert.ok(r.spots.length > 0, `${key}: keine Spots`);
  }
});

// Die Überschrift nennt die Spot-Zahl. Sie steht statisch im Shell-Markup,
// damit die Seite ohne JS schon vollständig lesbar ist — kann darum driften.
test('spots.json: die Spot-Zahl in der Ranking-Überschrift stimmt', () => {
  for (const [key, r] of Object.entries(SPOTS.regions)) {
    const m = read(PAGE_FILE[key]).match(/Gesamt-Ranking[^<]*?(\d+) Spots/);
    assert.ok(m, `${key}: Spot-Zahl nicht in der Überschrift gefunden`);
    assert.strictEqual(Number(m[1]), r.spots.length, `${key}: Überschrift nennt ${m[1]}`);
  }
});

// Jede Region, die vergleich.html verlinkt, muss auch eine Seite haben.
test('spots.json: vergleichRegion-Zuordnung zeigt auf vorhandene Regionen', () => {
  const labels = new Set(Object.values(SPOTS.regions).flatMap(r => r.vergleichRegions || []));
  for (const s of allSpots()) {
    if (!s.vergleichRegion) continue;
    assert.ok(typeof s.vergleichRegion === 'string' && s.vergleichRegion.length > 0,
      `${s.name}: vergleichRegion leer`);
  }
  assert.ok(labels.size > 0, 'keine vergleichRegions definiert');
});
