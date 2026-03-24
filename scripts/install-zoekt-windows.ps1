[CmdletBinding()]
param(
  [string]$InstallRoot = ".tools/zoekt",
  [string]$ZoektVersion = "latest",
  [string]$GoProxy = $null,
  [string]$GoSumDb = $null,
  [switch]$AddUserPath,
  [switch]$InstallGoWithWinget,
  [switch]$UseSourceBuild,
  [switch]$FallbackToSourceBuild,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host "[CodeAtlas] $Message"
}

function Invoke-External {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList
  )

  if ($DryRun) {
    Write-Step "dry-run: $FilePath $($ArgumentList -join ' ')"
    return
  }

  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($ArgumentList -join ' ')"
  }
}

function Add-BinDirToUserPath {
  param([string]$BinDir)

  if (-not $AddUserPath) {
    return
  }

  $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $pathEntries = @()
  if ($currentUserPath) {
    $pathEntries = $currentUserPath.Split(";", [System.StringSplitOptions]::RemoveEmptyEntries)
  }

  if ($pathEntries -notcontains $BinDir) {
    Write-Step "Adding $BinDir to the user PATH"
    if (-not $DryRun) {
      $newPath = if ($currentUserPath) { "$currentUserPath;$BinDir" } else { $BinDir }
      [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    }
  } else {
    Write-Step "User PATH already contains $BinDir"
  }
}

function Write-ConfigSnippet {
  param(
    [string]$ZoektExe,
    [string]$ZoektIndexExe,
    [string]$IndexDir
  )

  Write-Host ""
  Write-Step "Zoekt installation complete"
  Write-Host ""
  Write-Host "Use the following lexical backend config in config/codeatlas.example.json or your local config:"
  Write-Host ""
  $configSnippet = @{
    lexicalBackend = @{
      kind = "zoekt"
      zoektIndexExecutable = $ZoektIndexExe
      zoektSearchExecutable = $ZoektExe
      indexRoot = $IndexDir
      allowBootstrapFallback = $true
      bootstrapFallback = @{
        kind = "ripgrep"
        executable = "rg"
        fallbackToNaiveScan = $true
      }
    }
  } | ConvertTo-Json -Depth 5

  Write-Host $configSnippet
}

function Get-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Get-GoCommand {
  return Get-Command go -ErrorAction SilentlyContinue
}

function Ensure-GoAvailable {
  $goCommand = Get-GoCommand
  if ($goCommand) {
    return $goCommand
  }

  if ($DryRun) {
    Write-Step "dry-run: go is not installed in the current shell; installation commands will be printed only"
    return $null
  }

  if (-not $InstallGoWithWinget) {
    throw "Go is required to install Zoekt on Windows. Install Go first, or rerun with -InstallGoWithWinget if winget is available."
  }

  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw "Go is not installed and winget is unavailable. Install Go manually, then rerun this script."
  }

  Write-Step "Installing Go via winget"
  Invoke-External -FilePath $winget.Source -ArgumentList @("install", "--id", "GoLang.Go", "-e", "--source", "winget")
  throw "Go was installed via winget. Open a new shell so PATH is refreshed, then rerun the installer."
}

function Configure-GoModuleEnvironment {
  if ($script:PSBoundParameters.ContainsKey("GoProxy")) {
    if ($GoProxy.Trim() -eq "") {
      throw "GoProxy cannot be empty when provided. Omit it to use the default Go environment."
    }

    $env:GOPROXY = $GoProxy
    Write-Step "Using GOPROXY from script parameter"
  } elseif ($env:GOPROXY) {
    Write-Step "Using existing GOPROXY from environment"
  } else {
    Write-Step "Using default Go GOPROXY behavior"
  }

  if ($script:PSBoundParameters.ContainsKey("GoSumDb")) {
    if ($GoSumDb.Trim() -eq "") {
      throw "GoSumDb cannot be empty when provided. Omit it to use the default Go environment."
    }

    $env:GOSUMDB = $GoSumDb
    Write-Step "Using GOSUMDB from script parameter"
  } elseif ($env:GOSUMDB) {
    Write-Step "Using existing GOSUMDB from environment"
  } else {
    Write-Step "Using default Go GOSUMDB behavior"
  }
}

