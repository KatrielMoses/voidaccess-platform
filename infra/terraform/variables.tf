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

variable "crypto_payments" {
  description = "CRYPTO_PAYMENTS for va-app: \"on\" shows Pay with crypto (NOWPayments) and accepts IPNs; \"off\" hides it and acknowledges IPNs without applying them."
  type        = string
  default     = "on"
  validation {
    condition     = contains(["off", "on"], var.crypto_payments)
    error_message = "crypto_payments must be \"off\" or \"on\"."
  }
}

variable "nowpayments_api_base" {
  description = "NOWPayments API base: https://api.nowpayments.io/v1 (live) or https://api-sandbox.nowpayments.io/v1 (sandbox, test mode). The mode follows the base."
  type        = string
  default     = "https://api.nowpayments.io/v1"
}

variable "nowpayments_api_key_secret" {
  description = "Secret Manager id of the NOWPayments API key (live account, shared with MailAccess)."
  type        = string
  default     = "nowpayments-api-key"
}

variable "nowpayments_ipn_secret" {
  description = "Secret Manager id of the NOWPayments IPN secret (shared with MailAccess; VoidAccess accepts only va_ orders)."
  type        = string
  default     = "nowpayments-ipn-secret"
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
