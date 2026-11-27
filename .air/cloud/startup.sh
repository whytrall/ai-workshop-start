#!/usr/bin/env bash
# Air cloud startup script for Skill Atlas (Node >= 24 TypeScript CLI, run directly by node).
# WARMUP (snapshot bake / env-setup verification): install deps, then healthcheck = what CI runs.
# TASK: install deps (fast: npm cache is primed in the snapshot) and exit promptly.
set -euo pipefail

if [ "${AIR_STARTUP_MODE:-}" = warmup ]; then WARMUP=1; else WARMUP=; fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR"
log() { echo "[startup] $*"; }

# --- Node >= 24 (package.json engines). The Air image ships nvm + a recent Node. ---
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if [ "$(node_major)" -lt 24 ]; then
  log "Node >= 24 not found (have: $(node -v 2>/dev/null || echo none)); installing Node 24 via nvm"
  export NVM_DIR="${NVM_DIR:-/usr/local/nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install 24
  nvm alias default 24
fi
log "node $(node -v), npm $(npm -v)"

# --- Dependencies ---
log "npm ci ..."
npm ci --no-audit --no-fund
log "npm ci done"

# --- Healthcheck: the same gate as CI (.github/workflows/ci.yml) ---
healthcheck() {
  log "healthcheck: typecheck"
  npm run typecheck
  log "healthcheck: tests"
  npm test
  log "healthcheck: CLI smoke"
  ./skill-atlas help
  ./skill-atlas scan ./fixture
  log "healthcheck: OK"
}

if [ -n "$WARMUP" ]; then
  healthcheck
fi
log "startup complete"
