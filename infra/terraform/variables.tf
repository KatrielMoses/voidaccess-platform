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

variable "enable_dodo_webhook" {
  description = "Wire DODO_WEBHOOK_SECRET from secret dodo-webhook-secret. Keep false until the secret has a version, otherwise the revision cannot start."
  type        = bool
  default     = false
}

variable "app_domain" {
  description = "Custom domain of the app (Cloud Run domain mapping)."
  type        = string
  default     = "app.voidaccess.pro"
}

variable "site_domain" {
  type    = string
  default = "voidaccess.pro"
}

variable "email_from" {
  type    = string
  default = "VoidAccess <hello@voidaccess.pro>"
}

variable "manage_domain_mapping" {
  description = "Create the Cloud Run domain mapping (off: fallback is the Cloudflare Worker in infra/cloudflare/app-proxy until ownership is verified). Needs va-agent to be a verified owner of voidaccess.pro (Search Console)."
  type        = bool
  default     = false
}

variable "allow_unauthenticated" {
  description = "Grant allUsers run.invoker on va-app. The app authenticates every request itself (proxy.ts); only machine endpoints are open."
  type        = bool
  default     = true
}

variable "manage_iam" {
  description = "Create resource-level IAM bindings (secrets, runs bucket, invoker). va-agent holds secretmanager.admin, storage.admin and run.admin, so resource-level bindings work without project IAM."
  type        = bool
  default     = true
}

variable "manage_schedulers" {
  description = "Create the Cloud Scheduler jobs (enabled)."
  type        = bool
  default     = true
}
