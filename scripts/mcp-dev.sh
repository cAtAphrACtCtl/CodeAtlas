#!/bin/bash
# MCP server wrapper that logs debug output to a file
# Usage: ./scripts/mcp-dev.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_FILE="$PROJECT_ROOT/data/mcp-debug.log"

# Ensure data directory exists
mkdir -p "$PROJECT_ROOT/data"

# Clear previous log
echo "=== MCP Server Started: $(date) ===" > "$LOG_FILE"

# Run the MCP server, tee stderr to log file
cd "$PROJECT_ROOT"
CODEATLAS_CONFIG=config/codeatlas.dev.json \
  npx tsx packages/mcp-server/src/main.ts 2> >(tee -a "$LOG_FILE" >&2)
