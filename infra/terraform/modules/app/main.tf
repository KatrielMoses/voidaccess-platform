variable "project_id" { type = string }
variable "region" { type = string }
variable "service_account_email" { type = string }
variable "image" { type = string }
variable "allow_unauthenticated" { type = bool }
variable "runner_member" {
  description = "Service account of the runner job: it calls the app (spec fetch, callbacks) with an identity token."
  type        = string
  default     = ""
}
variable "app_url" {
  description = "Public origin of the app (APP_URL). Also the audience of the Cloud Scheduler OIDC tokens."
  type        = string
}
variable "site_url" {
  description = "Public origin of the site (SITE_URL, SITE_ORIGIN): sign-in lives there."
  type        = string
}
variable "cookie_domain" {
  description = "Parent domain of the shared session cookie."
  type        = string
}
variable "email_from" { type = string }
variable "kms_key_name" { type = string }
variable "cron_oidc_email" { type = string }
variable "creem_env" { type = string }
variable "creem_api_key_secret" {
  description = "Secret id for CREEM_API_KEY (creem-api-key-test or creem-api-key-live)."
  type        = string
}
variable "admin_email" {
  description = "ADMIN_EMAIL: the owner account of the admin console."
  type        = string
  default     = "katriel@voidaccess.pro"
}
variable "creem_webhook_secret" {
  description = "Secret id for CREEM_WEBHOOK_SECRET (creem-webhook-secret-test or creem-webhook-secret-live)."
  type        = string
}

locals {
  # Plain configuration only. Anything sensitive is a Secret Manager reference below.
  plain_env = {
    NODE_ENV             = "production"
    APP_URL              = var.app_url
    SITE_URL             = var.site_url
    SITE_ORIGIN          = var.site_url
    COOKIE_DOMAIN        = var.cookie_domain
    EMAIL_FROM           = var.email_from
    ENGINE_LAUNCHER      = "cloudrun"
    KMS_KEY_NAME         = var.kms_key_name
    CRON_OIDC_EMAIL      = var.cron_oidc_email
    CREEM_ENV            = var.creem_env
    NEXT_PUBLIC_SITE_URL = var.site_url
    ADMIN_EMAIL          = var.admin_email
  }

  # env var name => secret id
  secret_env = merge(
    {
      DATABASE_URL           = "database-url"        # va_app (RLS-bound), direct host. Never the owner.
      DATABASE_URL_SYSTEM    = "database-url-system" # va_worker: system work + Better Auth (H1). Never used for user queries.
      RLS_CONTEXT_KEY        = "rls-context-key"     # signs app.user_id so a SQL-injected set_config cannot impersonate (H1)
      BETTER_AUTH_SECRET     = "better-auth-secret"
      ENGINE_CALLBACK_SECRET = "engine-callback-secret"
      CRON_SHARED_SECRET     = "cron-shared-secret"
      VA_FINGERPRINT_KEY     = "va-fingerprint-key"
      RESEND_API_KEY         = "resend-api-key"
      GITHUB_CLIENT_ID       = "github-oauth-client-id"
      GITHUB_CLIENT_SECRET   = "github-oauth-client-secret"
      GOOGLE_CLIENT_ID       = "google-client-id" # Sign in with Google (Better Auth); redirect https://app.voidaccess.pro/api/auth/callback/google
      GOOGLE_CLIENT_SECRET   = "google-client-secret"
      TURNSTILE_SECRET_KEY   = "turnstile-secret-key"
      CREEM_API_KEY          = var.creem_api_key_secret
      CREEM_WEBHOOK_SECRET   = var.creem_webhook_secret
      OPENROUTER_API_KEY     = "openrouter-api-key"
      ADMIN_PATH             = "admin-path" # the admin console's secret URL slug; never put the value in terraform
    },
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
      image = var.image # CMD is `node apps/app/server.js` (Next standalone output) in apps/app/Dockerfile

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
        for_each = local.plain_env
        content {
          name  = env.key
          value = env.value
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

# Public on the internet; the app authenticates every request itself (proxy.ts, requireUser, machine-endpoint auth).
resource "google_cloud_run_v2_service_iam_member" "public" {
  count    = var.allow_unauthenticated ? 1 : 0
  location = google_cloud_run_v2_service.app.location
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# The runner reaches the private app with an identity token; resource-level binding, no project IAM.
resource "google_cloud_run_v2_service_iam_member" "runner_invoker" {
  count    = var.runner_member == "" ? 0 : 1
  location = google_cloud_run_v2_service.app.location
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = var.runner_member
}

output "url" {
  value = google_cloud_run_v2_service.app.uri
}

output "latest_ready_revision" {
  value = google_cloud_run_v2_service.app.latest_ready_revision
}
