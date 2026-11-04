#requires -Version 7.0
<#
.SYNOPSIS
Verifies the deployed service and records the result.

.DESCRIPTION
Checks that Terraform deployed the image from release/release-record.json, then runs
scripts/smoke_test.py against the public URL without credentials: version, home page
and static files, API contracts and the known search. The result is added to the
release record. Avatars, "Use my city" and the 3D graph are checked by hand with the
list printed at the end.

.EXAMPLE
pwsh -File scripts/verify.ps1
#>
param(
    # Defaults to the Terraform output service_url.
    [string]$BaseUrl,

    # Seconds to wait for /health; includes a possible cold start.
    [int]$Timeout = 90
)

. "$PSScriptRoot/common.ps1"

Assert-Command terraform
$python = Get-PythonPath
$record = Read-ReleaseRecord
$expectedVersion = $record.deployment_source_sha

Write-Step 'Reading the deployed configuration from Terraform'
$deployedImage = Invoke-Native terraform @("-chdir=$InfraDir", 'output', '-raw', 'image_uri') -Capture
if ($deployedImage -ne $record.image_uri) {
    throw "Terraform deployed $deployedImage, but the release record expects $($record.image_uri)."
}
if (-not $BaseUrl) {
    $BaseUrl = Invoke-Native terraform @("-chdir=$InfraDir", 'output', '-raw', 'service_url') -Capture
}
$revision = Invoke-Native terraform @("-chdir=$InfraDir", 'output', '-raw', 'latest_ready_revision') -Capture
Write-Host "Service:  $BaseUrl"
Write-Host "Revision: $revision"
Write-Host "Expected version: $expectedVersion"

Write-Step 'Smoke-testing the public service'
$smokeTest = Join-Path $RepoRoot 'scripts/smoke_test.py'
& $python $smokeTest --base-url $BaseUrl --expected-version $expectedVersion --timeout $Timeout
$passed = $LASTEXITCODE -eq 0

$record.service_url = $BaseUrl
$record.revision = $revision
$record.verification_status = if ($passed) { 'passed' } else { 'failed' }
$record.verified_at = Get-UtcTimestamp
Write-ReleaseRecord $record

if (-not $passed) {
    throw "Verification failed; the result is recorded in $ReleaseRecordPath."
}

Write-Host ''
Write-Host "Verification passed for $expectedVersion." -ForegroundColor Green
Write-Host @"

Manual checks in a private/incognito browser window at $BaseUrl :
  1. The 3D graph shows ten people with avatars; dragging rotates left and right only.
  2. Clicking a person opens the card; names behind it stay hidden while rotating.
  3. Taipei + hiking/museum highlights three people; clearing restores everyone.
  4. "Use my city" asks for permission and fills in the correct city.
  5. Narrow window (about 390 px): no horizontal scrolling.
"@
