#!/bin/bash
# fetch-vendor.sh v2 — lädt alle Frontend-Bibliotheken lokal herunter.
# Robust: probiert mehrere Pfade/Versionen und meldet, was klappt.
set -e
mkdir -p vendor
cd vendor

dl () {  # dl <zieldatei> <url1> [url2] [url3]
  local out="$1"; shift
  for url in "$@"; do
    echo "  versuche: $url"
    if curl -fsSL -o "$out" "$url"; then
      echo "  ✅ geladen: $out ($(du -h "$out" | cut -f1))"
      return 0
    fi
  done
  echo "  ❌ FEHLGESCHLAGEN: $out"
  return 1
}

echo "React…"
dl react.production.min.js \
  "https://unpkg.com/react@18/umd/react.production.min.js"

echo "ReactDOM…"
dl react-dom.production.min.js \
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"

echo "react-is (von Recharts benötigt)…"
dl react-is.production.min.js \
  "https://unpkg.com/react-is@18/umd/react-is.production.min.js"

echo "prop-types…"
dl prop-types.min.js \
  "https://unpkg.com/prop-types@15/prop-types.min.js"

echo "Recharts (probiere min, dann normal, mehrere Versionen)…"
dl Recharts.js \
  "https://unpkg.com/recharts@2.12.7/umd/Recharts.js" \
  "https://unpkg.com/recharts@2.15.0/umd/Recharts.js" \
  "https://unpkg.com/recharts/umd/Recharts.js" \
  "https://unpkg.com/recharts@2.12.7/umd/Recharts.min.js" \
  "https://unpkg.com/recharts/umd/Recharts.min.js"

echo "Babel…"
dl babel.min.js \
  "https://unpkg.com/@babel/standalone/babel.min.js"

cd ..
echo ""
echo "=== Ergebnis vendor/ ==="
ls -la vendor/
echo ""
du -h vendor/*.js 2>/dev/null
