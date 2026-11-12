const { useState, useEffect, useCallback, useRef } = React;
const { LineChart, Line, ComposedChart, Area, BarChart, Bar, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ReferenceArea, ReferenceDot, Cell } = Recharts;
let lang = "de";
const TRANSLATIONS = {
  de: {
    // Boot / loading
    boot_loading: "WindFoil wird geladen\u2026",
    loading_forecast: "Verbinde mit Open-Meteo Forecast API\u2026",
    loading_era5: "Forecast geladen. Lade ERA5-Archiv\u2026",
    loading_demo_fc: "Forecast offline \u2192 Demo-Daten. Lade Archiv\u2026",
    loading_connect: "Verbinde mit Open-Meteo\u2026",
    loading_demo_hint: "Bei Verbindungsproblemen werden Demo-Daten geladen",
    // Header
    version_label: "Weather Intelligence \xB7 v3.41.0",
    sport_foil: "\u{1F3C4} Wingfoiling",
    sport_kite: "\u{1FA81} Kitesurfing",
    // Loc bar
    loc_remember: "\u2605 merken",
    loc_remembered: "\u2713 gemerkt",
    loc_change: "Ort \xE4ndern",
    loc_feedback: "\u{1F4E3} Feedback",
    loc_calibrated: "\u{1F4CD} lokal kalibriert \xB7 ab {kn} kn",
    // Rider bar
    profile_foil: "\u{1F3C4} Wingfoil-Profil",
    profile_kite: "\u{1FA81} Kite-Profil",
    profile_and_equip: "& Equipment",
    field_weight: "Gewicht (kg)",
    field_wing: "Wing (m\xB2)",
    field_skill: "Skill-Level",
    field_plane_kn: "Abheben ab (kn) \xB7 opt.",
    field_plane_kn_title: "Optional: ab wie viel Wind du erfahrungsgem\xE4\xDF abhebst. \xDCberschreibt die Formel.",
    field_plane_placeholder: "z.B. 11",
    skill_beginner: "Anf\xE4nger",
    skill_intermediate: "Fortgeschritten",
    skill_advanced: "Fortgeschritten+",
    skill_pro: "Experte",
    btn_analyse: "ANALYSE STARTEN \u2192",
    btn_save_profile: "PROFIL SPEICHERN",
    btn_profile_saved: "\u2713 GESPEICHERT",
    // Equipment
    equip_title: "\u{1F392} Mein Equipment",
    equip_auto_select: "Automatische Setup-Wahl",
    equip_name: "Name",
    equip_wing: "Wing (m\xB2)",
    equip_plane: "ab (kn)",
    equip_add: "+ Hinzuf\xFCgen",
    equip_none_hint: "F\xFCge mindestens ein Equipment hinzu, damit die automatische Wahl greift.",
    equip_name_placeholder: "z.B. Leichtwind",
    // Day tabs / scores
    day_heute: "Heute",
    day_morgen: "Morgen",
    day_uncertain: "\u2248 unsicher",
    score_foil: "Wingfoil-Score",
    score_kite: "Kite-Score",
    score_raw_adj: "roh {raw} \xB7 justiert",
    score_best_time: "\u23F1 Beste Zeit: {from}\u2013{to} Uhr",
    score_auto_rec: "Auto-Empfehlung",
    // Badges
    badge_avg: "\xD8 {w}",
    badge_max_gust: "Max B\xF6e {w}",
    badge_max_temp: "{t}\xB0C max",
    badge_mos_corr: "MOS-Korrektur {sign}{w} \xB7 {n} Tage",
    badge_mos_blend: "MOS {pct}% / \u{1F30A} Brise {rest}%",
    badge_seabreeze: "Meeresbrise +{w}",
    // Thermik
    th_none: "Kaum Thermik",
    th_none_desc: "Stabile Luftmasse. Wind weitgehend laminar \u2013 gute Gleitbedingungen.",
    th_light: "Leichte Thermik",
    th_light_desc: "Gelegentliche Aufwinde, m\xE4\xDFige Turbulenzen m\xF6glich, vor allem mittags.",
    th_moderate: "Moderate Thermik",
    th_moderate_desc: "Aktive Konvektion. Thermische Windverst\xE4rkung am Nachmittag erwartet. B\xF6en!",
    th_strong: "Starke Thermik",
    th_strong_desc: "Intensive Instabilit\xE4t. Sturmb\xF6en und Gewitter m\xF6glich!",
    th_title: "Thermik-Analyse \u2014 {label}",
    th_breeze_active: "Thermische Brise aktiv:",
    // Confidence
    conf_none: "Kein Abgleich",
    conf_high: "Hohe Sicherheit",
    conf_mid: "Mittlere Sicherheit",
    conf_low: "Geringe Sicherheit",
    // Wind/gust
    wind_dir_chart: "Windrichtung (\xB0)",
    wind_label: "Wind {u}",
    gust_label: "B\xF6en {u}",
    mwind_label: "Ist Wind {u}",
    mgust_label: "Ist B\xF6e {u}",
    dir_label: "Richtung",
    temp_chart: "Temperatur (\xB0C)",
    pres_chart: "Luftdruck (hPa)",
    th_chart: "Thermik-Index (0\u2013100)",
    hist_chart: "Historischer Vergleich \u2014 ERA5 Reanalyse vs. Prognose",
    era5_label: "ERA5 \xD8 {u}",
    prog_label: "Prognose \xD8 {u}",
    model_label: "Modell",
    station_label: "Station (real)",
    model_spread: "Modell-Streuung",
    bias_window: "\xD8 Wind (Bias-Fenster)",
    // Quick stats
    stat_avg_wind: "\xD8 Wind",
    stat_max_gust: "Max B\xF6e",
    stat_temp: "Temperatur",
    stat_pres: "Luftdruck",
    stat_therm_idx: "Thermik-Index",
    stat_foil_window: "Wingfoil-Fenster",
    stat_kite_window: "Kite-Fenster",
    // Details divider
    more_details: "Weitere Details",
    // Equipment rec section
    equip_rec_title: "Equipment-Empfehlung",
    foil_window_title: "Wingfoil-Fenster Analyse \u2014 Rider-spezifisch + Foil-Score",
    kite_window_title: "Kite-Fenster Analyse \u2014 Rider-spezifisch + Kite-Score",
    foil_window_ref: "\u{1F3C4} Wing-Windranges",
    kite_window_ref: "\u{1FA81} Crazyfly Kite-Windranges",
    ref_weight_adj: "Herstellerangaben (Referenzgewicht {ref} kg). Die zweite Spalte zeigt dein angepasstes Fenster f\xFCr {weight} kg \xB7 {skill}.",
    ref_weight_adj_kite: "Herstellerangaben (Referenzgewicht ~80 kg). Die zweite Spalte zeigt dein angepasstes Fenster f\xFCr {weight} kg \xB7 {skill}.",
    // Recommendation lines
    rec_too_little: "\u26A0\uFE0F <b>Zu wenig Wind</b> \u2014 {w}, ben\xF6tigt \u2265{min}",
    rec_too_little_tip: "\u{1F4A1} Gr\xF6\xDFeren Wing w\xE4hlen oder auf Nachmittags-Thermik warten.",
    rec_optimal: "\u2705 <b>Optimale Bedingungen</b> \u2014 {w} im Fenster ({optMin}\u2013{optMax})",
    rec_optimal_rider: "\u{1F3C4} Wing {sz} m\xB2 \u2014 ideal f\xFCr {kg} kg \xB7 {skill}",
    rec_overpowered: "\u26A0\uFE0F <b>Overpowered-Zone</b> \u2014 {w} an der Obergrenze",
    rec_overpowered_tip: "\u{1F4A1} Kleineren Wing: {x} m\xB2 erw\xE4gen",
    rec_too_much: "\u{1F6A8} <b>Zu viel Wind</b> \u2014 {w} > Max {max}",
    rec_too_much_tip: "\u26D4 Sitzung abbrechen oder deutlich kleineres Equipment",
    rec_gust_delta: "\u{1F4A8} <b>B\xF6en-\u0394 {dw}</b> \u2014 Erh\xF6hte Kontrollbelastung!",
    rec_window: "<br>\u{1F4D0} <b>Dein Fenster:</b> Abheben {min} \xB7 Optimal {optMin}\u2013{optMax} \xB7 Max {max}",
    rec_setup: "\u{1F392} <b>Empfohlenes Setup aus deinem Material:</b> {name} \u2014 Wing {wing} m\xB2{plane}",
    rec_setup_plane: " \xB7 ab {kn} kn",
    rec_wing_plan: "\u{1F504} <b>Gr\xF6\xDFenwechsel \xFCber die Session:</b> {plan}",
    // Kite rec
    kite_rec_too_little: "\u26A0\uFE0F <b>Zu wenig Wind</b> \u2014 {w}, Kite braucht \u2265{min}",
    kite_rec_too_little_tip: "\u{1F4A1} Gr\xF6\xDFeren Kite w\xE4hlen oder auf Wind-Zunahme warten.",
    kite_rec_optimal: "\u2705 <b>Optimale Bedingungen</b> \u2014 {w} im Fenster ({optMin}\u2013{optMax})",
    kite_rec_optimal_rider: "\u{1FA81} {model} {size}m \u2014 ideal f\xFCr {skill}",
    kite_rec_overpowered: "\u26A0\uFE0F <b>Overpowered-Zone</b> \u2014 {w} an der Obergrenze",
    kite_rec_overpowered_tip: "\u{1F4A1} Kite zu gro\xDF \u2014 kleinere Gr\xF6\xDFe oder Bar depower erw\xE4gen",
    kite_rec_too_much: "\u{1F6A8} <b>Kite zu klein / zu viel Wind</b> \u2014 {w} > Max {max}",
    kite_rec_too_much_tip: "\u26D4 Session abbrechen oder deutlich kleineren Kite",
    kite_rec_gust: "\u{1F4A8} <b>B\xF6en-\u0394 {dw}</b> \u2014 Erh\xF6hte Leinenspannung!",
    kite_rec_window: "<br>\u{1F4D0} <b>Dein Kite-Fenster:</b> Start {min} \xB7 Optimal {optMin}\u2013{optMax} \xB7 Max {max}",
    // Station / model comparison
    station_cmp_title: "\u{1F6F0} Station \u2194 Modell Abgleich \u2192 Vertrauens-Score",
    station_cmp_loading: "Echte Stationsdaten werden mit dem Modell verglichen\u2026",
    station_cmp_unavail: "Kein Stations-Backend erreichbar. Der Vertrauens-Score ben\xF6tigt den Proxy ({proxy}) mit g\xFCltigem Weatherbit-API-Key auf deinem Host. Bis dahin basiert die Bewertung allein auf Modell + Rider-Angaben.",
    station_cmp_detail: "Gro\xDFer Unterschied zwischen Station und Modell \u21D2 niedriger Vertrauens-Score \u21D2 der Foil-Score (heute) wird Richtung neutral ged\xE4mpft. Aktuell: {src}. Hist. Bias: Meteostat-Station vs. Open-Meteo-Archiv (gleiches Zeitfenster).",
    p10_p90_around: "p10\u2013p90 um {h}:00",
    n_member: "{n} Member",
    // Nearby stations
    nearby_title: "\u{1F4E1} Echte Wetterstationen{radius}",
    nearby_radius: " (Umkreis {r} km)",
    nearby_loading: "\u23F3 l\xE4dt\u2026",
    nearby_live: "\u2705 Messung+Modell",
    nearby_model: "\u2248 Modellwind",
    nearby_meta: "\u25CB nur Stationsinfo",
    nearby_unavail: "\u2013 keine Stationen",
    nearby_searching: "Echte Stationen im Umkreis werden gesucht\u2026",
    nearby_none: "Keine Stationen gefunden bzw. Stationsliste nicht erreichbar.",
    nearby_obs: "\u25CF Messung",
    nearby_mod: "\u2248 Modell",
    nearby_footer: "Echte Messstationen im Umkreis (Quelle: Meteostat). Windwerte: Standard ist aktueller Modellwind am Stationsstandort (Open-Meteo, \u2248 Modell); die n\xE4chstgelegenen Stationen zeigen echte Messungen (\u25CF Messung, Weatherbit), solange das Tageskontingent reicht.",
    // Manual station
    manual_station_title: "\u{1F517} Eigene Wetterstation hinzuf\xFCgen",
    manual_station_add: "Hinzuf\xFCgen",
    manual_station_cors: "CORS-eingeschr\xE4nkt im Browser \u2014 Daten bitte direkt auf der Seite pr\xFCfen.",
    manual_station_none: "Noch keine eigenen Stationen konfiguriert.",
    // Location modal
    loc_modal_title: "Standort konfigurieren",
    loc_gps_loading: "Standort wird ermittelt\u2026",
    loc_gps_use: "\u{1F4CD} Meinen aktuellen Standort verwenden",
    loc_spots_section: "Spots",
    loc_recent_section: "Zuletzt verwendet",
    loc_add_section: "Ort hinzuf\xFCgen",
    loc_add_label: "Google-Maps-Link oder Koordinaten",
    loc_add_name_label: "Ortsname (optional)",
    loc_add_name_placeholder: "z.B. Mein Spot",
    loc_add_btn: "Hinzuf\xFCgen & w\xE4hlen",
    loc_add_hint: '\u{1F4A1} In Google Maps auf den Ort tippen \u2192 URL kopieren (Koordinaten stehen nach dem @). Oder direkt "lat, lon" eingeben.',
    loc_link_error_empty: "Bitte einen Link oder Koordinaten eingeben.",
    loc_parsed_ok: "\u2705 Erkannt: {lat}\xB0N, {lon}\xB0E",
    // Geo errors
    geo_not_supported: "Geolocation wird von diesem Ger\xE4t/Browser nicht unterst\xFCtzt.",
    geo_denied: "Standortzugriff verweigert. Bitte in den Browser-Einstellungen erlauben.",
    geo_unavail: "Position nicht verf\xFCgbar. GPS/Ortungsdienste aktiv?",
    geo_timeout: "Zeit\xFCberschreitung bei der Standortbestimmung.",
    geo_generic: "Standort konnte nicht ermittelt werden.",
    gps_my_location: "Mein Standort",
    // URL parse errors
    parse_shortlink: "Kurz-Link (goo.gl) kann im Browser nicht aufgel\xF6st werden. Bitte den Link in Maps \xF6ffnen und die lange URL oder die Koordinaten kopieren.",
    parse_no_coords: "Keine Koordinaten gefunden. Tipp: in Google Maps auf den Ort klicken, die URL aus der Adresszeile kopieren (sollte @Lat,Lon enthalten).",
    // Auth / session
    sess_checking: "Session wird gepr\xFCft\u2026",
    auth_title_signup: "Account erstellen",
    auth_title_signin: "Willkommen zur\xFCck",
    auth_sub_signup: "Sessions tracken & Score sch\xE4rfen.",
    auth_sub_signin: "Anmelden und lossurfen.",
    auth_tab_signin: "Anmelden",
    auth_tab_signup: "Registrieren",
    auth_name_label: "Name",
    auth_name_placeholder: "Dein Name",
    auth_email_label: "E-Mail",
    auth_pw_label: "Passwort (min. 10 Zeichen)",
    auth_btn_loading: "Einen Moment\u2026",
    auth_btn_signup: "Account erstellen",
    auth_btn_signin: "Anmelden",
    auth_fail: "Anmeldung fehlgeschlagen.",
    auth_server_err: "Server nicht erreichbar.",
    auth_logged_as: "Eingeloggt als",
    auth_signout: "Abmelden",
    auth_pw_forgot: "Passwort vergessen?",
    auth_pw_reset_email_label: "Deine E-Mail-Adresse",
    auth_pw_reset_btn: "Reset-Link senden",
    auth_pw_reset_ok: "E-Mail wurde gesendet. Bitte pr\xFCfe deinen Posteingang.",
    auth_pw_reset_err: "Fehler beim Senden. Bitte pr\xFCfe die E-Mail-Adresse.",
    auth_pw_reset_cancel: "Abbrechen",
    // Feedback modal
    fb_modal_label: "Session-Feedback",
    fb_planed_q: "Bist du aufs Foil gekommen?",
    fb_yes: "Ja, geplant",
    fb_no: "Kein Foilen heute",
    fb_wing_label: "Wing-Gr\xF6\xDFe (geflogen)",
    fb_wing_not_set: "\u2014 nicht angeben \u2014",
    fb_session_window: "Session-Zeitfenster",
    fb_session_hint: "Wann warst du auf dem Wasser? Der Wind wird aus echten Stationswerten in diesem Fenster abgeleitet.",
    fb_from: "Von",
    fb_to: "Bis",
    fb_session_q: "Wie war die Session?",
    fb_session_lo: "Mau",
    fb_session_hi: "Episch",
    fb_forecast_q: "Wie genau war der Forecast?",
    fb_forecast_lo: "Daneben",
    fb_forecast_hi: "Punktgenau",
    fb_notes_label: "Notizen",
    fb_notes_placeholder: "Thermik-Timing, B\xF6en, alles Merkenswerte",
    fb_submit_loading: "Speichern\u2026",
    fb_submit: "Session loggen",
    fb_done_title: "Gespeichert f\xFCr {date}",
    fb_done_sub: "Danke \u2014 das sch\xE4rft den Foil-Score f\xFCr {name}.",
    fb_cal_station: "Aus echten Stationswerten: {wing} m\xB2 bei ~{lo}\u2013{hi} kn kalibriert (aus {n} Messung{s}).",
    fb_cal_no_station: "Keine Stationsdaten f\xFCr dieses Zeitfenster \u2014 Session gespeichert, Kalibrierung folgt wenn Daten vorliegen.",
    fb_cal_threshold: "Abhebe-Schwellenwert f\xFCr {name}: {kn} kn (aus {n} {sessions}).",
    fb_cal_session: "Session",
    fb_cal_sessions: "Sessions",
    fb_cal_range: "Range f\xFCr {wing} m\xB2 an {name}: {lo}\u2013{hi} kn (aus {n} {sessions}).",
    fb_close: "Schlie\xDFen",
    fb_err_locked: "Feedback ist nur am Tag der Session m\xF6glich.",
    fb_err_save: "Speichern fehlgeschlagen.",
    fb_err_server: "Server nicht erreichbar.",
    // History view
    hist_title: "History & MOS-Performance",
    hist_close: "\u2715 Schlie\xDFen",
    hist_busy: "Lade Daten\u2026",
    hist_err: "Fehler beim Laden.",
    hist_obs_title: "Beobachteter Wind \u2014 letzte {days} Tage",
    hist_obs_pts: "{n} Messpunkte",
    hist_obs_none: "Keine Daten f\xFCr diese Station.",
    hist_obs_legend_obs: "Beobachtet",
    hist_obs_legend_fc: "Open-Meteo Forecast",
    hist_mos_title: "Beobachtung vs. Open-Meteo Ensemble \u2014 Stundenprofil (MOS-Fenster)",
    hist_mos_samples: "{n} Stichproben / Stunde (\xD8)",
    hist_mos_none: "MOS-Profil noch nicht verf\xFCgbar \u2014 {n} Beobachtungen bisher. Wird nach ~2\u20134 Wochen Datenbasis vom Nightly-Job berechnet.",
    hist_mos_legend_obs: "Beobachtet",
    hist_mos_legend_pred: "Ensemble-Modell",
    hist_bias_title: "MOS-Korrektur pro Stunde (bias_shrunk)",
    hist_bias_sub: "positiv = Modell untersch\xE4tzt, negativ = \xFCbersch\xE4tzt",
    hist_bias_none: "MOS-Bias noch nicht verf\xFCgbar \u2014 folgt automatisch sobald das MOS-Profil berechnet ist.",
    hist_bias_legend_bias: "Korrektur (shrunk)",
    hist_bias_legend_raw: "Roher Bias",
    hist_ml_pairs: "ml_samples lead=0: {n} Paare f\xFCr diese Station im Zeitfenster",
    hist_ml_missing: "(Neural MOS ben\xF6tigt \u226560 \u2014 noch {n} fehlend)",
    hist_ml_ok: "\u2713 genug f\xFCr Neural MOS",
    hist_hour_local: "Stunde (lokal)",
    // Footer
    footer_donate: "\u2665 Spenden",
    footer_support_title: "App unterst\xFCtzen",
    footer_loc: "Standort: {name}",
    footer_help: "\u2753 Hilfe",
    // Chart tooltip labels
    tooltip_forecast: "Forecast",
    tooltip_observed: "Beobachtet",
    tooltip_dir: "Richtung",
    tooltip_temp: "Temperatur",
    tooltip_pres: "Luftdruck",
    tooltip_th: "Thermik-Index",
    // Model source badge
    source_label: "\u{1F4E1} Quelle:",
    neural_mos: "Neural-MOS",
    mos_label: "MOS",
    live_station: "Live-Station",
    meas_station: "Messstation",
    live_now_label: "Live jetzt",
    live_sensor_lost: " \xB7 Sensor-Kontakt verloren",
    adjusted_label: " + {tag}",
    foil_score_chart: "Wingfoil-Score",
    kite_score_chart: "Kite-Score",
    // Wind regime
    regime_ora: "Ora (S\xFCd)",
    regime_eric: "Eric (W-NW)",
    regime_meltemi: "Meltemi (NW)",
    regime_garbin: "Garb\xECn (SW)",
    regime_seabreeze: "Meeresbrise (W-SW)",
    // Active users
    active_users_title: "Eingeloggte User",
    // Upload station
    station_url_placeholder: "https://wetterstation.example.com/data",
    // Confidence no-station note
    no_station_compare: "Kein Stationsabgleich verf\xFCgbar",
    // Kite profil labels
    kite_model_label: "Kite Modell",
    kite_size_label: "Kite Gr\xF6\xDFe",
    // Foil score card info
    foil_info_meltemi: "\u{1F30A} Meltemi-Wahrscheinlichkeit: {pct}%",
    foil_info_neural: " (Neural)",
    // Foil window ref table
    ref_manufacturer: "Hersteller",
    ref_freeride: "Freeride Foilwing",
    // Date label format
    date_short: "{wd}, {dd}. {mo}"
  },
  en: {
    // Boot / loading
    boot_loading: "Loading WindFoil\u2026",
    loading_forecast: "Connecting to Open-Meteo Forecast API\u2026",
    loading_era5: "Forecast loaded. Loading ERA5 archive\u2026",
    loading_demo_fc: "Forecast offline \u2192 demo data. Loading archive\u2026",
    loading_connect: "Connecting to Open-Meteo\u2026",
    loading_demo_hint: "Demo data will be used if connection fails",
    // Header
    version_label: "Weather Intelligence \xB7 v3.41.0",
    sport_foil: "\u{1F3C4} Wingfoiling",
    sport_kite: "\u{1FA81} Kitesurfing",
    // Loc bar
    loc_remember: "\u2605 save",
    loc_remembered: "\u2713 saved",
    loc_change: "Change location",
    loc_feedback: "\u{1F4E3} Feedback",
    loc_calibrated: "\u{1F4CD} locally calibrated \xB7 from {kn} kn",
    // Rider bar
    profile_foil: "\u{1F3C4} Wingfoil Profile",
    profile_kite: "\u{1FA81} Kite Profile",
    profile_and_equip: "& Equipment",
    field_weight: "Weight (kg)",
    field_wing: "Wing (m\xB2)",
    field_skill: "Skill level",
    field_plane_kn: "Plane from (kn) \xB7 opt.",
    field_plane_kn_title: "Optional: wind speed at which you typically start planing. Overrides the formula.",
    field_plane_placeholder: "e.g. 11",
    skill_beginner: "Beginner",
    skill_intermediate: "Intermediate",
    skill_advanced: "Advanced",
    skill_pro: "Pro",
    btn_analyse: "RUN ANALYSIS \u2192",
    btn_save_profile: "SAVE PROFILE",
    btn_profile_saved: "\u2713 SAVED",
    // Equipment
    equip_title: "\u{1F392} My Equipment",
    equip_auto_select: "Auto setup selection",
    equip_name: "Name",
    equip_wing: "Wing (m\xB2)",
    equip_plane: "from (kn)",
    equip_add: "+ Add",
    equip_none_hint: "Add at least one piece of equipment for auto selection to work.",
    equip_name_placeholder: "e.g. Light wind",
    // Day tabs / scores
    day_heute: "Today",
    day_morgen: "Tomorrow",
    day_uncertain: "\u2248 uncertain",
    score_foil: "Wingfoil Score",
    score_kite: "Kite Score",
    score_raw_adj: "raw {raw} \xB7 adjusted",
    score_best_time: "\u23F1 Best window: {from}\u2013{to}",
    score_auto_rec: "Auto recommendation",
    // Badges
    badge_avg: "Avg {w}",
    badge_max_gust: "Max gust {w}",
    badge_max_temp: "{t}\xB0C max",
    badge_mos_corr: "MOS correction {sign}{w} \xB7 {n} days",
    badge_mos_blend: "MOS {pct}% / \u{1F30A} Breeze {rest}%",
    badge_seabreeze: "Sea breeze +{w}",
    // Thermik
    th_none: "Minimal thermals",
    th_none_desc: "Stable air mass. Wind mostly laminar \u2014 good gliding conditions.",
    th_light: "Light thermals",
    th_light_desc: "Occasional updrafts, moderate turbulence possible, mainly midday.",
    th_moderate: "Moderate thermals",
    th_moderate_desc: "Active convection. Thermal wind enhancement expected in the afternoon. Gusts!",
    th_strong: "Strong thermals",
    th_strong_desc: "Intense instability. Storm gusts and thunderstorms possible!",
    th_title: "Thermal analysis \u2014 {label}",
    th_breeze_active: "Thermal breeze active:",
    // Confidence
    conf_none: "No comparison",
    conf_high: "High confidence",
    conf_mid: "Medium confidence",
    conf_low: "Low confidence",
    // Wind/gust
    wind_dir_chart: "Wind direction (\xB0)",
    wind_label: "Wind {u}",
    gust_label: "Gusts {u}",
    mwind_label: "Actual wind {u}",
    mgust_label: "Actual gust {u}",
    dir_label: "Direction",
    temp_chart: "Temperature (\xB0C)",
    pres_chart: "Pressure (hPa)",
    th_chart: "Thermal index (0\u2013100)",
    hist_chart: "Historical comparison \u2014 ERA5 reanalysis vs. forecast",
    era5_label: "ERA5 avg {u}",
    prog_label: "Forecast avg {u}",
    model_label: "Model",
    station_label: "Station (real)",
    model_spread: "Model spread",
    bias_window: "Avg wind (bias window)",
    // Quick stats
    stat_avg_wind: "Avg wind",
    stat_max_gust: "Max gust",
    stat_temp: "Temperature",
    stat_pres: "Pressure",
    stat_therm_idx: "Thermal index",
    stat_foil_window: "Wingfoil window",
    stat_kite_window: "Kite window",
    // Details divider
    more_details: "More details",
    // Equipment rec section
    equip_rec_title: "Equipment recommendation",
    foil_window_title: "Wingfoil window analysis \u2014 rider-specific + foil score",
    kite_window_title: "Kite window analysis \u2014 rider-specific + kite score",
    foil_window_ref: "\u{1F3C4} Wing wind ranges",
    kite_window_ref: "\u{1FA81} Crazyfly kite wind ranges",
    ref_weight_adj: "Manufacturer specs (reference weight {ref} kg). Second column shows your adjusted window for {weight} kg \xB7 {skill}.",
    ref_weight_adj_kite: "Manufacturer specs (reference weight ~80 kg). Second column shows your adjusted window for {weight} kg \xB7 {skill}.",
    // Recommendation lines
    rec_too_little: "\u26A0\uFE0F <b>Too little wind</b> \u2014 {w}, needs \u2265{min}",
    rec_too_little_tip: "\u{1F4A1} Choose a larger wing or wait for afternoon thermals.",
    rec_optimal: "\u2705 <b>Optimal conditions</b> \u2014 {w} in window ({optMin}\u2013{optMax})",
    rec_optimal_rider: "\u{1F3C4} Wing {sz} m\xB2 \u2014 ideal for {kg} kg \xB7 {skill}",
    rec_overpowered: "\u26A0\uFE0F <b>Overpowered zone</b> \u2014 {w} at upper limit",
    rec_overpowered_tip: "\u{1F4A1} Consider a smaller wing: {x} m\xB2",
    rec_too_much: "\u{1F6A8} <b>Too much wind</b> \u2014 {w} > max {max}",
    rec_too_much_tip: "\u26D4 Abort session or use significantly smaller equipment",
    rec_gust_delta: "\u{1F4A8} <b>Gust-\u0394 {dw}</b> \u2014 Increased control load!",
    rec_window: "<br>\u{1F4D0} <b>Your window:</b> Takeoff {min} \xB7 Optimal {optMin}\u2013{optMax} \xB7 Max {max}",
    rec_setup: "\u{1F392} <b>Recommended setup from your gear:</b> {name} \u2014 Wing {wing} m\xB2{plane}",
    rec_setup_plane: " \xB7 from {kn} kn",
    rec_wing_plan: "\u{1F504} <b>Size change over the session:</b> {plan}",
    // Kite rec
    kite_rec_too_little: "\u26A0\uFE0F <b>Too little wind</b> \u2014 {w}, kite needs \u2265{min}",
    kite_rec_too_little_tip: "\u{1F4A1} Choose a larger kite or wait for more wind.",
    kite_rec_optimal: "\u2705 <b>Optimal conditions</b> \u2014 {w} in window ({optMin}\u2013{optMax})",
    kite_rec_optimal_rider: "\u{1FA81} {model} {size}m \u2014 ideal for {skill}",
    kite_rec_overpowered: "\u26A0\uFE0F <b>Overpowered zone</b> \u2014 {w} at upper limit",
    kite_rec_overpowered_tip: "\u{1F4A1} Kite too large \u2014 consider smaller size or bar depower",
    kite_rec_too_much: "\u{1F6A8} <b>Kite too small / too much wind</b> \u2014 {w} > max {max}",
    kite_rec_too_much_tip: "\u26D4 Abort session or use a significantly smaller kite",
    kite_rec_gust: "\u{1F4A8} <b>Gust-\u0394 {dw}</b> \u2014 Increased line tension!",
    kite_rec_window: "<br>\u{1F4D0} <b>Your kite window:</b> Start {min} \xB7 Optimal {optMin}\u2013{optMax} \xB7 Max {max}",
    // Station / model comparison
    station_cmp_title: "\u{1F6F0} Station \u2194 Model comparison \u2192 confidence score",
    station_cmp_loading: "Comparing real station data with model\u2026",
    station_cmp_unavail: "No station backend available. The confidence score requires the proxy ({proxy}) with a valid Weatherbit API key on your host. Until then, the rating is based solely on model + rider inputs.",
    station_cmp_detail: "Large difference between station and model \u21D2 low confidence score \u21D2 foil score (today) is pulled toward neutral. Source: {src}. Historical bias: Meteostat station vs. Open-Meteo archive (same time window).",
    p10_p90_around: "p10\u2013p90 at {h}:00",
    n_member: "{n} members",
    // Nearby stations
    nearby_title: "\u{1F4E1} Real weather stations{radius}",
    nearby_radius: " ({r} km radius)",
    nearby_loading: "\u23F3 loading\u2026",
    nearby_live: "\u2705 Observation+Model",
    nearby_model: "\u2248 Model wind",
    nearby_meta: "\u25CB station info only",
    nearby_unavail: "\u2013 no stations",
    nearby_searching: "Searching for real stations nearby\u2026",
    nearby_none: "No stations found or station list unavailable.",
    nearby_obs: "\u25CF Obs",
    nearby_mod: "\u2248 Model",
    nearby_footer: "Real weather stations nearby (source: Meteostat). Wind values: default is current model wind at station location (Open-Meteo, \u2248 model); the nearest stations show real observations (\u25CF Obs, Weatherbit) while the daily quota lasts.",
    // Manual station
    manual_station_title: "\u{1F517} Add your own weather station",
    manual_station_add: "Add",
    manual_station_cors: "CORS-restricted in the browser \u2014 please check data directly on the site.",
    manual_station_none: "No custom stations configured yet.",
    // Location modal
    loc_modal_title: "Configure location",
    loc_gps_loading: "Locating\u2026",
    loc_gps_use: "\u{1F4CD} Use my current location",
    loc_spots_section: "Spots",
    loc_recent_section: "Recently used",
    loc_add_section: "Add location",
    loc_add_label: "Google Maps link or coordinates",
    loc_add_name_label: "Place name (optional)",
    loc_add_name_placeholder: "e.g. My spot",
    loc_add_btn: "Add & select",
    loc_add_hint: '\u{1F4A1} In Google Maps, tap the location \u2192 copy URL (coordinates follow the @). Or enter "lat, lon" directly.',
    loc_link_error_empty: "Please enter a link or coordinates.",
    loc_parsed_ok: "\u2705 Detected: {lat}\xB0N, {lon}\xB0E",
    // Geo errors
    geo_not_supported: "Geolocation is not supported by this device/browser.",
    geo_denied: "Location access denied. Please allow it in browser settings.",
    geo_unavail: "Position unavailable. Is GPS/location services enabled?",
    geo_timeout: "Location request timed out.",
    geo_generic: "Could not determine location.",
    gps_my_location: "My location",
    // URL parse errors
    parse_shortlink: "Short link (goo.gl) cannot be resolved in the browser. Please open the link in Maps and copy the full URL or the coordinates.",
    parse_no_coords: "No coordinates found. Tip: click the location in Google Maps, copy the URL from the address bar (should contain @Lat,Lon).",
    // Auth / session
    sess_checking: "Checking session\u2026",
    auth_title_signup: "Create account",
    auth_title_signin: "Welcome back",
    auth_sub_signup: "Track sessions & sharpen your score.",
    auth_sub_signin: "Sign in and get on the water.",
    auth_tab_signin: "Sign in",
    auth_tab_signup: "Register",
    auth_name_label: "Name",
    auth_name_placeholder: "Your name",
    auth_email_label: "E-Mail",
    auth_pw_label: "Password (min. 10 characters)",
    auth_btn_loading: "One moment\u2026",
    auth_btn_signup: "Create account",
    auth_btn_signin: "Sign in",
    auth_fail: "Sign-in failed.",
    auth_server_err: "Server unreachable.",
    auth_logged_as: "Signed in as",
    auth_signout: "Sign out",
    auth_pw_forgot: "Forgot password?",
    auth_pw_reset_email_label: "Your e-mail address",
    auth_pw_reset_btn: "Send reset link",
    auth_pw_reset_ok: "E-mail sent. Please check your inbox.",
    auth_pw_reset_err: "Error sending. Please check the e-mail address.",
    auth_pw_reset_cancel: "Cancel",
    // Feedback modal
    fb_modal_label: "Session feedback",
    fb_planed_q: "Did you get on the foil?",
    fb_yes: "Yes, planed",
    fb_no: "No foiling today",
    fb_wing_label: "Wing size (flown)",
    fb_wing_not_set: "\u2014 don't specify \u2014",
    fb_session_window: "Session time window",
    fb_session_hint: "When were you on the water? Wind is derived from real station readings in this window.",
    fb_from: "From",
    fb_to: "To",
    fb_session_q: "How was the session?",
    fb_session_lo: "Bad",
    fb_session_hi: "Epic",
    fb_forecast_q: "How accurate was the forecast?",
    fb_forecast_lo: "Way off",
    fb_forecast_hi: "Spot on",
    fb_notes_label: "Notes",
    fb_notes_placeholder: "Thermal timing, gusts, anything notable",
    fb_submit_loading: "Saving\u2026",
    fb_submit: "Log session",
    fb_done_title: "Saved for {date}",
    fb_done_sub: "Thanks \u2014 this sharpens the foil score for {name}.",
    fb_cal_station: "From real station data: {wing} m\xB2 calibrated at ~{lo}\u2013{hi} kn (from {n} reading{s}).",
    fb_cal_no_station: "No station data for this time window \u2014 session saved, calibration will follow when data is available.",
    fb_cal_threshold: "Planing threshold for {name}: {kn} kn (from {n} {sessions}).",
    fb_cal_session: "session",
    fb_cal_sessions: "sessions",
    fb_cal_range: "Range for {wing} m\xB2 at {name}: {lo}\u2013{hi} kn (from {n} {sessions}).",
    fb_close: "Close",
    fb_err_locked: "Feedback is only possible on the day of the session.",
    fb_err_save: "Save failed.",
    fb_err_server: "Server unreachable.",
    // History view
    hist_title: "History & MOS performance",
    hist_close: "\u2715 Close",
    hist_busy: "Loading data\u2026",
    hist_err: "Error loading data.",
    hist_obs_title: "Observed wind \u2014 last {days} days",
    hist_obs_pts: "{n} data points",
    hist_obs_none: "No data for this station.",
    hist_obs_legend_obs: "Observed",
    hist_obs_legend_fc: "Open-Meteo Forecast",
    hist_mos_title: "Observation vs. Open-Meteo Ensemble \u2014 hourly profile (MOS window)",
    hist_mos_samples: "{n} samples / hour (avg)",
    hist_mos_none: "MOS profile not yet available \u2014 {n} observations so far. Will be computed by the nightly job after ~2\u20134 weeks of data.",
    hist_mos_legend_obs: "Observed",
    hist_mos_legend_pred: "Ensemble model",
    hist_bias_title: "MOS correction per hour (bias_shrunk)",
    hist_bias_sub: "positive = model underestimates, negative = overestimates",
    hist_bias_none: "MOS bias not yet available \u2014 will follow automatically once the MOS profile is computed.",
    hist_bias_legend_bias: "Correction (shrunk)",
    hist_bias_legend_raw: "Raw bias",
    hist_ml_pairs: "ml_samples lead=0: {n} pairs for this station in the time window",
    hist_ml_missing: "(Neural MOS needs \u226560 \u2014 {n} more needed)",
    hist_ml_ok: "\u2713 enough for Neural MOS",
    hist_hour_local: "Hour (local)",
    // Footer
    footer_donate: "\u2665 Donate",
    footer_support_title: "Support the app",
    footer_loc: "Location: {name}",
    footer_help: "\u2753 Help",
    // Chart tooltip labels
    tooltip_forecast: "Forecast",
    tooltip_observed: "Observed",
    tooltip_dir: "Direction",
    tooltip_temp: "Temperature",
    tooltip_pres: "Pressure",
    tooltip_th: "Thermal index",
    // Model source badge
    source_label: "\u{1F4E1} Source:",
    neural_mos: "Neural-MOS",
    mos_label: "MOS",
    live_station: "Live station",
    meas_station: "Obs station",
    live_now_label: "Live now",
    live_sensor_lost: " \xB7 Sensor contact lost",
    adjusted_label: " + {tag}",
    foil_score_chart: "Wingfoil score",
    kite_score_chart: "Kite score",
    // Wind regime (keep meteorological proper names, translate direction hint)
    regime_ora: "Ora (S)",
    regime_eric: "Eric (W-NW)",
    regime_meltemi: "Meltemi (NW)",
    regime_garbin: "Garb\xECn (SW)",
    regime_seabreeze: "Sea breeze (W-SW)",
    // Active users
    active_users_title: "Logged-in users",
    // Upload station
    station_url_placeholder: "https://weather-station.example.com/data",
    // Confidence no-station note
    no_station_compare: "No station comparison available",
    // Kite profil labels
    kite_model_label: "Kite model",
    kite_size_label: "Kite size",
    // Foil score card info
    foil_info_meltemi: "\u{1F30A} Meltemi probability: {pct}%",
    foil_info_neural: " (Neural)",
    // Foil window ref table
    ref_manufacturer: "Manufacturer",
    ref_freeride: "Freeride foil wing",
    // Date label format
    date_short: "{wd}, {dd}. {mo}"
  }
};
function t(key, vars = {}) {
  let s = (TRANSLATIONS[lang] || TRANSLATIONS.de)[key] || TRANSLATIONS.de[key] || key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}
