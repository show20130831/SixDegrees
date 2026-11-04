#requires -Version 7.0
<#
.SYNOPSIS
One-time setup of a Google Cloud project for SixDegrees.

.DESCRIPTION
Checks the signed-in account, the project and its billing status, enables the APIs the
deployment needs, creates the private Artifact Registry repository if it is missing and
configures Docker to push to it. It never reads or changes payment details. Running it
again is safe: existing resources are checked, not recreated.

The Google Cloud account, billing account and project are created by hand first.

.EXAMPLE
pwsh -File scripts/bootstrap.ps1 -ProjectId my-sixdegrees-project
#>
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
    [string]$ProjectId,

    [string]$Region = 'asia-east1',

    [ValidatePattern('^[a-z][a-z0-9-]*$')]
    [string]$Repository = 'sixdegrees'
)

. "$PSScriptRoot/common.ps1"

$RequiredApis = @(
    'run.googleapis.com',              # Cloud Run
    'artifactregistry.googleapis.com', # private image repository
    'iam.googleapis.com'               # runtime service account created by Terraform
)

Assert-Command gcloud, docker

Write-Step 'Checking the signed-in account'
$account = Invoke-Native gcloud @('auth', 'list', '--filter=status:ACTIVE', '--format=value(account)') -Capture
if (-not $account) {
    throw 'No active gcloud account. Run: gcloud auth login'
}
Write-Host "Signed in as $account"

Write-Step "Checking project $ProjectId"
$state = Invoke-Native gcloud @('projects', 'describe', $ProjectId, '--format=value(lifecycleState)') -Capture
if ($state -ne 'ACTIVE') {
    throw "Project $ProjectId is not active (state: $state)."
}
Invoke-Native gcloud @('config', 'set', 'project', $ProjectId, '--quiet')

# Only the on/off flag is read. If the check itself is not possible, enabling the APIs
# below fails with a clear billing error instead.
$billing = Invoke-Native gcloud @('billing', 'projects', 'describe', $ProjectId, '--format=value(billingEnabled)') -Capture -AllowFailure
if ($billing -eq 'False') {
    throw "Billing is not enabled for $ProjectId. Link a billing account in the Cloud Console first."
} elseif ($billing -eq 'True') {
    Write-Host 'Billing is enabled.'
} else {
    Write-Warning 'Could not read the billing status; continuing.'
}

Write-Step 'Enabling APIs'
Invoke-Native gcloud (@('services', 'enable') + $RequiredApis + @("--project=$ProjectId"))

Write-Step "Checking Artifact Registry repository $Repository in $Region"
$describeArgs = @('artifacts', 'repositories', 'describe', $Repository, "--location=$Region", "--project=$ProjectId", '--format=value(format)')
if (Test-Native gcloud $describeArgs) {
    $format = Invoke-Native gcloud $describeArgs -Capture
    if ($format -ne 'DOCKER') {
        throw "Repository $Repository exists but its format is $format, not DOCKER."
    }
    Write-Host 'Repository already exists.'
} else {
    Invoke-Native gcloud @(
        'artifacts', 'repositories', 'create', $Repository,
        '--repository-format=docker',
        "--location=$Region",
        "--project=$ProjectId",
        '--description=SixDegrees container images'
    )
}

Write-Step 'Configuring Docker to push to Artifact Registry'
Invoke-Native gcloud @('auth', 'configure-docker', "$Region-docker.pkg.dev", '--quiet')

Write-Step 'Checking Application Default Credentials for Terraform'
if (Test-Native gcloud @('auth', 'application-default', 'print-access-token')) {
    Write-Host 'Application Default Credentials are available.'
} else {
    Write-Warning "Terraform needs Application Default Credentials. Run:`n  gcloud auth application-default login`n  gcloud auth application-default set-quota-project $ProjectId"
}

Write-Host ''
Write-Host "Bootstrap complete. Image repository: $Region-docker.pkg.dev/$ProjectId/$Repository" -ForegroundColor Green
