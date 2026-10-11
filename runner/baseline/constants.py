"""Named caps for the E0 harness (no bare magic numbers at call sites)."""

from __future__ import annotations

# Sub-phase spend guards (brief §NON-NEGOTIABLE).
MAX_MATRIX_JOB_EXECUTIONS = 120
MAX_OPENROUTER_USD = 9.0
OPENROUTER_HARD_KEY_LIMIT_USD = 10.0

# Cloud Run Job task timeout (seconds).
TASK_TIMEOUT_SECONDS = 45 * 60

# OpenRouter usage polling after a run.
OPENROUTER_USAGE_SETTLE_POLL_INTERVAL_S = 15.0
OPENROUTER_USAGE_SETTLE_MAX_WAIT_S = 180.0

# Matrix driver
MIN_LIMIT_REMAINING_USD = 0.5          # stop before a run if less than this is left on the key
GCS_RESULT_VISIBILITY_WAIT_S = 3.0     # pause between job exit and reading result.json
SECRET_OPENROUTER_KEY = "openrouter-api-key"

# Cloud Run instance-based (jobs) Tier 1 rates, read from CLOUD_RUN_PRICING_URL on 2026-10-11.
# The driver re-verifies these strings on the live page and aborts if they changed.
CLOUD_RUN_VCPU_PER_S_USD = 0.000018
CLOUD_RUN_GIB_PER_S_USD = 0.000002

# Comparison subsets (vcpu / bypass / model) use the first N queries.
COMPARE_SUBSET_SIZE = 10

# Model comparison: the model the product plans to ship (DeepSeek V4.1 Flash).
FLASH_COMPARE_MODEL = "openrouter/deepseek/deepseek-v4.1-flash"

# GCS layout
GCS_BUCKET = "voidaccess-cloud-runs"
GCS_BASE_PREFIX = "baseline"

# Artifact Registry / Job defaults
GCP_PROJECT = "voidaccess-cloud"
GCP_REGION = "us-central1"
ARTIFACT_REPO = "voidaccess"
IMAGE_NAME = "engine-baseline"
JOB_NAME = "engine-baseline"
RUNNER_SERVICE_ACCOUNT = "va-runner@voidaccess-cloud.iam.gserviceaccount.com"

# Compute pricing placeholders — matrix.run fills from live page fetch.
CLOUD_RUN_PRICING_URL = "https://cloud.google.com/run/pricing"

# Margin rule (Founding Pro $7 / 1600 credits, after Dodo fee ≈ 0.389¢ revenue/credit).
REVENUE_CENTS_PER_CREDIT = 0.389
TARGET_MARGIN = 0.80
MAX_COST_CENTS_PER_CREDIT = REVENUE_CENTS_PER_CREDIT * (1.0 - TARGET_MARGIN)  # ≈ 0.0778

# Parallel wave (redirect 2026-10-11): per-cell wall-clock limits enforced inside the
# entrypoint (a Cloud Run task has one timeout per execution), plus a backstop.
CELL_TIMEOUT_QUICK_STANDARD_S = 30 * 60
CELL_TIMEOUT_DEEP_S = 40 * 60
CLOUD_RUN_TASK_TIMEOUT_BACKSTOP_S = 41 * 60
WAVE_PARALLELISM = 50
WAVE_SPEND_POLL_INTERVAL_S = 120.0
WAVE_MIN_LIMIT_REMAINING_USD = 9.0
WAVE_USAGE_CROSSCHECK_TOLERANCE = 0.10
GCS_WAVE_PREFIX = "baseline/waves"
