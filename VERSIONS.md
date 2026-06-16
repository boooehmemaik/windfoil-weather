# WindFoil — Version History

## v3.8.1 (2026-06-16)
**Fix: „echte Wetterstationen" zeigten keine Werte mehr**
- Ursache: Weatherbit-Free-Quota (50/Tag) durch das Nearby-Panel (bis zu 4 Calls/Aufruf) erschöpft → HTTP 429 mit leerem Body → alle Stationswerte null
- Lösung „beides kombinieren" (`proxy-server.js` v2.6.1): Open-Meteo liefert als keyless/unbegrenzte Basis aktuellen Modellwind für ALLE Stationen in EINER Batch-Anfrage; die nächsten Stationen werden zusätzlich auf echte Weatherbit-Messung „geupgradet", solange Quota reicht — sonst stiller Fallback auf Modell. Panel zeigt nie mehr „keine Daten"
- `weatherbitCurrent` härter (kein JSON-Throw bei 429, gibt `{ok:false}` zurück); neuer `openMeteoCurrentBatch`-Helfer; Response-Feld `src` ("obs"|"model")
- `NEARBY_MAX_LIVE` Default 4→2 (quota-schonend; per Env überschreibbar)
- Frontend: Quellen-Tag je Station (● Messung / ≈ Modell), Status „Messung+Modell" bzw. „Modellwind", ehrliche Fußnote

## v3.8.0 (2026-06-16)
**Dark/Light-Theme, pro User wählbar & gespeichert**
- Zwei vollständige Paletten (`THEMES.dark` / `THEMES.light`) mit identischen Tokens; Light Mode behält Struktur & Akzent-Sprache des Dark Mode, Akzente leicht abgedunkelt für Kontrast auf Weiß
- Lebende Palette `C` + `applyTheme(name)`: schaltet `C` und alle abgeleiteten Style-Objekte (Chart-Tooltip/Achsen/Grid, Auth-Palette) in-place um → ein Re-Render thematisiert die ~280 `C.*`-Stellen ohne Umbau
- Umschalter (☀/☾) im Header; vorher hartcodierte dunkle Stellen (Header-BG, Tooltip, Status-Farben, WINDFOIL-Titel) auf Tokens umgestellt
- Persistenz pro User über den Prefs-Store (`wf_theme` zur Allowlist) + localStorage-Cache; Hydration beim Start
- Inline-Pre-Paint-Skript setzt den gespeicherten Theme-Hintergrund vor dem React-Mount (kein Dark-Flash im Light Mode)

## v3.7.0 (2026-06-16)
**Historische Station-↔-Modell-Korrelation via Meteostat (Bias)**
- Ersetzt die Weatherbit-History (lieferte planbedingt nie Daten) durch einen echten Bias: neuer Endpoint `GET /api/station/bias` (`proxy-server.js` v2.6.0)
- Methode: nächste Meteostat-Station mit Stunden-Historie, deren letzte ~45 verfügbaren Tage gegen das Open-Meteo-Archiv **derselben Daten/Stunden** (beide m/s, UTC, Zeitstempel-Alignment). Ein Bias ist zeitstabil → Meteostats ~8-Monats-Verzug ist dafür irrelevant. Meteostat-Wind (km/h) → m/s
- Adaptive Stationswahl (≤60 km, mit Stunden-Inventar), 24 h-Cache (Bulk-Download)
- Stationsliste um `he` (hourly-Inventar-Ende) erweitert → Cache-Datei auf `meteostat-stations-v2.json` versioniert
- `index.html`: `runStationComparison` nutzt `/api/station/bias` (statt der leeren Weatherbit-History) und speist die 35%-Hist-Komponente von `computeConfidence`; Vergleichskarte zeigt Bias-Station + Zeitfenster
- Wirkung verifiziert: z. B. Gialova/GR — Modell unterschätzt Wind um 2,4 m/s → Konfidenz 92→74, Foil-Score wird korrekt gedämpft (vorher blind für systematischen Bias)

## v3.6.0 (2026-06-16)
**Echte Wetterstationen im Umkreis (Meteostat)**
- Ersetzt die fingierten Open-Meteo-Gitterpunkte durch echte Messstationen: neuer Proxy-Endpoint `GET /api/station/nearby` (in `proxy-server.js`, v2.5.0)
- Stationssuche keyless via Meteostat-Bulk-Metadaten (auf Disk + im Speicher gecacht, wöchentlich aktualisiert); adaptiver Radius 25→50→75 km bis ≥5 Stationen; Haversine-Distanz
- Aktuelle Windwerte für die nächstgelegenen Stationen (`NEARBY_MAX_LIVE`, Default 4) über den bestehenden Weatherbit-Proxy (gecacht, quota-schonend); weiter entfernte zeigen nur Position/Distanz
- `weatherbitCurrent()` aus der `/current`-Route extrahiert und geteilt
- `index.html` / `app-react-local.html`: `fetchNearbyStations` ruft jetzt `/api/station/nearby`; Label „Echte Wetterstationen (Umkreis X km)", ehrliche Fußnoten, neuer `nearbyRadius`-State

## v3.5.0 (2026-06-16)
**Hilfeseite + Footer-Link**
- Neue statische Hilfeseite `help.html` (themen-konform, von nginx unter `/help.html` ausgeliefert): Standort, Foil-Score, Profil, Equipment, Feedback, Einheiten, iOS-Standalone
- `index.html` / `app-react-local.html`: „❓ Hilfe"-Link im Footer auf `/help.html`
- Neuer Projekt-Subagent `.claude/agents/windfoil-help.md` baut/aktualisiert die Hilfe und hält den Footer-Link konsistent

## v3.4.0 (2026-06-16)
**Server-seitige Persistenz für iOS Safari**
- Orte (aktiver Spot + „zuletzt verwendet") wandern von localStorage in die DB: neue Tabelle `user_locations` (Migration 003), Route `src/locations.routes.mjs` unter `/api/locations`
- Rider-Profil, Gear-Setups und Auto-Setup-Toggle persistiert via generischem Key-Value-Store: neue Tabelle `user_prefs` (Migration 004), Route `src/prefs.routes.mjs` unter `/api/prefs`
- Grund: iOS Safari verwirft localStorage (Private Mode / „Alle Cookies blockieren" / ITP-Purge) → manuell hinzugefügte Orte & Einstellungen waren nach Reload weg
- `index.html` / `app-react-local.html`: Hydrations-Effekte laden Server-Daten beim Start; `savePref()`-Helfer; localStorage nur noch Offline-Cache
- `src/server.integration.cjs`: beide Router unter `requireAuth` eingehängt (File-Version 2.1.0)

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
