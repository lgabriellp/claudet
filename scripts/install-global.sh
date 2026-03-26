#!/usr/bin/env bash
# claudet — remote install script
# Usage: curl -fsSL https://raw.githubusercontent.com/lgabriellp/claudet/main/scripts/install-global.sh | bash
set -euo pipefail

error() { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }
info()  { printf '\033[36m→\033[0m %s\n' "$1"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$1"; }

# --- prerequisites -----------------------------------------------------------

command -v node >/dev/null 2>&1 || error "Node.js is required. Install it from https://nodejs.org"

NODE_MAJOR=$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')
[ "$NODE_MAJOR" -ge 22 ] 2>/dev/null || error "Node.js 22+ is required (found v$(node --version))"
ok "Node.js v$(node --version | tr -d v)"

command -v git >/dev/null 2>&1 || error "Git is required. Install it from https://git-scm.com"
ok "Git $(git --version | awk '{print $3}')"

command -v claude >/dev/null 2>&1 || error "Claude Code CLI is required. Install it from https://docs.anthropic.com/en/docs/claude-code"
ok "Claude Code CLI"

# --- detect package manager ---------------------------------------------------

if command -v pnpm >/dev/null 2>&1; then
  PM=pnpm
elif command -v yarn >/dev/null 2>&1; then
  PM=yarn
elif command -v bun >/dev/null 2>&1; then
  PM=bun
else
  PM=npm
fi

# --- install ------------------------------------------------------------------

echo ""
info "Installing claudet via $PM..."
$PM install -g @lgabriellp/claudet 2>&1 | tail -3
ok "claudet installed"

echo ""
info "Running post-install setup..."
claudet install

echo ""
printf '\033[32mDone!\033[0m Run \033[1mclaudet\033[0m to get started.\n'
