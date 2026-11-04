#requires -Version 7.0
# Shared helpers for the release scripts. Dot-source it: . "$PSScriptRoot/common.ps1"

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$InfraDir = Join-Path $RepoRoot 'infra'
$ReleaseDir = Join-Path $RepoRoot 'release'
$ReleaseRecordPath = Join-Path $ReleaseDir 'release-record.json'
$PlanFileName = 'sixdegrees.tfplan'

function Write-Step([string]$Message) {
    Write-Host "==> $Message" -ForegroundColor Cyan
}

# Runs a native command and stops on a non-zero exit code; $ErrorActionPreference does not
# cover native commands. With -Capture, returns stdout as one trimmed string.
function Invoke-Native {
    param(
        [Parameter(Mandatory)][string]$Command,
        [string[]]$Arguments = @(),
        [switch]$Capture,
        [switch]$AllowFailure
    )
    if ($Capture) {
        $output = & $Command @Arguments
    } else {
        & $Command @Arguments | Out-Host
    }
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0 -and -not $AllowFailure) {
        throw "'$Command $($Arguments -join ' ')' failed with exit code $exitCode."
    }
    if ($Capture) {
        return (($output | Out-String).Trim())
    }
}

# True when the command exits with 0; output is discarded.
function Test-Native([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments *> $null
    return $LASTEXITCODE -eq 0
}

function Assert-Command([string[]]$Names) {
    foreach ($name in $Names) {
        if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
            throw "'$name' was not found on PATH. Install it, open a new terminal and try again."
        }
    }
}

function Get-PythonPath {
    $python = Join-Path $RepoRoot '.venv/Scripts/python.exe'
    if (-not (Test-Path $python)) {
        throw "Python virtual environment not found at $python. Create it as described in the README."
    }
    return $python
}

function Get-HeadSha {
    return Invoke-Native git @('-C', $RepoRoot, 'rev-parse', 'HEAD') -Capture
}

# Releases come from a clean main that matches origin/main.
function Assert-CleanMain {
    $status = Invoke-Native git @('-C', $RepoRoot, 'status', '--porcelain') -Capture
    if ($status) {
        throw "The working tree has uncommitted or untracked changes:`n$status"
    }
    $branch = Invoke-Native git @('-C', $RepoRoot, 'rev-parse', '--abbrev-ref', 'HEAD') -Capture
    if ($branch -ne 'main') {
        throw "Releases are built from main; the current branch is '$branch'."
    }
    Invoke-Native git @('-C', $RepoRoot, 'fetch', '--quiet', 'origin', 'main')
    $remote = Invoke-Native git @('-C', $RepoRoot, 'rev-parse', 'origin/main') -Capture
    $head = Get-HeadSha
    if ($head -ne $remote) {
        throw "Local main ($head) does not match origin/main ($remote). Pull or push first."
    }
}

function Read-ReleaseRecord {
    if (-not (Test-Path $ReleaseRecordPath)) {
        throw "No release record at $ReleaseRecordPath. Run scripts/build-push.ps1 first."
    }
    return Get-Content -Raw -Encoding utf8 $ReleaseRecordPath | ConvertFrom-Json -AsHashtable
}

# UTF-8 without BOM and LF line endings, as the repository's encoding rules require.
function Write-ReleaseRecord([System.Collections.IDictionary]$Record) {
    New-Item -ItemType Directory -Force $ReleaseDir | Out-Null
    $json = ($Record | ConvertTo-Json -Depth 10) -replace "`r`n", "`n"
    [IO.File]::WriteAllText($ReleaseRecordPath, $json + "`n", [Text.UTF8Encoding]::new($false))
}

function Get-UtcTimestamp {
    return [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
}
