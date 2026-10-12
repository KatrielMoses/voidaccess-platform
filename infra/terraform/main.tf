locals {
  registry    = "${var.region}-docker.pkg.dev/${var.project_id}/voidaccess"
  app_sa      = "va-app@${var.project_id}.iam.gserviceaccount.com"
  runner_sa   = "va-runner@${var.project_id}.iam.gserviceaccount.com"
  runs_bucket = "${var.project_id}-runs"
  app_url     = "https://${var.app_domain}"
  site_url    = "https://${var.site_domain}"
  # Secrets the app reads. All exist already except dodo-webhook-secret (container managed below, version added by hand).
  app_secrets = [
    "database-url",
    "better-auth-secret",
    "engine-callback-secret",
    "cron-shared-secret",
    "va-fingerprint-key",
    "resend-api-key",
    "github-oauth-client-id",
    "github-oauth-client-secret",
    "turnstile-secret-key",
    "dodo-api-key-test",
    "openrouter-api-key",
  ]
  runner_secrets = ["openrouter-api-key"] # not engine-callback-secret: see modules/runner
  kms_key        = "projects/${var.project_id}/locations/${var.region}/keyRings/voidaccess/cryptoKeys/credentials"
}

# Existing resources, referenced not recreated.
data "google_service_account" "app" {
  account_id = "va-app"
}

data "google_service_account" "runner" {
  account_id = "va-runner"
}

data "google_storage_bucket" "runs" {
  name = local.runs_bucket
}

data "google_secret_manager_secret" "secrets" {
  for_each  = toset(local.app_secrets)
  secret_id = each.key
}

# The Dodo webhook signing secret does not exist until the webhook is registered. Terraform owns the empty
# container (and its accessor binding); the version is added by hand, then `enable_dodo_webhook=true` wires it.
resource "google_secret_manager_secret" "dodo_webhook" {
  secret_id = "dodo-webhook-secret"
  replication {
    auto {}
  }
}

module "app" {
  source                = "./modules/app"
  project_id            = var.project_id
  region                = var.region
  service_account_email = data.google_service_account.app.email
  image                 = "${local.registry}/va-app:${var.app_image_tag}"
  app_url               = local.app_url
  site_url              = local.site_url
  cookie_domain         = ".${var.site_domain}"
  email_from            = var.email_from
  kms_key_name          = local.kms_key
  cron_oidc_email       = data.google_service_account.app.email
  dodo_env              = "test_mode"
  enable_dodo_webhook   = var.enable_dodo_webhook
  allow_unauthenticated = var.allow_unauthenticated && var.manage_iam
  runner_member         = var.manage_iam ? "serviceAccount:${data.google_service_account.runner.email}" : ""
}

module "runner" {
  source                = "./modules/runner"
  region                = var.region
  service_account_email = data.google_service_account.runner.email
  image                 = var.runner_image
}

module "scheduler" {
  count                 = var.manage_schedulers ? 1 : 0
  source                = "./modules/scheduler"
  region                = var.region
  app_url               = local.app_url
  service_account_email = data.google_service_account.app.email
}

module "domain" {
  count      = var.manage_domain_mapping ? 1 : 0
  source     = "./modules/domain"
  region     = var.region
  project_id = var.project_id
  domain     = var.app_domain
  service    = "va-app"
  depends_on = [module.app]
}

module "iam" {
  count          = var.manage_iam ? 1 : 0
  source         = "./modules/iam"
  runs_bucket    = data.google_storage_bucket.runs.name
  app_member     = "serviceAccount:${data.google_service_account.app.email}"
  run_member     = "serviceAccount:${data.google_service_account.runner.email}"
  secret_ids     = merge({ for k, s in data.google_secret_manager_secret.secrets : k => s.secret_id }, { "dodo-webhook-secret" = google_secret_manager_secret.dodo_webhook.secret_id })
  app_secrets    = concat(local.app_secrets, ["dodo-webhook-secret"])
  runner_secrets = local.runner_secrets
}
