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
