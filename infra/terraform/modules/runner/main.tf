variable "region" { type = string }
variable "service_account_email" { type = string }
variable "image" { type = string }

resource "google_cloud_run_v2_job" "runner" {
  name                = "va-runner"
  location            = var.region
  deletion_protection = false

  template {
    task_count = 1

    template {
      service_account = var.service_account_email
      timeout         = "900s"
      max_retries     = 0

      containers {
        image = var.image

        resources {
          limits = {
            cpu    = "1"
            memory = "2Gi"
          }
        }

        env {
          name = "ENGINE_CALLBACK_SECRET"
          value_source {
            secret_key_ref {
              secret  = "engine-callback-secret"
              version = "latest"
            }
          }
        }

        env {
          name = "OPENROUTER_API_KEY"
          value_source {
            secret_key_ref {
              secret  = "openrouter-api-key"
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].template[0].containers[0].image,
      client,
      client_version,
    ]
  }
}

output "name" {
  value = google_cloud_run_v2_job.runner.name
}
