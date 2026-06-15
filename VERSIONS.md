# WindFoil — Version History

## v3.3.6 (2026-06-15)
**Auth-Gate im Frontend verdrahtet**
- `index.html` / `app-react-local.html`: Root-Render auf `<AuthGate><App/></AuthGate>` umgestellt via dynamischem `import()` des ESM-Bundles
- `deploy.sh`: Esbuild-Entry auf `src/AuthGate.jsx` geändert (enthält Better-Auth-Client transitiv); Ausgabe korrigiert auf `vendor/auth-client.bundle.js`
- `vendor/react-esm-shim.js` in korrektes Verzeichnis verschoben (`public/vendor/` → `vendor/`), damit importmap und Bundle-Pfade übereinstimmen
- Eine React-Instanz: ESM-Bundle nutzt `react`-External → importmap → UMD-`window.React`; kein "invalid hook call"

## v3.3.5 (2026-06-15)
**Unified release: Frontend v3.3.0 + Backend v2.5.0**
- Frontend v3.3.0 wiederhergestellt (war durch v2.5.0-Backend-Commit auf v2.7.0 zurückgefallen)
- Tab-Konfidenz, Unsicher-Label, farbiger Foil-Score, 7-Tage-Analyse, Skill-Level-Korrekturen
- Backend: Better Auth, SQLite, Feedback-Loop, Drift-Analytics, alle `/api/*`-Routen in `proxy-server.js` eingehängt
- ESM-importmap + `react-esm-shim.js` für CDN-freies Auth-Bundle

## v3.3.0 (2026-06-12)
- Tab-Konfidenz: stationsbereinigter Score auf Tages-Tab (d=0)
- „≈ unsicher"-Label + Opacity 0.72 für Prognosetage 4–7
- Foil-Score-Karte mit farbigem linken Rand und Score-Farbverlauf

## v3.2.1 (2026-06-12)
- Score-Konsistenz-Fix: Tab und Karte zeigen immer gleichen Score

## v3.2.0 (2026-06-11)
- 7-Tage-Analyse (statt 4)

## v3.1.0 (2026-06-10)
- Skill-Level-Interpolation korrigiert (Pro/Advanced-Bug behoben)

## v3.0.0 (2026-06-09)
- Analyse-Layout neu geordnet

## v2.9.0 (2026-06-08)
- Rider+Equipment Grid-Layout, einheitliche Felder, iPhone-Fixes

## v2.8.0 (2026-06-07)
- Wind-Böen-Graph entfernt; Standort & Eingabe hervorgehoben

## v2.5.0 (2026-06-15) — Backend-Architektur
- User-Management (Better Auth), Post-Session-Feedback-Loop, SQLite-Datenbank
- Profil, Equipment, Analytics, Feedback-API-Routen
- DriftChart.jsx, SessionFeedback.jsx, AuthGate.jsx
- Admin-Deploy-Endpoint, systemd-Service (windfoil-proxy)
