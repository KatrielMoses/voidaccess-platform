BRIEF — Lane RUNNER, Sub-phase R0: Production runner (one Cloud Run Job execution per investigation) and the app's Cloud Run launcher

First production brief in the RUNNER lane. E0 and E1B proved the engine runs well in a disposable Cloud Run container. R0 turns that harness into the production runner:
- fetch the single-use run spec
- run the engine with the cloud profile
- stream signed progress events to the app
- build a contract-valid result bundle
- upload the artifacts
- stop cleanly on cancel or deadline

On the app side, R0 replaces P2's `CloudRunLauncher` stub with the real launcher and gives the app production readers for the artifacts.

Build only R0.

In parallel: RESULTS (P3) in `.worktrees/p3` (bundle ingest and the results UI). Never touch `packages/ingest/`, `apps/app/features/results/**`, the results routes, `apps/app/lib/runs/ingest.ts` (P3's hook gets wired by the architect), `apps/site/`, `runner/baseline/` (the measurement harness stays as it is; copy from it, don't edit it), or `../voidaccess` (the engine is published at `bf2213c`; propose any engine change in the handoff instead of making it).

── CONTEXT ─────────────────────────────────────────────────────────────────────
Work ONLY in `/Users/delzyn/Brand/companies/voidaccess/platform/.worktrees/r0` (git worktree, branch `r0-runner`, created from `main`). Run `pnpm install` first. First push: `git push -u origin r0-runner`. **Never push to `main`.**

Parallel-safe local setup: databases `voidaccess_r0_dev` and (for tests) `VA_TEST_DB=voidaccess_r0_test`; app dev server on **port 3300**. Never touch other lanes' databases.

