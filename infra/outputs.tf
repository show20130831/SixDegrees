output "service_url" {
  description = "Public HTTPS URL of the service."
  value       = google_cloud_run_v2_service.app.uri
}

output "image_uri" {
  description = "Image the service is configured to run."
  value       = google_cloud_run_v2_service.app.template[0].containers[0].image
}

output "latest_ready_revision" {
  description = "Revision currently serving traffic."
  value       = google_cloud_run_v2_service.app.latest_ready_revision
}

output "runtime_service_account" {
  description = "Identity the container runs as."
  value       = google_service_account.runtime.email
}
