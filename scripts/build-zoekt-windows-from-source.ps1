[CmdletBinding()]
param(
  [string]$InstallRoot = ".tools/zoekt",
  [string]$ZoektRef = "latest",
  [string]$GoProxy = $null,
  [string]$GoSumDb = $null,
  [switch]$AddUserPath,
  [switch]$InstallGoWithWinget,
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
    Write-Step "dry-run: go is not installed in the current shell; build commands will be printed only"
    return $null
  }

  if (-not $InstallGoWithWinget) {
    throw "Go is required to build Zoekt from source on Windows. Install Go first, or rerun with -InstallGoWithWinget if winget is available."
  }

  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw "Go is not installed and winget is unavailable. Install Go manually, then rerun this script."
  }

  Write-Step "Installing Go via winget"
  Invoke-External -FilePath $winget.Source -ArgumentList @("install", "--id", "GoLang.Go", "-e", "--source", "winget")
  throw "Go was installed via winget. Open a new shell so PATH is refreshed, then rerun the script."
}

function Get-GitCommand {
  return Get-Command git -ErrorAction SilentlyContinue
}

function Ensure-GitAvailable {
  $gitCommand = Get-GitCommand
  if ($gitCommand) {
    return $gitCommand
  }

  if ($DryRun) {
    Write-Step "dry-run: git is not installed in the current shell; clone commands will be printed only"
    return $null
  }

  throw "Git is required to build Zoekt from source on Windows. Install Git first, then rerun the script."
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
  Write-Step "Source build complete"
  Write-Host ""
  Write-Host "Use the following lexical backend config in config/codeatlas.example.json or your local config:"
  Write-Host ""
  $configSnippet = @{
    lexicalBackend = @{
      kind = "zoekt"
      zoektIndexExecutable = $ZoektIndexExe
function Update-FileContentRegex {
  param(
    [string]$Path,
    [string]$Pattern,
    [string]$NewValue
  )

  $content = Get-Content -Raw -Path $Path
  if ($content -notmatch $Pattern) {
    throw "Expected pattern was not found in $Path"
  }

  $updated = [regex]::Replace($content, $Pattern, $NewValue)
  [System.IO.File]::WriteAllText($Path, $updated)
}

function Apply-WindowsBuildPatch {
  param([string]$SourceRoot)

  $builderPath = Join-Path $SourceRoot "index/builder.go"
  # Remove the unix import while keeping surrounding imports, tolerating whitespace/line-ending changes.
  $importPattern = '(?ms)\t"github\.com/rs/xid"\s*\r?\n\t"golang\.org/x/sys/unix"\s*\r?\n\s*\r?\n\t"maps"'
  $importReplacement = "`t`"github.com/rs/xid`"`r`n`r`n`t`"maps`""
  Update-FileContentRegex -Path $builderPath -Pattern $importPattern -NewValue $importReplacement

  # Remove the umask variable and init function in a way that is resilient to formatting changes.
  $umaskPattern = '(?ms)//\s*umask holds the Umask of the current process\s+var\s+umask\s+os\.FileMode\s+func\s+init\(\)\s*\{\s*umask\s*=\s*os\.FileMode\(unix\.Umask\(0\)\)\s*unix\.Umask\(int\(umask\)\)\s*\}\s*'
  Update-FileContentRegex -Path $builderPath -Pattern $umaskPattern -NewValue ""
      }
    }
  } | ConvertTo-Json -Depth 5

  Write-Host $configSnippet
}

function Update-FileContent {
  param(
    [string]$Path,
    [string]$OldValue,
    [string]$NewValue
  )

  $content = Get-Content -Raw -Path $Path
  if (-not $content.Contains($OldValue)) {
    throw "Expected content was not found in $Path"
  }

  $updated = $content.Replace($OldValue, $NewValue)
  [System.IO.File]::WriteAllText($Path, $updated)
}

