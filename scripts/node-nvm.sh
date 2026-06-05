#!/bin/bash
# Wrapper that loads nvm before running node, needed because Claude Code's
# MCP launcher runs in a minimal env where nvm shell functions aren't available.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh" --no-use
exec node "$@"
