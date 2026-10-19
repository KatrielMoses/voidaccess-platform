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
  description = "Full runner image reference, e.g. us-central1-docker.pkg.dev/voidaccess-cloud/voidaccess/runner:c66b9a0-<runner sha> (engine v2.1.0; tag = <engine sha>-<runner sha>)."
  type        = string
}

variable "creem_env" {
  description = "Creem environment for va-app: test_mode (test-api.creem.io, test keys) or live_mode. Switch together with the two secrets below."
  type        = string
  default     = "test_mode"
  validation {
    condition     = contains(["test_mode", "live_mode"], var.creem_env)
    error_message = "creem_env must be test_mode or live_mode."
  }
}

variable "creem_api_key_secret" {
  description = "Secret Manager id of the Creem API key: creem-api-key-test now; creem-api-key-live when going live."
  type        = string
  default     = "creem-api-key-test"
}

variable "creem_webhook_secret" {
  description = "Secret Manager id of the Creem webhook signing secret: creem-webhook-secret-test now; creem-webhook-secret-live when going live."
  type        = string
  default     = "creem-webhook-secret-test"
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