GitHub Actions is blocked by account billing, so run the CI steps locally and report them (`pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @voidaccess/db db:check`, plus the runner's Python tests). When you gate on a command, check its exit code. Don't pipe it through `tail` or `grep` and trust the result.

Read first:
- `docs/ENGINE-CONTRACT.md` v0.3: RunSpec, callbacks and signing, ProgressEvent, ResultBundle, and the cloud policy G1–G10
- `docs/ARCHITECTURE.md` §2–3 (the one-run-per-container design and the infrastructure)
- `docs/baseline/E0-REPORT.md` and `docs/baseline/E1B-REPORT.md` (the notes for R0 at the end of each)
- `runner/baseline/` in full:
  - `presets.yaml`: the `cloud_profile` env and the per-depth presets
  - `policy.py`, `tor_service.py`, `llm_usage.py` (the token-counting `get_llm` wrapper), `metrics.py`
  - `Dockerfile` and `cloudbuild.yaml`, `scripts/prepare_build_context.sh`
- `packages/engine-client` (zod schemas and `schemas/*.json`, HMAC signing, the masking and fingerprint functions)
- the app's run plumbing from P2:
  - `apps/app/lib/launcher/` (`types.ts`, `index.ts`, `cloudrun.ts` stub, `mock.ts`, `artifacts.ts`)
  - `apps/app/lib/runs/spec.ts` (how the RunSpec is built), `callbacks.ts`, `settle.ts`, `secrets.ts`
  - `apps/app/env.ts`
- the engine's progress hook: `../voidaccess/progress/README.md` (`CallbackSink`, the event shape, stage order extract-before-enrich), plus `../voidaccess/voidaccess_cli/commands/investigate.py` for how a run is driven
- `infra/terraform/modules/runner` (the `va-runner` job, created but not applied) and `modules/iam`
- PRD §6 (non-functional requirements), pasted at the end of this brief

GCP: project `voidaccess-cloud`, region `us-central1`, always `CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess` (impersonates `va-agent`, which has no project-IAM rights). Relevant resources:
- the `va-runner` service account (already has `objectCreator` on `gs://voidaccess-cloud-runs` and can read the `openrouter-api-key` and `engine-callback-secret` secrets)
- the `va-app` service account (`run.developer` at project level, read access on the runs bucket, `cryptoKeyEncrypterDecrypter` on the credentials key)
- the app service `va-app` (private, `allow_unauthenticated=false`; its database is not configured yet)
- Artifact Registry `voidaccess`, and the bucket `gs://voidaccess-cloud-runs` (7-day lifecycle)
- **The engine version to ship is the public commit `bf2213c`** (E1 safety parity, E1B speed and progress hook). Build from that commit, not from a working tree.

── NON-NEGOTIABLE GUARANTEES ───────────────────────────────────────────────────
1. **The query never leaves the spec.** The launcher passes only `SPEC_URL`, `RUN_ID` and `DEADLINE_AT` as execution overrides. The runner fetches the RunSpec once and never logs the query, the callback secret or page text. A test greps the runner's log output from a real run for the query string and the secret, and fails if either appears.
2. **Cloud policy G1–G10 holds in every run.**
   - Content-safety gates stay on; `VOIDACCESS_SAFETY_BYPASS_PROMPT=off`.
   - `VOIDACCESS_PRIVATE_MODE=1`, with no Meilisearch and no Chroma.
   - The `cloud_profile` env and the licensed enrichment allowlist are in effect.
   - No media, and Tor runs as a client only.
   - A blocked query emits `failed` with reason `blocked_query` before any collection starts.
   - Exit codes follow G10.
3. **Every run ends with exactly one terminal event:** `completed` (sent only after the bundle upload succeeded), `failed` with a reason, or `cancelled` with `stages_completed`. This holds for a crash in the engine, SIGTERM (cancel), the deadline and the hard wall-clock cap. A crash that kills the process is covered by the app's watchdog. Don't rely on it for anything the runner can catch.
4. **Callbacks are signed per contract.** Each one is HMAC-signed with the run's `callback_secret` over `"<timestamp>.<raw body>"`, uses a strictly increasing `seq`, and is retried with backoff on 5xx or network errors. Events are never dropped, except intermediate `counts` events when the queue is full. A slow app never blocks the pipeline.
5. **No sensitive raw values leave the container.**
   - The bundle carries only masked `display_value`s plus fingerprints for sensitive entities, using the same masking rules as `packages/engine-client`.
   - Raw secrets and passwords appear as `len:N sha256:<8-hex prefix>` only.
   - Source excerpts are at most 500 characters, sanitized by the engine's own sanitizer.
   - A test runs the bundle builder on a fixture with planted credentials and asserts that none survives.
6. **Bounded cost.** Each run has three hard limits:
   - a wall-clock cap per depth (quick 8 min, standard 10 min)
   - a per-run LLM token budget enforced by the usage wrapper: after the budget is spent, further LLM calls raise and the engine falls back to its non-LLM paths and fallback summary
   - `VOIDACCESS_LLM_CHUNK_TIMEOUT`

   Report the budget you chose and why, from the E0 and E1B data.

── DELIVERABLES ────────────────────────────────────────────────────────────────
**N1. `runner/cloud/` (Python 3.11 package plus image)**
- **Entrypoint:** `python -m cloud.run`. It reads `SPEC_URL`, `RUN_ID` and `DEADLINE_AT`, then fetches the spec with an identity token for the app's audience (the app is private; use the metadata server, no extra dependency). It validates the spec against `RunSpec.json`.
- **Tor:** start the client with a baked consensus, retry bootstrap twice, and add a small random start jitter of 0–5 s against bursts.
- **Run the engine pipeline** from the installed engine at `bf2213c`:
  - apply `cloud_profile` and the depth preset from `presets.yaml` (copy them into `runner/cloud/`; don't import from `baseline`)
  - attach the engine's `CallbackSink` to a signed, retrying event sender (guarantee 4)
  - use the token-counting `get_llm` wrapper (copied from the baseline) for `RunMetrics` and the budget guard
- **Bundle builder:** turns the CLI JSON plus the run's local SQLite into a `ResultBundle` (`schema_version: 1`), validated against `ResultBundle.json` before upload. It covers:
  - entities with types, confidence, `source_ids` and the sensitive flag; relationships with evidence source ids; actors; communities
  - sources with kind, name, URL (text only), `fetched_at` and the sanitized excerpt
  - the summary with `summary_kind`
  - `RunMetrics` (duration, Tor bootstrap, per-stage ms, LLM calls and tokens and estimated cost, pages, bytes, enrichment calls)
- **Export artifacts:** STIX, MISP, Sigma, YARA, Snort and Suricata, produced by the engine's own exporters from the run's local database with credentials redacted. Skip a format that fails, and record why in the bundle metrics.
- **Archive input for the future archive lane (P4):** `pages.jsonl.gz`, one line per fetched page, containing the URL, `fetched_at`, the content hash and the **sanitized** text through the engine's `sanitizer.gate`, with credentials and PII redacted. A page the gate drops is omitted. Nothing else.
- **Uploads:** `artifact_put_urls` may be `https://` (presigned or the dev mock route; HTTP PUT) or `gs://voidaccess-cloud-runs/runs/<run_id>/<name>` (production; upload with the runner's own identity). Support both. Upload everything before sending `completed`.
- **Signals:** SIGTERM (cancel) stops at the next stage boundary, uploads nothing, and emits `cancelled` with `stages_completed`. The deadline and wall-clock caps emit `failed` with reason `deadline`.
- **Image:** `Dockerfile` plus Cloud Build config, about 1 vCPU / 2 GiB. **Deep at 1 GiB was never measured, so keep 2 GiB.** The image tag is `runner:<engine-sha>-<runner-git-sha>`. Keep the same build-context secret hygiene as E0: no `.env`, no `*.db`, and a key-pattern scan of the context and the built image.
- **Tests:** pytest for spec validation, signing (cross-checked against vectors produced by `packages/engine-client`), retry and ordering, the bundle builder (schema-valid, masking per guarantee 5), cancel and deadline handling, the budget guard, and the log-leak check.

**N2. App side** (TypeScript, in `apps/app`)
- **`lib/launcher/cloudrun.ts`:**
  - `launch` calls the Cloud Run Admin API v2 `jobs.run` on `va-runner` with container env overrides (`SPEC_URL`, `RUN_ID`, `DEADLINE_AT`) and `taskCount: 1`, and returns the execution name as `executionId`
  - `cancel` calls `executions.cancel`
  - authenticate with the metadata server token on Cloud Run, or ADC locally, using plain `fetch`. P2 found `google-auth-library` doesn't resolve under pnpm from `apps/app`; if you want a library, justify it.
  - map API errors so that a launch failure is a clean failure, which P2's service turns into a full refund
- **`lib/runs/spec.ts`:** when `launcherKind()` is `cloudrun`, `artifact_put_urls` become the `gs://voidaccess-cloud-runs/runs/<run_id>/…` paths (bundle, every export format, `pages`). The mock path is unchanged.
- **`lib/launcher/artifacts-gcs.ts`:** production readers with exactly P3's `IngestDeps` shape: `readBundle(runId): Promise<unknown>` and `readExport(runId, format): Promise<Uint8Array | null>`, reading the runs bucket as `va-app` via the JSON API with `fetch`. **Don't wire them into the ingest hook.** The architect does that when P3 merges.
- **Run cost:** when a terminal event carries `metrics`, write a `run_costs` row (`withSystem("runs.cost")`): compute cost from duration × the configured vCPU and GiB × the Cloud Run rates (constants in one module, with the source URL and date), plus the LLM estimate.
- **Tests:** the launcher against a mocked Admin API (request shape, no query in the overrides, error mapping), the spec URL switch, the GCS readers against a mocked API, and the `run_costs` write.

**N3. Infrastructure**
- Update `infra/terraform/modules/runner`:
  - image variable, 2 GiB, task timeout 15 min, max retries 0
  - secrets as env references: the OpenRouter key, and the callback secret only if the runner needs it (it shouldn't; the per-run secret comes in the spec)
  - the `cloud_profile` env baked in the image, not set by Terraform
- Add a resource-level `run.invoker` binding on the `va-app` service for `va-runner`, so the runner can reach the private app.
- Apply the runner job with your image.
- If an IAM binding is denied to `va-agent` (for example, `actAs` on `va-runner` for `va-app`, which the app needs to run the job), **don't work around it**. List the exact `gcloud` command for Katriel in the handoff.

**N4. Proof in the cloud**
- **Stage 1 (always possible):** deploy a temporary private Cloud Run service `va-r0-receiver` (a tiny Node app built from the existing app's callback and spec code, or a minimal stand-in that serves RunSpecs from fixed test queries and verifies every HMAC event against the contract schemas). Then run **10 real investigations** through the real `va-runner` job:
  - 5 quick and 5 standard, using public queries from `runner/baseline/queries.yaml`
  - 1 cancelled mid-run
  - 1 with an already-expired deadline
  - 1 blocked query (use the engine's test marker approach from its content-safety tests, not real prohibited text)

  Check every bundle validates, every export and `pages.jsonl.gz` exists, the event streams are complete and correctly ordered, and the terminal events are right. Report durations, LLM and compute cost per run, and peak memory. **Delete the receiver afterwards.**
- **Stage 2 (only if `database-url` has a secret version):** deploy `va-app` with the database and `ENGINE_LAUNCHER=cloudrun`, then do one real Quick run end to end through the app API as a test user (sign up through the API, verify via the log, start, wait, check the status and ledger). If the database isn't configured, report Stage 2 as blocked. That isn't a failure of R0.

── ACCEPTANCE CRITERIA ─────────────────────────────────────────────────────────
- The local CI steps and the runner's pytest suite pass, with exit codes checked.
- Stage 1: 10 of 10 runs end with the correct terminal event; every completed bundle validates against `ResultBundle.json`; all artifacts are present; there are no gaps or duplicates in `seq`.
- The log-leak check passes on real cloud logs: no query text or secret in Cloud Logging for those runs.
- The planted-credential test passes, and a scan of the 10 real bundles finds no raw credential patterns.
- Cost and duration per run are reported and sit within the E1B ranges, or the gap is explained.

── CONSTRAINTS ─────────────────────────────────────────────────────────────────
- Justify every dependency, Python and Node.
- Don't change the engine. If you need an engine change, propose it in the handoff with the reason.
- Don't edit P2's lifecycle semantics (`settle.ts`, `callbacks.ts` state machine); you may add the `run_costs` write next to them. Don't edit architect-owned paths (`packages/config`, `tokens.css`, root workspace files except adding devDependencies, `docs/`), or P3's paths.
- Use only `va-agent` rights. Never print secrets. Results files hold metrics and counts only.
- Commit messages: plain, conventional, NO AI/assistant attribution of any kind.
- Push `r0-runner` only. **Don't merge.** The architect reviews and merges.

── OUT OF SCOPE (later briefs) ─────────────────────────────────────────────────
- ingesting bundles into the database and the results UI (P3)
- the archive ingest from `pages.jsonl.gz` (P4)
- sealed raw credentials for the verified-owner unmask feature (later, with the unmask feature itself)
- monitors and scheduled re-runs (P8)
- making the app public and mapping `app.voidaccess.pro` (deploy brief)
- the engine API path emitting progress events

── HANDOFF (reply with this when done) ─────────────────────────────────────────
- the runner's flow and module layout
- the image tag and size
- the RunSpec and artifact URL handling (https vs gs)
- signing and retry behaviour
- the bundle builder mapping (CLI JSON and SQLite → ResultBundle fields), with any fields left empty and why
- the masking evidence
- the token budget and the caps you chose, with reasons
- the launcher's API calls and auth
- the GCS readers' signatures for P3
- the `run_costs` formula and rate constants
- Terraform resources applied
- any IAM commands Katriel must run
- Stage 1 results: a table per run (depth, duration, bootstrap, pages, entities, LLM tokens and cost, compute cost, peak memory, terminal event)
- the Stage 2 result or the blocker
- the log-leak evidence
- local CI and pytest output
- proposed engine changes, if any
- every dependency with its reason
- deviations with reasons

── APPENDIX: PRD section 6 (Non-functional requirements) ───────────────────────
(Verbatim from PRD v1.0, 2026-10-11.)

## 6. Non-functional requirements
- **Isolation (critical, given the engine's audit history):** a user can **never** see another user's investigations, entities, actors, monitors, exports or search results, including via shared caches, vector search or IDs in URLs. Must be tested explicitly before launch.
- **User safety:** all dark-web traffic originates from our infrastructure; **nothing is fetched from the user's browser or IP.** No dark-web HTML is rendered in the browser.
- **Abuse controls:** per-account rate limits; email verification; AUP acceptance; prohibited-query filtering (on by default, not user-configurable); logging of queries for abuse review; ability to ban.
- **Data retention:** clear default (e.g. investigation data kept while account is active; deleted on account deletion); state it on `/trust`.
- **Security basics:** HTTPS everywhere, secure session handling (no tokens readable by JavaScript), encrypted secrets and BYO keys, 2FA (P1).
- **Reliability:** runs survive page refreshes and deploys; failed runs auto-refund credits; status visible to the user.
- **Performance:** dashboard pages load fast; the graph stays usable up to at least a few thousand nodes (with filtering).
- **Accessibility:** readable contrast, keyboard navigation for main flows.
- **Observability:** per-investigation cost and duration logged (feeds admin cost view and credit pricing).
