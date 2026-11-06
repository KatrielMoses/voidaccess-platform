variable "region" { type = string }
variable "app_url" { type = string }
variable "service_account_email" { type = string }

# Every job fires on a quarter hour (:00/:15/:30/:45) so the Neon database can scale to zero between them
# (Neon suspends after 5 idle minutes; jobs every 5 minutes kept it awake 24/7).
locals {
  jobs = {
    "va-watchdog"      = { schedule = "*/15 * * * *", path = "/api/cron/watchdog" }
    "va-founding"      = { schedule = "0 6 * * *", path = "/api/cron/founding" }
    "va-grants"        = { schedule = "30 6 * * *", path = "/api/cron/grants" }
    "va-credit-alerts" = { schedule = "15 * * * *", path = "/api/cron/credit-alerts" }
    "va-archive"       = { schedule = "*/15 * * * *", path = "/api/cron/archive" }
    "va-lifecycle"     = { schedule = "0 * * * *", path = "/api/cron/lifecycle" }
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
