#requires -Version 7.0
<#
.SYNOPSIS
Builds the release image from a clean main, smoke-tests it and pushes it.

.DESCRIPTION
Before running, open the main CI run for the current commit on GitHub Actions and check
that its event is push, its branch is main, its head SHA equals this commit and its
result is success. Pass that run's URL with -CiRunUrl and confirm with -ConfirmCiPassed;
the script does not query GitHub itself.

The image is built for linux/amd64 with the commit SHA as its version, smoke-tested
locally, pushed, and its digest read back from Artifact Registry. The result is written
to release/release-record.json. The running service is not changed.

.EXAMPLE
pwsh -File scripts/build-push.ps1 -ProjectId my-sixdegrees-project `
    -CiRunUrl https://github.com/<owner>/SixDegrees/actions/runs/123 -ConfirmCiPassed
#>
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
    [string]$ProjectId,

    [Parameter(Mandatory)]
    [ValidatePattern('^https://github\.com/[\w.-]+/[\w.-]+/actions/runs/\d+')]
    [string]$CiRunUrl,

    [switch]$ConfirmCiPassed,

    [string]$Region = 'asia-east1',
    [string]$Repository = 'sixdegrees',
    [string]$ImageName = 'app',
    [int]$SmokePort = 18080
)

. "$PSScriptRoot/common.ps1"

if (-not $ConfirmCiPassed) {
    throw 'Check the main CI run for this commit, then pass -ConfirmCiPassed.'
}

Assert-Command git, docker, gcloud
$python = Get-PythonPath

Write-Step 'Checking the working tree'
Assert-CleanMain
$sha = Get-HeadSha
Write-Host "Commit: $sha"
Write-Host "CI run: $CiRunUrl (confirmed by the operator)"
$ciConfirmedAt = Get-UtcTimestamp

$imageRepo = "$Region-docker.pkg.dev/$ProjectId/$Repository/$ImageName"
$tag = "${imageRepo}:$sha"

Write-Step "Building $tag"
Invoke-Native docker @(
    'build', '--platform', 'linux/amd64',
    '--build-arg', "GIT_SHA=$sha",
    '--tag', $tag,
    $RepoRoot
)

Write-Step 'Smoke-testing the image'
$container = 'sixdegrees-release-smoke'
Invoke-Native docker @('rm', '--force', $container) -Capture -AllowFailure | Out-Null
try {
    Invoke-Native docker @(
        'run', '--detach', '--name', $container,
        '--env', 'PORT=8080',
        '--publish', "127.0.0.1:${SmokePort}:8080",
        $tag
    ) -Capture | Out-Null
    $smokeTest = Join-Path $RepoRoot 'scripts/smoke_test.py'
    & $python $smokeTest --base-url "http://127.0.0.1:$SmokePort" --expected-version $sha --container $container --timeout 60
    if ($LASTEXITCODE -ne 0) {
        Invoke-Native docker @('logs', $container) -AllowFailure
        throw 'Smoke test failed; nothing was pushed.'
    }
} finally {
    Invoke-Native docker @('rm', '--force', $container) -Capture -AllowFailure | Out-Null
}

Write-Step 'Pushing the image'
Invoke-Native docker @('push', $tag)

Write-Step 'Reading the pushed digest from Artifact Registry'
$digest = Invoke-Native gcloud @(
    'artifacts', 'docker', 'images', 'describe', $tag,
    "--project=$ProjectId", '--format=value(image_summary.digest)'
) -Capture
if ($digest -notmatch '^sha256:[0-9a-f]{64}$') {
    throw "Unexpected digest from Artifact Registry: '$digest'."
}
$imageUri = "$imageRepo@$digest"

# Docker may push a single manifest or an image index (for example with build
# attestations). An index must contain a linux/amd64 image for Cloud Run.
$manifest = Invoke-Native docker @('buildx', 'imagetools', 'inspect', $imageUri, '--raw') -Capture | ConvertFrom-Json -AsHashtable
$mediaType = $manifest['mediaType']
$platforms = @()
if ($manifest.ContainsKey('manifests')) {
    # Attestation entries are listed with the platform unknown/unknown.
    $platforms = @($manifest['manifests'] |
        Where-Object { $_['platform'] -and $_['platform']['os'] -ne 'unknown' } |
        ForEach-Object { "$($_['platform']['os'])/$($_['platform']['architecture'])" })
    if ($platforms -notcontains 'linux/amd64') {
        throw "The pushed image index has no linux/amd64 image (platforms: $($platforms -join ', '))."
    }
}

$record = [ordered]@{
    deployment_source_sha  = $sha
    image_uri              = $imageUri
    image_digest           = $digest
    image_tag              = $tag
    manifest_media_type    = $mediaType
    index_platforms        = $platforms
    ci_run_url             = $CiRunUrl
    ci_verification_method = 'manual'
    ci_confirmed_at        = $ciConfirmedAt
    built_at               = Get-UtcTimestamp
}
Write-ReleaseRecord $record

Write-Host ''
Write-Host "Pushed $imageUri" -ForegroundColor Green
Write-Host "Release record: $ReleaseRecordPath"
Write-Host "Next: pwsh -File scripts/plan-deploy.ps1 -ProjectId $ProjectId"
