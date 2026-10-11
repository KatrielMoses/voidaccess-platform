variable "project_id" { type = string }
variable "region" { type = string }
variable "service_account_email" { type = string }
variable "image" { type = string }
variable "enable_database_url" { type = bool }
variable "allow_unauthenticated" { type = bool }

locals {
  secret_env = merge(
    {
      ENGINE_CALLBACK_SECRET = "engine-callback-secret"
      OPENROUTER_API_KEY     = "openrouter-api-key"
    },
    var.enable_database_url ? { DATABASE_URL = "database-url" } : {},
  )
}

resource "google_cloud_run_v2_service" "app" {
  name                = "va-app"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = var.service_account_email
    timeout         = "300s"

    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }

    containers {
      image = var.image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      dynamic "env" {
        for_each = local.secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }

  # Deploys happen via gcloud/Cloud Build with new image tags; Terraform owns everything else.
  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      template[0].revision,
      client,
      client_version,
    ]
  }
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  count    = var.allow_unauthenticated ? 1 : 0
  location = google_cloud_run_v2_service.app.location
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "url" {
  value = google_cloud_run_v2_service.app.uri
}
