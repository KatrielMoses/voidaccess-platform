variable "project_id" {
  type    = string
  default = "voidaccess-cloud"
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "app_image_tag" {
  description = "Tag of va-app in Artifact Registry. Only used at creation: deploys by gcloud/Cloud Build do not drift (see README)."
  type        = string
  default     = "latest"
}

variable "runner_image" {
  description = "Placeholder until the runner image exists (R0). Ignored after creation."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/job"
}

variable "enable_database_url" {
  description = "Wire DATABASE_URL from secret database-url. Keep false until the secret has a version, otherwise the revision cannot start."
  type        = bool
  default     = false
}

variable "allow_unauthenticated" {
  description = "Grant allUsers run.invoker on va-app (needed for public /api/health)."
  type        = bool
  default     = true
}

variable "manage_iam" {
  description = "Create resource-level IAM bindings (secrets, runs bucket, invoker). va-agent holds secretmanager.admin, storage.admin and run.admin, so resource-level bindings work without project IAM."
  type        = bool
  default     = true
}

variable "manage_schedulers" {
  description = "Create the (paused) Cloud Scheduler jobs."
  type        = bool
  default     = true
}
