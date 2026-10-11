# Bootstrap (one-time, run by Katriel)

## 1. Billing + GCP resources
Create the new billing account in the Console (Billing → Manage billing accounts → Create). Then run:

```bash
gcloud billing accounts list                     # copy the new account ID
bash platform/infra/bootstrap/gcp-bootstrap.sh <BILLING_ACCOUNT_ID> 25
```

The script does the following:
- links billing
- enables the APIs
- grants va-agent its deploy/operate roles (va-agent can't edit IAM)
- lets you impersonate va-agent
- creates the Artifact Registry repo
- creates the archive bucket (versioned, permanent) and the runs bucket (7-day auto-delete)
- creates the KMS key for credentials
- creates empty secrets
- sets a $25/mo budget alert
- points the `voidaccess` gcloud configuration at va-agent

## 2. Secret values (never paste keys into a chat)
**OpenRouter** (openrouter.ai → Keys):
- `openrouter-api-key`: a normal key **with a credit limit** (e.g. $20). Used by the E0 baseline and the runner.
- `openrouter-provisioning-key`: a provisioning key, so the runner can mint per-run keys with spend caps. Optional until R0.

```bash
export CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess
read -rs K && printf '%s' "$K" | gcloud secrets versions add openrouter-api-key --data-file=- && unset K
read -rs K && printf '%s' "$K" | gcloud secrets versions add openrouter-provisioning-key --data-file=- && unset K
gcloud secrets versions add engine-callback-secret --data-file=<(openssl rand -hex 32)
```

**Neon** (neon.tech → new project `voidaccess`, region AWS us-east-1 or the closest to us-central1):

```bash
read -rs K && printf '%s' "$K" | gcloud secrets versions add database-url --data-file=- && unset K
```

For P0 (agents create branches per environment), also create a Neon API key and keep it in your shell as `NEON_API_KEY`, or as a secret `neon-api-key`.

## 3. Let agents run gcloud without prompting (Claude Code)
Every agent works as **va-agent** through impersonation. It can deploy and operate inside `voidaccess-cloud` only, and it can't change IAM or billing. To stop the approval prompts in agent chats, add this to `platform/.claude/settings.json` and `voidaccess/.claude/settings.json` (or your user settings):

```json
{
  "env": { "CLOUDSDK_ACTIVE_CONFIG_NAME": "voidaccess" },
  "permissions": {
    "allow": ["Bash(gcloud run:*)", "Bash(gcloud builds:*)", "Bash(gcloud artifacts:*)",
              "Bash(gcloud storage:*)", "Bash(gcloud scheduler:*)", "Bash(gcloud logging:*)",
              "Bash(gcloud secrets versions access:*)", "Bash(gcloud config list:*)"],
    "deny":  ["Bash(gcloud projects add-iam-policy-binding:*)", "Bash(gcloud iam:*)",
              "Bash(gcloud billing:*)", "Bash(gcloud config set:*)"]
  }
}
```

There is no local Docker on this Mac. Agents build images with `gcloud builds submit` (Cloud Build), so Docker isn't needed.

## 4. Verify
```bash
CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess gcloud run jobs list --region=us-central1   # empty list, no error
CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess gcloud secrets list
```
