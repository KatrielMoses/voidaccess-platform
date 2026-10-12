locals {
  registry     = "${var.region}-docker.pkg.dev/${var.project_id}/voidaccess"
  app_sa       = "va-app@${var.project_id}.iam.gserviceaccount.com"
  runner_sa    = "va-runner@${var.project_id}.iam.gserviceaccount.com"
  runs_bucket  = "${var.project_id}-runs"
  secret_names = ["database-url", "engine-callback-secret", "openrouter-api-key"]
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
  for_each  = toset(local.secret_names)
  secret_id = each.key
}

module "app" {
  source                = "./modules/app"
  project_id            = var.project_id
  region                = var.region
  service_account_email = data.google_service_account.app.email
  image                 = "${local.registry}/va-app:${var.app_image_tag}"
  enable_database_url   = var.enable_database_url
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
  app_url               = module.app.url
  service_account_email = data.google_service_account.app.email
}

module "iam" {
  count       = var.manage_iam ? 1 : 0
  source      = "./modules/iam"
  runs_bucket = data.google_storage_bucket.runs.name
  app_member  = "serviceAccount:${data.google_service_account.app.email}"
  run_member  = "serviceAccount:${data.google_service_account.runner.email}"
  secret_ids  = { for k, s in data.google_secret_manager_secret.secrets : k => s.secret_id }
}
