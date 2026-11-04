# Terraform manages the runtime identity and the Cloud Run service. The project, its
# billing, the enabled APIs and the Artifact Registry repository are created beforehand
# by scripts/bootstrap.ps1.

# The app reads only files inside its image, so this identity gets no project roles.
resource "google_service_account" "runtime" {
  account_id   = "${var.service_name}-run"
  display_name = "SixDegrees Cloud Run runtime"
  description  = "Runtime identity for the SixDegrees service. It holds no project roles."
}

resource "google_cloud_run_v2_service" "app" {
  name     = var.service_name
  location = var.region

  # Public demo with fictional, read-only data: anyone can open the page and the API.
  # This makes only the service public, not the image repository or the source code.
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = true

  # Lets terraform destroy remove the demo once the review is over.
  deletion_protection = false

  template {
    service_account                  = google_service_account.runtime.email
    timeout                          = "60s"
    max_instance_request_concurrency = 80

    # Scale to zero (cold starts accepted) and never past one instance. The maximum
    # limits growth; it is not a spending cap.
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }

    containers {
      image = var.image_uri

      # Cloud Run passes this port to the app in the PORT variable.
      ports {
        container_port = 8080
      }

      # Request-based billing: CPU is only allocated while a request is handled.
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }

      # /health succeeds only after the data has been loaded and validated. The probe
      # never depends on DiceBear or BigDataCloud. 5 s x 12 gives a 60-second window.
      startup_probe {
        initial_delay_seconds = 0
        period_seconds        = 5
        timeout_seconds       = 1
        failure_threshold     = 12

        http_get {
          path = "/health"
          port = 8080
        }
      }
    }
  }
}
