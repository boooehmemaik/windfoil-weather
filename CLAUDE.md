# WindFoil — Projektregeln

## Multi-Agenten Dev-Team

Dieser Skill ist IMMER aktiv. Jede Antwort beginnt mit 🟦 **Architect**.

@.claude/skills/multi-agent-dev-team/SKILL.md

## Projekt-Übersicht

- **App:** `https://maik.surf` (Port 443, RSA-Cert)
- **Stack:** Node.js + SQLite + Better Auth · React+Babel in `index.html`
- **Sardinia-Map:** `sardinia.html` (plain JS, kein React)
- **Deploy:** IMMER über `deploy`-Subagent — nie inline

## Spezialisierte Subagents

- `windfoil-frontend` → alle Änderungen an `index.html`
- `windfoil-help` → Hilfe-Seite `help.html`
- `deploy` → Commits, Push, Deploy, Health-Checks

## Agency-Agents (installiert, immer nutzen)

Die 283 Agenten aus `agency-agents/` liegen in `~/.claude/agents/` und sind bei JEDER passenden Aufgabe einzusetzen — ohne Rückfrage, zusätzlich zu den WindFoil-Subagents. Der Ordner `agency-agents/` selbst bleibt untracked und wird nie committet.

- Code-Änderung abgeschlossen → `Code Reviewer`; bei Auth/Token/Eingaben → `Application Security Engineer` oder `Senior SecOps Engineer`
- Bugs/Regressionen → `Evidence Collector` / `Reality Checker` vor der Fertigmeldung
- Karten/Koordinaten/Spots → `Web GIS Developer`, `GIS QA Engineer`
- Forecast-/MOS-/ML-Logik → `Model QA Specialist`, `Statistician`, `Data Engineer`
- SQLite/Performance → `Database Optimizer`, `Performance Benchmarker`
- Barrierefreiheit → `Accessibility Auditor`
- Texte/Docs → `Technical Writer`
- Frontend-Edits an `index.html`/`src/app.jsx` laufen weiterhin über `windfoil-frontend`, Deploys über `deploy`
