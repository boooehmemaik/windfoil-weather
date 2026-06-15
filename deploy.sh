#!/usr/bin/env bash
# ============================================================================
# WindFoil — deploy script
# File version: 1.0.6  |  App target: v2.5.0
# ----------------------------------------------------------------------------
# Run on the LXC from the repo root:   ./deploy.sh [branch]
# Idempotent & safe to re-run. Requires a sudoers whitelist entry for:
#     systemctl restart <service>     (matches your existing restricted sudo)
# Override defaults:  WINDFOIL_SERVICE, WINDFOIL_BRANCH
# ============================================================================
set -euo pipefail

SERVICE="${WINDFOIL_SERVICE:-windfoil}"
BRANCH="${1:-${WINDFOIL_BRANCH:-main}}"

# Always run from the repo root (this script's own directory).
cd "$(dirname "$(readlink -f "$0")")"

# Load env (Weatherbit token, BETTER_AUTH_SECRET, WINDFOIL_DB_PATH) so the
# migration + runtime steps below see the same values your service uses.
if [ -f windfoil.env ]; then set -a; . ./windfoil.env; set +a; fi

log(){ printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

log "Deploying '$BRANCH' to service '$SERVICE'"

# 0) Safety: never deploy if the secrets file slipped into git.
if git ls-files --error-unmatch windfoil.env >/dev/null 2>&1; then
  echo "REFUSING: windfoil.env is tracked by git. Run: git rm --cached windfoil.env"; exit 1
fi

# 1) Pull latest (fast-forward only — fails loudly on diverged history).
log "Fetching latest"
git fetch --all --prune
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

# 2) Dependencies.
log "Installing dependencies"
if [ -f package-lock.json ]; then npm ci; else npm install; fi

# 2a) Guard: ensure npm's configured global prefix dirs exist (some images set a
#     prefix like /root/.npm-global without creating lib/ + bin/, which breaks npx).
NPM_PREFIX="$(npm config get prefix 2>/dev/null || true)"
[ -n "$NPM_PREFIX" ] && mkdir -p "$NPM_PREFIX/lib" "$NPM_PREFIX/bin" || true

# 2b) Build/CLI tools as LOCAL deps (fast, offline-resilient, no @latest fetch).
log "Ensuring WindFoil deps (better-auth, better-sqlite3, express, esbuild)"
NODE_OPTIONS="--max-old-space-size=2048" npm install --no-audit --no-fund --maxsockets=1 --prefer-offline better-auth better-sqlite3 express esbuild

# 3) Database — ORDER MATTERS: auth tables, then domain tables, then seed.
log "Applying Better Auth schema (programmatic)"
node db/auth-migrate.mjs

log "Applying domain migrations"
node -e "import('./src/db.mjs').then(m=>m.runMigrations()).then(()=>process.exit(0))"

log "Seeding shared spots (idempotent)"
node db/seed.mjs

# 4) Build the CDN-free auth client bundle into local vendor.
log "Building auth client bundle"
mkdir -p public/vendor
npx esbuild src/auth-client.js --bundle --format=esm \
  --outfile=public/vendor/auth-client.bundle.js
# 5) Restart + health check.
log "Restarting $SERVICE"
sudo systemctl restart "$SERVICE"
sleep 2
if sudo systemctl is-active --quiet "$SERVICE"; then
  log "OK — $SERVICE is active"
else
  echo "FAILED — service not active. Recent logs:"
  journalctl -u "$SERVICE" -n 30 --no-pager || true
  exit 1
fi
