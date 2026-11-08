#requires -Version 7.0
<#
.SYNOPSIS
Packages the delivered source as a ZIP and proves it rebuilds from scratch.

.DESCRIPTION
Run on a clean main whose commit was deployed and verified (release/release-record.json
says the deployed commit equals HEAD and verification passed). The script:

1. checks the tracked files: nothing that must stay private, everything that must ship;
2. creates release/SixDegrees-<first 12 of SHA>.zip with git archive, then adds the documents
   that are delivered only in the ZIP (listed and ignored in .git/info/exclude, never pushed)
   from the working folder;
3. checks the file names inside the ZIP;
4. extracts it to an empty folder and, from there only, installs, runs pytest and the
   Node tests, builds the frontend, builds the image and runs the smoke test;
5. records the SHA-256 of the ZIP and of each ZIP-only document, and the rebuild result,
   in the release record.

It never commits, pushes or calls the live service.

.EXAMPLE
pwsh -File scripts/package.ps1
#>
param(
    [int]$SmokePort = 18090
)

. "$PSScriptRoot/common.ps1"

Assert-Command git, docker, node, npm
$python = Get-PythonPath

# Paths that must never be delivered (matched against tracked paths and ZIP entries).
$ForbiddenPatterns = @(
    '(^|/)\.venv/', '(^|/)node_modules/', '(^|/)dist/', '(^|/)__pycache__/', '(^|/)\.pytest_cache/',
    '(^|/)\.terraform/', '\.tfstate', '\.tfplan$', '\.tfvars(\.json)?$', '(^|/)\.env($|\.)',
    '\.pem$', '\.key$', 'credentials.*\.json$', 'service-account.*\.json$',
    '^release/', 'SixDegrees_Design\.md$', '^docs/internal/'
)

# Documents delivered only inside the ZIP: never pushed, added after git archive. They are
# listed, and ignored, only in this clone's .git/info/exclude, between these two lines:
#   # BEGIN zip-only
#   /path/of/document.md
#   # END zip-only
# so their names appear nowhere in the repository.
function Get-ZipOnlyFiles {
    $exclude = Invoke-Native git @('-C', $RepoRoot, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude') -Capture
    if (-not (Test-Path -LiteralPath $exclude -PathType Leaf)) {
        throw "No $exclude, so there is no list of documents delivered only in the ZIP."
    }
    $inSection = $false
    $files = foreach ($line in Get-Content -LiteralPath $exclude) {
        $line = $line.Trim()
        if ($line -eq '# BEGIN zip-only') { $inSection = $true; continue }
        if ($line -eq '# END zip-only') { $inSection = $false; continue }
        if ($inSection -and $line -and -not $line.StartsWith('#')) { $line.TrimStart('/') }
    }
    if (-not $files) {
        throw "No documents listed between '# BEGIN zip-only' and '# END zip-only' in $exclude."
    }
    return @($files)
}

# Tracked files the delivery must contain.
$RequiredFiles = @(
    'README.md', 'docs/deployment.md', 'docs/third-party-services.md',
    'docs/diagrams/output/1-system-architecture.png', 'docs/diagrams/output/2-deployment-architecture.png',
    'docs/diagrams/output/3-ci-cd-flow.png', 'docs/diagrams/output/4-git-personal-flow.png',
    'docs/diagrams/output/5-git-team-flow.png',
    'docs/diagrams/package-lock.json', 'requirements.txt', 'requirements-dev.txt',
    'frontend/package-lock.json', 'infra/.terraform.lock.hcl', 'infra/main.tf',
    'Dockerfile', '.dockerignore', '.github/workflows/ci.yml', 'app/main.py',
    'scripts/smoke_test.py'
)

function Assert-FileList([string[]]$Paths, [string]$Label, [string[]]$Required) {
    $forbidden = @($Paths | Where-Object { $path = $_; $ForbiddenPatterns | Where-Object { $path -match $_ } })
    if ($forbidden) {
        throw "$Label contains files that must not be delivered:`n$($forbidden -join "`n")"
    }
    $missing = @($Required | Where-Object { $Paths -notcontains $_ })
    if ($missing) {
        throw "$Label is missing required files:`n$($missing -join "`n")"
    }
    $examples = @($Paths | Where-Object { $_ -match '\.tfvars' -and $_ -notmatch '\.example$' })
    if ($examples) {
        throw "$Label contains real variable files: $($examples -join ', ')"
    }
    Write-Host "$Label`: $($Paths.Count) files, no forbidden paths, all required files present."
}

Write-Step 'Checking the release record'
Assert-CleanMain
$sha = Get-HeadSha
$record = Read-ReleaseRecord
if ($record.deployment_source_sha -ne $sha) {
    throw "The deployed commit is $($record.deployment_source_sha), but HEAD is $sha. Deploy and verify HEAD first."
}
if ($record['verification_status'] -ne 'passed') {
    throw 'The release record has no passed verification. Run scripts/verify.ps1 first.'
}
if (-not $record['ci_run_url']) {
    throw 'The release record has no CI run URL.'
}
Write-Host "Commit $sha was deployed and verified; CI: $($record.ci_run_url)"

Write-Step 'Checking tracked files'
$tracked = (Invoke-Native git @('-C', $RepoRoot, '-c', 'core.quotepath=false', 'ls-files') -Capture) -split "`n" |
    ForEach-Object { $_.Trim() } | Where-Object { $_ }
Assert-FileList $tracked 'Tracked files' $RequiredFiles

Write-Step 'Checking the ZIP-only documents'
$ZipOnlyFiles = Get-ZipOnlyFiles
$tracking = @($ZipOnlyFiles | Where-Object { $tracked -contains $_ })
if ($tracking) {
    throw "These documents must not be tracked by Git: $($tracking -join ', ')"
}
foreach ($file in $ZipOnlyFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot $file) -PathType Leaf)) {
        throw "Missing $file in the working folder; it is delivered only inside the ZIP."
    }
    if (-not (Test-Native git @('-C', $RepoRoot, 'check-ignore', '--quiet', '--no-index', $file))) {
        throw "$file is not git-ignored, so it could be pushed by mistake."
    }
}
Write-Host "Found and git-ignored: $($ZipOnlyFiles -join ', ')"

