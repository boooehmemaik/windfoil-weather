# DESIGN — ML für alle Spots + historischer Backfill (v3.42.0)

File version: 1.1.0 · App target: v3.42.0 · Phase 3 (🟦 Architect) · nach QA-Review überarbeitet

## Ziel

Neural-MOS + linearer MOS lernen bisher nur an 5 Stationen (torbole, ulcinj,
LGPZ, LGKL, talamone) und nur aus live gepollten Daten (≤ 90 Tage, `ml_samples`
wird gepruned). Neue Spots brauchen dadurch Monate, bis ≥ 60 Paare da sind.

Neu:
1. **Jeder Spot** (spots.json + Zusatzliste + alle `user_locations`) bekommt
   automatisch die beste reale Station im Umkreis (bevorzugt ≤ 20 km, max 40 km).
2. **Historischer Backfill**: 24 Monate Stationsbeobachtungen + die damaligen
   Modellprognosen (lead 0/24/48) → sofort tausende Trainingspaare je Station.
3. **Eval-Gate**: ein Modell wird nur aktiv, wenn es auf einem chronologischen
   Holdout besser ist als das Rohmodell (MAE).
4. Neue Stationen werden **stündlich live** nachgepollt (METAR-Batch).

## Datenquellen

| Zweck | Quelle | Bemerkung |
|---|---|---|
| Stationskatalog | `bulk.meteostat.net/v2/stations/lite.json.gz` | keyless, hat icao/wmo/timezone/inventory.hourly.end |
| Obs-Historie (Jahre) | `data.meteostat.net/hourly/{year}/{id}.csv.gz` | km/h, Header + `*_source`; Modell-Lückenfüller werden verworfen. `bulk.meteostat.net` v2 ist seit 01/2026 eingefroren |
| Obs-Historie (bis gestern, ICAO) | IEM ASOS `mesonet.agron.iastate.edu/cgi-bin/request/asos.py` | globale METARs, kn |
| Obs live (ICAO) | `aviationweather.gov/api/data/metar?ids=A,B,…` | 1 Request für alle Stationen |
| Modell lead 0 | `historical-forecast-api.open-meteo.com` (best_match) | identisch zum Live-Poller |
| Modell lead 24/48 | `previous-runs-api.open-meteo.com` (`*_previous_day1/2`) | ab ~2024, Lücken tolerieren |
| Ensemble-Median (linearer MOS) | `mos.fetchHistoricalEnsemble(st with tz:'GMT')` | gleicher Modell-Key `ens_median_v1` |

Obs-Priorität je Stunde: IEM (wenn ICAO und vorhanden) > Meteostat.

## Stationswahl (`pickStation`)

Kandidaten: Meteostat-Stationen mit `hourly.end` ≤ 400 Tage alt, Distanz ≤ 40 km.
Sortierung nach Distanz; eine ICAO-Station gewinnt gegen die nächste Nicht-ICAO,
wenn `km_icao ≤ max(preferKm, 1.5 × km_nearest)` (wegen Live-Polling).
Station-Key: `icao` falls vorhanden (→ LGKL/LGPZ verbinden sich automatisch mit
den bestehenden Live-`ml_samples`), sonst `ms:<meteostatId>`.
Spots, die bereits eine LIVE/MEASURED-Station haben, behalten diese für die
Anzeige; die Meteostat-Station wird trotzdem angelernt.

## Schema — Migration 013 (additiv)

```sql
ml_stations(station_key PK, meteostat_id, icao, wmo, label, lat, lon, elev, tz,
            hourly_end, live_source, enabled, created_at, updated_at)
ml_station_spots(station_key, spot_id, spot_name, spot_lat, spot_lon, km,
                 PK(station_key, spot_id))
ml_history(station_key, ts, fc_lead_hours, hour_local, month,
           obs_wind_ms, obs_gust_ms, obs_dir_deg,
           fc_wind_ms, fc_dir_deg, fc_pressure_hpa, fc_temp_c, fc_cape,
           fc_ens_wind_ms, bias_ms, source, PK(station_key, ts, fc_lead_hours))
ml_backfill_progress(station_key, chunk 'YYYY-MM', status, rows, error, updated_at,
                     PK(station_key, chunk))
```
`ml_history.ts` ist **stundengenau** `YYYY-MM-DDTHH:00:00Z`; kein Pruning.

## Module & Schnittstellen

