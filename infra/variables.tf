variable "project_id" {
  description = "Google Cloud project that hosts the service."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run; the Artifact Registry repository is in the same region."
  type        = string
  default     = "asia-east1"
}

variable "service_name" {
  description = "Cloud Run service name."
  type        = string
  default     = "sixdegrees"
}

variable "image_uri" {
  description = "Container image pinned by digest, as printed by scripts/build-push.ps1."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+-docker\\.pkg\\.dev/[^@\\s]+@sha256:[0-9a-f]{64}$", var.image_uri))
    error_message = "image_uri must be an Artifact Registry image pinned by digest (…-docker.pkg.dev/…@sha256:<64 hex>)."
  }
}
