// ============================================================================
// WindFoil — Statik-Check der buildfreien Seiten
// ----------------------------------------------------------------------------
// Die Spot-Seiten haben keinen Build-Step und keine Tests, die den DOM fahren.
// Ein Refactor (e9f86c4) hat deshalb unbemerkt vier Funktionen und das
// return-Statement von dayStats aus sizilien.html/skandinavien.html gelöscht —
// beide Seiten waren live kaputt, ohne dass ein Test rot wurde.
//
// Dieser Test parst den Seiten-JS und prüft:
//   1. syntaktische Gültigkeit
//   2. jeder lokal aufgerufene Name ist auch definiert
//   3. jede Funktion mit Rückgabewert-Nutzung hat ein return
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const PAGES = ['sardinia.html', 'sizilien.html', 'spanien.html', 'skandinavien.html', 'vergleich.html'];

// Browser-Globals + Bibliotheken, die zur Laufzeit da sind, aber nicht im Script stehen.
const AMBIENT = new Set([
  'Array', 'Boolean', 'Date', 'Error', 'JSON', 'Map', 'Math', 'Number', 'Object',
  'Promise', 'Set', 'String', 'AbortSignal', 'Intl',
  'parseFloat', 'parseInt', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'fetch', 'setTimeout', 'setInterval', 'clearTimeout',
  'clearInterval', 'requestAnimationFrame', 'alert', 'confirm',
  'console', 'document', 'window', 'localStorage', 'navigator', 'location',
  'URLSearchParams', 'URL', 'RegExp',
  'L',   // Leaflet
  'WF',  // js/wf-scoring.js
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function',
  'new', 'await', 'else', 'do', 'in', 'of', 'case',
]);

/** Alle <script>-Blöcke ohne src zusammenfassen. */
function pageScript(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).join('\n;\n');
}

/** Bezeichner, die im Script als Funktion definiert werden. */
function definedNames(js) {
  const out = new Set();
  for (const m of js.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) out.add(m[1]);
  // const foo = (…) => …   /   const foo = function …   /   const foo = async (…) =>
  for (const m of js.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/g)) out.add(m[1]);
  return out;
}

/** Entfernt Kommentare, String- und Regex-Inhalte, behält aber `${…}`-Ausdrücke
 *  aus Template-Literalen — dort stehen die Renderer-Aufrufe der Seiten.
 *  Ohne das matcht ein naiver Regex Fließtext wie "7 Spots (…)" oder "rgba(". */
function stripLiterals(src) {
  let out = '', i = 0;
  const tmplStack = [];           // offene `…` je ${}-Verschachtelungstiefe
  let braceDepth = 0;
  const prevSignificant = () => { const m = out.match(/([^\s])\s*$/); return m ? m[1] : ''; };

  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && d === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
    if (c === '/' && !'})]'.includes(prevSignificant()) && !/[\w$]/.test(prevSignificant())) {
      i++;                                                   // Regex-Literal überspringen
      while (i < src.length && src[i] !== '/') i += src[i] === '\\' ? 2 : 1;
      i++; out += ' '; continue;
    }
    if (c === "'" || c === '"') {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      i++; out += ' '; continue;
    }
    if (c === '`') { tmplStack.push(braceDepth); i++; out += ' '; continue; }
    if (tmplStack.length && tmplStack[tmplStack.length - 1] === braceDepth) {
      // innerhalb des Textteils eines Template-Literals
      if (c === '\\') { i += 2; continue; }
      if (c === '$' && d === '{') { braceDepth++; i += 2; out += ' '; continue; }
      i++; continue;
    }
    if (c === '{') braceDepth++;
    if (c === '}') {
      braceDepth--;
      if (tmplStack.length && tmplStack[tmplStack.length - 1] === braceDepth) { i++; out += ' '; continue; }
    }
    if (c === '`') { tmplStack.pop(); i++; out += ' '; continue; }
    out += c; i++;
  }
  return out;
}

/** Bezeichner, die als `name(` aufgerufen werden — ohne Methodenaufrufe `.name(`. */
function calledNames(js) {
  const out = new Set();
  for (const m of stripLiterals(js).matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) out.add(m[1]);
  return out;
}

for (const page of PAGES) {
  const html = readFileSync(new URL(`./${page}`, import.meta.url), 'utf8');
  const js = pageScript(html);

  test(`${page}: Script ist syntaktisch gültig`, () => {
    assert.ok(js.trim().length > 0, 'kein Inline-Script gefunden');
    assert.doesNotThrow(() => new Function(js));
  });

  test(`${page}: jeder Funktionsaufruf ist aufgelöst`, () => {
    const defined = definedNames(js);
    const missing = [...calledNames(js)]
      .filter(n => !defined.has(n) && !AMBIENT.has(n))
      // Bezeichner, die im Script irgendwo deklariert werden (Parameter, Destructuring),
      // tauchen als Aufruf nur bei Callback-Durchreichung auf — die prüft der Parse-Test.
      .filter(n => !new RegExp(`(?:const|let|var|function|,|\\()\\s*${n}\\b`).test(js));
    assert.deepStrictEqual(missing, [], `undefinierte Aufrufe in ${page}: ${missing.join(', ')}`);
  });
}

// dayStats liefert das Objekt, aus dem Karten, Marker und Ranking gebaut werden.
// Fehlt das return, rendert die Seite nichts — genau der Fall von e9f86c4.
for (const page of PAGES.filter(p => p !== 'vergleich.html')) {
  test(`${page}: dayStats gibt ein Objekt zurück`, () => {
    const js = pageScript(readFileSync(new URL(`./${page}`, import.meta.url), 'utf8'));
    const fn = js.match(/function dayStats[\s\S]*?\n\}/);
    assert.ok(fn, 'dayStats nicht gefunden');
    const returns = fn[0].match(/return\s*\{/g) || [];
    assert.ok(returns.length >= 2,
      `dayStats braucht Guard- und Ergebnis-return, gefunden: ${returns.length}`);
    assert.match(fn[0], /avgWindKn/, 'avgWindKn fehlt im Rückgabeobjekt');
  });
}

// Die vier Renderer wurden von e9f86c4 gelöscht. Sie sind seitenlokal (unterschiedliche
// Signaturen je Region), gehören also nicht in wf-scoring.js — aber da sein müssen sie.
const RENDERERS = ['dayLabel', 'windArrowSvg', 'buildCard', 'switchDay'];
for (const page of ['sardinia.html', 'sizilien.html', 'spanien.html', 'skandinavien.html']) {
  test(`${page}: Renderer ${RENDERERS.join('/')} definiert`, () => {
    const defined = definedNames(pageScript(readFileSync(new URL(`./${page}`, import.meta.url), 'utf8')));
    assert.deepStrictEqual(RENDERERS.filter(r => !defined.has(r)), []);
  });
}
