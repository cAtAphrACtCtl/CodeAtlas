param(
	[string]$ConfigPath = "config/codeatlas.json",
	[string]$LogPath = "",
	[string]$LogLevel = "",
	[switch]$ClearLog
)

$ErrorActionPreference = "Stop"

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

function Get-LoggingFilePath {
	param(
		[object]$ConfigObject,
		[string]$ConfigFilePath
	)

	if (-not $ConfigObject.logging) {
		return $null
	}

	if (-not $ConfigObject.logging.file) {
		return $null
	}

	if ($ConfigObject.logging.file.enabled -eq $false) {
		return $null
	}

	$configDirectory = Split-Path -Parent $ConfigFilePath
	return Resolve-CodeAtlasPath -BasePath $configDirectory -CandidatePath $ConfigObject.logging.file.path
}

function New-TemporaryConfigPath {
	param([string]$ResolvedConfigPath)

	$configDirectory = Split-Path -Parent $ResolvedConfigPath
	return Join-Path $configDirectory ("codeatlas-agent.override.{0}.json" -f [guid]::NewGuid().ToString("N"))
}

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$resolvedConfigPath = [System.IO.Path]::GetFullPath((Join-Path $workspaceRoot $ConfigPath))

$configObject = Get-Content -Raw -Path $resolvedConfigPath | ConvertFrom-Json
$effectiveConfigPath = $resolvedConfigPath
$temporaryConfigPath = $null

if (-not [string]::IsNullOrWhiteSpace($LogPath)) {
	$resolvedLogPath = Resolve-CodeAtlasPath -BasePath $workspaceRoot -CandidatePath $LogPath
	if (-not $configObject.logging) {
		$configObject | Add-Member -MemberType NoteProperty -Name logging -Value ([pscustomobject]@{})
	}
	if (-not $configObject.logging.file) {
		$configObject.logging | Add-Member -MemberType NoteProperty -Name file -Value ([pscustomobject]@{})
	}
	$configObject.logging.enabled = $true
	$configObject.logging.file.enabled = $true
	$configObject.logging.file.path = $resolvedLogPath
	$temporaryConfigPath = New-TemporaryConfigPath -ResolvedConfigPath $resolvedConfigPath
	$configObject | ConvertTo-Json -Depth 20 | Set-Content -Path $temporaryConfigPath -Encoding utf8
	$effectiveConfigPath = $temporaryConfigPath
} else {
	$resolvedLogPath = Get-LoggingFilePath -ConfigObject $configObject -ConfigFilePath $resolvedConfigPath
}

if (-not [string]::IsNullOrWhiteSpace($LogLevel)) {
	if (-not $configObject.logging) {
		$configObject | Add-Member -MemberType NoteProperty -Name logging -Value ([pscustomobject]@{})
	}
	$configObject.logging.enabled = $true
	$configObject.logging.level = $LogLevel
	if (-not $temporaryConfigPath) {
		$temporaryConfigPath = New-TemporaryConfigPath -ResolvedConfigPath $resolvedConfigPath
	}
	$configObject | ConvertTo-Json -Depth 20 | Set-Content -Path $temporaryConfigPath -Encoding utf8
	$effectiveConfigPath = $temporaryConfigPath
}

if ($resolvedLogPath) {
	$logDirectory = Split-Path -Parent $resolvedLogPath
	New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
	if ($ClearLog) {
		Set-Content -Path $resolvedLogPath -Value $null
	}
}

$env:CODEATLAS_CONFIG = $effectiveConfigPath
Remove-Item Env:CODEATLAS_DEBUG -ErrorAction SilentlyContinue

Write-Host "Starting CodeAtlas MCP for agent verification"
	Write-Host "  Config: $effectiveConfigPath"
	if (-not [string]::IsNullOrWhiteSpace($LogLevel)) {
		Write-Host "  Override log level: $LogLevel"
	}
	if ($resolvedLogPath) {
		Write-Host "  Structured log file: $resolvedLogPath"
	} else {
		Write-Host "  Structured log file: disabled"
	}

try {
	& node --import tsx (Join-Path $workspaceRoot "src/mcp-server/main.ts")
} finally {
	if ($temporaryConfigPath -and (Test-Path $temporaryConfigPath)) {
		Remove-Item $temporaryConfigPath -Force
	}
}

