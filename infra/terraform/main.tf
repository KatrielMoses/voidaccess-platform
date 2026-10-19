locals {
  registry       = "${var.region}-docker.pkg.dev/${var.project_id}/voidaccess"
  app_sa         = "va-app@${var.project_id}.iam.gserviceaccount.com"
  runner_sa      = "va-runner@${var.project_id}.iam.gserviceaccount.com"
  runs_bucket    = "${var.project_id}-runs"
  archive_bucket = "${var.project_id}-archive"
  app_url        = "https://${var.app_domain}"
  site_url       = "https://${var.site_domain}"
  # Secrets the app reads. All exist already (Creem test or live names come from var.creem_*_secret).
  app_secrets = [
    "database-url",
    "database-url-system", # va_worker (H1): withSystem + Better Auth. Created by packages/db/scripts/neon-provision.ts
    "rls-context-key",     # H1: signs the tenant context; the same value is installed in the database (app_ctx_key)
    "better-auth-secret",
    "engine-callback-secret",
    "cron-shared-secret",
    "va-fingerprint-key",
    "resend-api-key",
    "github-oauth-client-id",
    "github-oauth-client-secret",
    "google-client-id",
    "google-client-secret",
    "turnstile-secret-key",
    var.creem_api_key_secret,
    var.creem_webhook_secret,
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

# Permanent, versioned archive bucket (P4): page snapshots by content hash.
data "google_storage_bucket" "archive" {
  name = local.archive_bucket
}

data "google_secret_manager_secret" "secrets" {
  for_each  = toset(local.app_secrets)
  secret_id = each.key
}

# P7: Dodo is replaced by Creem. Terraform stops managing the old dodo-webhook-secret container but leaves it in
# place (delete it by hand once the Dodo account is closed).
removed {
  from = google_secret_manager_secret.dodo_webhook
  lifecycle {
    destroy = false
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
  creem_env             = var.creem_env
  creem_api_key_secret  = var.creem_api_key_secret
  creem_webhook_secret  = var.creem_webhook_secret
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
  archive_bucket = data.google_storage_bucket.archive.name
  app_member     = "serviceAccount:${data.google_service_account.app.email}"
  run_member     = "serviceAccount:${data.google_service_account.runner.email}"
  secret_ids     = { for k, s in data.google_secret_manager_secret.secrets : k => s.secret_id }
  app_secrets    = local.app_secrets
  runner_secrets = local.runner_secrets
}