function Apply-WindowsBuildPatch {
  param([string]$SourceRoot)

  $builderPath = Join-Path $SourceRoot "index/builder.go"
  Update-FileContent -Path $builderPath -OldValue "`t`"github.com/rs/xid`"`r`n`t`"golang.org/x/sys/unix`"`r`n`r`n`t`"maps`"" -NewValue "`t`"github.com/rs/xid`"`r`n`r`n`t`"maps`""
  Update-FileContent -Path $builderPath -OldValue "// umask holds the Umask of the current process`r`nvar umask os.FileMode`r`n`r`nfunc init() {`r`n`tumask = os.FileMode(unix.Umask(0))`r`n`tunix.Umask(int(umask))`r`n}`r`n" -NewValue ""

  $indexFileWindows = @'
// Copyright 2016 Google Inc. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

//go:build windows

package index

import (
	"fmt"
	"io"
	"math"
	"os"
)

type mmapedIndexFile struct {
	name string
	size uint32
	data []byte
}

func (f *mmapedIndexFile) Read(off, sz uint32) ([]byte, error) {
	if off > off+sz || off+sz > uint32(len(f.data)) {
		return nil, fmt.Errorf("out of bounds: %d, len %d, name %s", off+sz, len(f.data), f.name)
	}
	return f.data[off : off+sz], nil
}

func (f *mmapedIndexFile) Name() string {
	return f.name
}

func (f *mmapedIndexFile) Size() (uint32, error) {
	return f.size, nil
}

func (f *mmapedIndexFile) Close() {}

func NewIndexFile(f *os.File) (IndexFile, error) {
	defer f.Close()

	fi, err := f.Stat()
	if err != nil {
		return nil, err
	}

	sz := fi.Size()
	if sz >= math.MaxUint32 {
		return nil, fmt.Errorf("file %s too large: %d", f.Name(), sz)
	}

	if _, err := f.Seek(0, 0); err != nil {
		return nil, err
	}

	data, err := io.ReadAll(f)
	if err != nil {
		return nil, err
	}

	return &mmapedIndexFile{
		name: f.Name(),
		size: uint32(sz),
		data: data,
	}, nil
}
'@

  $umaskUnix = @'
//go:build linux || darwin || freebsd

package index

import (
	"os"

	"golang.org/x/sys/unix"
)

var umask os.FileMode

func init() {
	umask = os.FileMode(unix.Umask(0))
	unix.Umask(int(umask))
}
'@

  $umaskWindows = @'
//go:build windows

package index

import "os"

var umask os.FileMode = 0
'@

  [System.IO.File]::WriteAllText((Join-Path $SourceRoot "index/indexfile_windows.go"), $indexFileWindows)
  [System.IO.File]::WriteAllText((Join-Path $SourceRoot "index/umask_unix.go"), $umaskUnix)
  [System.IO.File]::WriteAllText((Join-Path $SourceRoot "index/umask_windows.go"), $umaskWindows)
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
$sourceRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("zoekt-src-build-" + [Guid]::NewGuid().ToString("N"))

Write-Step "Repo root: $repoRoot"
Write-Step "Zoekt install root: $resolvedInstallRoot"
Write-Step "Temporary source root: $sourceRoot"

$goCommand = Ensure-GoAvailable
$gitCommand = Ensure-GitAvailable
Configure-GoModuleEnvironment

if (-not $DryRun) {
  New-Item -ItemType Directory -Path $binDir -Force | Out-Null
}

Write-Step "Cloning Zoekt source"
if ($gitCommand) {
  Invoke-External -FilePath $gitCommand.Source -ArgumentList @("clone", "--depth", "1", "https://github.com/sourcegraph/zoekt.git", $sourceRoot)
}

if ($ZoektRef -notin @("latest", "main", "HEAD")) {
  Write-Step "Checking out Zoekt ref $ZoektRef"
  if ($gitCommand) {
    Push-Location $sourceRoot
    try {
      Invoke-External -FilePath $gitCommand.Source -ArgumentList @("fetch", "--depth", "1", "origin", $ZoektRef)
      Invoke-External -FilePath $gitCommand.Source -ArgumentList @("checkout", "FETCH_HEAD")
    } finally {
      Pop-Location
    }
  }
}

if (-not $DryRun) {
  Write-Step "Applying Windows build patch"
  Apply-WindowsBuildPatch -SourceRoot $sourceRoot
}

Write-Step "Building zoekt.exe and zoekt-index.exe from source"
if ($goCommand) {
  if ($DryRun) {
    Invoke-External -FilePath $goCommand.Source -ArgumentList @("build", "-v", "-o", (Join-Path $binDir "zoekt.exe"), "./cmd/zoekt")
    Invoke-External -FilePath $goCommand.Source -ArgumentList @("build", "-v", "-o", (Join-Path $binDir "zoekt-index.exe"), "./cmd/zoekt-index")
  } else {
    Push-Location $sourceRoot
    try {
      Remove-Item Env:GOOS -ErrorAction SilentlyContinue
      Remove-Item Env:GOARCH -ErrorAction SilentlyContinue
      Invoke-External -FilePath $goCommand.Source -ArgumentList @("build", "-v", "-o", (Join-Path $binDir "zoekt.exe"), "./cmd/zoekt")
      Invoke-External -FilePath $goCommand.Source -ArgumentList @("build", "-v", "-o", (Join-Path $binDir "zoekt-index.exe"), "./cmd/zoekt-index")
    } finally {
      Pop-Location
    }
  }
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