const COMPASS16 = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compass = (deg) => deg == null ? "" : COMPASS16[Math.round((deg % 360 + 360) % 360 / 22.5) % 16];
const msToKn = (ms) => ms * 1.94384;
const knToMs = (kn) => kn / 1.94384;
const msToBf = (ms) => {
  if (ms < 0.3) return 0;
  if (ms < 1.6) return 1;
  if (ms < 3.4) return 2;
  if (ms < 5.5) return 3;
  if (ms < 8) return 4;
  if (ms < 10.8) return 5;
  if (ms < 13.9) return 6;
  if (ms < 17.2) return 7;
  if (ms < 20.8) return 8;
  if (ms < 24.5) return 9;
  if (ms < 28.5) return 10;
  if (ms < 32.7) return 11;
  return 12;
};
const BF_LABEL = ["0 Windstille", "1 Leicht", "2 Leicht", "3 Leise", "4 M\xE4\xDFig", "5 Frisch", "6 Stark", "7 Steif", "8 St\xFCrmisch", "9 Sturm", "10 Schwerer Sturm", "11 Orkan", "12 Orkan"];
const CRAZYFLY_KITES = [
  { model: "Sculp", desc: "Allround Freeride/Foil", sizes: [
    { m: 7, minKn: 18, maxKn: 40 },
    { m: 8, minKn: 16, maxKn: 38 },
    { m: 9, minKn: 14, maxKn: 34 },
    { m: 10, minKn: 13, maxKn: 30 },
    { m: 12, minKn: 10, maxKn: 26 },
    { m: 14, minKn: 9, maxKn: 20 }
  ] }
];
function calcKiteWindow(kiteMinKn, kiteMaxKn, skill, weight) {
  const sm = { beginner: 1.15, intermediate: 1, advanced: 0.9, pro: 0.85 }[skill] ?? 1;
  const wm = Math.max(0.85, Math.min(1.2, weight / 80));
  const minMs = knToMs(kiteMinKn) * sm * wm;
  const maxMs = knToMs(kiteMaxKn) / sm;
  const span = maxMs - minMs;
  return {
    minWind: Math.round(minMs * 10) / 10,
    optMin: Math.round((minMs + span * 0.15) * 10) / 10,
    optMax: Math.round((minMs + span * 0.75) * 10) / 10,
    maxWind: Math.round(maxMs * 10) / 10
  };
}
function kiteRec(effW, midG, win, kiteModel, kiteSize, skill, windUnit) {
  const lines = [];
  if (effW < win.minWind) {
    lines.push(t("kite_rec_too_little", { w: fmtW(effW, windUnit), min: fmtW(win.minWind, windUnit) }));
    lines.push(t("kite_rec_too_little_tip"));
  } else if (effW <= win.optMax) {
    lines.push(t("kite_rec_optimal", { w: fmtW(effW, windUnit), optMin: fmtW(win.optMin, windUnit), optMax: fmtW(win.optMax, windUnit) }));
    lines.push(t("kite_rec_optimal_rider", { model: kiteModel, size: kiteSize, skill }));
  } else if (effW <= win.maxWind) {
    lines.push(t("kite_rec_overpowered", { w: fmtW(effW, windUnit) }));
    lines.push(t("kite_rec_overpowered_tip"));
  } else {
    lines.push(t("kite_rec_too_much", { w: fmtW(effW, windUnit), max: fmtW(win.maxWind, windUnit) }));
    lines.push(t("kite_rec_too_much_tip"));
  }
  if (midG - effW > 4) lines.push(t("kite_rec_gust", { dw: fmtW(midG - effW, windUnit) }));
  lines.push(t("kite_rec_window", { min: fmtW(win.minWind, windUnit), optMin: fmtW(win.optMin, windUnit), optMax: fmtW(win.optMax, windUnit), max: fmtW(win.maxWind, windUnit) }));
  return lines.join("<br>");
}
function cvt(ms, unit) {
  if (unit === "kn") return Math.round(msToKn(ms) * 10) / 10;
  if (unit === "bf") return msToBf(ms);
  return Math.round(ms * 10) / 10;
}
function fmtW(ms, unit) {
  if (unit === "kn") return `${cvt(ms, "kn").toFixed(1)} kn`;
  if (unit === "bf") return `${cvt(ms, "bf")} BF`;
  return `${cvt(ms, "ms").toFixed(1)} m/s`;
}
function unitLabel(unit) {
  return unit === "kn" ? "kn" : unit === "bf" ? "BF" : "m/s";
}
function cvtArr(arr, unit) {
  return arr.map((v) => cvt(v, unit));
}
const THEMES = {
  dark: {
    bg: "#0a0e14",
    surface: "#111820",
    panel: "#151d28",
    border: "#1e2d3d",
    border2: "#243040",
    sky: "#3a9ad9",
    signal: "#f07820",
    caution: "#f5b942",
    go: "#3ddc84",
    stop: "#e84040",
    text: "#d8e4f0",
    muted: "#7fa0be",
    dim: "#2a3d52",
    headerBg: "rgba(10,14,20,.97)",
    gridStroke: "rgba(255,255,255,0.05)"
  },
  light: {
    bg: "#e7edf3",
    surface: "#f3f6fa",
    panel: "#ffffff",
    border: "#cdd9e6",
    border2: "#b6c6d6",
    sky: "#1f7fc0",
    signal: "#dd6510",
    caution: "#b07d10",
    go: "#149048",
    stop: "#d62828",
    text: "#13202e",
    muted: "#5b7186",
    dim: "#9fb1c2",
    headerBg: "rgba(247,249,252,.97)",
    gridStroke: "rgba(0,0,0,0.06)"
  }
};
const C = { ...THEMES.dark };
function localDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function parseLocationInput(input) {
  if (!input) return null;
  const str = input.trim();
  if (/maps\.app\.goo\.gl|goo\.gl\/maps/.test(str)) {
    return { error: t("parse_shortlink") };
  }
  let m = str.match(/@(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  const m3 = str.match(/!3d(-?\d{1,3}\.\d+)/);
  const m4 = str.match(/!4d(-?\d{1,3}\.\d+)/);
  if (m3 && m4) return { lat: parseFloat(m3[1]), lon: parseFloat(m4[1]) };
  m = str.match(/[?&](?:q|query|ll|sll)=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  m = str.match(/^\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
  if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  return { error: t("parse_no_coords") };
}
function parsePlaceName(input) {
  if (!input) return "";
  const m = input.match(/\/place\/([^/@]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1].replace(/\+/g, " ")).split(",")[0];
    } catch (e) {
      return m[1].replace(/\+/g, " ").split(",")[0];
    }
  }
  return "";
}
function generateDemoDay(lat, lon, dayOffset) {
  const base = /* @__PURE__ */ new Date();
  base.setDate(base.getDate() + dayOffset);
  const dateStr = localDateStr(base);
  const isNavarino = Math.abs(lat - 36.98) < 0.5;
  const windBase = isNavarino ? 4.2 : 3.8;
  const tempBase = isNavarino ? 22 : 20;
  const times = [], winds = [], gusts = [], dirs = [], temps = [], pres = [], cape = [], li = [], cloud = [], humid = [];
  for (let h = 0; h < 24; h++) {
    times.push(`${dateStr}T${String(h).padStart(2, "0")}:00`);
    const seaFactor = h >= 10 && h <= 19 ? Math.sin(Math.PI * (h - 10) / 9) : 0;
    const nightDip = h < 7 ? 0.55 : h < 10 ? 0.75 : 1;
    const w = Math.max(0.5, windBase * nightDip + seaFactor * 3.8 + (Math.random() - 0.5) * 0.8 + dayOffset * 0.3);
    winds.push(Math.round(w * 10) / 10);
    gusts.push(Math.round(w * (1.25 + Math.random() * 0.2) * 10) / 10);
    const dir = h < 10 ? 45 + Math.random() * 30 : 240 + Math.random() * 40;
    dirs.push(Math.round(dir));
    const tVal = tempBase + (h < 6 ? -3 : h < 14 ? (h - 6) * 1.1 : (24 - h) * 0.6 - 1) + Math.random() * 0.8 - dayOffset * 0.5;
    temps.push(Math.round(tVal * 10) / 10);
    pres.push(Math.round((1013 + Math.sin(h / 8) * 1.5 + Math.random() * 0.5 - dayOffset * 0.3) * 10) / 10);
    cape.push(h >= 11 && h <= 17 ? Math.round(Math.random() * 600) : 0);
    li.push(h >= 11 && h <= 17 ? -(Math.random() * 2.5) : 1 + Math.random());
    cloud.push(Math.round(Math.random() * 30 + (h > 14 ? 10 : 0)));
    humid.push(Math.round(55 + Math.random() * 20 - seaFactor * 8));
  }
  return {
    time: times,
    windspeed_10m: winds,
    windgusts_10m: gusts,
    winddirection_10m: dirs,
    temperature_2m: temps,
    surface_pressure: pres,
    cape,
    lifted_index: li,
    cloudcover: cloud,
    relativehumidity_2m: humid
  };
}
function buildDemoForecast(lat, lon) {
  const keys = [
    "time",
    "windspeed_10m",
    "windgusts_10m",
    "winddirection_10m",
    "temperature_2m",
    "surface_pressure",
    "cape",
    "lifted_index",
    "cloudcover",
    "relativehumidity_2m"
  ];
  const merged = Object.fromEntries(keys.map((k) => [k, []]));
  for (let d = 0; d < 7; d++) {
    const day = generateDemoDay(lat, lon, d);
    keys.forEach((k) => merged[k].push(...day[k]));
  }
  return { hourly: merged };
}
function buildDemoHistorical(lat, lon) {
  const times = [], winds = [], temps = [];
  for (let d = 7; d >= 1; d--) {
    const day = generateDemoDay(lat, lon, -d);
    times.push(...day.time);
    winds.push(...day.windspeed_10m);
    temps.push(...day.temperature_2m);
  }
  return { hourly: { time: times, windspeed_10m: winds, temperature_2m: temps } };
}
async function fetchWithTimeout(url, ms = 7e3) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (e) {
    clearTimeout(tid);
    throw e;
  }
}
function pickForecastModel(lat, lon) {
  const inAromeItaly = lat >= 36 && lat <= 47.2 && lon >= 6.5 && lon <= 16;
  return inAromeItaly ? "meteofrance_arome_france_hd" : "";
}
const MODEL_LABELS = {
  meteofrance_arome_france_hd: "AROME-HD 1.5km",
  arome_best_max: "AROME-HD + Best (max/h)",
  ens_median_v1: "Ensemble-Median"
};
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
const SPECIAL_RADIUS_KM = 5;
function isGardaSpot(lat, lon) {
  return lat >= 45.4 && lat <= 45.95 && lon >= 10.5 && lon <= 11;
}
function isVasilikiSpot(lat, lon) {
  return haversineKm(lat, lon, 38.6297, 20.6103) <= SPECIAL_RADIUS_KM;
}
function isLefkadaNWSpot(lat, lon) {
  return haversineKm(lat, lon, 38.752, 20.579) <= SPECIAL_RADIUS_KM;
}
function isChioggiaSpot(lat, lon) {
  return haversineKm(lat, lon, 45.2271, 12.3046) <= 8;
}
function thermalRegime(lat, lon) {
  if (isGardaSpot(lat, lon))
    return { dir: 195, labelKey: "regime_ora", originDE: "vom Gardasee-S\xFCden", originEN: "from the south end of Lake Garda", peakHour: 15 };
  if (isVasilikiSpot(lat, lon))
    return { dir: 290, labelKey: "regime_eric", originDE: "um Kap Doukato", originEN: "around Cape Doukato", peakHour: 16 };
  if (isLefkadaNWSpot(lat, lon))
    return { dir: 315, labelKey: "regime_meltemi", originDE: "vom Ionischen Meer", originEN: "from the Ionian Sea", peakHour: 15 };
  if (isChioggiaSpot(lat, lon))
    return { dir: 225, labelKey: "regime_garbin", originDE: "vom Adriatischen Meer", originEN: "from the Adriatic Sea", peakHour: 14 };
  return { dir: 250, labelKey: "regime_seabreeze", originDE: "vom Meer", originEN: "from the sea", peakHour: 14 };
}
function regimeLabel(regime) {
  return t(regime.labelKey || "regime_seabreeze");
}
function regimeOrigin(regime) {
  return lang === "en" ? regime.originEN || regime.originDE : regime.originDE;
}
function hasWindData(fc) {
  return fc && fc.hourly && Array.isArray(fc.hourly.windspeed_10m) && fc.hourly.windspeed_10m.some((v) => v != null);
}
function mergeForecastsMax(a, b) {
  if (!hasWindData(a)) return b;
  if (!hasWindData(b)) return a;
  if (a.hourly.time?.[0] !== b.hourly.time?.[0]) return a;
  const out = JSON.parse(JSON.stringify(a));
  const ha = a.hourly, hb = b.hourly, ho = out.hourly;
  const n = Math.min(ha.windspeed_10m.length, hb.windspeed_10m.length);
  for (let i = 0; i < n; i++) {
    const wa = ha.windspeed_10m[i], wb = hb.windspeed_10m[i];
    if (wb != null && (wa == null || wb > wa)) {
      ho.windspeed_10m[i] = wb;
      if (hb.windgusts_10m?.[i] != null) ho.windgusts_10m[i] = hb.windgusts_10m[i];
      if (hb.winddirection_10m?.[i] != null) ho.winddirection_10m[i] = hb.winddirection_10m[i];
    }
  }
  return out;
}
const PELER = { windFactor: 1.4, gustFactor: 1.45, oraBearing: 195, oraGuard: 70, lastHour: 12 };
function isPelerHour(hour, dir) {
  if (dir == null || hour == null || hour > PELER.lastHour) return false;
  return angDiff(dir, PELER.oraBearing) > PELER.oraGuard;
}
function applyPelerBoost(fc, lat, lon, mos) {
  if (!isGardaSpot(lat, lon) || !hasWindData(fc)) return fc;
  const h = fc.hourly, dirs = h.winddirection_10m || [], times = h.time || [];
  const ens = fc.__ens;
  let boosted = 0, anyMosFaded = false;
  for (let i = 0; i < h.windspeed_10m.length; i++) {
    const hour = times[i] ? parseInt(times[i].slice(11, 13), 10) : null;
    if (!isPelerHour(hour, dirs[i])) continue;
    const mh = mos && mos.hours ? mos.hours[hour] : null;
    const mw = mh && mh.n >= MOS_MIN_SAMPLES ? mosWeight(mh.n, mos.station ? mos.station.km : null) : 0;
    const wf = 1 + (PELER.windFactor - 1) * (1 - mw);
    const gf = 1 + (PELER.gustFactor - 1) * (1 - mw);
    if (h.windspeed_10m[i] != null) h.windspeed_10m[i] = Math.round(h.windspeed_10m[i] * wf * 100) / 100;
    if (h.windgusts_10m && h.windgusts_10m[i] != null) h.windgusts_10m[i] = Math.round(h.windgusts_10m[i] * gf * 100) / 100;
    if (ens) {
      for (const k of ["wind", "p10", "p90"]) {
        if (ens[k] && ens[k][i] != null) ens[k][i] = Math.round(ens[k][i] * wf * 100) / 100;
      }
      if (ens.spread && ens.spread[i] != null) ens.spread[i] = Math.round((ens.p90[i] - ens.p10[i]) * 100) / 100;
    }
    boosted++;
    if (mw > 0) anyMosFaded = true;
  }
  if (boosted) fc.__pelerBoost = true;
  if (anyMosFaded) fc.__pelerFaded = true;
  return fc;
}
const MELTEMI_BOOST = { windFactor: 2, gustFactor: 2.1 };
const ERIC_BOOST = { windFactor: 1.7, gustFactor: 1.8 };
function applyMeltemBoost(fc, lat, lon, mos) {
  const isLeft = isLefkadaNWSpot(lat, lon);
  const isVas = isVasilikiSpot(lat, lon);
  if (!isLeft && !isVas || !hasWindData(fc)) return fc;
  const regime = thermalRegime(lat, lon);
  const cfg = isLeft ? MELTEMI_BOOST : ERIC_BOOST;
  const h = fc.hourly, dirs = h.winddirection_10m || [], times = h.time || [];
  const ens = fc.__ens;
  const t0Date = times[0] ? times[0].slice(0, 10) : null;
  for (let i = 0; i < h.windspeed_10m.length; i++) {
    const hour = times[i] ? parseInt(times[i].slice(11, 13), 10) : null;
    if (hour == null || hour < 9 || hour > 21) continue;
    const align = dirs[i] != null ? Math.max(0, 1 - angDiff(dirs[i], regime.dir) / 80) : 0;
    if (align < 0.25) continue;
    const iDate = times[i] ? times[i].slice(0, 10) : t0Date;
    const leadDay = t0Date && iDate ? Math.round((new Date(iDate) - new Date(t0Date)) / 864e5) : 0;
    const leadDamp = MELTEMI_LEAD_DAMP[Math.min(leadDay, 3)];
    const mh = mos && mos.hours ? mos.hours[hour] : null;
    const mw = mh && mh.n >= MOS_MIN_SAMPLES ? mosWeight(mh.n, mos.station ? mos.station.km : null) : 0;
    const wf = 1 + (cfg.windFactor - 1) * (1 - mw) * leadDamp;
    const gf = 1 + (cfg.gustFactor - 1) * (1 - mw) * leadDamp;
    if (h.windspeed_10m[i] != null) h.windspeed_10m[i] = Math.round(h.windspeed_10m[i] * wf * 100) / 100;
    if (h.windgusts_10m && h.windgusts_10m[i] != null)
      h.windgusts_10m[i] = Math.round(h.windgusts_10m[i] * gf * 100) / 100;
    if (ens) {
      for (const k of ["wind", "p10", "p90"]) {
        if (ens[k] && ens[k][i] != null) ens[k][i] = Math.round(ens[k][i] * wf * 100) / 100;
      }
      if (ens.spread && ens.spread[i] != null)
        ens.spread[i] = Math.round((ens.p90[i] - ens.p10[i]) * 100) / 100;
    }
  }
  fc.__meltemBoost = isLeft ? "Meltemi" : "Eric";
  return fc;
}
const LIVE_BOOST_MIN_RATIO = 1.2;
const LIVE_BOOST_KMAX = 2;
const LIVE_BOOST_MIN_MODEL = 3 / 1.94384;
const LIVE_BOOST_WIN_START = 11;
const LIVE_BOOST_WIN_END = 19;
const LIVE_BOOST_ACTIVE_MIN = 11;
const LIVE_BOOST_ACTIVE_MAX = 20;
const LIVE_GUST_BLEND = 0.5;
const LIVE_ANCHOR_HOURS = 2;
function applyLiveStationBoost(wins, gust, live, isToday) {
  const none = { wins, gust, k: 1, applied: false, station: null, nowKn: null };
  if (!isToday || !live || !live.ok || live.sensorOk === false || live.wind == null) return none;
  const nowH = live.time ? parseInt(live.time.slice(0, 2), 10) : (/* @__PURE__ */ new Date()).getHours();
  if (!(nowH >= LIVE_BOOST_ACTIVE_MIN && nowH <= LIVE_BOOST_ACTIVE_MAX)) return none;
  const modelNow = wins[nowH];
  if (modelNow == null || modelNow < LIVE_BOOST_MIN_MODEL) return none;
  const gustMs = live.gustMax != null ? live.gustMax : live.gust != null ? live.gust : live.wind;
  const effLive = live.wind + LIVE_GUST_BLEND * Math.max(0, gustMs - live.wind);
  const bw = wins.slice(), bg = gust ? gust.slice() : gust;
  let applied = false;
  for (let h = nowH; h < nowH + LIVE_ANCHOR_HOURS && h <= 23; h++) {
    if (bw[h] != null && effLive > bw[h]) {
      bw[h] = Math.round(effLive * 100) / 100;
      applied = true;
    }
    if (bg && gustMs != null && (bg[h] == null || gustMs > bg[h])) bg[h] = Math.round(gustMs * 100) / 100;
  }
  let k = live.wind / modelNow;
  if (k >= LIVE_BOOST_MIN_RATIO) {
    k = Math.min(k, LIVE_BOOST_KMAX);
    for (let h = LIVE_BOOST_WIN_START; h <= LIVE_BOOST_WIN_END; h++) {
      if (h >= nowH && h < nowH + LIVE_ANCHOR_HOURS) continue;
      if (bw[h] != null) {
        const v = Math.round(bw[h] * k * 100) / 100;
        if (v > bw[h]) {
          bw[h] = v;
          applied = true;
        }
      }
      if (bg && bg[h] != null) {
        const v = Math.round(bg[h] * k * 100) / 100;
        if (v > bg[h]) bg[h] = v;
      }
    }
  } else {
    k = 1;
  }
  return applied ? {
    wins: bw,
    gust: bg,
    k: Math.round(k * 100) / 100,
    applied: true,
    station: live.label || live.key || "Live-Station",
    nowKn: Math.round(msToKn(effLive) * 10) / 10
  } : none;
}
const STATION_TRUST_AT_SPOT = 0.8;
const STATION_MAX_KM = 50;
function measuredWeight(km) {
  if (km == null) return STATION_TRUST_AT_SPOT;
  return Math.max(0, STATION_TRUST_AT_SPOT * (1 - Math.min(km, STATION_MAX_KM) / STATION_MAX_KM));
}
function applyMeasuredStationCorrection(wins, gust, measured, activeDateStr) {
  const none = { wins, gust, applied: false, station: null, km: null, weight: 0 };
  if (!measured || !measured.ok || !measured.hourly || measured.date !== activeDateStr) return none;
  const mw = measured.hourly.wind || [], mg = measured.hourly.gust || [];
  const w = measuredWeight(measured.km);
  if (w <= 0) return none;
  const bw = wins.slice(), bg = gust ? gust.slice() : gust;
  let applied = false;
  for (let h = 0; h < bw.length; h++) {
    if (mw[h] != null && bw[h] != null && mw[h] > bw[h]) {
      bw[h] = Math.round((bw[h] + (mw[h] - bw[h]) * w) * 100) / 100;
      applied = true;
    }
    if (bg && mg[h] != null && bg[h] != null && mg[h] > bg[h]) {
      bg[h] = Math.round((bg[h] + (mg[h] - bg[h]) * w) * 100) / 100;
    }
  }
  return applied ? {
    wins: bw,
    gust: bg,
    applied: true,
    station: measured.label || measured.source || "Station",
    km: measured.km ?? null,
    weight: Math.round(w * 100) / 100
  } : none;
}
const ENS_CORE = ["ecmwf_ifs025", "ecmwf_aifs025_single", "icon_eu", "icon_global", "gfs_seamless"];
const ENS_MIN_MEMBERS = 3;
const ENS_LONG_RANGE = 0.8;
const ensR2 = (v) => v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
function ensembleMembers(lat, lon) {
  const hi = pickForecastModel(lat, lon);
  return hi ? [hi, ...ENS_CORE] : ENS_CORE.slice();
}
function admitMembers(hourly, members, n) {
  const out = [];
  for (const m of members) {
    const arr = hourly?.[`windspeed_10m_${m}`];
    if (!Array.isArray(arr) || arr.length < n) continue;
    let ok = 0;
    for (let i = 0; i < n; i++) if (Number.isFinite(arr[i])) ok++;
    if (ok > 0) out.push({ model: m, arr, coverage: ok / n });
  }
  return out;
}
function quantile(values, q) {
  const a = values.slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (pos - lo);
}
const median = (arr) => quantile(arr, 0.5);
function combineEnsemble(hourly, members) {
  const n = hourly?.time?.length || 0;
  if (!n) return null;
  const adm = admitMembers(hourly, members, n);
  if (adm.length < ENS_MIN_MEMBERS) return null;
  const wind = new Array(n).fill(null), p10 = new Array(n).fill(null), p90 = new Array(n).fill(null), spread = new Array(n).fill(null), nMembers = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const v = [];
    for (const m of adm) if (Number.isFinite(m.arr[i])) v.push(m.arr[i]);
    nMembers[i] = v.length;
    if (v.length < ENS_MIN_MEMBERS) continue;
    wind[i] = ensR2(quantile(v, 0.5));
    p10[i] = ensR2(quantile(v, 0.1));
    p90[i] = ensR2(quantile(v, 0.9));
    spread[i] = ensR2(p90[i] - p10[i]);
  }
  return {
    wind,
    p10,
    p90,
    spread,
    nMembers,
    n,
    members: adm.map((m) => m.model),
    membersLong: adm.filter((m) => m.coverage >= ENS_LONG_RANGE).map((m) => m.model)
  };
}
const GUST_K_MIN = 0.75, GUST_K_MAX = 1.35, GUST_CARRIER_FLOOR_MS = 1;
function rescaleGusts(gust, carrierWind, ensWind) {
  if (!Array.isArray(gust)) return gust;
  return gust.map((g, i) => {
    const c = carrierWind?.[i], e = ensWind?.[i];
    if (!Number.isFinite(g) || !Number.isFinite(c) || !Number.isFinite(e)) return g;
    if (c < GUST_CARRIER_FLOOR_MS) return g;
    return ensR2(g * Math.min(GUST_K_MAX, Math.max(GUST_K_MIN, e / c)));
  });
}
function ensembleGridMatches(fcHourly, ensHourly) {
  const a = fcHourly?.time, b = ensHourly?.time;
  return !!(Array.isArray(a) && Array.isArray(b) && a.length && a.length === b.length && a[0] === b[0]);
}
const MOS_MIN_SAMPLES = 8;
const MOS_W_K = 8;
const MOS_LEAD_DAMP = [1, 0.75, 0.55, 0.4];
const MELTEMI_LEAD_DAMP = [1, 0.8, 0.62, 0.48];
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function mosWeight(n, km) {
  if (!n || n < MOS_MIN_SAMPLES) return 0;
  return clamp01(n / (n + MOS_W_K) * (measuredWeight(km) / STATION_TRUST_AT_SPOT));
}
function thermalCorrection(hour, dir, month, regime, mos, leadDay = 0) {
  const sb = seaBreeze(dir, hour, month, regime);
  const sbB = sb.active ? sb.boost : 0;
  const m = mos && mos.hours ? mos.hours[hour] : null;
  const neuralBias = m ? (leadDay >= 2 ? m.neuralBiasMs48 : leadDay >= 1 ? m.neuralBiasMs24 : m.neuralBiasMs) ?? null : null;
  const linearBias = m && m.n >= MOS_MIN_SAMPLES ? m.biasShrunkMs : null;
  const bias = neuralBias ?? linearBias;
  const leadDamp = MOS_LEAD_DAMP[Math.min(leadDay, 3)];
  const w = bias != null ? mosWeight(m.n, mos.station ? mos.station.km : null) * leadDamp : 0;
  if (w <= 0) return { addMs: sbB, source: "seabreeze", mosWeight: 0, n: m ? m.n : 0, sb, leadDay };
  const source = neuralBias != null ? w >= 0.85 ? "neural_mos" : "neural_blend" : w >= 0.85 ? "mos" : "blend";
  return {
    addMs: Math.round((w * bias + (1 - w) * sbB) * 100) / 100,
    source,
    mosWeight: w,
    n: m.n,
    sb,
    leadDay
  };
}
async function tryFetchForecast(lat, lon) {
  const base = {
    latitude: lat,
    longitude: lon,
    hourly: "temperature_2m,windspeed_10m,windgusts_10m,winddirection_10m,surface_pressure,relativehumidity_2m,cloudcover,cape,lifted_index",
    wind_speed_unit: "ms",
    forecast_days: 7,
    timezone: "auto"
  };
  const fetchModel = (models) => {
    const p = new URLSearchParams(models ? { ...base, models } : base);
    return fetchWithTimeout(`https://api.open-meteo.com/v1/forecast?${p}`);
  };
  const model = pickForecastModel(lat, lon);
  if (model) {
    try {
      const [arome, best] = await Promise.all([
        fetchModel(model).catch(() => null),
        fetchModel("").catch(() => null)
      ]);
      if (hasWindData(arome) && hasWindData(best)) {
        const merged = mergeForecastsMax(arome, best);
        merged.__model = "arome_best_max";
        return merged;
      }
      if (hasWindData(arome)) {
        arome.__model = model;
        return arome;
      }
      if (hasWindData(best)) {
        best.__model = "best_match";
        return best;
      }
    } catch (_) {
    }
  }
  const fc = await fetchModel("");
  fc.__model = "best_match";
  return fc;
}
async function tryFetchEnsemble(lat, lon) {
  const members = ensembleMembers(lat, lon);
  const p = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: "windspeed_10m",
    wind_speed_unit: "ms",
    forecast_days: 7,
    timezone: "auto",
    models: members.join(",")
  });
  const j = await fetchWithTimeout(`https://api.open-meteo.com/v1/forecast?${p}`);
  return { hourly: j?.hourly, ens: combineEnsemble(j?.hourly, members) };
}
function attachEnsemble(fc, res) {
  if (!fc || !res?.ens) return fc;
  if (!ensembleGridMatches(fc.hourly, res.hourly)) {
    fc.__ensRejected = "grid_mismatch";
    return fc;
  }
  fc.__ens = res.ens;
  fc.__carrierModel = fc.__model;
  fc.__model = "ens_median_v1";
  return fc;
}
async function tryFetchHistorical(lat, lon) {
  const now = /* @__PURE__ */ new Date();
  const localDateStr2 = (d) => {
    const y = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, "0"), dy = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${dy}`;
  };
  const end = new Date(now);
  end.setDate(now.getDate() - 1);
  const start = new Date(now);
  start.setDate(now.getDate() - 8);
  const fmt = localDateStr2;
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    start_date: fmt(start),
    end_date: fmt(end),
    hourly: "windspeed_10m,temperature_2m",
    wind_speed_unit: "ms",
    timezone: "auto"
  });
  return fetchWithTimeout(`https://archive-api.open-meteo.com/v1/archive?${params}`, 8e3);
}
function angDiff(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
function computeThermik(h, idx, regime) {
  const cape = h.cape?.[idx] ?? 0, li = h.lifted_index?.[idx] ?? 0, temp = h.temperature_2m?.[idx] ?? 20;
  const cloud = h.cloudcover?.[idx] ?? 50, humid = h.relativehumidity_2m?.[idx] ?? 60;
  const hour = h.time?.[idx] ? parseInt(h.time[idx].slice(11, 13), 10) : 12;
  const solar = Math.max(0, Math.sin(Math.PI * (hour - 6) / 12));
  const capePts = Math.min(40, cape / 3e3 * 40);
  const liPts = li < 0 ? Math.min(30, Math.abs(li) * 5) : li > 2 ? -10 : 0;
  const tempPts = Math.max(0, (temp - 20) * 1.5);
  const cloudF = 1 - cloud / 100 * 0.6;
  const humidF = Math.max(0.4, 1 - (humid - 40) / 120);
  let breezePts = 0;
  if (regime && hour >= 11 && hour <= 18) {
    const dir = h.winddirection_10m?.[idx];
    if (dir != null) breezePts = Math.max(0, 1 - angDiff(dir, regime.dir) / 60) * solar * 25;
  }
  return Math.round(Math.max(0, Math.min(100, (capePts + liPts + tempPts) * solar * cloudF * humidF + breezePts)));
}
function classifyThermik(max) {
  if (max < 10) return { icon: "\u{1F634}", labelKey: "th_none", descKey: "th_none_desc", color: C.go };
  if (max < 30) return { icon: "\u{1F324}", labelKey: "th_light", descKey: "th_light_desc", color: C.caution };
  if (max < 60) return { icon: "\u26C5", labelKey: "th_moderate", descKey: "th_moderate_desc", color: C.caution };
  return { icon: "\u26C8", labelKey: "th_strong", descKey: "th_strong_desc", color: C.stop };
}
function thermikLabel(info) {
  return t(info.labelKey);
}
function thermikDesc(info) {
  return t(info.descKey);
}
function seaBreeze(windDir, hour, month, regime) {
  if (hour < 10 || hour > 19) return { active: false, boost: 0, align: 0 };
  const target = regime?.dir ?? 250;
  const align = Math.max(0, 1 - angDiff(windDir, target) / 80);
  const season = [0, 0.4, 0.5, 0.7, 0.9, 1, 1, 1, 0.8, 0.6, 0.4, 0.2, 0.3][month] ?? 0.5;
  const hf = Math.sin(Math.PI * (hour - 10) / 9);
  const boost = align * season * hf * 3.5;
  return { active: align > 0.25, boost: Math.round(boost * 10) / 10, align };
}
var calcWindow = WF.calcWindow;
var WING_BRANDS = WF.WING_BRANDS;
var DEFAULT_WING_BRAND = WF.DEFAULT_WING_BRAND;
var TABLE_BLEND = WF.TABLE_BLEND;
var FEEDBACK_BLEND = WF.FEEDBACK_BLEND;
var FEEDBACK_MIN_SAMPLES = WF.FEEDBACK_MIN_SAMPLES;
var wingTableWindow = WF.wingTableWindow;
var wingWindow = WF.wingWindow;
var rangeToWindow = WF.rangeToWindow;
var blendWindows = WF.blendWindows;
var scoreHour = WF.scoreHour;
var riderQuiver = WF.riderQuiver;
var bestWingForWind = WF.bestWingForWind;
var scorerFor = WF.scorerFor;
var carries = WF.carries;
var sessionWings = WF.sessionWings;
var wingAdvice = WF.wingAdvice;
var scoreDay = (winds, win, start = 0) => WF.scoreDay(winds, win, { start });
var bestSession = (winds, win, start = 0) => WF.bestSession(winds, win, { start });
function loadStored(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) {
    return fallback;
  }
}
function saveStored(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
    return true;
  } catch (e) {
    return false;
  }
}
function savePref(key, val) {
  saveStored(key, val);
  fetch(`/api/prefs/${key}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: val })
  }).catch(() => {
  });
}
const PROXY_BASE = "/api/station";
async function fetchStationCurrent(lat, lon) {
  try {
    const r = await fetch(`${PROXY_BASE}/current?lat=${lat}&lon=${lon}`, { signal: AbortSignal.timeout(7e3) });
    if (!r.ok) throw new Error(`Proxy ${r.status}`);
    return r.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
async function fetchStationHistory(lat, lon, days = 7) {
  try {
    const r = await fetch(`${PROXY_BASE}/history?lat=${lat}&lon=${lon}&days=${days}`, { signal: AbortSignal.timeout(12e3) });
    if (!r.ok) throw new Error(`Proxy ${r.status}`);
    return r.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
async function fetchStationBias(lat, lon) {
  try {
    const r = await fetch(`${PROXY_BASE}/bias?lat=${lat}&lon=${lon}`, { signal: AbortSignal.timeout(2e4) });
    if (!r.ok) throw new Error(`Proxy ${r.status}`);
    return r.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
async function fetchStationMos(lat, lon) {
  try {
    const r = await fetch(`${PROXY_BASE}/mos?lat=${lat}&lon=${lon}`, { signal: AbortSignal.timeout(8e3) });
    if (!r.ok) throw new Error(`Proxy ${r.status}`);
    return r.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
function computeConfidence({ stationCurrent, modelCurrentWind, modelCurrentDir, stationHistMeanWind, modelHistMeanWind, ensSpreadMs }) {
  const parts = [], notes = [];
  if (stationCurrent && stationCurrent.ok && modelCurrentWind != null && stationCurrent.wind != null) {
    const errMs = Math.abs(stationCurrent.wind - modelCurrentWind);
    parts.push({ w: 0.45, v: Math.max(0, 100 - errMs / 6 * 100) });
    notes.push(`Wind-\u0394 aktuell ${errMs.toFixed(1)} m/s`);
  }
  if (stationCurrent && stationCurrent.ok && modelCurrentDir != null && stationCurrent.dir != null) {
    let dd = Math.abs(stationCurrent.dir - modelCurrentDir) % 360;
    if (dd > 180) dd = 360 - dd;
    parts.push({ w: 0.2, v: Math.max(0, 100 - dd / 90 * 100) });
    notes.push(`Richtungs-\u0394 ${Math.round(dd)}\xB0`);
  }
  if (stationHistMeanWind != null && modelHistMeanWind != null) {
    const bias = Math.abs(stationHistMeanWind - modelHistMeanWind);
    parts.push({ w: 0.35, v: Math.max(0, 100 - bias / 4 * 100) });
    notes.push(`Hist. Bias ${bias.toFixed(1)} m/s`);
  }
  if (ensSpreadMs != null) {
    parts.push({ w: 1, v: Math.max(0, 100 - ensSpreadMs / 4 * 100) });
    notes.push(`Modell-Streuung ${ensSpreadMs.toFixed(1)} m/s`);
  }
  if (!parts.length) return { confidence: null, notes: [t("no_station_compare")] };
  const wsum = parts.reduce((a, p) => a + p.w, 0);
  return { confidence: Math.round(parts.reduce((a, p) => a + p.v * p.w, 0) / wsum), notes };
}
function applyConfidence(rawScore, confidence) {
  if (confidence == null) return { score: rawScore, adjusted: false, confidence: null };
  const pull = (1 - confidence / 100) * 0.4;
  return { score: Math.round(rawScore * (1 - pull) + 50 * pull), adjusted: confidence < 80, confidence };
}
function classifyConfidence(c) {
  if (c == null) return { labelKey: "conf_none", color: C.muted, icon: "\u25CB" };
  if (c >= 80) return { labelKey: "conf_high", color: C.go, icon: "\u25CF" };
  if (c >= 55) return { labelKey: "conf_mid", color: C.caution, icon: "\u25D0" };
  return { labelKey: "conf_low", color: C.stop, icon: "\u25D4" };
}
function confidenceLabel(info) {
  return t(info.labelKey);
}
const TT = {
  contentStyle: { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 11, fontFamily: "monospace", color: C.text },
  labelStyle: { color: C.muted },
  itemStyle: { color: C.text }
};
const ax = { tick: { fill: C.muted, fontSize: 10, fontFamily: "monospace" }, axisLine: { stroke: C.border }, tickLine: false };
const gr = { stroke: C.gridStroke };
const DirArrow = (props) => {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || payload?.dir == null) return null;
  const rot = payload.dir + 180 - 90;
  return /* @__PURE__ */ React.createElement("g", { transform: `translate(${cx},${cy}) rotate(${rot})` }, /* @__PURE__ */ React.createElement("path", { d: "M-7,0 L5,0 M5,0 L0,-4 M5,0 L0,4", stroke: C.caution, strokeWidth: 1.5, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" }));
};
const CA = {
  deep: C.panel,
  panel: C.surface,
  p2: C.bg,
  foam: C.text,
  haze: C.muted,
  lift: C.signal,
  coral: C.stop,
  line: C.border2
};
function applyTheme(name) {
  Object.assign(C, THEMES[name] || THEMES.dark);
  Object.assign(TT.contentStyle, { background: C.panel, border: `1px solid ${C.border}`, color: C.text });
  Object.assign(TT.labelStyle, { color: C.muted });
  Object.assign(TT.itemStyle, { color: C.text });
  Object.assign(ax.tick, { fill: C.muted });
  Object.assign(ax.axisLine, { stroke: C.border });
  gr.stroke = C.gridStroke;
  Object.assign(CA, {
    deep: C.panel,
    panel: C.surface,
    p2: C.bg,
    foam: C.text,
    haze: C.muted,
    lift: C.signal,
    coral: C.stop,
    line: C.border2
  });
}
const HISTORY_EMAILS = ["booehmemaik@gmail.com", "genrich@live.de"];
const HISTORY_SPOTS = [
  { label: "LefkadaNW", key: "LGPZ", boost: 2 },
  { label: "Vasiliki", key: "LGPZ", boost: 1.7 },
  { label: "SurfParkBouka", key: "LGKL", boost: 1 },
  { label: "Talamone", key: "talamone", boost: 1 }
];
function HistoryView({ onClose }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [spotIdx, setSpotIdx] = useState(0);
  const curSpot = HISTORY_SPOTS[spotIdx];
  useEffect(() => {
    setBusy(true);
    fetch("/api/station/obs-history?days=5", { credentials: "include" }).then((r) => r.json()).then((d) => {
      setData(d);
      setBusy(false);
    }).catch(() => {
      setErr(t("hist_err"));
      setBusy(false);
    });
  }, []);
  const HBG = "#0d1117";
  const LINE = "#1e2a38";
  const MUTED = "#6b7f96";
  const FOAM = "#e0ecf8";
  const ACT = "#38bdf8";
  const OBS = "#34d399";
  const MOD = "#fb923c";
  const BIAS_P = "#38bdf8";
  const BIAS_N = "#f87171";
  const stObs = data ? data.obs.filter((r) => r.station_key === curSpot.key) : [];
  const stMos = data ? data.mos.filter((r) => r.station_key === curSpot.key) : [];
  const stMl = data ? data.ml.filter((r) => r.station_key === curSpot.key) : [];
  const boost = curSpot.boost ?? 1;
  const ms2kn = (ms) => ms != null ? Math.round(ms * boost * 1.94384 * 10) / 10 : null;
  const mlByTs = Object.fromEntries(stMl.map((r) => [r.ts, r.fc_wind_ms]));
  const obsData = stObs.map((r) => ({
    t: new Date(r.ts).getTime(),
    lbl: new Date(r.ts).toLocaleDateString("de-DE", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
    obs: ms2kn(r.wind_ms),
    fc: ms2kn(mlByTs[r.ts] ?? null)
  }));
  const mosData = stMos.map((r) => ({
    h: r.hour_local,
    obs: ms2kn(r.obs_median_ms),
    pred: ms2kn(r.pred_median_ms),
    n: r.n_samples
  }));
  const biasData = stMos.map((r) => ({
    h: r.hour_local,
    bias: r.bias_shrunk_ms != null ? Math.round(r.bias_shrunk_ms * boost * 1.94384 * 100) / 100 : 0,
    mad: r.bias_ms != null ? Math.round(r.bias_ms * boost * 1.94384 * 100) / 100 : 0
  }));
  const gr2 = { stroke: LINE };
  const tt = { contentStyle: { background: "#1a2332", border: `1px solid ${LINE}`, fontSize: 12 }, labelStyle: { color: FOAM } };
  const tick = { fill: MUTED, fontSize: 11 };
  const chartH = 200;
  return /* @__PURE__ */ React.createElement("div", { style: { position: "fixed", inset: 0, background: HBG, overflowY: "auto", zIndex: 200, fontFamily: "system-ui,sans-serif" } }, /* @__PURE__ */ React.createElement("div", { style: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 20px",
    background: "#0b0f17",
    borderBottom: `1px solid ${LINE}`,
    position: "sticky",
    top: 0,
    zIndex: 10
  } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14, fontWeight: 700, color: FOAM, letterSpacing: ".05em" } }, t("hist_title")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, marginLeft: 8 } }, HISTORY_SPOTS.map((sp, i) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: sp.label,
      onClick: () => setSpotIdx(i),
      style: {
        padding: "3px 10px",
        borderRadius: 6,
        border: `1px solid ${i === spotIdx ? ACT : LINE}`,
        background: i === spotIdx ? ACT : "transparent",
        color: i === spotIdx ? "#000" : MUTED,
        fontSize: 12,
        cursor: "pointer",
        fontWeight: i === spotIdx ? 700 : 400
      }
    },
    sp.label
  ))), /* @__PURE__ */ React.createElement("button", { onClick: onClose, style: {
    marginLeft: "auto",
    padding: "4px 14px",
    borderRadius: 6,
    border: `1px solid ${LINE}`,
    background: "transparent",
    color: MUTED,
    fontSize: 13,
    cursor: "pointer"
  } }, t("hist_close"))), busy && /* @__PURE__ */ React.createElement("p", { style: { color: MUTED, textAlign: "center", marginTop: 60 } }, t("hist_busy")), err && /* @__PURE__ */ React.createElement("p", { style: { color: "#f87171", textAlign: "center", marginTop: 60 } }, err), data && !busy && /* @__PURE__ */ React.createElement("div", { style: { padding: "24px 20px", maxWidth: 1200, margin: "0 auto" } }, /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 32 } }, /* @__PURE__ */ React.createElement("h3", { style: { color: FOAM, fontSize: 14, fontWeight: 600, margin: "0 0 12px" } }, t("hist_obs_title", { days: data.days }), /* @__PURE__ */ React.createElement("span", { style: { color: MUTED, fontWeight: 400, fontSize: 12, marginLeft: 8 } }, t("hist_obs_pts", { n: stObs.length }))), stObs.length === 0 ? /* @__PURE__ */ React.createElement("p", { style: { color: MUTED, fontSize: 13 } }, t("hist_obs_none")) : /* @__PURE__ */ React.createElement(ResponsiveContainer, { width: "100%", height: chartH }, /* @__PURE__ */ React.createElement(LineChart, { data: obsData, margin: { top: 4, right: 8, bottom: 4, left: 0 } }, /* @__PURE__ */ React.createElement(CartesianGrid, { ...gr2, strokeDasharray: "3 3" }), /* @__PURE__ */ React.createElement(XAxis, { dataKey: "lbl", tick: { ...tick, fontSize: 9 }, interval: Math.floor(obsData.length / 8), angle: -30, textAnchor: "end", height: 40 }), /* @__PURE__ */ React.createElement(YAxis, { tick, unit: " kn", width: 52, domain: ["auto", "auto"] }), /* @__PURE__ */ React.createElement(Tooltip, { ...tt, formatter: (v, n) => [v != null ? v + " kn" : "\u2013", n === "obs" ? t("hist_obs_legend_obs") : t("hist_obs_legend_fc")] }), /* @__PURE__ */ React.createElement(Legend, { wrapperStyle: { fontSize: 12, color: MUTED } }), /* @__PURE__ */ React.createElement(Line, { type: "monotone", dataKey: "obs", stroke: OBS, dot: false, strokeWidth: 1.5, name: "obs", connectNulls: false }), /* @__PURE__ */ React.createElement(Line, { type: "monotone", dataKey: "fc", stroke: MOD, dot: false, strokeWidth: 1.5, name: "fc", connectNulls: false, strokeDasharray: "4 3" })))), /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 32 } }, /* @__PURE__ */ React.createElement("h3", { style: { color: FOAM, fontSize: 14, fontWeight: 600, margin: "0 0 12px" } }, t("hist_mos_title"), stMos[0] && /* @__PURE__ */ React.createElement("span", { style: { color: MUTED, fontWeight: 400, fontSize: 12, marginLeft: 8 } }, t("hist_mos_samples", { n: stMos[0].n }))), stMos.length === 0 ? /* @__PURE__ */ React.createElement("p", { style: { color: MUTED, fontSize: 13 } }, t("hist_mos_none", { n: stObs.length })) : /* @__PURE__ */ React.createElement(ResponsiveContainer, { width: "100%", height: chartH }, /* @__PURE__ */ React.createElement(LineChart, { data: mosData, margin: { top: 4, right: 8, bottom: 4, left: 0 } }, /* @__PURE__ */ React.createElement(CartesianGrid, { ...gr2, strokeDasharray: "3 3" }), /* @__PURE__ */ React.createElement(XAxis, { dataKey: "h", tick, tickFormatter: (h) => `${h}:00` }), /* @__PURE__ */ React.createElement(YAxis, { tick, unit: " kn", width: 52, domain: ["auto", "auto"] }), /* @__PURE__ */ React.createElement(
    Tooltip,
    {
      ...tt,
      labelFormatter: (h) => `${h}:00`,
      formatter: (v, n) => [v != null ? v + " kn" : "\u2013", n === "obs" ? t("hist_mos_legend_obs") : t("hist_mos_legend_pred")]
    }
  ), /* @__PURE__ */ React.createElement(Legend, { wrapperStyle: { fontSize: 12, color: MUTED } }), /* @__PURE__ */ React.createElement(Line, { type: "monotone", dataKey: "obs", stroke: OBS, dot: false, strokeWidth: 2, name: "obs" }), /* @__PURE__ */ React.createElement(Line, { type: "monotone", dataKey: "pred", stroke: MOD, dot: false, strokeWidth: 2, name: "pred", strokeDasharray: "5 3" })))), /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 32 } }, /* @__PURE__ */ React.createElement("h3", { style: { color: FOAM, fontSize: 14, fontWeight: 600, margin: "0 0 12px" } }, t("hist_bias_title"), /* @__PURE__ */ React.createElement("span", { style: { color: MUTED, fontWeight: 400, fontSize: 12, marginLeft: 8 } }, t("hist_bias_sub"))), biasData.length === 0 ? /* @__PURE__ */ React.createElement("p", { style: { color: MUTED, fontSize: 13 } }, t("hist_bias_none")) : /* @__PURE__ */ React.createElement(ResponsiveContainer, { width: "100%", height: chartH }, /* @__PURE__ */ React.createElement(BarChart, { data: biasData, margin: { top: 4, right: 8, bottom: 4, left: 0 } }, /* @__PURE__ */ React.createElement(CartesianGrid, { ...gr2, strokeDasharray: "3 3" }), /* @__PURE__ */ React.createElement(XAxis, { dataKey: "h", tick, tickFormatter: (h) => `${h}:00` }), /* @__PURE__ */ React.createElement(YAxis, { tick, unit: " kn", width: 52, domain: ["auto", "auto"] }), /* @__PURE__ */ React.createElement(ReferenceLine, { y: 0, stroke: LINE, strokeWidth: 1 }), /* @__PURE__ */ React.createElement(
    Tooltip,
    {
      ...tt,
      labelFormatter: (h) => `${h}:00`,
      formatter: (v, n) => [v != null ? v + " kn" : "\u2013", n === "bias" ? t("hist_bias_legend_bias") : t("hist_bias_legend_raw")]
    }
  ), /* @__PURE__ */ React.createElement(Bar, { dataKey: "bias", name: "bias", radius: [3, 3, 0, 0] }, biasData.map((d, i) => /* @__PURE__ */ React.createElement(Cell, { key: i, fill: d.bias >= 0 ? BIAS_P : BIAS_N })))))), /* @__PURE__ */ React.createElement("div", { style: { padding: "12px 16px", background: "#0b0f17", borderRadius: 8, border: `1px solid ${LINE}` } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: MUTED } }, t("hist_ml_pairs", { n: stMl.length }), stMl.length < 60 && /* @__PURE__ */ React.createElement("span", { style: { color: "#fbbf24", marginLeft: 8 } }, t("hist_ml_missing", { n: 60 - stMl.length })), stMl.length >= 60 && /* @__PURE__ */ React.createElement("span", { style: { color: OBS, marginLeft: 8 } }, t("hist_ml_ok"))))));
}
const AuthCtx = React.createContext(null);
function AuthGate({ children }) {
  const [sess, setSess] = useState(null);
  const [histOpen, setHistOpen] = useState(false);
  const [mode, setMode] = useState("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState("");
  const [agTheme, setAgTheme] = useState(() => loadStored("wf_theme", "dark"));
  useEffect(() => {
    function onStorage(e) {
      if (e.key === "wf_theme" && e.newValue) {
        const val = JSON.parse(e.newValue);
        setAgTheme(val === "light" ? "light" : "dark");
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  applyTheme(agTheme === "light" ? "light" : "dark");
  function toggleAuthTheme() {
    const next = agTheme === "light" ? "dark" : "light";
    setAgTheme(next);
    saveStored("wf_theme", next);
  }
  useEffect(() => {
    fetch("/api/auth/get-session", { credentials: "include" }).then((r) => r.json()).then((d) => setSess(d && d.user ? d : false)).catch(() => setSess(false));
  }, []);
  async function submit() {
    setErr("");
    setBusy(true);
    try {
      const url = mode === "signup" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email";
      const body = mode === "signup" ? { name, email, password: pw } : { email, password: pw };
      const r = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const d = await r.json();
      if (!r.ok) setErr(d.message || d.error || t("auth_fail"));
      else setSess(d);
    } catch {
      setErr(t("auth_server_err"));
    } finally {
      setBusy(false);
    }
  }
  async function doSignOut() {
    await fetch("/api/auth/sign-out", { method: "POST", credentials: "include" });
    setSess(false);
    setEmail("");
    setPw("");
    setErr("");
  }
  async function requestReset() {
    setResetBusy(true);
    setResetMsg("");
    try {
      const r = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail })
      });
      setResetMsg(r.ok ? "ok" : "err");
    } catch {
      setResetMsg("err");
    } finally {
      setResetBusy(false);
    }
  }
  const INP = {
    width: "100%",
    boxSizing: "border-box",
    background: CA.p2,
    color: CA.foam,
    border: `1px solid ${CA.line}`,
    borderRadius: 10,
    padding: "11px 12px",
    fontSize: 16
  };
  const cardShadow = agTheme === "light" ? "0 8px 32px -8px rgba(0,0,0,.18)" : "0 30px 70px -30px rgba(0,0,0,.75)";
  if (sess === null) return /* @__PURE__ */ React.createElement("div", { style: { minHeight: "100vh", display: "grid", placeItems: "center", background: CA.deep } }, /* @__PURE__ */ React.createElement("p", { style: { color: CA.haze, fontFamily: "monospace" } }, t("sess_checking")));
  if (!sess) return /* @__PURE__ */ React.createElement("div", { style: {
    minHeight: "100dvh",
    display: "grid",
    placeItems: "center",
    boxSizing: "border-box",
    background: `radial-gradient(120% 90% at 50% -10%,${C.surface},${C.bg})`,
    padding: "max(20px, env(safe-area-inset-top)) 20px max(20px, env(safe-area-inset-bottom))"
  } }, /* @__PURE__ */ React.createElement("div", { style: {
    width: "100%",
    maxWidth: 380,
    background: CA.deep,
    border: `1px solid ${CA.line}`,
    borderRadius: 18,
    padding: 26,
    boxShadow: cardShadow
  } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 } }, /* @__PURE__ */ React.createElement("div", { style: {
    fontSize: 11,
    letterSpacing: ".2em",
    textTransform: "uppercase",
    color: CA.lift,
    fontWeight: 700
  } }, "WindFoil"), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: toggleAuthTheme,
      title: agTheme === "light" ? "Dark Mode" : "Light Mode",
      style: {
        background: "transparent",
        border: `1px solid ${C.border2}`,
        color: C.muted,
        borderRadius: 8,
        padding: "5px 12px",
        fontSize: 13,
        cursor: "pointer",
        lineHeight: 1.2
      }
    },
    agTheme === "light" ? "\u263E" : "\u2600"
  )), /* @__PURE__ */ React.createElement("h1", { style: { fontSize: 21, fontWeight: 700, color: CA.foam, margin: "0 0 4px" } }, mode === "signup" ? t("auth_title_signup") : t("auth_title_signin")), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 13, color: CA.haze, margin: "0 0 20px" } }, mode === "signup" ? t("auth_sub_signup") : t("auth_sub_signin")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, background: CA.p2, padding: 4, borderRadius: 11, marginBottom: 18 } }, ["signin", "signup"].map((m) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: m,
      onClick: () => {
        setMode(m);
        setErr("");
        setResetOpen(false);
        setResetMsg("");
      },
      style: {
        flex: 1,
        padding: 9,
        border: "none",
        borderRadius: 8,
        cursor: "pointer",
        background: mode === m ? CA.panel : "transparent",
        color: mode === m ? CA.foam : CA.haze,
        fontWeight: 600,
        fontSize: 13
      }
    },
    m === "signin" ? t("auth_tab_signin") : t("auth_tab_signup")
  ))), err && /* @__PURE__ */ React.createElement("p", { style: { color: CA.coral, fontSize: 13, margin: "0 0 12px" } }, err), mode === "signup" && /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 12 } }, /* @__PURE__ */ React.createElement("label", { style: { display: "block", fontSize: 12, color: CA.haze, marginBottom: 6 } }, t("auth_name_label")), /* @__PURE__ */ React.createElement(
    "input",
    {
      style: INP,
      value: name,
      onChange: (e) => setName(e.target.value),
      autoComplete: "name",
      placeholder: t("auth_name_placeholder")
    }
  )), /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 12 } }, /* @__PURE__ */ React.createElement("label", { style: { display: "block", fontSize: 12, color: CA.haze, marginBottom: 6 } }, t("auth_email_label")), /* @__PURE__ */ React.createElement(
    "input",
    {
      style: INP,
      type: "email",
      value: email,
      onChange: (e) => setEmail(e.target.value),
      autoComplete: "email",
      placeholder: "mail@example.com"
    }
  )), /* @__PURE__ */ React.createElement("div", { style: { marginBottom: mode === "signin" && !resetOpen ? 8 : 20 } }, /* @__PURE__ */ React.createElement("label", { style: { display: "block", fontSize: 12, color: CA.haze, marginBottom: 6 } }, t("auth_pw_label")), /* @__PURE__ */ React.createElement(
    "input",
    {
      style: INP,
      type: "password",
      value: pw,
      onChange: (e) => setPw(e.target.value),
      autoComplete: mode === "signup" ? "new-password" : "current-password",
      onKeyDown: (e) => e.key === "Enter" && submit()
    }
  )), mode === "signin" && !resetOpen && /* @__PURE__ */ React.createElement("div", { style: { textAlign: "right", marginBottom: 16 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        setResetOpen(true);
        setResetEmail(email);
        setResetMsg("");
      },
      style: {
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        color: CA.lift,
        fontSize: 13,
        textDecoration: "underline",
        textUnderlineOffset: 3
      }
    },
    t("auth_pw_forgot")
  )), mode === "signin" && resetOpen && /* @__PURE__ */ React.createElement("div", { style: {
    background: CA.p2,
    border: `1px solid ${CA.line}`,
    borderRadius: 12,
    padding: "14px 14px 16px",
    marginBottom: 16
  } }, /* @__PURE__ */ React.createElement("label", { style: { display: "block", fontSize: 12, color: CA.haze, marginBottom: 6 } }, t("auth_pw_reset_email_label")), /* @__PURE__ */ React.createElement(
    "input",
    {
      style: { ...INP, marginBottom: 10 },
      type: "email",
      value: resetEmail,
      onChange: (e) => {
        setResetEmail(e.target.value);
        setResetMsg("");
      },
      placeholder: "mail@example.com",
      onKeyDown: (e) => e.key === "Enter" && !resetBusy && requestReset()
    }
  ), resetMsg === "ok" && /* @__PURE__ */ React.createElement("p", { style: {
    fontSize: 13,
    color: CA.foam,
    margin: "0 0 10px",
    background: `${C.go}22`,
    border: `1px solid ${C.go}44`,
    borderRadius: 8,
    padding: "8px 10px"
  } }, t("auth_pw_reset_ok")), resetMsg === "err" && /* @__PURE__ */ React.createElement("p", { style: { fontSize: 13, color: CA.coral, margin: "0 0 10px" } }, t("auth_pw_reset_err")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: requestReset,
      disabled: resetBusy || !resetEmail,
      style: {
        flex: 1,
        padding: "10px 0",
        border: "none",
        borderRadius: 9,
        cursor: "pointer",
        background: CA.lift,
        color: "#fff",
        fontWeight: 700,
        fontSize: 13,
        opacity: resetBusy || !resetEmail ? 0.5 : 1
      }
    },
    resetBusy ? t("auth_btn_loading") : t("auth_pw_reset_btn")
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        setResetOpen(false);
        setResetMsg("");
      },
      style: {
        padding: "10px 14px",
        border: `1px solid ${CA.line}`,
        borderRadius: 9,
        cursor: "pointer",
        background: "transparent",
        color: CA.haze,
        fontSize: 13
      }
    },
    t("auth_pw_reset_cancel")
  ))), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: submit,
      disabled: busy,
      style: {
        width: "100%",
        padding: 13,
        border: "none",
        borderRadius: 11,
        cursor: "pointer",
        background: CA.lift,
        color: "#fff",
        fontWeight: 700,
        fontSize: 14,
        opacity: busy ? 0.5 : 1
      }
    },
    busy ? t("auth_btn_loading") : mode === "signup" ? t("auth_btn_signup") : t("auth_btn_signin")
  )));
  const isHistUser = HISTORY_EMAILS.includes(sess.user?.email);
  return /* @__PURE__ */ React.createElement(AuthCtx.Provider, { value: sess.user?.email || null }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 16px",
    background: CA.deep,
    borderBottom: `1px solid ${CA.line}`,
    minWidth: 0
  } }, /* @__PURE__ */ React.createElement("div", { className: "wf-hdr-nav", style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "nowrap", flex: 1, minWidth: 0 } }, [
    { href: "/sardinia.html", label: "Sardinien" },
    { href: "/sizilien.html", label: "Sizilien" },
    { href: "/spanien.html", label: "Spanien" },
    { href: "/skandinavien.html", label: "Skandinavien" },
    { href: "/vergleich.html", label: "Vergleich" },
    { href: "/watcher.html", label: "Watcher" },
    { href: "/alarm.html", label: "\u{1F514} Windalarm" },
    { href: "/logbuch.html", label: "\u{1F6F6} Logbuch" },
    { href: "/reise.html", label: "\u{1F9ED} Reiseplaner" }
  ].map(({ href, label }) => /* @__PURE__ */ React.createElement(
    "a",
    {
      key: href,
      href,
      style: {
        padding: "6px 10px",
        borderRadius: 8,
        cursor: "pointer",
        flexShrink: 0,
        border: `1px solid ${CA.line}`,
        background: "transparent",
        color: CA.foam,
        fontSize: 13,
        fontWeight: 600,
        textDecoration: "none",
        display: "inline-flex",
        alignItems: "center",
        whiteSpace: "nowrap"
      }
    },
    label
  )), isHistUser && /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setHistOpen((o) => !o),
      style: {
        padding: "6px 10px",
        borderRadius: 8,
        cursor: "pointer",
        flexShrink: 0,
        border: `1px solid ${histOpen ? CA.lift : CA.line}`,
        background: histOpen ? CA.lift : "transparent",
        color: histOpen ? "#fff" : CA.foam,
        fontSize: 13,
        fontWeight: 600,
        whiteSpace: "nowrap"
      }
    },
    "History"
  )), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: doSignOut,
      style: {
        padding: "6px 10px",
        borderRadius: 8,
        cursor: "pointer",
        flexShrink: 0,
        border: `1px solid ${CA.line}`,
        background: "transparent",
        color: CA.foam,
        fontSize: 13,
        fontWeight: 600,
        whiteSpace: "nowrap"
      }
    },
    t("auth_signout")
  )), histOpen && isHistUser ? /* @__PURE__ */ React.createElement(HistoryView, { onClose: () => setHistOpen(false) }) : children));
}
function FeedbackModal({ loc, forecast, gear, onClose, onCalibrated }) {
  const [planed, setPlaned] = useState(null);
  const [wingM2, setWingM2] = useState(null);
  const [rating, setRating] = useState(0);
  const [match, setMatch] = useState(0);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  const defaultTimes = (() => {
    const now = /* @__PURE__ */ new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const fmt = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const from = new Date(now.getTime() - 2 * 60 * 60 * 1e3);
    return { from: fmt(from), to: fmt(now) };
  })();
  const [startTime, setStartTime] = useState(defaultTimes.from);
  const [endTime, setEndTime] = useState(defaultTimes.to);
  const wingOptions = (() => {
    if (!gear || !gear.length) return [];
    const seen = /* @__PURE__ */ new Set();
    return gear.map((g) => parseFloat(g.wing)).filter((s) => !isNaN(s) && seen.size < seen.add(s).size || !seen.has(s) && !seen.add(s)).sort((a, b) => a - b);
  })();
  const tz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  })();
  const dialogRef = useRef(null);
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])');
    if (focusable.length) focusable[0].focus();
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  function timeToIso(hhmm) {
    if (!hhmm) return null;
    const [hh, mm] = hhmm.split(":").map(Number);
    const d = /* @__PURE__ */ new Date();
    d.setHours(hh, mm, 0, 0);
    return d.toISOString();
  }
  async function submit() {
    setBusy(true);
    setErr("");
    try {
      const sr = await fetch("/api/feedback/spot", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: loc.name, lat: loc.lat, lon: loc.lon, timezone: tz })
      });
      if (!sr.ok) throw new Error("spot");
      const { spot } = await sr.json();
      const startedAt = timeToIso(startTime);
      const endedAt = timeToIso(endTime);
      const r = await fetch("/api/feedback", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spotId: spot.id,
          planed,
          wingM2: wingM2 || null,
          startedAt,
          endedAt,
          rating: rating || null,
          conditionsMatched: match || null,
          notes: notes.trim() || null,
          forecast: forecast || void 0
        })
      });
      const d = await r.json();
      if (!r.ok) {
        setErr(d.error === "feedback_locked" ? t("fb_err_locked") : d.error || t("fb_err_save"));
      } else {
        const cal = d.calibration || {};
        setDone({
          ...cal,
          wingCalibration: d.wingCalibration || [],
          _wingM2: wingM2,
          observed: d.observed,
          obsRange: d.obsRange || null
        });
        if (onCalibrated) onCalibrated(cal);
      }
    } catch {
      setErr(t("fb_err_server"));
    } finally {
      setBusy(false);
    }
  }
  const Meter = ({ value, onChange, lo, hi }) => /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6 } }, [1, 2, 3, 4, 5].map((n) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: n,
      type: "button",
      onClick: () => onChange(n),
      style: {
        flex: 1,
        height: 34,
        borderRadius: 10,
        cursor: "pointer",
        border: `1px solid ${value >= n && value ? C.signal : C.border2}`,
        background: value >= n && value ? C.signal : C.bg
      }
    }
  ))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 10, color: C.muted } }, /* @__PURE__ */ React.createElement("span", null, lo), /* @__PURE__ */ React.createElement("span", null, hi)));
  const dateLabel = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "short" }).format(/* @__PURE__ */ new Date());
  const lbl = { display: "block", fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 };
  const inputStyle = { background: C.bg, color: C.text, border: `1px solid ${C.border2}`, borderRadius: 10, padding: "8px 10px", fontSize: 15, fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" };
  return /* @__PURE__ */ React.createElement("div", { role: "dialog", "aria-modal": "true", "aria-labelledby": "fb-modal-title", style: { position: "fixed", top: 0, left: 0, right: 0, height: "100dvh", background: "rgba(0,0,0,.85)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, paddingBottom: "max(16px, env(safe-area-inset-bottom))", boxSizing: "border-box", fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" } }, /* @__PURE__ */ React.createElement("div", { ref: dialogRef, style: { background: C.panel, border: `1px solid ${C.border2}`, borderRadius: 20, width: "100%", maxWidth: 480, maxHeight: "100%", overflow: "auto", color: C.text } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: `1px solid ${C.border}` } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "monospace", fontSize: 10, color: C.signal, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 700 } }, t("fb_modal_label")), /* @__PURE__ */ React.createElement("strong", { id: "fb-modal-title", style: { fontSize: 14 } }, loc.name)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "monospace", fontSize: 11, color: C.muted } }, dateLabel), /* @__PURE__ */ React.createElement("button", { onClick: onClose, "aria-label": t("fb_close"), style: { background: "none", border: "none", color: C.muted, fontSize: 16, cursor: "pointer" } }, "\u2715"))), /* @__PURE__ */ React.createElement("div", { style: { padding: 16 } }, done ? /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: "12px 4px" } }, /* @__PURE__ */ React.createElement("div", { style: { width: 48, height: 48, borderRadius: "50%", margin: "0 auto 12px", display: "grid", placeItems: "center", background: "rgba(61,220,132,0.16)", border: `1px solid ${C.go}`, color: C.go, fontSize: 24 } }, "\u2713"), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 15, fontWeight: 700, marginBottom: 6 } }, t("fb_done_title", { date: dateLabel })), /* @__PURE__ */ React.createElement("p", { style: { color: C.muted, fontSize: 13, margin: 0 } }, t("fb_done_sub", { name: loc.name })), done.observed && done.obsRange ? /* @__PURE__ */ React.createElement("div", { style: { marginTop: 14, padding: 12, borderRadius: 8, background: C.bg, border: `1px solid ${C.signal}`, textAlign: "left", fontSize: 13, color: C.text } }, /* @__PURE__ */ React.createElement("span", null, t("fb_cal_station", { wing: done._wingM2 || "?", lo: done.obsRange.lowKn, hi: done.obsRange.highKn, n: done.obsRange.samples, s: done.obsRange.samples === 1 ? "" : lang === "en" ? "s" : "en" }))) : /* @__PURE__ */ React.createElement("div", { style: { marginTop: 14, padding: 12, borderRadius: 8, background: C.bg, border: `1px solid ${C.border2}`, textAlign: "left", fontSize: 13, color: C.muted } }, /* @__PURE__ */ React.createElement("span", null, t("fb_cal_no_station"))), done.rolling != null && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 10, padding: 12, borderRadius: 8, background: C.bg, border: `1px solid ${C.border2}`, textAlign: "left", fontSize: 13, color: C.text } }, /* @__PURE__ */ React.createElement("span", null, t("fb_cal_threshold", { name: loc.name, kn: done.rolling, n: done.samples, sessions: done.samples === 1 ? t("fb_cal_session") : t("fb_cal_sessions") }))), (() => {
    const wc = done.wingCalibration;
    const wm = done._wingM2;
    if (!wm || !Array.isArray(wc)) return null;
    const entry = wc.find((r) => r.wingM2 === wm);
    if (!entry || entry.minKn == null || entry.maxKn == null) return null;
    return /* @__PURE__ */ React.createElement("div", { style: { marginTop: 10, padding: 12, borderRadius: 8, background: C.bg, border: `1px solid ${C.border2}`, textAlign: "left", fontSize: 13, color: C.text } }, /* @__PURE__ */ React.createElement("span", null, t("fb_cal_range", { wing: wm, name: loc.name, lo: entry.minKn, hi: entry.maxKn, n: entry.samples, sessions: entry.samples === 1 ? t("fb_cal_session") : t("fb_cal_sessions") })));
  })(), /* @__PURE__ */ React.createElement("button", { onClick: onClose, style: { marginTop: 16, width: "100%", padding: 12, border: "none", borderRadius: 10, cursor: "pointer", background: C.signal, color: "#fff", fontWeight: 700, fontSize: 14 } }, t("fb_close"))) : /* @__PURE__ */ React.createElement(React.Fragment, null, err && /* @__PURE__ */ React.createElement("p", { style: { color: C.stop, fontSize: 13, margin: "0 0 12px" } }, err), /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 18 } }, /* @__PURE__ */ React.createElement("span", { id: "lbl-planed", style: lbl }, t("fb_planed_q")), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      "aria-labelledby": "lbl-planed",
      onClick: () => setPlaned(true),
      style: {
        padding: "14px 10px",
        borderRadius: 8,
        cursor: "pointer",
        fontWeight: 600,
        fontSize: 14,
        border: `1px solid ${planed === true ? C.go : C.border2}`,
        background: planed === true ? "rgba(61,220,132,0.16)" : C.bg,
        color: planed === true ? C.go : C.text
      }
    },
    t("fb_yes")
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      "aria-labelledby": "lbl-planed",
      onClick: () => setPlaned(false),
      style: {
        padding: "14px 10px",
        borderRadius: 8,
        cursor: "pointer",
        fontWeight: 600,
        fontSize: 14,
        border: `1px solid ${planed === false ? C.stop : C.border2}`,
        background: planed === false ? "rgba(232,64,64,0.14)" : C.bg,
        color: planed === false ? C.stop : C.text
      }
    },
    t("fb_no")
  ))), /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 18 } }, /* @__PURE__ */ React.createElement("label", { style: { ...lbl, display: "block" }, htmlFor: "fb-wing-select" }, t("fb_wing_label")), wingOptions.length > 0 ? /* @__PURE__ */ React.createElement(
    "select",
    {
      id: "fb-wing-select",
      value: wingM2 || "",
      onChange: (e) => setWingM2(e.target.value ? parseFloat(e.target.value) : null),
      style: { width: "100%", ...inputStyle }
    },
    /* @__PURE__ */ React.createElement("option", { value: "" }, t("fb_wing_not_set")),
    wingOptions.map((s) => /* @__PURE__ */ React.createElement("option", { key: s, value: s }, s, " m\xB2"))
  ) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: C.text } }, wingM2 != null ? `${wingM2} m\xB2` : "\u2014"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6 } }, /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => setWingM2((w) => w != null ? Math.max(1, Math.round((w - 0.5) * 2) / 2) : null), style: { width: 36, height: 36, borderRadius: 6, cursor: "pointer", border: `1px solid ${C.border2}`, background: C.panel, color: C.text, fontSize: 16 } }, "\u2212"), /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => setWingM2((w) => w != null ? Math.min(20, Math.round((w + 0.5) * 2) / 2) : 3), style: { width: 36, height: 36, borderRadius: 6, cursor: "pointer", border: `1px solid ${C.border2}`, background: C.panel, color: C.text, fontSize: 16 } }, "+")))), /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 18 } }, /* @__PURE__ */ React.createElement("span", { id: "lbl-session-window", style: lbl }, t("fb_session_window")), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 11, color: C.muted, marginTop: 0, marginBottom: 10 } }, t("fb_session_hint")), /* @__PURE__ */ React.createElement("div", { "aria-labelledby": "lbl-session-window", style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { style: { fontSize: 11, color: C.muted, display: "block", marginBottom: 4 }, htmlFor: "fb-time-from" }, t("fb_from")), /* @__PURE__ */ React.createElement(
    "input",
    {
      id: "fb-time-from",
      type: "time",
      value: startTime,
      onChange: (e) => setStartTime(e.target.value),
      style: { width: "100%", boxSizing: "border-box", ...inputStyle }
    }
  )), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { style: { fontSize: 11, color: C.muted, display: "block", marginBottom: 4 }, htmlFor: "fb-time-to" }, t("fb_to")), /* @__PURE__ */ React.createElement(
    "input",
    {
      id: "fb-time-to",
      type: "time",
      value: endTime,
      onChange: (e) => setEndTime(e.target.value),
      style: { width: "100%", boxSizing: "border-box", ...inputStyle }
    }
  )))), /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 18 } }, /* @__PURE__ */ React.createElement("span", { id: "lbl-rating", style: lbl }, t("fb_session_q")), /* @__PURE__ */ React.createElement(Meter, { value: rating, onChange: setRating, lo: t("fb_session_lo"), hi: t("fb_session_hi") })), /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 18 } }, /* @__PURE__ */ React.createElement("span", { id: "lbl-match", style: lbl }, t("fb_forecast_q")), /* @__PURE__ */ React.createElement(Meter, { value: match, onChange: setMatch, lo: t("fb_forecast_lo"), hi: t("fb_forecast_hi") })), /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 18 } }, /* @__PURE__ */ React.createElement("span", { style: lbl }, t("fb_notes_label")), /* @__PURE__ */ React.createElement(
    "textarea",
    {
      value: notes,
      onChange: (e) => setNotes(e.target.value),
      rows: 3,
      placeholder: t("fb_notes_placeholder"),
      style: { width: "100%", boxSizing: "border-box", background: C.bg, color: C.text, border: `1px solid ${C.border2}`, borderRadius: 14, padding: "10px 12px", fontSize: 14, fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif", resize: "vertical" }
    }
  )), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      disabled: busy,
      onClick: submit,
      style: { width: "100%", padding: 14, border: "none", borderRadius: 8, cursor: busy ? "not-allowed" : "pointer", background: C.signal, color: "#fff", fontWeight: 700, fontSize: 15, opacity: busy ? 0.5 : 1 }
    },
    busy ? t("fb_submit_loading") : t("fb_submit")
  )))));
}
function App() {
  const userEmail = React.useContext(AuthCtx);
  const [loc, setLoc] = useState(() => loadStored("wf_loc", { lat: 48.0703, lon: 11.1167, name: "W\xF6rthsee / Pilsensee" }));
  const [rider, setRider] = useState(() => loadStored("wf_rider", { weight: 80, wingSize: 5, skill: "intermediate", planeKn: "" }));
  const [ri, setRi] = useState(() => loadStored("wf_rider", { weight: 80, wingSize: 5, skill: "intermediate", planeKn: "" }));
  const [gear, setGear] = useState(() => loadStored("wf_gear", []));
  const [useGear, setUseGear] = useState(() => loadStored("wf_usegear", false));
  const [profileSaved, setProfileSaved] = useState(false);
  const [locSaved, setLocSaved] = useState(false);
  const [newGear, setNewGear] = useState({ name: "", wing: "5.0", planeKn: "" });
  const [forecast, setForecast] = useState(null);
  const [historical, setHist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadMsg, setLoadMsg] = useState(() => t("loading_connect"));
  const [apiStatus, setApiStatus] = useState({ forecast: "\u23F3", historical: "\u23F3" });
  const [activeDay, setActiveDay] = useState(0);
  const [measured, setMeasured] = useState(null);
  const [live, setLive] = useState(null);
  const [mos, setMos] = useState(null);
  const [clock, setClock] = useState("");
  const [activeUsers, setActiveUsers] = useState(null);
  const [windUnit, setWindUnit] = useState("kn");
  const [theme, setThemeState] = useState(() => loadStored("wf_theme", "dark"));
  const [langState, setLangState] = useState(() => loadStored("wf_lang", "de"));
  applyTheme(theme === "light" ? "light" : "dark");
  lang = langState;
  const setTheme = (tval) => {
    setThemeState(tval);
    savePref("wf_theme", tval);
  };
  useEffect(() => {
    const bg = (THEMES[theme] || THEMES.dark).bg;
    document.documentElement.style.background = bg;
    document.body.style.background = bg;
  }, [theme]);
  useEffect(() => {
    document.getElementById("htmlRoot").setAttribute("lang", langState);
  }, [langState]);
  const [showLoc, setShowLoc] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [spotCal, setSpotCal] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (loc && loc.lat != null && loc.lon != null) {
      fetch(`/api/feedback/spot-calibration?lat=${loc.lat}&lon=${loc.lon}`, { credentials: "include" }).then((r) => r.ok ? r.json() : null).then((d) => {
        if (!cancelled) {
          const cal = d && d.calibration && d.calibration.rolling != null ? d.calibration : null;
          const wr = d && Array.isArray(d.wingRanges) ? d.wingRanges : [];
          setSpotCal(cal ? { ...cal, wingRanges: wr } : wr.length ? { rolling: null, samples: 0, wingRanges: wr } : null);
        }
      }).catch(() => {
        if (!cancelled) setSpotCal(null);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [loc && loc.lat, loc && loc.lon]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/locations", { credentials: "include" }).then((r) => r.ok ? r.json() : null).then((d) => {
      if (cancelled || !d) return;
      if (Array.isArray(d.recent) && d.recent.length) {
        setRecent(d.recent);
        saveStored("wf_loc_recent", d.recent);
      }
      if (d.active && d.active.lat != null && d.active.lon != null) {
        setLoc(d.active);
        saveStored("wf_loc", d.active);
      }
    }).catch(() => {
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/prefs", { credentials: "include" }).then((r) => r.ok ? r.json() : null).then((d) => {
      if (cancelled || !d) return;
      if (d.wf_rider && typeof d.wf_rider === "object") {
        setRider(d.wf_rider);
        setRi(d.wf_rider);
        saveStored("wf_rider", d.wf_rider);
      }
      if (Array.isArray(d.wf_gear)) {
        setGear(d.wf_gear);
        saveStored("wf_gear", d.wf_gear);
      }
      if (typeof d.wf_usegear === "boolean") {
        setUseGear(d.wf_usegear);
        saveStored("wf_usegear", d.wf_usegear);
      }
      if (d.wf_theme === "light" || d.wf_theme === "dark") {
        setThemeState(d.wf_theme);
        saveStored("wf_theme", d.wf_theme);
      }
      if (d.wf_lang === "de" || d.wf_lang === "en") {
        setLangState(d.wf_lang);
        saveStored("wf_lang", d.wf_lang);
      }
    }).catch(() => {
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const [geoStatus, setGeoStatus] = useState("");
  const [geoError, setGeoError] = useState("");
  const [recent, setRecent] = useState(() => loadStored("wf_loc_recent", []));
  const [custom, setCustom] = useState({ link: "", name: "" });
  const [linkError, setLinkError] = useState("");
  const [stations, setStations] = useState([]);
  const [stationUrl, setStationUrl] = useState("");
  const [nearbyStations, setNearbyStations] = useState([]);
  const [nearbyStatus, setNearbyStatus] = useState("");
  const [nearbyRadius, setNearbyRadius] = useState(null);
  const [stationCmp, setStationCmp] = useState(null);
  const [stationCmpStatus, setStationCmpStatus] = useState("");
  const [sport, setSport] = useState(() => {
    try {
      return localStorage.getItem("windfoil.sport") ?? "foil";
    } catch {
      return "foil";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("windfoil.sport", sport);
    } catch {
    }
  }, [sport]);
  const DEFAULT_KITE = { kiteModel: "Sculp", kiteSize: 9, skill: "intermediate", weight: 80 };
  const [kiteRider, setKiteRider] = useState(DEFAULT_KITE);
  const [kiteRi, setKiteRi] = useState(DEFAULT_KITE);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminPw, setAdminPw] = useState("");
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [adminToken, setAdminToken] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminOut, setAdminOut] = useState("");
  const [adminErr, setAdminErr] = useState("");
  const [adminTab, setAdminTab] = useState("actions");
  const [users, setUsers] = useState([]);
  const [usersMsg, setUsersMsg] = useState("");
  const [pwInputs, setPwInputs] = useState({});
  useEffect(() => {
    const t2 = setInterval(() => setClock((/* @__PURE__ */ new Date()).toLocaleTimeString("de-DE")), 1e3);
    return () => clearInterval(t2);
  }, []);
  useEffect(() => {
    const load = () => fetch("/api/stats/active-users").then((r) => r.json()).then((d) => setActiveUsers(d.activeUsers)).catch(() => {
    });
    load();
    const t2 = setInterval(load, 6e4);
    return () => clearInterval(t2);
  }, []);
  async function fetchNearbyStations(lat, lon) {
    setNearbyStatus("loading");
    try {
      const r = await fetch(`${PROXY_BASE}/nearby?lat=${lat}&lon=${lon}`, { signal: AbortSignal.timeout(15e3) });
      const d = await r.json();
      if (d && d.ok && Array.isArray(d.stations) && d.stations.length) {
        setNearbyStations(d.stations);
        setNearbyRadius(d.radiusKm ?? null);
        setNearbyStatus(d.stations.some((s) => s.src === "obs") ? "live" : d.stations.some((s) => s.src === "model") ? "model" : "meta");
        return;
      }
      setNearbyStations([]);
      setNearbyRadius(null);
      setNearbyStatus("unavailable");
    } catch (e) {
      setNearbyStations([]);
      setNearbyRadius(null);
      setNearbyStatus("unavailable");
    }
  }
  async function reverseGeocode(lat, lon) {
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?latitude=${lat}&longitude=${lon}&count=1&language=de`;
      const r = await fetch(url, { signal: AbortSignal.timeout(5e3) });
      if (r.ok) {
        const d = await r.json();
        if (d.results && d.results[0]) {
          const p = d.results[0];
          return [p.name, p.admin1, p.country].filter(Boolean).join(", ");
        }
      }
    } catch (e) {
    }
    return null;
  }
  function useMyLocation() {
    setGeoError("");
    if (!("geolocation" in navigator)) {
      setGeoError(t("geo_not_supported"));
      return;
    }
    setGeoStatus("loading");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Math.round(pos.coords.latitude * 1e4) / 1e4;
        const lon = Math.round(pos.coords.longitude * 1e4) / 1e4;
        const name = await reverseGeocode(lat, lon);
        const nl = { lat, lon, name: name || `${t("gps_my_location")} (${lat.toFixed(3)}\xB0, ${lon.toFixed(3)}\xB0)` };
        setLoc(nl);
        pushRecent(nl);
        setGeoStatus("");
        setShowLoc(false);
      },
      (err) => {
        setGeoStatus("error");
        const msg = err.code === 1 ? t("geo_denied") : err.code === 2 ? t("geo_unavail") : err.code === 3 ? t("geo_timeout") : t("geo_generic");
        setGeoError(msg);
      },
      { enableHighAccuracy: true, timeout: 1e4, maximumAge: 6e4 }
    );
  }
  const loadData = useCallback(async (l) => {
    setLoading(true);
    setApiStatus({ forecast: "\u23F3", historical: "\u23F3" });
    setLoadMsg(t("loading_forecast"));
    let fc = null;
    try {
      const [fcRes, ensRes, mosRes] = await Promise.all([
        tryFetchForecast(l.lat, l.lon),
        tryFetchEnsemble(l.lat, l.lon).catch(() => null),
        fetchStationMos(l.lat, l.lon).catch(() => null)
      ]);
      fc = fcRes;
      const mosData = mosRes && mosRes.ok ? mosRes : null;
      setMos(mosData);
      attachEnsemble(fc, ensRes);
      applyPelerBoost(fc, l.lat, l.lon, mosData);
      applyMeltemBoost(fc, l.lat, l.lon, mosData);
      const ml = MODEL_LABELS[fc.__model];
      const ensTag = fc.__ens ? ` (${fc.__ens.members.length})` : "";
      const boostTag = fc.__pelerBoost ? " +Pel\xE8r" : fc.__meltemBoost ? ` +${fc.__meltemBoost}` : "";
      setApiStatus((s) => ({ ...s, forecast: (ml ? `\u2705 ${ml}${ensTag}` : "\u2705 Live") + boostTag }));
      setLoadMsg(t("loading_era5"));
    } catch (e) {
      setApiStatus((s) => ({ ...s, forecast: "\u26A0\uFE0F Demo" }));
      fc = buildDemoForecast(l.lat, l.lon);
      setLoadMsg(t("loading_demo_fc"));
    }
    setForecast(fc);
    let hist = null;
    try {
      hist = await tryFetchHistorical(l.lat, l.lon);
      setApiStatus((s) => ({ ...s, historical: "\u2705 Live" }));
    } catch (e) {
      setApiStatus((s) => ({ ...s, historical: "\u26A0\uFE0F Demo" }));
      hist = buildDemoHistorical(l.lat, l.lon);
    }
    setHist(hist);
    setActiveDay(0);
    setLoading(false);
    fetchNearbyStations(l.lat, l.lon);
    runStationComparison(l.lat, l.lon, fc, hist);
  }, []);
  async function runStationComparison(lat, lon, fc, hist) {
    setStationCmpStatus("loading");
    const [cur, bias] = await Promise.all([
      fetchStationCurrent(lat, lon),
      fetchStationBias(lat, lon)
    ]);
    const biasOk = !!(bias && bias.ok);
    if ((!cur || !cur.ok) && !biasOk) {
      setStationCmp({ available: false, current: cur, bias });
      setStationCmpStatus("unavailable");
      return;
    }
    const nowH = (/* @__PURE__ */ new Date()).getHours();
    const modelCurrentWind = fc?.hourly?.windspeed_10m?.[nowH] ?? null;
    const modelCurrentDir = fc?.hourly?.winddirection_10m?.[nowH] ?? null;
    const stationHistMeanWind = biasOk ? bias.stationMeanMs : null;
    const modelHistMeanWind = biasOk ? bias.modelMeanMs : null;
    const spreads = (fc?.__ens?.spread || []).slice(11, 19).filter((v) => v != null);
    const ensSpreadMs = spreads.length ? spreads.slice().sort((a, b) => a - b)[Math.floor(spreads.length / 2)] : null;
    const { confidence, notes } = computeConfidence({
      stationCurrent: cur,
      modelCurrentWind,
      modelCurrentDir,
      stationHistMeanWind,
      modelHistMeanWind,
      ensSpreadMs
    });
    setStationCmp({
      available: true,
      current: cur,
      bias,
      modelCurrentWind,
      modelCurrentDir,
      stationHistMeanWind,
      modelHistMeanWind,
      confidence,
      notes
    });
    setStationCmpStatus("ok");
  }
  useEffect(() => {
    loadData(loc);
  }, [loc]);
  useEffect(() => {
    if (!forecast || !forecast.hourly.time.length) {
      setMeasured(null);
      return;
    }
    const times = forecast.hourly.time;
    const [fy, fm, fd] = times[0].slice(0, 10).split("-").map(Number);
    const t2 = new Date(fy, fm - 1, fd + activeDay);
    const ds = `${t2.getFullYear()}-${String(t2.getMonth() + 1).padStart(2, "0")}-${String(t2.getDate()).padStart(2, "0")}`;
    let cancelled = false;
    fetch(`/api/station/measured?lat=${loc.lat}&lon=${loc.lon}&date=${ds}`).then((r) => r.json()).then((d) => {
      if (!cancelled) setMeasured(d && d.ok ? d : null);
    }).catch(() => {
      if (!cancelled) setMeasured(null);
    });
    return () => {
      cancelled = true;
    };
  }, [forecast, activeDay, loc]);
  useEffect(() => {
    if (!loc) {
      setLive(null);
      return;
    }
    let cancelled = false;
    const load = () => fetch(`/api/station/live?lat=${loc.lat}&lon=${loc.lon}`).then((r) => r.json()).then((d) => {
      if (!cancelled) setLive(d && d.ok ? d : null);
    }).catch(() => {
      if (!cancelled) setLive(null);
    });
    load();
    const id = setInterval(load, 6e4);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [loc]);
  const dayStartIndices = (() => {
    if (!forecast) return [0, 24, 48, 72, 96, 120, 144];
    const times = forecast.hourly.time;
    if (!times.length) return [0, 24, 48, 72, 96, 120, 144];
    const firstDateStr = times[0].slice(0, 10);
    const [fy, fm, fd] = firstDateStr.split("-").map(Number);
    const result = [];
    for (let d = 0; d < 7; d++) {
      const target = new Date(fy, fm - 1, fd + d);
      const y = target.getFullYear(), m = String(target.getMonth() + 1).padStart(2, "0"), dy = String(target.getDate()).padStart(2, "0");
      const prefix = `${y}-${m}-${dy}`;
      let idx = times.findIndex((t2) => typeof t2 === "string" && t2.startsWith(prefix));
      if (idx === -1) idx = d * 24;
      result.push(idx);
    }
    return result;
  })();
  const effPlaneMs = spotCal && spotCal.rolling != null ? knToMs(spotCal.rolling) : rider.planeKn ? knToMs(parseFloat(rider.planeKn)) : null;
  const spotWingMap = (() => {
    const wr = spotCal && spotCal.wingRanges;
    if (!Array.isArray(wr) || !wr.length) return null;
    const m = {};
    for (const r of wr) m[String(r.wingM2)] = r;
    return m;
  })();
  function getActiveWin() {
    if (sport === "kite") {
      const kite = CRAZYFLY_KITES.find((k) => k.model === kiteRider.kiteModel);
      const size = kite?.sizes.find((s) => s.m === kiteRider.kiteSize);
      if (kite && size) return calcKiteWindow(size.minKn, size.maxKn, kiteRider.skill, kiteRider.weight);
    }
    const effPlaneMsRi = spotCal && spotCal.rolling != null ? knToMs(spotCal.rolling) : ri.planeKn ? knToMs(parseFloat(ri.planeKn)) : null;
    return wingWindow(ri.weight, ri.wingSize, ri.skill, effPlaneMsRi, DEFAULT_WING_BRAND, spotWingMap?.[String(ri.wingSize)]);
  }
  const quiver = sport === "foil" ? riderQuiver(ri, useGear && gear.length ? gear : null, { wingRanges: spotWingMap }) : null;
  const dayData = (() => {
    if (!forecast) return null;
    const h = forecast.hourly, s = dayStartIndices[activeDay] ?? activeDay * 24;
    const carrierWins = h.windspeed_10m.slice(s, s + 24);
    const ensD = forecast.__ens ? {
      wind: forecast.__ens.wind.slice(s, s + 24),
      p10: forecast.__ens.p10.slice(s, s + 24),
      p90: forecast.__ens.p90.slice(s, s + 24),
      spread: forecast.__ens.spread.slice(s, s + 24),
      nMembers: forecast.__ens.nMembers.slice(s, s + 24),
      members: forecast.__ens.members
    } : null;
    const wins = ensD ? ensD.wind.map((w, i) => w == null ? carrierWins[i] : w) : carrierWins;
    const gustRaw = h.windgusts_10m.slice(s, s + 24);
    const gust = ensD ? rescaleGusts(gustRaw, carrierWins, wins) : gustRaw;
    const dirs = h.winddirection_10m.slice(s, s + 24);
    const temp = h.temperature_2m.slice(s, s + 24);
    const pres = h.surface_pressure.slice(s, s + 24);
    const labels = Array.from({ length: 24 }, (_, i) => {
      const t2 = h.time[s + i];
      if (t2) {
        const hh = t2.slice(11, 13), mm = t2.slice(14, 16);
        return `${hh}:${mm}`;
      }
      return `${String(i).padStart(2, "0")}:00`;
    });
    const regime = thermalRegime(loc.lat, loc.lon);
    const thermik = Array.from({ length: 24 }, (_, i) => computeThermik(h, s + i, regime));
    const activeDateStr2 = h.time[s] ? h.time[s].slice(0, 10) : null;
    const month_n = (/* @__PURE__ */ new Date()).getMonth() + 1;
    const tcs = wins.map((w, i) => thermalCorrection(i, dirs[i] ?? 180, month_n, regime, mos, activeDay));
    const winsTh = wins.map((w, i) => w == null ? w : Math.round((w + tcs[i].addMs) * 100) / 100);
    const lb = applyLiveStationBoost(winsTh, gust, live, activeDay === 0);
    const mc = applyMeasuredStationCorrection(lb.wins, lb.gust, measured, activeDateStr2);
    const winsEff = mc.wins, gustEff = mc.gust;
    const slice = (arr, a, b) => arr.slice(a, b).filter(Boolean);
    const midW = slice(winsEff, 12, 16).reduce((a, b) => a + b, 0) / 4 || winsEff[12] || 0;
    const midG = slice(gustEff, 12, 16).reduce((a, b) => a + b, 0) / 4 || gustEff[12] || 0;
    const midDir = dirs[14] ?? dirs[12] ?? 180;
    const tcPeak = thermalCorrection(regime?.peakHour ?? 14, midDir, month_n, regime, mos, activeDay);
    const sb = tcPeak.sb;
    const effW = midW;
    let win, pickedGear = null, pickedWing = null;
    if (quiver) {
      const best = bestWingForWind(quiver, midW);
      if (best) {
        win = best.win;
        pickedWing = best.wing;
        if (useGear && gear.length) pickedGear = gear.find((g) => parseFloat(g.wing) === best.wing) || null;
      }
    }
    if (!win) win = getActiveWin();
    const winsEffBoosted = winsEff;
    const scoreSrc = quiver || win;
    const scores = winsEffBoosted.map(scorerFor(scoreSrc));
    const avgW = winsEffBoosted.reduce((a, b) => a + b, 0) / winsEffBoosted.length;
    const maxG = Math.max(...gustEff);
    const maxT = Math.max(...temp);
    const maxTh = Math.max(...thermik);
    const dayScore = scoreDay(winsEffBoosted, scoreSrc);
    const session = bestSession(winsEffBoosted, scoreSrc);
    const sessWings = quiver && session.startHour != null ? sessionWings(winsEffBoosted, quiver, session.startHour, session.endHour, 0) : [];
    const wingPlan = wingAdvice(sessWings);
    const wingPlanChanges = new Set(sessWings.map((w) => w.wing)).size > 1;
    const thInfo = classifyThermik(maxTh);
    return { wins, gust, dirs, temp, pres, labels, thermik, win, scores, avgW, maxG, maxT, maxTh, midW, midG, sb, regime, effW, winsEffBoosted, dayScore, thInfo, pickedGear, pickedWing, session, wingPlan, wingPlanChanges, liveBoost: lb, measuredCorr: mc, ens: ensD, carrierWins, thermal: tcPeak, thermalHours: tcs };
  })();
  const dayScores = forecast ? Array.from({ length: 7 }, (_, d) => {
    const start = dayStartIndices[d] ?? d * 24;
    const srcW = forecast.__ens ? forecast.__ens.wind.map((w, i) => w == null ? forecast.hourly.windspeed_10m[i] : w) : forecast.hourly.windspeed_10m;
    const dstr = forecast.hourly.time[start] ? forecast.hourly.time[start].slice(0, 10) : null;
    let slice = srcW.slice(start, start + 24);
    let gslice = forecast.__ens ? rescaleGusts(
      forecast.hourly.windgusts_10m.slice(start, start + 24),
      forecast.hourly.windspeed_10m.slice(start, start + 24),
      slice
    ) : forecast.hourly.windgusts_10m.slice(start, start + 24);
    const dirs_d = forecast.hourly.winddirection_10m.slice(start, start + 24);
    const regime_d = thermalRegime(loc.lat, loc.lon);
    const month_d = (/* @__PURE__ */ new Date()).getMonth() + 1;
    slice = slice.map((w, i) => w == null ? w : Math.round((w + thermalCorrection(i, dirs_d[i] ?? 180, month_d, regime_d, mos, d).addMs) * 100) / 100);
    if (d === 0) {
      const lb = applyLiveStationBoost(slice, gslice, live, true);
      slice = lb.wins;
      gslice = lb.gust;
    }
    if (d === activeDay) {
      const mc = applyMeasuredStationCorrection(slice, gslice, measured, dstr);
      slice = mc.wins;
      gslice = mc.gust;
    }
    const scoreSrcD = quiver || getActiveWin();
    return scoreDay(slice, scoreSrcD, 0);
  }) : [];
  const dayNames = forecast ? (() => {
    const times = forecast.hourly.time;
    const firstDateStr = times && times.length ? times[0].slice(0, 10) : null;
    const [fy, fm, fd] = firstDateStr ? firstDateStr.split("-").map(Number) : [0, 0, 0];
    return Array.from({ length: 7 }, (_, d) => {
      if (!firstDateStr) return `Tag ${d + 1}`;
      const target = new Date(fy, fm - 1, fd + d);
      if (d === 0) return t("day_heute");
      if (d === 1) return t("day_morgen");
      const loc_code = lang === "en" ? "en-GB" : "de-DE";
      return target.toLocaleDateString(loc_code, { weekday: "short", day: "numeric", month: "numeric" });
    });
  })() : [];
  const histData = (() => {
    if (!historical || !dayData) return [];
    const hw = historical.hourly.windspeed_10m, ht = historical.hourly.time;
    const days = Math.floor(hw.length / 24);
    const res = [];
    for (let d = 0; d < Math.min(days, 7); d++) {
      const sl = hw.slice(d * 24, d * 24 + 24).filter((v) => v != null);
      const avg = sl.length ? sl.reduce((a, b) => a + b, 0) / sl.length : 0;
      let label = `T-${days - d}`;
      if (ht[d * 24]) {
        const [y, mo, dy] = ht[d * 24].slice(0, 10).split("-").map(Number);
        const loc_code = lang === "en" ? "en-GB" : "de-DE";
        label = new Date(y, mo - 1, dy).toLocaleDateString(loc_code, { weekday: "short", day: "numeric" });
      }
      res.push({ label, era5: Math.round(avg * 10) / 10, prog: null });
    }
    res.push({ label: t("day_heute"), era5: null, prog: Math.round(cvt(dayData.avgW, windUnit) * 10) / 10 });
    return res.map((r) => ({ ...r, era5: r.era5 != null ? Math.round(cvt(r.era5, windUnit) * 10) / 10 : null }));
  })();
  const rec = (() => {
    if (!dayData) return "";
    const { effW, midG, win, pickedGear, wingPlan, wingPlanChanges } = dayData;
    if (sport === "kite") return kiteRec(effW, midG, win, kiteRider.kiteModel, kiteRider.kiteSize, kiteRider.skill, windUnit);
    const { weight, wingSize, skill } = rider;
    const lines = [];
    if (pickedGear) {
      const gname = pickedGear.name ? `<b>${pickedGear.name}</b>` : "Setup";
      const planePart = pickedGear.planeKn ? t("rec_setup_plane", { kn: pickedGear.planeKn }) : "";
      lines.push(t("rec_setup", { name: gname, wing: pickedGear.wing, plane: planePart }));
    }
    if (effW < win.minWind) {
      lines.push(t("rec_too_little", { w: fmtW(effW, windUnit), min: fmtW(win.minWind, windUnit) }));
      lines.push(t("rec_too_little_tip"));
    } else if (effW <= win.optMax) {
      lines.push(t("rec_optimal", { w: fmtW(effW, windUnit), optMin: fmtW(win.optMin, windUnit), optMax: fmtW(win.optMax, windUnit) }));
      if (!pickedGear) lines.push(t("rec_optimal_rider", { sz: wingSize, kg: weight, skill }));
    } else if (effW <= win.maxWind) {
      lines.push(t("rec_overpowered", { w: fmtW(effW, windUnit) }));
      lines.push(t("rec_overpowered_tip", { x: (wingSize - 0.5).toFixed(1) }));
    } else {
      lines.push(t("rec_too_much", { w: fmtW(effW, windUnit), max: fmtW(win.maxWind, windUnit) }));
      lines.push(t("rec_too_much_tip"));
    }
    if (midG - effW > 4) lines.push(t("rec_gust_delta", { dw: fmtW(midG - effW, windUnit) }));
    if (wingPlanChanges) lines.push(t("rec_wing_plan", { plan: wingPlan }));
    lines.push(t("rec_window", { min: fmtW(win.minWind, windUnit), optMin: fmtW(win.optMin, windUnit), optMax: fmtW(win.optMax, windUnit), max: fmtW(win.maxWind, windUnit) }));
    return lines.join("<br>");
  })();
  const activeDateStr = forecast ? (forecast.hourly.time[dayStartIndices[activeDay]] || "").slice(0, 10) : null;
  const meas = measured && measured.ok && measured.date === activeDateStr ? measured.hourly : null;
  const windData = dayData ? dayData.labels.map((l, i) => {
    const hh = parseInt(l.slice(0, 2), 10);
    const mw = meas && meas.wind[hh] != null ? cvt(meas.wind[hh], windUnit) : null;
    const mg = meas && meas.gust[hh] != null ? cvt(meas.gust[hh], windUnit) : null;
    const band = dayData.ens && dayData.ens.p10[i] != null && dayData.ens.p90[i] != null ? [cvt(dayData.ens.p10[i], windUnit), cvt(dayData.ens.p90[i], windUnit)] : null;
    return { h: l, wind: cvt(dayData.winsEffBoosted[i], windUnit), gust: cvt(dayData.gust[i], windUnit), score: dayData.scores[i], mwind: mw, mgust: mg, band, hh };
  }).filter((d) => d.hh >= 6 && d.hh <= 23) : [];
  const gearByHour = (() => {
    if (!dayData) return null;
    const { winsEffBoosted, labels } = dayData;
    return labels.map((_, i) => {
      const w = winsEffBoosted[i];
      if (!w || w < 0.5) return null;
      if (sport === "kite") {
        const kite = CRAZYFLY_KITES.find((k) => k.model === kiteRider.kiteModel);
        if (!kite) return null;
        let best = null, bestPri = -1;
        for (const s of kite.sizes) {
          const adj = calcKiteWindow(s.minKn, s.maxKn, kiteRider.skill, kiteRider.weight);
          const inOpt = w >= adj.optMin && w <= adj.optMax;
          const inRange = w >= adj.minWind && w <= adj.maxWind;
          const pri = inOpt ? 2 : inRange ? 1 : 0;
          if (pri > bestPri) {
            bestPri = pri;
            best = { m: s.m, pri };
          }
        }
        return best && best.pri > 0 ? { label: `${best.m}m`, score: best.pri === 2 ? 88 : 50 } : null;
      }
      if (quiver) {
        const b = bestWingForWind(quiver, w);
        if (!b || !carries(b.win, w)) return null;
        return { label: `${b.wing}m`, score: b.score };
      }
      return null;
    });
  })();
  const FensterTick = ({ x, y, payload, ghour, lbls }) => {
    const i = (lbls ?? []).indexOf(payload?.value);
    const g = i >= 0 ? ghour?.[i] : null;
    const show3h = i >= 0 && i % 3 === 0;
    if (!show3h && !g) return null;
    const col = !g ? null : g.score >= 75 ? C.go : C.caution;
    const prev = i > 0 ? ghour?.[i - 1] : null;
    const sizeChanged = !prev || prev.label !== g?.label;
    return /* @__PURE__ */ React.createElement("g", { transform: `translate(${x},${y})` }, show3h && /* @__PURE__ */ React.createElement("text", { textAnchor: "middle", fill: ax.tick.fill, fontSize: 9, fontFamily: "monospace", dy: 11 }, payload?.value), g && sizeChanged && /* @__PURE__ */ React.createElement("text", { textAnchor: "middle", fill: col, fontSize: 8, fontFamily: "monospace", fontWeight: "bold", dy: 22 }, g.label), g && !sizeChanged && /* @__PURE__ */ React.createElement("circle", { cx: 0, cy: 19, r: 2.5, fill: col }));
  };
  const dirData = dayData ? dayData.labels.map((l, i) => ({ idx: i, dir: dayData.dirs[i] })) : [];
  const tempData = dayData ? dayData.labels.map((l, i) => ({ h: l, temp: dayData.temp[i] })) : [];
  const presData = dayData ? dayData.labels.map((l, i) => ({ h: l, pres: Math.round(dayData.pres[i]) })) : [];
  const thData = dayData ? dayData.labels.map((l, i) => ({ h: l, th: dayData.thermik[i] })) : [];
  const sc2col = (s) => s >= 75 ? C.go : s >= 45 ? C.caution : C.stop;
  async function adminLogin() {
    setAdminErr("");
    if (!adminPw) {
      setAdminErr("Bitte Passwort eingeben.");
      return;
    }
    setAdminBusy(true);
    try {
      const r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPw })
      });
      const d = await r.json();
      if (d.ok && d.token) {
        setAdminToken(d.token);
        setAdminAuthed(true);
        setAdminPw("");
        setAdminErr("");
      } else {
        setAdminErr(d.error || "Login fehlgeschlagen.");
      }
    } catch (e) {
      setAdminErr("Server nicht erreichbar (l\xE4uft der Proxy?).");
    }
    setAdminBusy(false);
  }
  async function adminRun(path, label) {
    setAdminBusy(true);
    setAdminOut(`\u25B6 ${label}\u2026`);
    setAdminErr("");
    try {
      const r = await fetch(`/api/admin/${path}`, { headers: { "X-Admin-Token": adminToken } });
      const d = await r.json();
      setAdminOut((d.output || JSON.stringify(d)).trim());
      if (!d.ok) setAdminErr("Aktion meldete einen Fehler (siehe Ausgabe).");
    } catch (e) {
      setAdminErr("Server nicht erreichbar.");
      setAdminOut("");
    }
    setAdminBusy(false);
  }
  async function adminApi(path, opts = {}) {
    const headers = { "X-Admin-Token": adminToken, ...opts.headers || {} };
    if (opts.body) headers["Content-Type"] = "application/json";
    const r = await fetch(`/api/admin/${path}`, { ...opts, headers });
    return r.json();
  }
  async function loadUsers() {
    setUsersMsg("");
    setAdminBusy(true);
    try {
      const d = await adminApi("users");
      if (d.ok) setUsers(d.users);
      else setUsersMsg(d.error || "Laden fehlgeschlagen.");
    } catch (e) {
      setUsersMsg("Server nicht erreichbar.");
    }
    setAdminBusy(false);
  }
  async function toggleUser(u) {
    setUsersMsg("");
    setAdminBusy(true);
    try {
      const d = await adminApi(
        "users/set-disabled",
        { method: "POST", body: JSON.stringify({ id: u.id, disabled: !u.disabled }) }
      );
      if (d.ok) await loadUsers();
      else {
        setUsersMsg(d.error || "Fehler.");
        setAdminBusy(false);
      }
    } catch (e) {
      setUsersMsg("Server nicht erreichbar.");
      setAdminBusy(false);
    }
  }
  async function resetUserPw(u) {
    const pw = (pwInputs[u.id] || "").trim();
    if (pw.length < 10) {
      setUsersMsg("Passwort muss mindestens 10 Zeichen haben.");
      return;
    }
    setUsersMsg("");
    setAdminBusy(true);
    try {
      const d = await adminApi(
        "users/reset-password",
        { method: "POST", body: JSON.stringify({ id: u.id, password: pw }) }
      );
      if (d.ok) {
        setUsersMsg(`\u2713 Passwort f\xFCr ${u.email} gesetzt.`);
        setPwInputs((p) => ({ ...p, [u.id]: "" }));
      } else setUsersMsg(d.error || "Fehler.");
    } catch (e) {
      setUsersMsg("Server nicht erreichbar.");
    }
    setAdminBusy(false);
  }
  async function deleteUser(u) {
    if (!window.confirm(`Benutzer \u201E${u.email}" endg\xFCltig l\xF6schen?

Alle Daten (Spots, Equipment, Sessions, Profil, Einstellungen) werden unwiderruflich entfernt.`)) return;
    setUsersMsg("");
    setAdminBusy(true);
    try {
      const d = await adminApi(
        "users/delete",
        { method: "POST", body: JSON.stringify({ id: u.id }) }
      );
      if (d.ok) {
        setUsersMsg(`\u2713 Benutzer ${u.email} gel\xF6scht.`);
        await loadUsers();
      } else {
        setUsersMsg(d.error || "Fehler.");
        setAdminBusy(false);
      }
    } catch (e) {
      setUsersMsg("Server nicht erreichbar.");
      setAdminBusy(false);
    }
  }
  function pushRecent(l, opts) {
    if (!l || l.lat == null || l.lon == null) return;
    const active = !!(opts && opts.active);
    const key = (x) => `${(+x.lat).toFixed(4)},${(+x.lon).toFixed(4)}`;
    const k = key(l);
    const entry = { lat: +l.lat, lon: +l.lon, name: l.name };
    const next = [entry, ...recent.filter((r) => key(r) !== k)].slice(0, 8);
    setRecent(next);
    saveStored("wf_loc_recent", next);
    if (active) saveStored("wf_loc", l);
    fetch("/api/locations", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: +l.lat, lon: +l.lon, name: l.name, setActive: active })
    }).then((r) => r.ok ? r.json() : null).then((d) => {
      if (d && Array.isArray(d.recent)) {
        setRecent(d.recent);
        saveStored("wf_loc_recent", d.recent);
      }
    }).catch(() => {
    });
  }
  const S = {
    wrap: { fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif", background: C.bg, color: C.text, minHeight: "100vh", fontSize: 14 },
    hdr: { background: C.headerBg, borderBottom: `1px solid ${C.border}`, padding: "10px 16px", backdropFilter: "blur(20px)", display: "flex", flexDirection: "column", gap: 4, position: "sticky", top: 0, zIndex: 100 },
    hdrRow1: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
    hdrRow2: { display: "flex", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: 6 },
    locBar: { background: C.panel, borderBottom: `2px solid ${C.sky}`, padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
    riderBar: { background: C.panel, borderBottom: `1px solid ${C.border}`, borderTop: `2px solid ${C.signal}`, padding: "14px 20px" },
    main: { padding: "14px clamp(10px,3vw,18px) calc(40px + env(safe-area-inset-bottom))", maxWidth: 1200, margin: "0 auto" },
    card: { background: C.panel, border: `1px solid ${C.border2}`, borderRadius: 14, padding: "16px 20px", marginBottom: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.3),0 1px 2px rgba(0,0,0,0.2)" },
    sec: { fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", color: C.muted, marginBottom: 8 },
    btn: { background: C.signal, color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, padding: "10px 20px", cursor: "pointer" },
    btnG: { background: "transparent", border: `1px solid ${C.border2}`, color: C.muted, borderRadius: 8, fontSize: 13, padding: "8px 14px", cursor: "pointer" },
    inp: { background: C.bg, border: `1px solid ${C.border2}`, color: C.text, borderRadius: 8, padding: "8px 12px", fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif", fontSize: 12, outline: "none" },
    fl: { fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif", fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 4 },
    fi: { background: C.bg, border: `1px solid ${C.border2}`, color: C.text, borderRadius: 8, padding: "0 10px", fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif", fontSize: 14, outline: "none", height: 44, width: "100%", boxSizing: "border-box" },
    grid2: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14, marginBottom: 12 },
    grid6: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 12 },
    cw: { height: 190 },
    cwL: { height: 210 }
  };
  return /* @__PURE__ */ React.createElement("div", { style: S.wrap }, /* @__PURE__ */ React.createElement("header", { style: S.hdr }, /* @__PURE__ */ React.createElement("div", { style: S.hdrRow1 }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("svg", { width: "38", height: "38", viewBox: "0 0 32 32", fill: "none", style: { display: "block", flexShrink: 0 }, "aria-label": "WindFoil" }, /* @__PURE__ */ React.createElement("path", { d: "M5 11.5h11.5a2.7 2.7 0 1 0-2.7-2.7", stroke: C.signal, strokeWidth: "2.6", strokeLinecap: "round" }), /* @__PURE__ */ React.createElement("path", { d: "M5 20.5h15a2.7 2.7 0 1 1-2.7 2.7", stroke: C.signal, strokeWidth: "2.6", strokeLinecap: "round" }), /* @__PURE__ */ React.createElement("path", { d: "M5 16h6.6a2.3 2.3 0 1 0-2.3-2.3", stroke: C.muted, strokeWidth: "2.4", strokeLinecap: "round" })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif", fontWeight: 900, fontSize: 15, letterSpacing: "0.15em", color: C.text } }, "WINDFOIL"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif", fontSize: 10, color: C.muted, letterSpacing: "0.1em" } }, t("version_label")))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement(
    "a",
    {
      href: "https://paypal.me/boehmemaik",
      target: "_blank",
      rel: "noopener noreferrer",
      title: t("footer_support_title"),
      style: { background: "transparent", border: `1px solid ${C.border2}`, color: C.muted, borderRadius: 8, padding: "5px 12px", fontSize: 11, cursor: "pointer", textDecoration: "none", lineHeight: "1.6" }
    },
    t("footer_donate")
  ), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "monospace", fontSize: 13, color: C.signal, minWidth: 44, textAlign: "right" } }, clock))), /* @__PURE__ */ React.createElement("div", { style: S.hdrRow2 }, /* @__PURE__ */ React.createElement("span", { style: { display: "flex", gap: 6, fontSize: 9, fontFamily: "monospace" } }, /* @__PURE__ */ React.createElement("span", { title: "Forecast API" }, "FC:", apiStatus.forecast), /* @__PURE__ */ React.createElement("span", { title: "Historical API" }, "ERA5:", apiStatus.historical)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 3 } }, [{ k: "foil", lk: "sport_foil" }, { k: "kite", lk: "sport_kite" }].map(({ k, lk }) => /* @__PURE__ */ React.createElement("button", { key: k, onClick: () => setSport(k), style: { background: sport === k ? C.signal : "transparent", border: `1px solid ${sport === k ? C.signal : C.border2}`, color: sport === k ? "#fff" : C.muted, borderRadius: 8, padding: "5px 12px", fontSize: 10, cursor: "pointer" } }, t(lk)))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 3 } }, ["ms", "kn", "bf"].map((u) => /* @__PURE__ */ React.createElement("button", { key: u, onClick: () => setWindUnit(u), style: { background: windUnit === u ? C.signal : "transparent", border: `1px solid ${windUnit === u ? C.signal : C.border2}`, color: windUnit === u ? "#fff" : C.muted, borderRadius: 8, padding: "5px 12px", fontSize: 10, cursor: "pointer", textTransform: "uppercase" } }, u === "ms" ? "m/s" : u === "kn" ? "kn" : "BF"))), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setTheme(theme === "light" ? "dark" : "light"),
      title: theme === "light" ? "Dark Mode" : "Light Mode",
      style: { background: "transparent", border: `1px solid ${C.border2}`, color: C.muted, borderRadius: 8, padding: "5px 12px", fontSize: 13, cursor: "pointer", lineHeight: 1.2 }
    },
    theme === "light" ? "\u263E" : "\u2600"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        const nl = langState === "de" ? "en" : "de";
        setLangState(nl);
        savePref("wf_lang", nl);
      },
      style: { background: "transparent", border: `1px solid ${C.border2}`, color: C.muted, borderRadius: 8, padding: "5px 12px", fontSize: 10, cursor: "pointer" }
    },
    langState === "de" ? "EN" : "DE"
  ), activeUsers != null && /* @__PURE__ */ React.createElement("span", { title: t("active_users_title"), style: { fontFamily: "monospace", fontSize: 10, color: C.muted, display: "flex", alignItems: "center", gap: 3 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: C.go, display: "inline-block" } }), activeUsers))), /* @__PURE__ */ React.createElement("div", { style: S.locBar }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, fontSize: 15 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 20 } }, "\u{1F4CD}"), /* @__PURE__ */ React.createElement("b", { style: { color: "#fff", fontSize: 16, letterSpacing: "0.02em" } }, loc.name), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "monospace", fontSize: 11, color: C.sky } }, loc.lat.toFixed(4), "\xB0N, ", loc.lon.toFixed(4), "\xB0E"), spotCal && spotCal.rolling != null && /* @__PURE__ */ React.createElement(
    "span",
    {
      title: `Abhebe-Schwellenwert aus ${spotCal.samples} Session(s) an diesem Spot \u2014 gilt nur lokal`,
      style: { fontFamily: "monospace", fontSize: 10, color: C.go, background: "rgba(61,220,132,0.12)", border: `1px solid ${C.go}`, borderRadius: 4, padding: "2px 7px" }
    },
    t("loc_calibrated", { kn: spotCal.rolling })
  )), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center" } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      style: { ...S.btnG, borderColor: locSaved ? C.go : C.border2, color: locSaved ? C.go : C.muted },
      title: t("loc_remember"),
      onClick: () => {
        pushRecent(loc, { active: true });
        setLocSaved(true);
        setTimeout(() => setLocSaved(false), 2e3);
      }
    },
    locSaved ? t("loc_remembered") : t("loc_remember")
  ), /* @__PURE__ */ React.createElement("button", { style: S.btnG, onClick: () => setShowLoc(true) }, t("loc_change")), /* @__PURE__ */ React.createElement(
    "button",
    {
      style: { ...S.btnG, borderColor: C.signal, color: C.signal },
      title: t("loc_feedback"),
      onClick: () => setShowFeedback(true)
    },
    t("loc_feedback")
  ))), /* @__PURE__ */ React.createElement("div", { style: S.riderBar }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: C.signal, marginBottom: 12, fontWeight: 700 } }, sport === "kite" ? t("profile_kite") : t("profile_foil"), " & ", t("profile_and_equip")), sport === "foil" && /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(155px,1fr))", gap: 10, marginBottom: 10 } }, [
    { lk: "field_weight", k: "weight", step: 1, min: 40, max: 150 },
    { lk: "field_wing", k: "wingSize", step: 0.5, min: 2, max: 12 }
  ].map((f) => /* @__PURE__ */ React.createElement("div", { key: f.k }, /* @__PURE__ */ React.createElement("label", { style: S.fl }, t(f.lk)), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      value: ri[f.k],
      step: f.step,
      min: f.min,
      max: f.max,
      onChange: (e) => setRi((r) => ({ ...r, [f.k]: parseFloat(e.target.value) })),
      style: S.fi
    }
  ))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { style: S.fl }, t("field_skill")), /* @__PURE__ */ React.createElement("select", { value: ri.skill, onChange: (e) => setRi((r) => ({ ...r, skill: e.target.value })), style: S.fi }, ["beginner", "intermediate", "advanced", "pro"].map((s) => /* @__PURE__ */ React.createElement("option", { key: s, value: s }, t(`skill_${s}`))))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { style: S.fl, title: t("field_plane_kn_title") }, t("field_plane_kn")), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      value: ri.planeKn,
      step: 0.5,
      min: 4,
      max: 30,
      placeholder: t("field_plane_placeholder"),
      onChange: (e) => setRi((r) => ({ ...r, planeKn: e.target.value })),
      style: S.fi
    }
  ))), sport === "kite" && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4 } }, /* @__PURE__ */ React.createElement("label", { style: { fontFamily: "monospace", fontSize: 9, color: C.muted, textTransform: "uppercase" } }, t("field_weight")), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      value: kiteRi.weight,
      step: 1,
      min: 40,
      max: 150,
      onChange: (e) => setKiteRi((r) => ({ ...r, weight: parseFloat(e.target.value) })),
      style: { ...S.inp, width: 100, fontSize: 13 }
    }
  )), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4 } }, /* @__PURE__ */ React.createElement("label", { style: { fontFamily: "monospace", fontSize: 9, color: C.muted, textTransform: "uppercase" } }, t("kite_model_label")), /* @__PURE__ */ React.createElement(
    "select",
    {
      value: kiteRi.kiteModel,
      onChange: (e) => {
        const model = e.target.value;
        const firstSize = CRAZYFLY_KITES.find((k) => k.model === model)?.sizes[0]?.m ?? 9;
        setKiteRi((r) => ({ ...r, kiteModel: model, kiteSize: firstSize }));
      },
      style: { ...S.inp, width: 120, fontSize: 13 }
    },
    CRAZYFLY_KITES.map((k) => /* @__PURE__ */ React.createElement("option", { key: k.model, value: k.model }, k.model))
  )), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4 } }, /* @__PURE__ */ React.createElement("label", { style: { fontFamily: "monospace", fontSize: 9, color: C.muted, textTransform: "uppercase" } }, t("kite_size_label")), /* @__PURE__ */ React.createElement(
    "select",
    {
      value: kiteRi.kiteSize,
      onChange: (e) => setKiteRi((r) => ({ ...r, kiteSize: parseInt(e.target.value) })),
      style: { ...S.inp, width: 300, fontSize: 13 }
    },
    (CRAZYFLY_KITES.find((k) => k.model === kiteRi.kiteModel)?.sizes ?? []).map((s) => {
      const adjW = calcKiteWindow(s.minKn, s.maxKn, "intermediate", kiteRi.weight);
      return /* @__PURE__ */ React.createElement("option", { key: s.m, value: s.m }, s.m, " m  \xB7  Hersteller ", s.minKn, "\u2013", s.maxKn, " kn  \xB7  f\xFCr ", kiteRi.weight, "kg ", Math.round(msToKn(adjW.minWind)), "\u2013", Math.round(msToKn(adjW.maxWind)), " kn");
    })
  )), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4 } }, /* @__PURE__ */ React.createElement("label", { style: { fontFamily: "monospace", fontSize: 9, color: C.muted, textTransform: "uppercase" } }, t("field_skill")), /* @__PURE__ */ React.createElement(
    "select",
    {
      value: kiteRi.skill,
      onChange: (e) => setKiteRi((r) => ({ ...r, skill: e.target.value })),
      style: { ...S.inp, width: 140, fontSize: 13 }
    },
    ["beginner", "intermediate", "advanced", "pro"].map((s) => /* @__PURE__ */ React.createElement("option", { key: s, value: s }, t(`skill_${s}`)))
  ))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      style: { ...S.btn, flex: "1 1 180px", touchAction: "manipulation" },
      onClick: () => {
        if (sport === "kite") {
          setKiteRider({ ...kiteRi });
        } else {
          setRider({ ...ri });
        }
        setActiveDay(0);
      }
    },
    t("btn_analyse")
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      style: { ...S.btn, flex: "1 1 180px", background: "transparent", border: `1px solid ${C.go}`, color: C.go, touchAction: "manipulation" },
      onClick: () => {
        savePref("wf_rider", ri);
        setRider({ ...ri });
        setProfileSaved(true);
        setTimeout(() => setProfileSaved(false), 2e3);
      }
    },
    profileSaved ? t("btn_profile_saved") : t("btn_save_profile")
  )), /* @__PURE__ */ React.createElement("div", { style: { paddingTop: 12, borderTop: `1px solid ${C.border}` } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "monospace", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", color: C.muted } }, t("equip_title")), /* @__PURE__ */ React.createElement("label", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: useGear ? C.go : C.muted, cursor: "pointer" } }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: useGear, onChange: (e) => {
    setUseGear(e.target.checked);
    savePref("wf_usegear", e.target.checked);
    setActiveDay(0);
  } }), t("equip_auto_select"))), gear.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 } }, gear.map((g) => {
    const isRec = useGear && dayData?.pickedGear?.id === g.id;
    return /* @__PURE__ */ React.createElement("div", { key: g.id, style: { display: "flex", alignItems: "center", gap: 6, background: isRec ? `${C.go}1e` : C.bg, border: `1px solid ${isRec ? C.go : C.border2}`, borderRadius: 6, padding: "5px 8px", fontSize: 11 } }, isRec && /* @__PURE__ */ React.createElement("span", { title: "heute empfohlen", style: { color: C.go, fontWeight: 700 } }, "\u2713"), /* @__PURE__ */ React.createElement("span", { style: { color: isRec ? C.go : C.text, fontWeight: isRec ? 700 : 400 } }, g.name || `${g.wing}m\xB2`), /* @__PURE__ */ React.createElement("span", { style: { color: C.muted, fontFamily: "monospace", fontSize: 10 } }, g.wing, "m\xB2", g.planeKn ? ` \xB7 ab ${g.planeKn}kn` : ""), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => {
          const ng = gear.filter((x) => x.id !== g.id);
          setGear(ng);
          savePref("wf_gear", ng);
          setActiveDay(0);
        },
        style: { background: "none", border: "none", color: C.stop, cursor: "pointer", fontSize: 13, padding: 0, lineHeight: 1 }
      },
      "\xD7"
    ));
  })), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", gap: 8, alignItems: "end" } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { style: S.fl }, t("equip_name")), /* @__PURE__ */ React.createElement("input", { value: newGear.name, placeholder: t("equip_name_placeholder"), onChange: (e) => setNewGear((g) => ({ ...g, name: e.target.value })), style: { ...S.fi, height: 38 } })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { style: S.fl }, t("equip_wing")), /* @__PURE__ */ React.createElement("input", { type: "number", step: 0.5, value: newGear.wing, onChange: (e) => setNewGear((g) => ({ ...g, wing: e.target.value })), style: { ...S.fi, height: 38 } })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { style: S.fl }, t("equip_plane")), /* @__PURE__ */ React.createElement("input", { type: "number", step: 0.5, value: newGear.planeKn, placeholder: "opt.", onChange: (e) => setNewGear((g) => ({ ...g, planeKn: e.target.value })), style: { ...S.fi, height: 38 } })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { style: S.fl }, "\xA0"), /* @__PURE__ */ React.createElement(
    "button",
    {
      style: { ...S.btn, width: "100%", height: 38, fontSize: 11, padding: 0, touchAction: "manipulation" },
      onClick: () => {
        if (!newGear.wing) return;
        const entry = { ...newGear, id: Date.now() };
        const ng = [...gear, entry];
        setGear(ng);
        savePref("wf_gear", ng);
        setNewGear({ name: "", wing: "5.0", planeKn: "" });
        setActiveDay(0);
      }
    },
    t("equip_add")
  ))), useGear && gear.length === 0 && /* @__PURE__ */ React.createElement("p", { style: { fontSize: 10, color: C.caution, marginTop: 8 } }, t("equip_none_hint")))), /* @__PURE__ */ React.createElement("div", { style: S.main }, loading && /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: "60px 0", color: C.muted } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 40, marginBottom: 12, display: "inline-block", animation: "spin 1s linear infinite" } }, "\u27F3"), /* @__PURE__ */ React.createElement("p", { style: { fontFamily: "monospace", fontSize: 13, marginBottom: 6 } }, loadMsg), /* @__PURE__ */ React.createElement("p", { style: { fontFamily: "monospace", fontSize: 10, color: C.dim } }, t("loading_demo_hint"))), !loading && forecast && dayData && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 12 } }, [
    { icon: "\u{1F4A8}", label: t("badge_avg", { w: fmtW(dayData.avgW, windUnit) }), c: dayData.avgW >= dayData.win.optMin && dayData.avgW <= dayData.win.optMax ? C.go : dayData.avgW < dayData.win.minWind ? C.stop : C.caution },
    { icon: "\u2B06", label: t("badge_max_gust", { w: fmtW(dayData.maxG, windUnit) }), c: dayData.maxG > dayData.win.maxWind ? C.stop : C.caution },
    { icon: "\u{1F321}", label: t("badge_max_temp", { t: dayData.maxT.toFixed(0) }), c: C.sky },
    { icon: dayData.thInfo.icon, label: thermikLabel(dayData.thInfo), c: dayData.thInfo.color },
    ...(() => {
      const tc = dayData.thermal;
      if (tc && tc.source === "mos") {
        const sign = tc.addMs < 0 ? "\u2212" : "+";
        return [{ icon: "\u{1F3AF}", label: t("badge_mos_corr", { sign, w: fmtW(Math.abs(tc.addMs), windUnit), n: tc.n }), c: C.signal }];
      }
      if (tc && tc.source === "blend") {
        const pct = Math.round(tc.mosWeight * 100);
        return [{ icon: "\u{1F3AF}", label: t("badge_mos_blend", { pct, rest: 100 - pct }), c: C.signal }];
      }
      return dayData.sb.active ? [{ icon: "\u{1F30A}", label: t("badge_seabreeze", { w: fmtW(dayData.sb.boost, windUnit) }), c: C.sky }] : [];
    })()
  ].map((b, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { border: `1px solid ${b.c}`, borderRadius: 4, padding: "6px 10px", fontSize: 12, color: b.c, display: "flex", alignItems: "center", gap: 6, background: C.surface } }, b.icon, " ", b.label))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" } }, dayNames.map((name, d) => {
    const rawSc = dayScores[d];
    const tabConf = d === 0 && stationCmp?.available ? stationCmp.confidence : null;
    const sc = tabConf != null ? applyConfidence(rawSc, tabConf).score : rawSc;
    const active = d === activeDay;
    const icon = sc >= 75 ? "\u2705" : sc >= 45 ? "\u26A0\uFE0F" : "\u274C";
    const uncertain = d >= 4;
    return /* @__PURE__ */ React.createElement("button", { key: d, onClick: () => setActiveDay(d), style: {
      background: active ? C.signal : C.surface,
      border: `1px solid ${active ? C.signal : C.border2}`,
      color: active ? "#fff" : C.muted,
      borderRadius: 8,
      padding: "8px 14px",
      cursor: "pointer",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 2,
      minWidth: 90,
      opacity: uncertain ? 0.72 : 1
    } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14 } }, icon), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "monospace", fontSize: 9, textTransform: "uppercase" } }, name), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "monospace", fontWeight: 900, fontSize: 18, color: active ? "#fff" : sc2col(sc) } }, sc), uncertain && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 7, color: active ? "rgba(255,255,255,.6)" : C.caution, fontFamily: "monospace", letterSpacing: "0.05em" } }, t("day_uncertain")));
  })), (() => {
    const conf = activeDay === 0 && stationCmp?.available ? stationCmp.confidence : null;
    const adj = applyConfidence(dayData.dayScore, conf);
    const cc = classifyConfidence(conf);
    const scoreColor = sc2col(adj.score);
    return /* @__PURE__ */ React.createElement("div", { style: { ...S.card, marginBottom: 12, display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap", borderLeft: `3px solid ${scoreColor}`, background: `linear-gradient(90deg,${scoreColor}12 0%,${C.panel} 40%)` } }, /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", minWidth: 100 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "monospace", fontWeight: 900, fontSize: 56, color: scoreColor, lineHeight: 1 } }, adj.score), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "monospace", fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 4 } }, sport === "kite" ? t("score_kite") : t("score_foil")), adj.adjusted && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: C.caution, marginTop: 3 } }, t("score_raw_adj", { raw: dayData.dayScore }))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 160 } }, dayData.session && dayData.session.startHour != null && dayData.dayScore > 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, color: C.go, fontFamily: "monospace", fontWeight: 700, marginBottom: 4 } }, t("score_best_time", { from: String(dayData.session.startHour).padStart(2, "0"), to: String(dayData.session.endHour).padStart(2, "0") })), dayData.pickedGear ? /* @__PURE__ */ React.createElement("div", { style: { display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: `${C.go}1e`, border: `1px solid ${C.go}`, borderRadius: 8, padding: "7px 12px" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 16 } }, "\u{1F392}"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "monospace", fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em" } }, t("score_auto_rec")), /* @__PURE__ */ React.createElement("b", { style: { fontSize: 15, color: C.go, fontFamily: "monospace" } }, dayData.pickedGear.name || `${dayData.pickedGear.wing} m\xB2`), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: C.muted } }, "\xB7 ", dayData.pickedGear.wing, " m\xB2 \xB7 ", rider.weight, " kg")) : /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: C.muted } }, sport === "kite" ? `${kiteRider.kiteModel} ${kiteRider.kiteSize}m \xB7 ${kiteRider.weight}kg \xB7 ${kiteRider.skill}` : `${rider.weight}kg \xB7 ${rider.wingSize}m\xB2${rider.planeKn ? ` \xB7 ab ${rider.planeKn}kn` : ""}`), conf != null && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6, fontSize: 11, color: cc.color } }, cc.icon, " ", confidenceLabel(cc), " (", conf, "%)"), dayData.liveBoost?.applied && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6, fontSize: 10, color: C.signal, fontFamily: "monospace" } }, dayData.liveBoost.nowKn != null ? `\u2191 Live-Station ${dayData.liveBoost.station}: jetzt ~${dayData.liveBoost.nowKn} kn` : `\u2191 an Live-Station ${dayData.liveBoost.station} angepasst (\xD7${dayData.liveBoost.k})`), dayData.measuredCorr?.applied && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6, fontSize: 10, color: C.signal, fontFamily: "monospace" } }, "\u2191 an Station ", dayData.measuredCorr.station, dayData.measuredCorr.km >= 2 ? ` (~${dayData.measuredCorr.km} km)` : "", " angepasst"), forecast?.__model && MODEL_LABELS[forecast.__model] && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6, fontSize: 10, color: C.muted, fontFamily: "monospace" } }, t("source_label"), " ", MODEL_LABELS[forecast.__model], dayData.thermal?.source === "neural_mos" || dayData.thermal?.source === "neural_blend" ? ` + ${t("neural_mos")}` : dayData.thermal?.source === "mos" || dayData.thermal?.source === "blend" ? ` + ${t("mos_label")}` : "", dayData.liveBoost?.applied ? ` + ${t("live_station")}` : dayData.measuredCorr?.applied ? ` + ${t("meas_station")}` : ""), mos?.meltemProb != null && /* @__PURE__ */ React.createElement("div", { style: {
      marginTop: 6,
      fontSize: 10,
      fontFamily: "monospace",
      color: mos.meltemProb >= 0.6 ? C.go : mos.meltemProb >= 0.35 ? C.caution : C.muted
    } }, t("foil_info_meltemi", { pct: Math.round(mos.meltemProb * 100) }), mos.neuralActive ? t("foil_info_neural") : "")));
  })(), /* @__PURE__ */ React.createElement("div", { style: { ...S.card, borderLeft: `3px solid ${C.go}` } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 } }, /* @__PURE__ */ React.createElement("span", null, "\u{1F3AF}"), /* @__PURE__ */ React.createElement("strong", { style: { color: C.go, fontSize: 13 } }, t("equip_rec_title"))), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: C.muted, lineHeight: 1.9 }, dangerouslySetInnerHTML: { __html: rec } })), /* @__PURE__ */ React.createElement("div", { style: S.card }, /* @__PURE__ */ React.createElement("div", { style: S.sec }, sport === "kite" ? t("kite_window_title") : t("foil_window_title")), meas && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: C.muted, fontFamily: "monospace", marginBottom: 6 } }, "Wei\xDF/rot = echte Station (", measured.source, measured.km >= 2 ? `, ~${measured.km} km entfernt` : "", measured.latest ? `, zuletzt ${measured.latest}` : "", ") vs. Forecast (blau/orange)"), live && live.wind != null && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "2px 0 8px", padding: "6px 10px", borderRadius: 8, background: "rgba(61,220,132,0.08)", border: `1px solid ${C.go}44`, fontSize: 11 } }, /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 5, color: C.go, fontWeight: 600, whiteSpace: "nowrap" } }, /* @__PURE__ */ React.createElement("span", { style: { width: 7, height: 7, borderRadius: "50%", background: live.sensorOk ? C.go : C.stop, boxShadow: `0 0 6px ${live.sensorOk ? C.go : C.stop}` } }), t("live_now_label")), /* @__PURE__ */ React.createElement("span", { style: { color: C.text, fontFamily: "monospace" } }, fmtW(live.wind, windUnit), " ", unitLabel(windUnit), live.gust != null && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 B\xF6e ", fmtW(live.gust, windUnit)), live.dir != null && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 ", compass(live.dir), " ", Math.round(live.dir), "\xB0")), /* @__PURE__ */ React.createElement("span", { style: { color: C.muted, fontFamily: "monospace", fontSize: 10 } }, live.source, live.time ? ` \xB7 ${live.time}` : "", live.sensorOk ? "" : t("live_sensor_lost"))), /* @__PURE__ */ React.createElement("div", { style: S.cwL }, /* @__PURE__ */ React.createElement(ResponsiveContainer, { width: "100%", height: "100%" }, /* @__PURE__ */ React.createElement(ComposedChart, { data: windData, margin: { top: 5, right: 5, bottom: gearByHour && gearByHour.some((g) => g) ? 20 : 5, left: 5 } }, dayData.ens && /* @__PURE__ */ React.createElement(Area, { yAxisId: "l", dataKey: "band", name: "Modell-Streuung", stroke: "none", fill: C.sky, fillOpacity: 0.12, isAnimationActive: false, legendType: "none" }), /* @__PURE__ */ React.createElement(CartesianGrid, { ...gr }), /* @__PURE__ */ React.createElement(XAxis, { dataKey: "h", ...ax, interval: gearByHour ? 0 : 3, tick: gearByHour ? /* @__PURE__ */ React.createElement(FensterTick, { ghour: gearByHour.slice(6), lbls: dayData.labels.slice(6) }) : void 0 }), /* @__PURE__ */ React.createElement(YAxis, { yAxisId: "l", ...ax }), /* @__PURE__ */ React.createElement(YAxis, { yAxisId: "r", orientation: "right", domain: [0, 100], ...ax, tick: { ...ax.tick, fill: C.go } }), /* @__PURE__ */ React.createElement(Tooltip, { ...TT }), /* @__PURE__ */ React.createElement(Legend, { verticalAlign: "top", wrapperStyle: { fontSize: 10, fontFamily: "monospace", color: C.muted, paddingBottom: 4 } }), /* @__PURE__ */ React.createElement(ReferenceArea, { yAxisId: "l", y1: cvt(dayData.win.optMin, windUnit), y2: cvt(dayData.win.optMax, windUnit), fill: "rgba(61,220,132,0.10)", stroke: "rgba(61,220,132,0.3)" }), /* @__PURE__ */ React.createElement(ReferenceLine, { yAxisId: "l", y: cvt(dayData.win.minWind, windUnit), stroke: C.caution, strokeDasharray: "4 3" }), /* @__PURE__ */ React.createElement(Line, { yAxisId: "l", type: "monotone", dataKey: "wind", name: t("wind_label", { u: unitLabel(windUnit) }), stroke: C.sky, strokeWidth: 2, dot: false }), /* @__PURE__ */ React.createElement(Line, { yAxisId: "l", type: "monotone", dataKey: "gust", name: t("gust_label", { u: unitLabel(windUnit) }), stroke: C.signal, strokeDasharray: "4 3", strokeWidth: 1.5, dot: false }), meas && windData.some((d) => d.mwind != null) && /* @__PURE__ */ React.createElement(Line, { yAxisId: "l", type: "monotone", dataKey: "mwind", name: t("mwind_label", { u: unitLabel(windUnit) }), stroke: C.text, strokeWidth: 2, dot: false, connectNulls: true }), meas && windData.some((d) => d.mgust != null) && /* @__PURE__ */ React.createElement(Line, { yAxisId: "l", type: "monotone", dataKey: "mgust", name: t("mgust_label", { u: unitLabel(windUnit) }), stroke: C.stop, strokeDasharray: "2 2", strokeWidth: 1.5, dot: false, connectNulls: true }), (() => {
    if (!(live && activeDay === 0 && live.wind != null && live.time)) return null;
    const lh = `${live.time.slice(0, 2)}:00`;
    if (!windData.some((d) => d.h === lh)) return null;
    return /* @__PURE__ */ React.createElement(ReferenceDot, { yAxisId: "l", x: lh, y: cvt(live.wind, windUnit), r: 5, fill: C.go, stroke: "#fff", strokeWidth: 1.5, ifOverflow: "extendDomain", label: { value: "Live", position: "top", fontSize: 9, fill: C.go, fontFamily: "monospace" } });
  })(), /* @__PURE__ */ React.createElement(Line, { yAxisId: "r", type: "monotone", dataKey: "score", name: sport === "kite" ? t("kite_score_chart") : t("foil_score_chart"), stroke: C.go, strokeWidth: 1.5, dot: false, strokeOpacity: 0.8 }))))), sport === "kite" && /* @__PURE__ */ React.createElement("div", { style: S.card }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 } }, /* @__PURE__ */ React.createElement("span", { style: S.sec }, t("kite_window_ref")), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "monospace", fontSize: 9, color: C.muted } }, "crazyflykites.com \xB7 Stand 2026")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: C.muted, marginBottom: 10, lineHeight: 1.5 } }, lang === "en" ? /* @__PURE__ */ React.createElement(React.Fragment, null, "Manufacturer specs (reference weight ~80 kg). Second column shows your adjusted window for ", /* @__PURE__ */ React.createElement("b", { style: { color: C.text } }, kiteRider.weight, " kg \xB7 ", t(`skill_${kiteRider.skill}`)), ".") : /* @__PURE__ */ React.createElement(React.Fragment, null, "Herstellerangaben (Referenzgewicht ~80 kg). Die zweite Spalte zeigt dein angepasstes Fenster f\xFCr ", /* @__PURE__ */ React.createElement("b", { style: { color: C.text } }, kiteRider.weight, " kg \xB7 ", t(`skill_${kiteRider.skill}`)), ".")), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 8 } }, CRAZYFLY_KITES.map((kite) => /* @__PURE__ */ React.createElement("div", { key: kite.model, style: { background: C.bg, border: `1px solid ${kiteRider.kiteModel === kite.model ? C.signal : C.border2}`, borderRadius: 6, padding: "10px 12px" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 } }, /* @__PURE__ */ React.createElement("b", { style: { fontFamily: "monospace", fontSize: 12, color: kiteRider.kiteModel === kite.model ? C.signal : C.text } }, kite.model), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, color: C.muted } }, kite.desc)), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: "3px 8px", fontSize: 10, color: C.dim, marginBottom: 4, paddingLeft: 6 } }, /* @__PURE__ */ React.createElement("span", null), /* @__PURE__ */ React.createElement("span", null, t("ref_manufacturer")), /* @__PURE__ */ React.createElement("span", null, kiteRider.weight, " kg")), kite.sizes.map((s) => {
    const isActive = kiteRider.kiteModel === kite.model && kiteRider.kiteSize === s.m;
    const adj = calcKiteWindow(s.minKn, s.maxKn, kiteRider.skill, kiteRider.weight);
    return /* @__PURE__ */ React.createElement("div", { key: s.m, style: {
      display: "grid",
      gridTemplateColumns: "auto 1fr 1fr",
      gap: "3px 8px",
      fontSize: 11,
      color: isActive ? C.go : C.muted,
      marginBottom: 3,
      borderLeft: `2px solid ${isActive ? C.go : "transparent"}`,
      paddingLeft: 6
    } }, /* @__PURE__ */ React.createElement("span", null, s.m, " m"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "monospace", color: C.dim } }, s.minKn, "\u2013", s.maxKn, " kn"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "monospace", color: isActive ? C.go : C.muted } }, Math.round(msToKn(adj.minWind)), "\u2013", Math.round(msToKn(adj.maxWind)), " kn"));
  }))))), sport === "foil" && /* @__PURE__ */ React.createElement("div", { style: S.card }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 } }, /* @__PURE__ */ React.createElement("span", { style: S.sec }, t("foil_window_ref")), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "monospace", fontSize: 9, color: C.muted } }, "Harlem Pace \xB7 Stand 2026")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: C.muted, marginBottom: 10, lineHeight: 1.5 } }, lang === "en" ? /* @__PURE__ */ React.createElement(React.Fragment, null, "Manufacturer specs (reference weight ", WING_BRANDS[DEFAULT_WING_BRAND].refWeightKg, " kg). Second column shows your adjusted window for ", /* @__PURE__ */ React.createElement("b", { style: { color: C.text } }, ri.weight, " kg \xB7 ", t(`skill_${ri.skill}`)), ".") : /* @__PURE__ */ React.createElement(React.Fragment, null, "Herstellerangaben (Referenzgewicht ", WING_BRANDS[DEFAULT_WING_BRAND].refWeightKg, " kg). Die zweite Spalte zeigt dein angepasstes Fenster f\xFCr ", /* @__PURE__ */ React.createElement("b", { style: { color: C.text } }, ri.weight, " kg \xB7 ", t(`skill_${ri.skill}`)), ".")), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 8 } }, Object.entries(WING_BRANDS).map(([brandName, brand]) => /* @__PURE__ */ React.createElement("div", { key: brandName, style: { background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 6, padding: "10px 12px" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 } }, /* @__PURE__ */ React.createElement("b", { style: { fontFamily: "monospace", fontSize: 12, color: C.text } }, brandName), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, color: C.muted } }, t("ref_freeride"))), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: "3px 8px", fontSize: 10, color: C.dim, marginBottom: 4, paddingLeft: 6 } }, /* @__PURE__ */ React.createElement("span", null), /* @__PURE__ */ React.createElement("span", null, t("ref_manufacturer")), /* @__PURE__ */ React.createElement("span", null, ri.weight, " kg")), Object.entries(brand.sizes).map(([sz, data]) => {
    const size = Number(sz);
    const activeSize = dayData?.pickedWing ?? parseFloat(ri.wingSize);
    const isActive = size === activeSize;
    const adj = wingTableWindow(ri.weight, size, brandName);
    const adjOk = adj && !adj.outOfRange;
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        key: sz,
        type: "button",
        title: `${size} m\xB2 ausw\xE4hlen`,
        onClick: () => {
          setRi((r) => ({ ...r, wingSize: size }));
          setRider((r) => ({ ...r, wingSize: size }));
          setActiveDay(0);
        },
        style: {
          display: "grid",
          gridTemplateColumns: "auto 1fr 1fr",
          gap: "3px 8px",
          fontSize: 11,
          color: isActive ? C.go : C.muted,
          marginBottom: 3,
          borderLeft: `2px solid ${isActive ? C.go : C.border}`,
          paddingLeft: 6
        }
      },
      /* @__PURE__ */ React.createElement("span", null, size, " m\xB2"),
      /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "monospace", color: C.dim } }, data.rangeKn[0], "\u2013", data.rangeKn[1], " kn"),
      /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "monospace", color: isActive ? C.go : C.muted } }, adjOk ? `${Math.round(msToKn(adj.minWind))}\u2013${Math.round(msToKn(adj.maxWind))} kn` : "\u2014")
    );
  }))))), /* @__PURE__ */ React.createElement("div", { style: S.grid6 }, [
    { v: cvt(dayData.avgW, windUnit).toFixed(windUnit === "bf" ? 0 : 1), u: unitLabel(windUnit), l: t("stat_avg_wind") },
    { v: cvt(dayData.maxG, windUnit).toFixed(windUnit === "bf" ? 0 : 1), u: unitLabel(windUnit), l: t("stat_max_gust") },
    { v: dayData.maxT.toFixed(0), u: "\xB0C", l: t("stat_temp") },
    { v: Math.round(Math.max(...dayData.pres)), u: "hPa", l: t("stat_pres") },
    { v: dayData.maxTh, u: "", l: t("stat_therm_idx") },
    { v: `${cvt(dayData.win.optMin, windUnit).toFixed(windUnit === "bf" ? 0 : 1)}\u2013${cvt(dayData.win.optMax, windUnit).toFixed(windUnit === "bf" ? 0 : 1)}`, u: unitLabel(windUnit), l: sport === "kite" ? t("stat_kite_window") : t("stat_foil_window") }
  ].map((s, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { ...S.card, marginBottom: 0, padding: "10px 12px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "monospace", fontWeight: 700, fontSize: 19, color: "#fff" } }, s.v, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: C.muted, marginLeft: 3 } }, s.u)), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "monospace", fontSize: 9, color: C.muted, textTransform: "uppercase", marginTop: 2 } }, s.l)))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, margin: "20px 0 12px" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, height: 1, background: C.border } }), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "monospace", fontSize: 9, letterSpacing: "0.14em", color: C.dim, textTransform: "uppercase" } }, t("more_details")), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, height: 1, background: C.border } })), /* @__PURE__ */ React.createElement("div", { style: S.grid2 }, /* @__PURE__ */ React.createElement("div", { style: S.card }, /* @__PURE__ */ React.createElement("div", { style: S.sec }, t("wind_dir_chart")), /* @__PURE__ */ React.createElement("div", { style: S.cw }, /* @__PURE__ */ React.createElement(ResponsiveContainer, { width: "100%", height: "100%" }, /* @__PURE__ */ React.createElement(ScatterChart, null, /* @__PURE__ */ React.createElement(CartesianGrid, { ...gr }), /* @__PURE__ */ React.createElement(XAxis, { dataKey: "idx", type: "number", domain: [0, 23], ...ax, tickFormatter: (v) => `${v}:00`, interval: 5 }), /* @__PURE__ */ React.createElement(YAxis, { dataKey: "dir", domain: [0, 360], ...ax, tickFormatter: (v) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "N"][Math.round(v / 45)] || v }), /* @__PURE__ */ React.createElement(Tooltip, { ...TT, formatter: (v) => [`${v}\xB0`, t("tooltip_dir")] }), /* @__PURE__ */ React.createElement(Scatter, { data: dirData, fill: C.caution, shape: /* @__PURE__ */ React.createElement(DirArrow, null) }))))), /* @__PURE__ */ React.createElement("div", { style: S.card }, /* @__PURE__ */ React.createElement("div", { style: S.sec }, t("temp_chart")), /* @__PURE__ */ React.createElement("div", { style: S.cw }, /* @__PURE__ */ React.createElement(ResponsiveContainer, { width: "100%", height: "100%" }, /* @__PURE__ */ React.createElement(LineChart, { data: tempData }, /* @__PURE__ */ React.createElement(CartesianGrid, { ...gr }), /* @__PURE__ */ React.createElement(XAxis, { dataKey: "h", ...ax, interval: 3 }), /* @__PURE__ */ React.createElement(YAxis, { ...ax }), /* @__PURE__ */ React.createElement(Tooltip, { ...TT }), /* @__PURE__ */ React.createElement(Line, { type: "monotone", dataKey: "temp", stroke: "#ff6b6b", strokeWidth: 2, dot: false })))))), /* @__PURE__ */ React.createElement("div", { style: S.grid2 }, /* @__PURE__ */ React.createElement("div", { style: S.card }, /* @__PURE__ */ React.createElement("div", { style: S.sec }, t("th_chart")), /* @__PURE__ */ React.createElement("div", { style: S.cw }, /* @__PURE__ */ React.createElement(ResponsiveContainer, { width: "100%", height: "100%" }, /* @__PURE__ */ React.createElement(BarChart, { data: thData }, /* @__PURE__ */ React.createElement(CartesianGrid, { ...gr }), /* @__PURE__ */ React.createElement(XAxis, { dataKey: "h", ...ax, interval: 3 }), /* @__PURE__ */ React.createElement(YAxis, { domain: [0, 100], ...ax }), /* @__PURE__ */ React.createElement(Tooltip, { ...TT }), /* @__PURE__ */ React.createElement(Bar, { dataKey: "th", radius: [2, 2, 0, 0] }, thData.map((d, i) => /* @__PURE__ */ React.createElement(Cell, { key: i, fill: d.th < 25 ? "rgba(61,220,132,0.75)" : d.th < 55 ? "rgba(245,185,66,0.75)" : "rgba(232,64,64,0.75)" }))))))), /* @__PURE__ */ React.createElement("div", { style: S.card }, /* @__PURE__ */ React.createElement("div", { style: S.sec }, t("pres_chart")), /* @__PURE__ */ React.createElement("div", { style: S.cw }, /* @__PURE__ */ React.createElement(ResponsiveContainer, { width: "100%", height: "100%" }, /* @__PURE__ */ React.createElement(LineChart, { data: presData }, /* @__PURE__ */ React.createElement(CartesianGrid, { ...gr }), /* @__PURE__ */ React.createElement(XAxis, { dataKey: "h", ...ax, interval: 3 }), /* @__PURE__ */ React.createElement(YAxis, { ...ax, domain: ["auto", "auto"] }), /* @__PURE__ */ React.createElement(Tooltip, { ...TT }), /* @__PURE__ */ React.createElement(Line, { type: "monotone", dataKey: "pres", stroke: "#a78bfa", strokeWidth: 2, dot: false })))))), /* @__PURE__ */ React.createElement("div", { style: S.card }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 8 } }, /* @__PURE__ */ React.createElement("span", { style: S.sec }, t("hist_chart")), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "monospace", fontSize: 9, color: C.muted } }, apiStatus.historical)), /* @__PURE__ */ React.createElement("div", { style: S.cwL }, /* @__PURE__ */ React.createElement(ResponsiveContainer, { width: "100%", height: "100%" }, /* @__PURE__ */ React.createElement(BarChart, { data: histData }, /* @__PURE__ */ React.createElement(CartesianGrid, { ...gr }), /* @__PURE__ */ React.createElement(XAxis, { dataKey: "label", ...ax }), /* @__PURE__ */ React.createElement(YAxis, { ...ax }), /* @__PURE__ */ React.createElement(Tooltip, { ...TT }), /* @__PURE__ */ React.createElement(Legend, { wrapperStyle: { fontSize: 10, fontFamily: "monospace", color: C.muted } }), /* @__PURE__ */ React.createElement(Bar, { dataKey: "era5", name: t("era5_label", { u: unitLabel(windUnit) }), fill: "rgba(58,154,217,0.55)", stroke: C.sky, strokeWidth: 1, radius: [3, 3, 0, 0] }), /* @__PURE__ */ React.createElement(Bar, { dataKey: "prog", name: t("prog_label", { u: unitLabel(windUnit) }), fill: "rgba(61,220,132,0.55)", stroke: C.go, strokeWidth: 1, radius: [3, 3, 0, 0] }))))), /* @__PURE__ */ React.createElement("div", { style: { ...S.card, borderLeft: `3px solid ${C.caution}`, display: "flex", gap: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 22 } }, "\u{1F321}\uFE0F"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("strong", { style: { color: C.caution, fontSize: 13 } }, t("th_title", { label: thermikLabel(dayData.thInfo) })), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.7 } }, thermikDesc(dayData.thInfo), dayData.sb.active && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("br", null), /* @__PURE__ */ React.createElement("br", null), "\u{1F30A} ", /* @__PURE__ */ React.createElement("b", { style: { color: C.sky } }, t("th_breeze_active")), " ", regimeLabel(dayData.regime), " (", regimeOrigin(dayData.regime), ") +", fmtW(dayData.sb.boost, windUnit), " ~", dayData.regime.peakHour, ":00. ", Math.round(dayData.sb.align * 100), "%.")))), /* @__PURE__ */ React.createElement("div", { style: { ...S.card, borderLeft: `3px solid ${C.sky}` } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 } }, /* @__PURE__ */ React.createElement("span", { style: S.sec }, t("station_cmp_title")), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "monospace", fontSize: 9, color: C.muted } }, stationCmpStatus === "loading" ? lang === "en" ? "\u23F3 comparing\u2026" : "\u23F3 Abgleich\u2026" : stationCmpStatus === "ok" ? "\u2705 aktiv" : stationCmpStatus === "unavailable" ? "\u25CB keine Station" : "")), stationCmpStatus === "loading" && /* @__PURE__ */ React.createElement("p", { style: { fontSize: 11, color: C.dim } }, t("station_cmp_loading")), stationCmpStatus === "unavailable" && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: C.muted, lineHeight: 1.6 } }, lang === "en" ? /* @__PURE__ */ React.createElement(React.Fragment, null, "No station backend available. The confidence score requires the proxy (", /* @__PURE__ */ React.createElement("code", { style: { color: C.caution } }, "proxy-server.js"), ") with a valid Weatherbit API key on your host. Until then, the rating is based solely on model + rider inputs.") : /* @__PURE__ */ React.createElement(React.Fragment, null, "Kein Stations-Backend erreichbar. Der Vertrauens-Score ben\xF6tigt den Proxy (", /* @__PURE__ */ React.createElement("code", { style: { color: C.caution } }, "proxy-server.js"), ") mit g\xFCltigem Weatherbit-API-Key auf deinem Host. Bis dahin basiert die Bewertung allein auf Modell + Rider-Angaben.")), stationCmpStatus === "ok" && stationCmp?.available && (() => {
    const cc = classifyConfidence(stationCmp.confidence);
    const cur = stationCmp.current;
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "monospace", fontWeight: 900, fontSize: 32, color: cc.color, lineHeight: 1 } }, stationCmp.confidence ?? "\u2013", "%"), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: cc.color, marginBottom: 4 } }, cc.icon, " ", confidenceLabel(cc)), /* @__PURE__ */ React.createElement("div", { style: { height: 6, background: C.bg, borderRadius: 8, overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: { height: "100%", width: `${stationCmp.confidence ?? 0}%`, background: cc.color, transition: "width .4s" } })))), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, marginBottom: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 6, padding: "8px 10px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: C.muted, textTransform: "uppercase", marginBottom: 4 } }, t("station_label")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: C.text } }, "\u{1F4A8} ", cur?.ok && cur.wind != null ? fmtW(cur.wind, windUnit) : "\u2013"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: C.muted } }, "\u{1F9ED} ", cur?.ok && cur.dir != null ? Math.round(cur.dir) + "\xB0" : "\u2013", " \xB7 \u{1F321} ", cur?.ok && cur.temp != null ? cur.temp.toFixed(0) + "\xB0" : "\u2013"), cur?.station_id && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "monospace", fontSize: 8, color: C.dim, marginTop: 4 } }, "ID ", cur.station_id)), /* @__PURE__ */ React.createElement("div", { style: { background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 6, padding: "8px 10px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: C.muted, textTransform: "uppercase", marginBottom: 4 } }, t("model_label")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: C.text } }, "\u{1F4A8} ", stationCmp.modelCurrentWind != null ? fmtW(stationCmp.modelCurrentWind, windUnit) : "\u2013"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: C.muted } }, "\u{1F9ED} ", stationCmp.modelCurrentDir != null ? Math.round(stationCmp.modelCurrentDir) + "\xB0" : "\u2013")), /* @__PURE__ */ React.createElement("div", { style: { background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 6, padding: "8px 10px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: C.muted, textTransform: "uppercase", marginBottom: 4 } }, t("bias_window")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: C.text } }, t("station_label").split(" ")[0], " ", stationCmp.stationHistMeanWind != null ? fmtW(stationCmp.stationHistMeanWind, windUnit) : "\u2013"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: C.muted } }, t("model_label"), " ", stationCmp.modelHistMeanWind != null ? fmtW(stationCmp.modelHistMeanWind, windUnit) : "\u2013"), stationCmp.bias?.ok && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "monospace", fontSize: 8, color: C.dim, marginTop: 3 } }, stationCmp.bias.station?.name, " \xB7 ", stationCmp.bias.station?.km, "km \xB7 ", stationCmp.bias.samples, "h \xB7 ", stationCmp.bias.periodStart, "\u2026", stationCmp.bias.periodEnd)), dayData?.ens && (() => {
      const ph = Math.min(23, Math.max(0, dayData.regime?.peakHour ?? 14));
      const p10 = dayData.ens.p10[ph], p90 = dayData.ens.p90[ph];
      const n = dayData.ens.nMembers?.[ph] ?? dayData.ens.members?.length ?? null;
      return /* @__PURE__ */ React.createElement("div", { style: { background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 6, padding: "8px 10px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: C.muted, textTransform: "uppercase", marginBottom: 4 } }, t("model_spread")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: C.text } }, "\u{1F4CA} ", p10 != null && p90 != null ? `${fmtW(p10, windUnit)} \u2013 ${fmtW(p90, windUnit)}` : "\u2013"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: C.muted } }, t("p10_p90_around", { h: String(ph).padStart(2, "0") })), n != null && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "monospace", fontSize: 8, color: C.dim, marginTop: 4 } }, t("n_member", { n })));
    })()), stationCmp.notes?.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, stationCmp.notes.map((n, i) => /* @__PURE__ */ React.createElement("span", { key: i, style: { fontFamily: "monospace", fontSize: 10, color: C.muted, background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 4, padding: "3px 8px" } }, n))), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: C.dim, marginTop: 10, lineHeight: 1.5 } }, t("station_cmp_detail", { src: cur?.source || "Weatherbit" })));
  })()), /* @__PURE__ */ React.createElement("div", { style: S.card }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 } }, /* @__PURE__ */ React.createElement("span", { style: S.sec }, t("nearby_title", { radius: nearbyRadius ? t("nearby_radius", { r: nearbyRadius }) : "" })), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "monospace", fontSize: 9, color: C.muted } }, nearbyStatus === "loading" ? t("nearby_loading") : nearbyStatus === "live" ? t("nearby_live") : nearbyStatus === "model" ? t("nearby_model") : nearbyStatus === "meta" ? t("nearby_meta") : nearbyStatus === "unavailable" ? t("nearby_unavail") : "")), nearbyStatus === "loading" && /* @__PURE__ */ React.createElement("p", { style: { fontSize: 11, color: C.dim } }, t("nearby_searching")), nearbyStatus === "unavailable" && /* @__PURE__ */ React.createElement("p", { style: { fontSize: 11, color: C.dim } }, t("nearby_none")), nearbyStations.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 } }, nearbyStations.map((st, i) => {
    const dirTxt = st.dir != null ? ["N", "NO", "O", "SO", "S", "SW", "W", "NW"][Math.round(st.dir / 45) % 8] : "\u2013";
    return /* @__PURE__ */ React.createElement("div", { key: i, style: { background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 6, padding: "10px 12px" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 6 } }, /* @__PURE__ */ React.createElement("b", { style: { color: C.text, fontSize: 12 } }, st.name), /* @__PURE__ */ React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 } }, /* @__PURE__ */ React.createElement(
      "span",
      {
        style: { fontFamily: "monospace", fontSize: 8, color: st.src === "obs" ? C.go : C.muted },
        title: st.src === "obs" ? "Echte Stationsmessung (Weatherbit)" : "Modellwind am Stationsstandort (Open-Meteo)"
      },
      st.src === "obs" ? t("nearby_obs") : st.src === "model" ? t("nearby_mod") : ""
    ), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "monospace", fontSize: 9, color: C.muted } }, st.km, " km"))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11, color: C.muted } }, /* @__PURE__ */ React.createElement("span", { style: { color: C.sky } }, "\u{1F4A8} ", st.wind != null ? fmtW(st.wind, windUnit) : "\u2013"), /* @__PURE__ */ React.createElement("span", { style: { color: C.signal } }, "\u2B06 ", st.gust != null ? fmtW(st.gust, windUnit) : "\u2013"), /* @__PURE__ */ React.createElement("span", null, "\u{1F9ED} ", dirTxt), /* @__PURE__ */ React.createElement("span", null, "\u{1F321} ", st.temp != null ? st.temp.toFixed(0) + "\xB0" : "\u2013")), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "monospace", fontSize: 8, color: C.dim, marginTop: 5 } }, st.lat.toFixed(3), "\xB0, ", st.lon.toFixed(3), "\xB0", st.country ? ` \xB7 ${st.country}` : ""));
  })), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: C.dim, marginTop: 8, lineHeight: 1.5 } }, t("nearby_footer"))), /* @__PURE__ */ React.createElement("div", { style: S.card }, /* @__PURE__ */ React.createElement("div", { style: S.sec }, t("manual_station_title")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 10 } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "url",
      value: stationUrl,
      onChange: (e) => setStationUrl(e.target.value),
      placeholder: t("station_url_placeholder"),
      style: { ...S.inp, flex: 1 }
    }
  ), /* @__PURE__ */ React.createElement("button", { style: { ...S.btn, fontSize: 11, padding: "5px 12px" }, onClick: () => {
    if (stationUrl.trim()) {
      setStations((s) => [...s, { url: stationUrl.trim() }]);
      setStationUrl("");
    }
  } }, t("manual_station_add"))), stations.map((st, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 4, padding: "8px 12px", marginBottom: 6, fontSize: 11, color: C.muted } }, /* @__PURE__ */ React.createElement("b", { style: { color: C.text, display: "block", marginBottom: 3 } }, st.url), t("manual_station_cors"))), !stations.length && /* @__PURE__ */ React.createElement("p", { style: { fontSize: 11, color: C.dim } }, t("manual_station_none"))))), showFeedback && /* @__PURE__ */ React.createElement(
    FeedbackModal,
    {
      loc,
      gear,
      onClose: () => setShowFeedback(false),
      onCalibrated: (cal) => setSpotCal(cal && cal.rolling != null ? cal : null),
      forecast: forecast ? {
        source: "foil-score",
        predictedScore: activeDay === 0 && dayData ? dayData.dayScore : null,
        predictedWindKt: activeDay === 0 && dayData ? dayData.midW : null
      } : null
    }
  ), showLoc && /* @__PURE__ */ React.createElement("div", { role: "dialog", "aria-modal": "true", "aria-labelledby": "loc-modal-title", onKeyDown: (e) => {
    if (e.key === "Escape") setShowLoc(false);
  }, style: { position: "fixed", top: 0, left: 0, right: 0, height: "100dvh", background: "rgba(0,0,0,.85)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, paddingBottom: "max(16px, env(safe-area-inset-bottom))", boxSizing: "border-box" } }, /* @__PURE__ */ React.createElement("div", { style: { background: C.panel, border: `1px solid ${C.border2}`, borderRadius: 20, width: "100%", maxWidth: 460, maxHeight: "100%", overflow: "auto" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: `1px solid ${C.border}` } }, /* @__PURE__ */ React.createElement("strong", { id: "loc-modal-title", style: { fontFamily: "monospace", fontSize: 14 } }, t("loc_modal_title")), /* @__PURE__ */ React.createElement("button", { onClick: () => setShowLoc(false), style: { background: "none", border: "none", color: C.muted, fontSize: 16, cursor: "pointer" } }, "\u2715")), /* @__PURE__ */ React.createElement("div", { style: { padding: 16 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      autoFocus: true,
      onClick: useMyLocation,
      disabled: geoStatus === "loading",
      style: {
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        background: geoStatus === "loading" ? C.surface : "rgba(58,154,217,0.12)",
        border: `1px solid ${C.sky}`,
        color: C.sky,
        borderRadius: 6,
        padding: "10px 12px",
        fontSize: 13,
        fontFamily: "monospace",
        cursor: geoStatus === "loading" ? "wait" : "pointer",
        marginBottom: 12
      }
    },
    geoStatus === "loading" ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { style: { display: "inline-block", animation: "spin 1s linear infinite" } }, "\u27F3"), " ", t("loc_gps_loading")) : /* @__PURE__ */ React.createElement(React.Fragment, null, t("loc_gps_use"))
  ), geoError && /* @__PURE__ */ React.createElement("div", { style: {
    fontSize: 11,
    color: C.caution,
    lineHeight: 1.5,
    background: "rgba(245,185,66,0.08)",
    border: `1px solid ${C.caution}`,
    borderRadius: 4,
    padding: "6px 10px",
    marginBottom: 12
  } }, "\u26A0\uFE0F ", geoError), (() => {
    const SAVED_SPOTS = [
      { lat: 45.2271134, lon: 12.3046255, name: "Chioggia", desc: "AROME-HD \xB7 Garb\xECn/Bora" },
      { lat: 48.0619, lon: 11.1207, name: "Ammersee Eching", desc: "GFS \xB7 ICON-D2 \xB7 Thermik/F\xF6hn" },
      { lat: 48.2989, lon: 11.6178, name: "Hollerner See", desc: "GFS \xB7 ICON-D2 \xB7 Thermik" }
    ];
    return /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "monospace", fontSize: 10, color: C.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" } }, t("loc_spots_section")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } }, SAVED_SPOTS.map((s, i) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: i,
        onClick: () => {
          setLoc(s);
          pushRecent(s, { active: true });
          setShowLoc(false);
        },
        style: { background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 4, color: C.text, textAlign: "left", padding: "8px 12px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }
      },
      /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { display: "block", fontSize: 13 } }, "\u{1F4CD} ", s.name), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: C.muted, fontFamily: "monospace" } }, s.lat.toFixed(4), "\xB0N ", s.lon.toFixed(4), "\xB0E \xB7 ", s.desc)),
      /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: C.signal } }, "\u2605")
    ))));
  })(), recent.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "monospace", fontSize: 10, color: C.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" } }, t("loc_recent_section")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } }, recent.map((r, i) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: i,
      onClick: () => {
        setLoc(r);
        pushRecent(r, { active: true });
        setShowLoc(false);
      },
      style: { background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 4, color: C.text, textAlign: "left", padding: "8px 12px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }
    },
    /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { display: "block", fontSize: 13 } }, r.name), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: C.muted, fontFamily: "monospace" } }, (+r.lat).toFixed(4), "\xB0N ", (+r.lon).toFixed(4), "\xB0E")),
    /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: C.sky } }, "\u21B5")
  )))), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "monospace", fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" } }, t("loc_add_section")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { style: { fontFamily: "monospace", fontSize: 10, color: C.muted, display: "block", marginBottom: 4 } }, t("loc_add_label")), /* @__PURE__ */ React.createElement(
    "textarea",
    {
      value: custom.link,
      rows: 3,
      onChange: (e) => {
        setCustom((c) => ({ ...c, link: e.target.value }));
        setLinkError("");
      },
      placeholder: "https://www.google.com/maps/@36.9833,21.6667,14z\noder: 36.9833, 21.6667",
      style: { ...S.inp, width: "100%", resize: "vertical", lineHeight: 1.4 }
    }
  )), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { style: { fontFamily: "monospace", fontSize: 10, color: C.muted, display: "block", marginBottom: 4 } }, t("loc_add_name_label")), /* @__PURE__ */ React.createElement(
    "input",
    {
      value: custom.name,
      onChange: (e) => setCustom((c) => ({ ...c, name: e.target.value })),
      placeholder: parsePlaceName(custom.link) || t("loc_add_name_placeholder"),
      style: { ...S.inp, width: "100%" }
    }
  )), (() => {
    const parsed = parseLocationInput(custom.link);
    if (custom.link && parsed && !parsed.error) return /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: C.go, fontFamily: "monospace", background: "rgba(61,220,132,0.08)", border: `1px solid ${C.go}`, borderRadius: 4, padding: "6px 10px" } }, t("loc_parsed_ok", { lat: parsed.lat.toFixed(4), lon: parsed.lon.toFixed(4) }));
    if (custom.link && parsed && parsed.error) return /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: C.caution, lineHeight: 1.5, background: "rgba(245,185,66,0.08)", border: `1px solid ${C.caution}`, borderRadius: 4, padding: "6px 10px" } }, "\u26A0\uFE0F ", parsed.error);
    return null;
  })(), linkError && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: C.stop, fontFamily: "monospace" } }, linkError), /* @__PURE__ */ React.createElement("button", { style: S.btn, onClick: () => {
    const parsed = parseLocationInput(custom.link);
    if (!parsed) {
      setLinkError(t("loc_link_error_empty"));
      return;
    }
    if (parsed.error) {
      setLinkError(parsed.error);
      return;
    }
    const name = custom.name.trim() || parsePlaceName(custom.link) || `${parsed.lat.toFixed(3)}\xB0N ${parsed.lon.toFixed(3)}\xB0E`;
    const nl = { lat: parsed.lat, lon: parsed.lon, name };
    setLoc(nl);
    pushRecent(nl, { active: true });
    setCustom({ link: "", name: "" });
    setLinkError("");
    setShowLoc(false);
  } }, t("loc_add_btn")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: C.dim, lineHeight: 1.5 } }, t("loc_add_hint")))))), /* @__PURE__ */ React.createElement("div", { style: { background: C.surface, borderTop: `1px solid ${C.border}`, padding: "8px 20px calc(14px + env(safe-area-inset-bottom))", textAlign: "center", fontFamily: "monospace", fontSize: 9, color: C.muted, display: "flex", justifyContent: "center", alignItems: "center", gap: 24, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", null, "WindFoil Weather Intelligence v3.41.0"), userEmail && /* @__PURE__ */ React.createElement("span", { style: { color: C.muted } }, t("auth_logged_as"), ": ", userEmail), /* @__PURE__ */ React.createElement("span", null, "Open-Meteo \xB7 ERA5 ECMWF \xB7 Rider-Input"), /* @__PURE__ */ React.createElement("span", null, t("footer_loc", { name: loc.name })), /* @__PURE__ */ React.createElement("a", { href: "/sardinia.html", style: { color: C.sky, textDecoration: "none" } }, "\u{1F3DD} Sardinien"), /* @__PURE__ */ React.createElement("a", { href: "/sizilien.html", style: { color: C.sky, textDecoration: "none" } }, "\u{1F3DD} Sizilien"), /* @__PURE__ */ React.createElement("a", { href: "/spanien.html", style: { color: C.sky, textDecoration: "none" } }, "\u{1F1EA}\u{1F1F8} Spanien"), /* @__PURE__ */ React.createElement("a", { href: "/vergleich.html", style: { color: C.sky, textDecoration: "none" } }, "\u{1F4CA} Vergleich"), /* @__PURE__ */ React.createElement("a", { href: "/watcher.html", style: { color: C.sky, textDecoration: "none" } }, "\u{1F52D} Watcher"), /* @__PURE__ */ React.createElement("a", { href: "/alarm.html", style: { color: C.sky, textDecoration: "none" } }, "\u{1F514} Windalarm"), /* @__PURE__ */ React.createElement("a", { href: "/logbuch.html", style: { color: C.sky, textDecoration: "none" } }, "\u{1F6F6} Logbuch"), /* @__PURE__ */ React.createElement("a", { href: "/reise.html", style: { color: C.sky, textDecoration: "none" } }, "\u{1F9ED} Reiseplaner"), /* @__PURE__ */ React.createElement("a", { href: "/help.html", style: { color: C.sky, textDecoration: "none" } }, t("footer_help")), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        setAdminOpen(true);
        setAdminErr("");
        setAdminOut("");
        setAdminTab("actions");
        setUsersMsg("");
      },
      title: "Admin",
      style: { background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 12, padding: 0 }
    },
    "\u2699"
  )), adminOpen && /* @__PURE__ */ React.createElement("div", { role: "dialog", "aria-modal": "true", "aria-labelledby": "admin-modal-title", onKeyDown: (e) => {
    if (e.key === "Escape") {
      setAdminOpen(false);
      setAdminAuthed(false);
      setAdminToken("");
      setAdminPw("");
      setAdminOut("");
      setAdminErr("");
      setAdminTab("actions");
      setUsers([]);
      setUsersMsg("");
      setPwInputs({});
    }
  }, style: { position: "fixed", top: 0, left: 0, right: 0, height: "100dvh", background: "rgba(0,0,0,.85)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, paddingBottom: "max(16px, env(safe-area-inset-bottom))", boxSizing: "border-box" } }, /* @__PURE__ */ React.createElement("div", { style: { background: C.panel, border: `1px solid ${C.border2}`, borderRadius: 20, width: "100%", maxWidth: 560, maxHeight: "100%", overflow: "auto" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: `1px solid ${C.border}` } }, /* @__PURE__ */ React.createElement("strong", { id: "admin-modal-title", style: { fontFamily: "monospace", fontSize: 14 } }, "\u2699 Admin"), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        setAdminOpen(false);
        setAdminAuthed(false);
        setAdminToken("");
        setAdminPw("");
        setAdminOut("");
        setAdminErr("");
        setAdminTab("actions");
        setUsers([]);
        setUsersMsg("");
        setPwInputs({});
      },
      style: { background: "none", border: "none", color: C.muted, fontSize: 16, cursor: "pointer" }
    },
    "\u2715"
  )), /* @__PURE__ */ React.createElement("div", { style: { padding: 16 } }, !adminAuthed ? /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, /* @__PURE__ */ React.createElement("label", { style: { fontFamily: "monospace", fontSize: 10, color: C.muted } }, "Admin-Passwort"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "password",
      value: adminPw,
      autoFocus: true,
      onChange: (e) => setAdminPw(e.target.value),
      onKeyDown: (e) => {
        if (e.key === "Enter") adminLogin();
      },
      style: { ...S.inp, width: "100%", fontSize: 14 }
    }
  ), /* @__PURE__ */ React.createElement("button", { style: { ...S.btn, opacity: adminBusy ? 0.6 : 1 }, disabled: adminBusy, onClick: adminLogin }, adminBusy ? "Pr\xFCfe\u2026" : "Anmelden"), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 9, color: C.dim, lineHeight: 1.5 } }, "Das Passwort wird serverseitig gepr\xFCft (windfoil.env). Es wird nicht im Browser gespeichert.")) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6 } }, [["actions", "Aktionen"], ["users", "Benutzer"]].map(([t2, l]) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: t2,
      onClick: () => {
        setAdminTab(t2);
        if (t2 === "users") loadUsers();
      },
      style: { background: adminTab === t2 ? C.signal : "none", border: `1px solid ${adminTab === t2 ? C.signal : C.border2}`, color: adminTab === t2 ? "#fff" : C.muted, borderRadius: 4, padding: "4px 12px", fontSize: 12, cursor: "pointer" }
    },
    l
  ))), adminTab === "actions" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      style: { ...S.btn, opacity: adminBusy ? 0.6 : 1 },
      disabled: adminBusy,
      onClick: () => adminRun("deploy", "Deployment")
    },
    "\u{1F680} Deploy starten"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      style: { ...S.btn, background: "transparent", border: `1px solid ${C.sky}`, color: C.sky, opacity: adminBusy ? 0.6 : 1 },
      disabled: adminBusy,
      onClick: () => adminRun("restart-proxy", "Proxy-Neustart")
    },
    "\u267B Proxy neu starten"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      style: { ...S.btn, background: "transparent", border: `1px solid ${C.muted}`, color: C.muted, opacity: adminBusy ? 0.6 : 1 },
      disabled: adminBusy,
      onClick: () => adminRun("status", "Status")
    },
    "\u{1F4CA} Status"
  )), adminBusy && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: C.caution } }, "\u23F3 l\xE4uft\u2026 (kann bis zu 2 Min dauern)"), adminOut && /* @__PURE__ */ React.createElement("pre", { style: { background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 6, padding: "10px 12px", fontSize: 11, color: C.text, fontFamily: "monospace", whiteSpace: "pre-wrap", maxHeight: 340, overflow: "auto", margin: 0 } }, adminOut)), adminTab === "users" && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: C.muted, fontFamily: "monospace" } }, users.length, " Benutzer"), /* @__PURE__ */ React.createElement("button", { style: S.btnG, disabled: adminBusy, onClick: loadUsers }, "\u21BB Aktualisieren")), usersMsg && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: usersMsg.startsWith("\u2713") ? C.go : C.caution } }, usersMsg), users.length === 0 && !adminBusy && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: C.dim } }, "Keine Benutzer gefunden."), users.map((u) => /* @__PURE__ */ React.createElement("div", { key: u.id, style: { background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 6, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", { style: { minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: C.text, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 } }, u.name || "\u2014", /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: u.disabled ? C.stop : C.go } }, u.disabled ? "\u25CF gesperrt" : "\u25CF aktiv")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: C.muted, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis" } }, u.email)), /* @__PURE__ */ React.createElement(
    "button",
    {
      disabled: adminBusy,
      onClick: () => toggleUser(u),
      style: { ...S.btnG, borderColor: u.disabled ? C.go : C.stop, color: u.disabled ? C.go : C.stop, opacity: adminBusy ? 0.6 : 1 }
    },
    u.disabled ? "Freischalten" : "Sperren"
  )), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6 } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      autoComplete: "off",
      placeholder: "Neues Passwort (min. 10)",
      value: pwInputs[u.id] || "",
      onChange: (e) => setPwInputs((p) => ({ ...p, [u.id]: e.target.value })),
      style: { ...S.inp, flex: 1, fontSize: 12 }
    }
  ), /* @__PURE__ */ React.createElement("button", { disabled: adminBusy, style: S.btnG, onClick: () => resetUserPw(u) }, "PW setzen"), /* @__PURE__ */ React.createElement(
    "button",
    {
      disabled: adminBusy,
      onClick: () => deleteUser(u),
      style: { ...S.btnG, borderColor: C.stop, color: C.stop, opacity: adminBusy ? 0.6 : 1 }
    },
    "L\xF6schen"
  )))))), adminErr && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: C.stop, marginTop: 10 } }, "\u26A0\uFE0F ", adminErr)))), /* @__PURE__ */ React.createElement("style", null, `@keyframes spin{to{transform:rotate(360deg)}}`));
}
const boot = document.getElementById("boot");
if (boot) boot.remove();
ReactDOM.createRoot(document.getElementById("root")).render(/* @__PURE__ */ React.createElement(AuthGate, null, /* @__PURE__ */ React.createElement(App, null)));
