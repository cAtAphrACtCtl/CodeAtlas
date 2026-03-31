#!/bin/bash
# MCP server wrapper that uses the configured structured log file.
# Usage: ./scripts/mcp-dev.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_PATH="$PROJECT_ROOT/config/codeatlas.dev.json"

LOG_FILE="$(node --input-type=module -e "import fs from 'node:fs'; import path from 'node:path'; const configPath = process.argv[1]; const config = JSON.parse(fs.readFileSync(configPath, 'utf8')); const raw = config.logging?.file?.enabled === false ? '' : config.logging?.file?.path ?? ''; if (raw) { console.log(path.isAbsolute(raw) ? raw : path.resolve(path.dirname(configPath), raw)); }" "$CONFIG_PATH")"

if [ -n "$LOG_FILE" ]; then
  mkdir -p "$(dirname "$LOG_FILE")"
  : > "$LOG_FILE"
  echo "Structured log file: $LOG_FILE"
else
  echo "Structured log file disabled in config"
fi

cd "$PROJECT_ROOT"
CODEATLAS_CONFIG="$CONFIG_PATH" \
  npx tsx packages/mcp-server/src/main.ts
