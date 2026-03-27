# MCP server wrapper that logs debug output to a file
# Usage: .\scripts\mcp-dev.ps1

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LogFile = Join-Path $ProjectRoot "data\mcp-debug.log"

# Ensure data directory exists
$DataDir = Join-Path $ProjectRoot "data"
if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir | Out-Null
}

# Clear previous log
"=== MCP Server Started: $(Get-Date) ===" | Out-File -FilePath $LogFile -Encoding utf8

# Set environment and run
$env:CODEATLAS_CONFIG = "config/codeatlas.dev.json"

Push-Location $ProjectRoot
try {
    # Run MCP server and capture stderr to log file while also showing it
    npx tsx packages/mcp-server/src/main.ts 2>&1 | Tee-Object -FilePath $LogFile -Append
} finally {
    Pop-Location
}