### `src/ml_stations.mjs` (Toolsmith)
- `EXTRA_SPOTS` — Spots außerhalb spots.json (Wörthsee, Pilsensee, Ammersee Eching,
  Hollerner See, Chioggia, Gialova, Vasiliki, Torbole, Talamone, Ulcinj)
- `parseMeteostatCatalog(jsonText)` → `[{id,name,country,lat,lon,elev,icao,wmo,tz,hourlyEnd}]`
- `loadMeteostatCatalog({fetchImpl, cacheFile, ttlMs})`
- `collectSpots({spotsJson, extraSpots, userLocations})` → dedupe (2 Dezimalen)
- `rankCandidates(spot, catalog, {maxKm=40, preferKm=20, now})`, `pickStation(...)`
- `stationKeyOf(st)`
- `assignStations(db, spots, catalog, opts)` → schreibt ml_stations + ml_station_spots
- `listMlStations(db)`, `findMlStationForSpot(db, lat, lon, maxKm=40)`

### `src/ml_backfill.mjs` (Toolsmith)
- Parser (rein): `parseMeteostatHourlyCsv`, `parseIemAsosCsv`, `hourlyFromReports`
- Fetcher (fetchImpl-injiziert): `fetchMeteostatHourly`, `fetchIemAsos`,
  `fetchHistoricalFeatures`, `fetchPreviousRunFeatures`
- `pairHistory({stationKey, tz, obsByTs, fc0, prev, ens, source})` → Zeilen
- `backfillStation(db, st, {months, endDay, fetchImpl, sleepMs, log})` —
  Monats-Chunks, resumebar über `ml_backfill_progress`, `RateLimitError` bei 429
- `runBackfill(db, stations, opts)`
- CLI `tools/ml-backfill.mjs [--discover] [--months N] [--station KEY] [--train] [--dry-run]`

### `src/neural_mos.mjs` v2.1.0
- Training liest `ml_samples ∪ ml_history`
- **Bugfix**: lead-24/48-Join auf Stunde (`substr(ts,1,13)`) statt exaktem ts —
  Poll-ts hat Sekunden, lead-ts ist stundengenau → Join traf praktisch nie
- Deterministisches Subsampling auf `NEURAL_MAX_TRAIN` (12 000), Saison-gewichtet
- Adaptive Epochen: `clamp(200·2000/n, 30, 200)`
- Chronologischer Holdout (20 %) → `ml_eval:{key}` {maeRaw, maeModel, skill, active}
- Predictions nur bei `skill ≥ NEURAL_MIN_SKILL` (0.03), sonst gelöscht
- Stunden-Repräsentant aus Monaten ±1 um den aktuellen Monat

### `src/mos.mjs` v1.x
- `computeHistoryMosRows(db, stationKey, {now, windowDays=30})` — Tag-im-Jahr ±30
  über alle Jahre aus `ml_history` (lead 0, `fc_ens_wind_ms`), n = Tage
- `runMosJob`: Station ohne Live-Obs, aber mit Historie → History-MOS

### `proxy-server.js`
- `mosStations()` ∪ `ml_stations`
- `/api/station/mos`: Fallback `findMlStationForSpot` nach LIVE/MEASURED
- Stündlicher METAR-Batch-Poll für ICAO-ml_stations (nicht schon MEASURED)
  + Open-Meteo Multi-Location-Request für die Features → `station_obs`, `ml_samples`
- Admin: `GET /api/admin/ml/status`, `POST /api/admin/ml/discover`,
  `POST /api/admin/ml/backfill` (Hintergrund, single-flight), `POST /api/admin/ml/train`

### `admin.html` (WebDev)
ML-Panel: Tabelle je Station (Spots, km, Historie n, Live n, Skill, aktiv) +
Buttons Discover / Backfill / Train + Fortschritt.

## Budget (🪙 Cost-Optimizer)

Open-Meteo Free ≈ 10 000 Calls/Tag. Pro Station × Monat 3 Requests
(lead0, previous-runs, ensemble). 40 Stationen × 24 Monate ≈ 2 900 Requests,
gewichtet ~6–9 k → Tool drosselt (`sleepMs` 1500), stoppt sauber bei 429 und
setzt beim nächsten Lauf fort. Live-Polling: 1 METAR-Request + 1 Open-Meteo-Request
pro Stunde für alle neuen Stationen zusammen.

## Performance (🩵)

