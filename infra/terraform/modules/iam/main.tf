variable "runs_bucket" { type = string }
variable "app_member" { type = string }
variable "run_member" { type = string }
variable "secret_ids" { type = map(string) }

locals {
  app_secrets    = ["database-url", "engine-callback-secret", "openrouter-api-key"]
  runner_secrets = ["engine-callback-secret", "openrouter-api-key"]
}

resource "google_secret_manager_secret_iam_member" "app" {
  for_each  = toset(local.app_secrets)
  secret_id = var.secret_ids[each.key]
  role      = "roles/secretmanager.secretAccessor"
  member    = var.app_member
}

resource "google_secret_manager_secret_iam_member" "runner" {
  for_each  = toset(local.runner_secrets)
  secret_id = var.secret_ids[each.key]
  role      = "roles/secretmanager.secretAccessor"
  member    = var.run_member
}

resource "google_storage_bucket_iam_member" "app_runs_read" {
  bucket = var.runs_bucket
  role   = "roles/storage.objectViewer"
  member = var.app_member
}