function Invoke-SourceBuildInstaller {
  param(
    [string]$RepoRoot,
    [string]$InstallRoot,
    [string]$ZoektVersion
  )

  $sourceBuildScript = Join-Path $RepoRoot "scripts/build-zoekt-windows-from-source.ps1"
  $arguments = @(
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $sourceBuildScript,
    "-InstallRoot",
    $InstallRoot,
    "-ZoektRef",
    $ZoektVersion
  )

  if ($AddUserPath) {
    $arguments += "-AddUserPath"
  }

  if ($script:PSBoundParameters.ContainsKey("GoProxy")) {
    $arguments += @("-GoProxy", $GoProxy)
  }

  if ($script:PSBoundParameters.ContainsKey("GoSumDb")) {
    $arguments += @("-GoSumDb", $GoSumDb)
  }

  if ($InstallGoWithWinget) {
    $arguments += "-InstallGoWithWinget"
  }

  if ($DryRun) {
    $arguments += "-DryRun"
  }

  Invoke-External -FilePath "powershell" -ArgumentList $arguments
}

$repoRoot = Get-RepoRoot
$resolvedInstallRoot = if ([System.IO.Path]::IsPathRooted($InstallRoot)) {
  $InstallRoot
} else {
  Join-Path $repoRoot $InstallRoot
}
$resolvedInstallRoot = [System.IO.Path]::GetFullPath($resolvedInstallRoot)
$binDir = Join-Path $resolvedInstallRoot "bin"
$indexDir = Join-Path $repoRoot "data/indexes/zoekt"

Write-Step "Repo root: $repoRoot"
Write-Step "Zoekt install root: $resolvedInstallRoot"

if ($UseSourceBuild) {
  Write-Step "Using source-build installation path"
  Invoke-SourceBuildInstaller -RepoRoot $repoRoot -InstallRoot $resolvedInstallRoot -ZoektVersion $ZoektVersion
  return
}

$goCommand = Ensure-GoAvailable
Configure-GoModuleEnvironment

if (-not $DryRun) {
  New-Item -ItemType Directory -Path $binDir -Force | Out-Null
}

$env:GOBIN = $binDir

$packages = @(
  "github.com/sourcegraph/zoekt/cmd/zoekt@$ZoektVersion",
  "github.com/sourcegraph/zoekt/cmd/zoekt-index@$ZoektVersion"
)

try {
  foreach ($package in $packages) {
    Write-Step "Installing $package"
    if ($goCommand) {
      Invoke-External -FilePath $goCommand.Source -ArgumentList @("install", $package)
    }
  }
} catch {
  if (-not $FallbackToSourceBuild) {
    throw
  }

  Write-Step "go install path failed: $($_.Exception.Message)"
  Write-Step "Falling back to source-build installation path"
  Invoke-SourceBuildInstaller -RepoRoot $repoRoot -InstallRoot $resolvedInstallRoot -ZoektVersion $ZoektVersion
  return
}

$zoektExe = Join-Path $binDir "zoekt.exe"
$zoektIndexExe = Join-Path $binDir "zoekt-index.exe"

if (-not $DryRun) {
  if (-not (Test-Path $zoektExe)) {
    throw "Expected zoekt binary was not created: $zoektExe"
  }

  if (-not (Test-Path $zoektIndexExe)) {
    throw "Expected zoekt-index binary was not created: $zoektIndexExe"
  }
}

Add-BinDirToUserPath -BinDir $binDir
Write-ConfigSnippet -ZoektExe $zoektExe -ZoektIndexExe $zoektIndexExe -IndexDir $indexDir