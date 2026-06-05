#!/usr/bin/env bash
# Harness setup entry point.
#
# Default: launches the interactive wizard (requires Node.js).
# Use --full to install everything without prompts.
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
  --full)
    bash "$HARNESS_DIR/scripts/setup-core.sh"
    ;;
  *)
    if command -v node &>/dev/null; then
      npm install --prefix "$HARNESS_DIR" --silent 2>/dev/null
      exec node "$HARNESS_DIR/setup.js"
    else
      echo "⚠  Node.js not found — running full install"
      echo "   Install Node.js and re-run for the interactive wizard."
      echo ""
      bash "$HARNESS_DIR/scripts/setup-core.sh"
    fi
    ;;
esac
