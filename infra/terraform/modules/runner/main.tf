variable "region" { type = string }
variable "service_account_email" { type = string }
variable "image" {
  description = "Runner image, runner:<engine-sha>-<runner-git-sha> (runner/cloud/scripts/prepare_build_context.sh prints the tag)."
  type        = string
}

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

        # The only secret the runner holds. The per-run callback secret arrives inside the single-use RunSpec; the
        # root ENGINE_CALLBACK_SECRET would let a compromised runner forge callbacks for any run, so it is not given.
        # The cloud profile (speed knobs, licensed enrichment allowlist) is baked into the image (presets.yaml), not set
        # here, and SPEC_URL / RUN_ID / DEADLINE_AT are per-execution overrides set by the app's launcher.
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

  # The image is part of the release (engine commit + runner commit), so Terraform tracks it: no ignore_changes on it.
  lifecycle {
    ignore_changes = [
      client,
      client_version,
    ]
  }
}

output "name" {
  value = google_cloud_run_v2_job.runner.name
}
