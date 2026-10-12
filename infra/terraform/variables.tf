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
  description = "Full runner image reference, e.g. us-central1-docker.pkg.dev/voidaccess-cloud/voidaccess/runner:bf2213c-7cfd4b1."
  type        = string
}

variable "enable_database_url" {
  description = "Wire DATABASE_URL from secret database-url. Keep false until the secret has a version, otherwise the revision cannot start."
  type        = bool
  default     = false
}

variable "allow_unauthenticated" {
  description = "Grant allUsers run.invoker on va-app. Keep false until auth ships (P2); /dev/ui must be gated first."
  type        = bool
  default     = false
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