Write-Step 'Creating the ZIP'
New-Item -ItemType Directory -Force $ReleaseDir | Out-Null
$zipPath = Join-Path $ReleaseDir "SixDegrees-$($sha.Substring(0, 12)).zip"
if (Test-Path $zipPath) {
    [IO.File]::Delete($zipPath)
}
Invoke-Native git @('-C', $RepoRoot, 'archive', '--format=zip', '--prefix=SixDegrees/', "--output=$zipPath", $sha)

Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Update)
try {
    foreach ($file in $ZipOnlyFiles) {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive, (Join-Path $RepoRoot $file), "SixDegrees/$file",
            [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally {
    $archive.Dispose()
}
$zipOnlyHashes = [ordered]@{}
foreach ($file in $ZipOnlyFiles) {
    $zipOnlyHashes[$file] = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $RepoRoot $file)).Hash.ToLowerInvariant()
}

Write-Step 'Checking the ZIP contents'
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $entries = @($archive.Entries |
        Where-Object { -not $_.FullName.EndsWith('/') } |
        ForEach-Object { $_.FullName -replace '^SixDegrees/', '' })
} finally {
    $archive.Dispose()
}
Assert-FileList $entries 'ZIP' ($RequiredFiles + $ZipOnlyFiles)

Write-Step 'Rebuilding from the extracted ZIP'
$workDir = Join-Path ([IO.Path]::GetTempPath()) "sixdegrees-package-$($sha.Substring(0, 12))-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
New-Item -ItemType Directory $workDir | Out-Null
[IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $workDir)
$root = Join-Path $workDir 'SixDegrees'
$venvPython = Join-Path $root '.venv/Scripts/python.exe'
$container = 'sixdegrees-package-smoke'
$image = "sixdegrees:package-$($sha.Substring(0, 12))"

Push-Location $root
try {
    Write-Host 'Python: create a virtual environment, install and run pytest'
    Invoke-Native $python @('-m', 'venv', '.venv')
    Invoke-Native $venvPython @('-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '-r', 'requirements-dev.txt')
    Invoke-Native $venvPython @('-m', 'pytest', '-q')

    Write-Host 'Frontend: npm ci, tests and build'
    Push-Location (Join-Path $root 'frontend')
    try {
        Invoke-Native npm @('ci', '--no-audit', '--no-fund')
        Invoke-Native npm @('test')
        Invoke-Native npm @('run', 'build')
    } finally {
        Pop-Location
    }

    Write-Host 'Container: build and smoke test'
    Invoke-Native docker @('build', '--build-arg', "GIT_SHA=$sha", '--tag', $image, $root)
    Invoke-Native docker @('rm', '--force', $container) -Capture -AllowFailure | Out-Null
    try {
        Invoke-Native docker @(
            'run', '--detach', '--name', $container, '--env', 'PORT=8080',
            '--publish', "127.0.0.1:${SmokePort}:8080", $image
        ) -Capture | Out-Null
        Invoke-Native $venvPython @(
            (Join-Path $root 'scripts/smoke_test.py'),
            '--base-url', "http://127.0.0.1:$SmokePort",
            '--expected-version', $sha, '--container', $container, '--timeout', '60'
        )
    } finally {
        Invoke-Native docker @('rm', '--force', $container) -Capture -AllowFailure | Out-Null
    }
} finally {
    Pop-Location
}

$zipHash = (Get-FileHash -Algorithm SHA256 $zipPath).Hash.ToLowerInvariant()
$record.package_source_sha = $sha
$record.zip_file = Split-Path -Leaf $zipPath
$record.zip_sha256 = $zipHash
$record.zip_only_files = $zipOnlyHashes
$record.clean_rebuild_status = 'passed'
$record.packaged_at = Get-UtcTimestamp
Write-ReleaseRecord $record

Write-Host ''
Write-Host "Packaged $zipPath" -ForegroundColor Green
Write-Host "SHA-256: $zipHash"
Write-Host "Clean rebuild folder (safe to delete): $workDir"
Write-Host "Release record: $ReleaseRecordPath"
