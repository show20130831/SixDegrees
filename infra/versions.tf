terraform {
  required_version = ">= 1.16.0, < 2.0.0"

  required_providers {
    google = {
      source = "hashicorp/google"
      # Current major version; invoker_iam_disabled on Cloud Run v2 is available in it.
      # The exact version is pinned by .terraform.lock.hcl.
      version = ">= 8.0.0, < 9.0.0"
    }
  }

  # Local state on the operator's machine, backed up privately outside Git.
  # A remote backend is a later step, together with automated deployment.
}

provider "google" {
  project = var.project_id
  region  = var.region
}
