#requires -Version 7.0
<#
.SYNOPSIS
Creates a Terraform plan that deploys an image by digest.

.DESCRIPTION
By default the image comes from release/release-record.json, which must belong to the
current commit. To roll back, pass a previously verified digest with -ImageUri.

The plan is saved to infra/sixdegrees.tfplan and printed. Read the resource changes,
then apply exactly that plan with the command shown at the end. The script never
applies anything itself.

.EXAMPLE
pwsh -File scripts/plan-deploy.ps1 -ProjectId my-sixdegrees-project
#>
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
    [string]$ProjectId,

    [string]$Region = 'asia-east1',

    # Optional override, for example a previous digest when rolling back.
    [string]$ImageUri
)

. "$PSScriptRoot/common.ps1"

Assert-Command git, terraform

if (-not $ImageUri) {
    $record = Read-ReleaseRecord
    $head = Get-HeadSha
    if ($record.deployment_source_sha -ne $head) {
        throw "The release record is for $($record.deployment_source_sha), but HEAD is $head. Run build-push.ps1 for this commit, or pass -ImageUri."
    }
    $ImageUri = $record.image_uri
}
Write-Host "Image: $ImageUri"

Write-Step 'terraform init'
Invoke-Native terraform @("-chdir=$InfraDir", 'init', '-input=false')

Write-Step 'terraform plan'
Invoke-Native terraform @(
    "-chdir=$InfraDir", 'plan', '-input=false',
    "-var=project_id=$ProjectId",
    "-var=region=$Region",
    "-var=image_uri=$ImageUri",
    "-out=$PlanFileName"
)

Write-Host ''
Write-Host 'Review the plan above. If it is what you expect, apply exactly this plan:' -ForegroundColor Green
Write-Host "  terraform -chdir=infra apply $PlanFileName"
Write-Host 'Then run: pwsh -File scripts/verify.ps1'
Write-Host 'Afterwards, back up infra/terraform.tfstate privately (outside Git).'
