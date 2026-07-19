#!/usr/bin/env bash
# Harness setup — installs the Claude plugin, Codex config, skills, rules, and
# status line. Pure bash + python3; no Node required. Safe to re-run.
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$HARNESS_DIR/scripts/setup-core.sh"
