variable "project_id" { type = string }
variable "region" { type = string }
variable "domain" { type = string }
variable "service" { type = string }

# Cloud Run domain mapping. The caller (va-agent) must be a verified owner of the domain in Search Console.
# Google issues the certificate once the DNS-only CNAME (grey cloud) to ghs.googlehosted.com resolves.
resource "google_cloud_run_domain_mapping" "app" {
  location = var.region
  name     = var.domain

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = var.service
  }
}

output "records" {
  value = google_cloud_run_domain_mapping.app.status[0].resource_records
}
