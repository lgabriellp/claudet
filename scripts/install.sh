#!/usr/bin/env bash
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "claudet install — repo: $REPO_DIR"
echo ""
echo "→ Installing dependencies..."
(cd "$REPO_DIR" && pnpm install --silent)
echo "  ✓ dependencies"
echo ""
echo "→ Installing global binary..."
(cd "$REPO_DIR" && pnpm install -g . 2>&1 | tail -1)
echo "  ✓ global binary"
echo ""
exec claudet install
