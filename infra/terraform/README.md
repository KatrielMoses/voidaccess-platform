# infra/terraform

Root module plus `modules/{app,runner,scheduler,iam}`. Existing resources (service accounts, secrets, runs bucket) are data sources.

## One-time: state bucket

```bash
export CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess
gcloud storage buckets create gs://voidaccess-cloud-tfstate --project=voidaccess-cloud \
  --location=us-central1 --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update gs://voidaccess-cloud-tfstate --versioning
```

## Use

```bash
export CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess
cd infra/terraform
terraform init && terraform validate && terraform plan
```

## Deploy the app shell

```bash
# from the repo root: build with Cloud Build, then create/update the service
gcloud builds submit --config apps/app/cloudbuild.yaml --substitutions=_COMMIT_SHA=$(git rev-parse --short HEAD) .
terraform -chdir=infra/terraform apply -target=module.iam -target=module.app
```

## Decisions

- **Image drift:** `lifecycle.ignore_changes` covers the container image on `va-app`, so
  `gcloud run deploy` / Cloud Build deploys do not show as drift. `va-runner` is the opposite: its image is the release
  (`runner:<engine-sha>-<runner-sha>`), set by `-var runner_image=...`, and Terraform tracks it. `app_image_tag` only matters at creation.
  Update later with `gcloud run deploy va-app --image ...:<tag> --region us-central1`.
- **`enable_database_url`** (default false): the `database-url` secret has no version until Neon is set up.
  A secret env reference to a version-less secret stops the revision from starting. Add a version, then
  `terraform apply -var enable_database_url=true`. Until then `/api/health` reports `db: unconfigured`.
- **Scheduler** jobs are created `paused = true`, and `paused` is ignored afterwards so un-pausing by hand sticks.
  Auth is OIDC as `va-app` against `/api/cron/{watchdog,founding,grants}`.
- **IAM** is resource-level only (`modules/iam`: secretAccessor on the three secrets for `va-app`, two for `va-runner`;
  `objectViewer` on `voidaccess-cloud-runs` for `va-app`), plus `allUsers` `run.invoker` on `va-app`
  (`allow_unauthenticated`), which `/api/health` needs. Set `-var manage_iam=false` to skip all of it.
- `va-runner` already has a manual `secretAccessor` on `openrouter-api-key` from `gcp-iam.sh`; the Terraform binding is additive.
- **Runner (R0):** 1 vCPU / 2 GiB, task timeout 900 s, no retries. Its only secret env is `OPENROUTER_API_KEY`; the
  per-run callback secret comes in the RunSpec (the root `ENGINE_CALLBACK_SECRET` is not given to the runner, and its
  Terraform `secretAccessor` binding was removed). `va-runner` gets a resource-level `run.invoker` on `va-app`
  (`modules/app`) to fetch the spec and post callbacks. `va-app` runs the job: `run.developer` at project level, plus
  `iam.serviceAccountUser` on `va-runner` (actAs), which is a service-account-level binding.