Training ist synchron (reines JS). Cap 12 000 Samples + adaptive Epochen ≈ 1–2 s
pro Station; zwischen Stationen `await setImmediate`, damit der Event-Loop atmet.

## Testplan (Phase 5)

`ml-stations.test.mjs`, `ml-backfill.test.mjs`, `neural-mos-history.test.mjs`:
Fixtures statt Netz, `:memory:`-DB mit Migrationen, Join-Bugfix-Regression,
Eval-Gate (Rauschen → inaktiv, systematischer Bias → aktiv), Resume nach 429.

## v1.1 — Änderungen nach QA-Review (🟫)

| # | Befund | Entscheidung |
|---|---|---|
| 1 | Gate ohne Holdout ließ ungeprüfte Netze durch | ohne Val/Test ≥ 30 bleibt Neural **aus**, linear übernimmt |
| 2 | Backfill verbraucht Open-Meteo-Kontingent der Nutzer-Forecasts | eigenes Tagesbudget `ML_OM_DAILY_BUDGET` (Default 4000, Gewichtsformel Orte × Tage/14 × Variablen/10 × Modelle), Stopp **vor** dem Limit; nach echtem 429 kein Post-Backfill-MOS |
| 3 | Event-Loop | Intl-Formatter je TZ gecacht, `setImmediate` zwischen Stationen in `runMosJob` und Training, adaptive Epochen auch für Meltemi |
| 4 | stille Lücken (`done` trotz Fehler) | `done` nur bei vollständigem Monat, Ensemble ok, previous-runs ok (ab 2024-03) und ≥ 90 % Tage mit Obs; sonst `partial` (Retry ≤ 1×/Woche), `error` Retry ≤ 1×/Tag; Meteostat-Ausfall ohne ICAO bricht die Station ab |
| 5 | Meteostat-„Obs" enthalten Modelldaten | neue Jahres-Dumps, `wspd_source` gegen Modell-Quellen gefiltert, Quellen-Statistik im Log |
| 6 | Selection-Leakage / ausgelieferte Tabelle nie bewertet | Split 60/20/20: Restart-Auswahl auf Val, Gate auf Test; Tabelle wird **als Tabelle** bewertet; Refit auf allen Daten mit gewähltem Seed |
| 7 | CAPE-Semantik Live ≠ Historie, Pools über alle Leads | CAPE nur für lead 0; Tabellen-Pool je Lead |
| 8 | Live-Duplikate (6 Polls/h) + Überlappung mit Historie | Live lead 0 je Stunde gemittelt, Historie gewinnt bei gleicher (Stunde, lead) |
| 9 | Single-flight unvollständig, keine Timeouts | gemeinsamer `runMos`-Mutex (Nightly, recompute, Train, Post-Backfill); `claimMlJob` für alle ML-Jobs; `AbortSignal.timeout` an allen ML-Fetches |
| 10 | Frontend-Gewichtung | Neural nicht mehr lead-gedämpft; **situativ** (s. u.) nur über Distanz gewichtet |
| 11 | IEM feste Spalten, DST-Doppelstunde | IEM per Header; doppelte lokale Stunde wird nur einmal gepaart |

### Situative Neural-Korrektur (neu)
Eine 24-h-Tabelle je Station mittelt weg, was das Netz kann (Seebrise bei SW-Lage,
Abdeckung bei Nordlage). Deshalb:
- Poller speichern je Station die 72-h-Features (`app_meta ml_fc72:{key}`) — ML-Stationen
  stündlich per Multi-Location-Request, Bestandsstationen im 10-min-Poller.
- `/api/station/mos` liefert `neuralFc: { 'YYYY-MM-DD': [24] }` (Stations-TZ) und
  `neuralEval`, nur wenn `ml_eval.activeFc` (Netz je Sample besser als roh **und** linear).
- `thermalCorrection(…, dateStr)` nimmt `neuralFc[dateStr][hour]` vor Tabelle und linear,
  Gewicht `measuredWeight(km) / STATION_TRUST_AT_SPOT`, konvex mit seaBreeze wie bisher.

### Offene Punkte für Phase 6 (Verifizierung auf dem LXC)
- Erster echter Discovery-Lauf: Zuordnung Spot → Station/km im Admin-Panel prüfen
- Meteostat-`_source`-Werte im Backfill-Log ansehen und ggf. `MODEL_SOURCE_RE` schärfen
- Nach 1–2 Backfill-Tagen: Skill/MAE je Station im Panel; welche Stationen `situativ` aktiv sind
