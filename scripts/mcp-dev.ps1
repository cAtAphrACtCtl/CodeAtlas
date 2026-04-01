# MCP server wrapper that uses the configured structured log file.
# Usage: .\scripts\mcp-dev.ps1

function Resolve-CodeAtlasPath {
    param(
        [string]$BasePath,
        [string]$CandidatePath
    )

    if ([string]::IsNullOrWhiteSpace($CandidatePath)) {
        return $null
    }

    if ([System.IO.Path]::IsPathRooted($CandidatePath)) {
        return [System.IO.Path]::GetFullPath($CandidatePath)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $BasePath $CandidatePath))
}

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ConfigPath = Join-Path $ProjectRoot "config\codeatlas.json"
$Config = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json -Depth 20
$LogFile = $null

if ($Config.logging -and $Config.logging.file -and $Config.logging.file.enabled -ne $false) {
    $LogFile = Resolve-CodeAtlasPath -BasePath (Split-Path -Parent $ConfigPath) -CandidatePath $Config.logging.file.path
}

# Ensure log directory exists when file logging is enabled
if ($LogFile) {
    $DataDir = Split-Path -Parent $LogFile
    if (-not (Test-Path $DataDir)) {
        New-Item -ItemType Directory -Path $DataDir | Out-Null
    }

    # Clear previous structured log
    Set-Content -Path $LogFile -Value $null
}

# Set environment and run
$env:CODEATLAS_CONFIG = $ConfigPath

if ($LogFile) {
    Write-Host "Structured log file: $LogFile"
} else {
    Write-Host "Structured log file disabled in config"
}

Push-Location $ProjectRoot
try {
    npx tsx src/mcp-server/main.ts
} finally {
    Pop-Location
}


