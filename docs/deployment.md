# Deploying SixDegrees to Google Cloud

The service runs on Cloud Run in `asia-east1`, with images in a private Artifact Registry
repository. Terraform ([infra/](../infra/)) manages the Cloud Run service and its runtime
service account. The project, billing, enabled APIs and the image repository are set up
beforehand, so only part of the cloud setup is managed as code.

CI never deploys. A release is built, pushed and deployed from a local machine, from a
`main` commit whose CI run has passed. See the [CI/CD flow](diagrams/output/3-ci-cd-flow.png).

## Prerequisites

PowerShell 7, Docker Desktop, the Google Cloud CLI and Terraform 1.16, a Google Cloud
project with billing enabled, and the Python virtual environment from
[Local development](../README.md#local-development) (the smoke test runs with it). Sign in
once:

```powershell
gcloud auth login
gcloud auth application-default login
gcloud auth application-default set-quota-project <project-id>
```

## Release steps

Run from the repository root on a clean `main`:

```powershell
# One time: enable APIs, create the image repository, configure Docker.
pwsh -File scripts/bootstrap.ps1 -ProjectId <project-id>

# Build, smoke-test and push the image for the current commit. First open the main CI run
# for this commit on GitHub Actions and check that it succeeded.
pwsh -File scripts/build-push.ps1 -ProjectId <project-id> -CiRunUrl <run-url> -ConfirmCiPassed

# Plan the deployment, read the plan, then apply exactly that plan.
pwsh -File scripts/plan-deploy.ps1 -ProjectId <project-id>
terraform -chdir=infra apply sixdegrees.tfplan

# Check the public service and record the result.
pwsh -File scripts/verify.ps1
```

| Script | What it does |
| --- | --- |
| [bootstrap.ps1](../scripts/bootstrap.ps1) | Checks the account, project and billing flag; enables Cloud Run, Artifact Registry and IAM; creates the repository; configures Docker |
| [build-push.ps1](../scripts/build-push.ps1) | Requires a clean `main` equal to `origin/main` and a confirmed CI run; builds a linux/amd64 image versioned with the commit SHA, smoke-tests it, pushes it and reads the digest back from Artifact Registry |
| [plan-deploy.ps1](../scripts/plan-deploy.ps1) | Runs `terraform init` and `plan` with the image digest and saves the plan; never applies |
| [verify.ps1](../scripts/verify.ps1) | Confirms Terraform deployed the recorded image, smoke-tests the public URL without credentials, and prints a short manual checklist |
| [package.ps1](../scripts/package.ps1) | Packages the deployed and verified commit as a ZIP, rebuilds and tests it from the extracted files, and records its SHA-256 |

Each run writes `release/release-record.json` (commit, image digest, CI run, verification
result). `release/`, Terraform state, plans and variable files stay out of Git; back up
`infra/terraform.tfstate` privately after each apply.

## Service settings

- 0 to 1 instances. The service scales to zero, so the first request may be a cold start.
- 1 vCPU and 512 MiB with request-based billing.
- Concurrency 80 and a 60-second request timeout.
- A startup probe on `/health`.
- A runtime service account with no project-level IAM roles.

The URL is public because the data is fictional and read-only; the image repository stays
private.

## Roll back

Plan with a previously verified digest, read the plan, then apply it:

```powershell
pwsh -File scripts/plan-deploy.ps1 -ProjectId <project-id> -ImageUri <image@sha256:...>
terraform -chdir=infra apply sixdegrees.tfplan
pwsh -File scripts/verify.ps1
```

## Remove the demo

After the review, read the plan of:

```powershell
terraform -chdir=infra destroy -var=project_id=<project-id> -var=image_uri=<deployed image>
```

Deletion protection is off. Then delete the Artifact Registry repository separately;
removing the service does not remove stored images.
