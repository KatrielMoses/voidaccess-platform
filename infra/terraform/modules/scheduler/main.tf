variable "region" { type = string }
variable "app_url" { type = string }
variable "service_account_email" { type = string }

locals {
  jobs = {
    "va-watchdog"      = { schedule = "*/5 * * * *", path = "/api/cron/watchdog" }
    "va-founding"      = { schedule = "0 6 * * *", path = "/api/cron/founding" }
    "va-grants"        = { schedule = "30 6 * * *", path = "/api/cron/grants" }
    "va-credit-alerts" = { schedule = "15 * * * *", path = "/api/cron/credit-alerts" }
    "va-archive"       = { schedule = "*/5 * * * *", path = "/api/cron/archive" }
    "va-lifecycle"     = { schedule = "5 * * * *", path = "/api/cron/lifecycle" }
  }
}

resource "google_cloud_scheduler_job" "cron" {
  for_each  = local.jobs
  name      = each.key
  region    = var.region
  schedule  = each.value.schedule
  time_zone = "Etc/UTC"
  paused    = false

  attempt_deadline = "180s"

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = "${var.app_url}${each.value.path}"

    oidc_token {
      service_account_email = var.service_account_email
      audience              = var.app_url
    }
  }
}
