variable "runs_bucket" { type = string }
variable "archive_bucket" { type = string }
variable "app_member" { type = string }
variable "run_member" { type = string }
variable "secret_ids" { type = map(string) }

locals {
  app_secrets    = ["database-url", "engine-callback-secret", "openrouter-api-key"]
  runner_secrets = ["openrouter-api-key"] # not engine-callback-secret: see modules/runner
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

# The archive worker (P4) writes page snapshots and, for legal removals, deletes them with all versions.
resource "google_storage_bucket_iam_member" "app_archive_admin" {
  bucket = var.archive_bucket
  role   = "roles/storage.objectAdmin"
  member = var.app_member
}
