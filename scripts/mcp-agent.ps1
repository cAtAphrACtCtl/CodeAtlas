param(
	[string]$ConfigPath = "config/codeatlas.windows.example.json",
	[string]$LogPath = "data/debug/codeatlas.agent.log",
	[string]$DebugScopes = "runtime,mcp,search-service,ripgrep,zoekt,trace",
	[switch]$ClearLog
)

$ErrorActionPreference = "Stop"

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$resolvedConfigPath = [System.IO.Path]::GetFullPath((Join-Path $workspaceRoot $ConfigPath))
$resolvedLogPath = [System.IO.Path]::GetFullPath((Join-Path $workspaceRoot $LogPath))
$logDirectory = Split-Path -Parent $resolvedLogPath

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

if ($ClearLog) {
	Set-Content -Path $resolvedLogPath -Value $null
}

$env:CODEATLAS_CONFIG = $resolvedConfigPath
$env:CODEATLAS_DEBUG = $DebugScopes
$env:CODEATLAS_LOG_FILE = $resolvedLogPath

Write-Host "Starting CodeAtlas MCP for agent verification"
Write-Host "  Config: $resolvedConfigPath"
Write-Host "  Debug scopes: $DebugScopes"
Write-Host "  Log file: $resolvedLogPath"

& node --import tsx (Join-Path $workspaceRoot "packages/mcp-server/src/main.ts")