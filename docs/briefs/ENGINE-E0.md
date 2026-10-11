BRIEF — Lane ENGINE, Sub-phase E0: Cloud cost and quality baseline

First brief in the ENGINE lane. It measures what a real VoidAccess investigation costs and produces when it runs the way the cloud will run it: one investigation per Cloud Run Job execution, with Tor inside the container and DeepSeek through OpenRouter. The numbers set the credit price per depth for VoidAccess Cloud. **The engine source is not modified in this sub-phase.** The harness lives in the platform repo and runs the engine's existing CLI pipeline. Build only E0.

In parallel: ENGINE E1 (CLI content-safety parity, in ../voidaccess on its own branch). Do not touch ../voidaccess. Read it only.

── CONTEXT ─────────────────────────────────────────────────────────────────────
Work ONLY in /Users/delzyn/Brand/companies/voidaccess/platform (repo KatrielMoses/voidaccess-platform, private). Create branch e0-baseline off main. All new code goes in platform/runner/baseline/.

The engine is at /Users/delzyn/Brand/companies/voidaccess/voidaccess. Build from its local `main`, where Katriel has committed the dev tree as one unpushed snapshot commit. That commit is what we ship. If `git -C ../voidaccess status --short` isn't empty, stop and report. Read:
- its CLAUDE.md and README.md
- voidaccess_cli/commands/investigate.py: `run()`, `_run_investigation`, `DEPTH_PRESETS` at ~:228, and the JSON payload at ~:1377. Page text is not in the JSON; it lives in the run's local SQLite.
- voidaccess_cli/adapters/sqlite.py
- config.py: `MAX_LLM_PAGES_PER_INV`, `MAX_REL_PAGES_PER_INV`, `ENABLE_RELATIONSHIP_EXTRACTION` (~:330-360), and the `*_MAX_RESULTS` caps
- voidaccess/llm.py: `SAFETY_BYPASS_PROMPT` at :23, `get_llm`, `refine_query`, `filter_results`, `generate_summary`
- utils/content_safety.py
- sources/ (the enrichment modules and their env keys)
- docker/Dockerfile.tor and docker/Dockerfile.fastapi (for Tor in a container)
- pacing/README.md

Platform docs to read: docs/ARCHITECTURE.md, docs/ROADMAP.md (the "How cost is balanced" and "Engine changes: re-evaluated" sections), and docs/ENGINE-CONTRACT.md (the cloud policy list G1–G10). The contract's "job mode" is superseded by the runner approach in ROADMAP.md; the cloud policy still applies.

GCP: project voidaccess-cloud, region us-central1. Always use `CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess`, which impersonates va-agent. Never use or modify the default gcloud configuration. Resources that already exist:
- Artifact Registry repo `voidaccess`
- service account `va-runner@voidaccess-cloud.iam.gserviceaccount.com` for job executions
- secrets `openrouter-api-key` and optionally `openrouter-provisioning-key`
- bucket `gs://voidaccess-cloud-runs` (7-day auto-delete)

There is no local Docker. Build images with `gcloud builds submit`.

── NON-NEGOTIABLE GUARANTEES ───────────────────────────────────────────────────
1. **No secrets leave their place.** The engine's `.env` is never copied into a build context, image, log or report. The build context is a staged copy of ../voidaccess with `.env`, `.env.*` (except `.env.example`), `investigations/`, `*.db`, `chroma_db/`, `.git/` and `__pycache__/` excluded. Verify the exclusion before the first build and print the check. API keys reach the container only through Secret Manager references on the Cloud Run Job.
2. **Engine source is untouched.** No edits under ../voidaccess. Behaviour is configured only through env vars and CLI flags. The one exception is the safety-bypass prompt: the harness entrypoint sets `voidaccess.llm.SAFETY_BYPASS_PROMPT = ""` before the pipeline is imported or used. Verify that the override actually takes effect (grep the rendered prompt in a dry run), because module-level string reuse can defeat it.
3. **Cloud policy in effect for every measured run:**
   - content-safety gates on
   - the engine's own shared-corpus features off (`PRIVATE_MODE=1`, no Meilisearch, no Chroma)
   - no media
   - Tor client only: no relay or exit configuration in torrc
4. **Legitimate queries only.** The query set covers organisations, ransomware and extortion groups, malware families, CVEs, public IOCs (domains, onion services, wallets published in public threat reports) and threat-actor handles already named in public reporting. **No private individuals and no personal names.** Commit the list as `queries.yaml`, with a one-line public-source note per query, before any run.
5. **Bounded spend.** Hard caps for the whole sub-phase: ≤ 120 job executions, ≤ $9 of OpenRouter usage (the key itself has a $10 hard limit, so stop before it trips), and a 45-min task timeout. Check `GET /api/v1/key` `limit_remaining` before each run, and stop and report if any cap would be exceeded.

── DELIVERABLES ────────────────────────────────────────────────────────────────
**D1. Container image** `us-central1-docker.pkg.dev/voidaccess-cloud/voidaccess/engine-baseline:<engine-tree-hash>`
- The engine is installed from the staged working tree, with the `nlp` extra only if the CLI needs it for NER. Record the image size.
- The Tor client runs inside the container. Bake a recent consensus/cache into the image if that measurably cuts bootstrap time.
- The entrypoint is `python -m baseline.run_one`.
- Record the engine snapshot identity in the report: `git -C ../voidaccess rev-parse main`. Stage the build context from `git -C ../voidaccess archive main`; this automatically excludes untracked files and `.env`.

**D2. Depth presets** in `presets.yaml`, mapping our names onto engine settings:

| Our depth | CLI depth | Engine caps | Other |
|---|---|---|---|
| quick | `--depth shallow` | low LLM page caps | relationship extraction off |
| standard | `--depth normal` | engine defaults | |
| deep | `--depth deep` | raised `MAX_LLM_PAGES_PER_INV` / `MAX_REL_PAGES_PER_INV` / result caps | crawler, if the CLI path supports it; otherwise note that it doesn't |

Document exactly which env vars and flags each preset sets.

**D3. `run_one`** (one job execution = one investigation):
- Reads `QUERY_ID` + `DEPTH` from env and looks up the query in the baked `queries.yaml`, so query text is never in job args.
- Starts Tor and measures bootstrap ms.
- Runs the CLI pipeline with `--format json`.
- Then reads the run's local SQLite to collect page count, bytes fetched and per-stage timings where available.
- Writes `result.json` to `gs://voidaccess-cloud-runs/baseline/<run_id>/`:
  - the CLI JSON as-is
  - a metrics block: duration_ms, tor_bootstrap_ms, stage timings, pages, entities by type, relationships by type, actors, llm_calls (from `investigation_step_metrics` if the CLI persists it), exit status, refusal flags
- **Refusal detection:** look for model outputs that decline, or empty extraction/summary where pages existed. Record every case.

**D4. LLM cost per run**
- **Preferred:** if the `openrouter-provisioning-key` secret has a version, mint a per-run OpenRouter key with a $1 limit, run with it, read its usage after a settle delay (poll until stable), then delete it. This also validates the production approach.
- **Fallback (the current state: the provisioning secret has no version):** run measured cells **one at a time** and take the delta of `GET https://openrouter.ai/api/v1/key` usage on the shared key. Expect several hours of wall time for the full matrix. Run the quick depth first, so partial results are useful early. Up to 6 concurrent executions are allowed only for cells that don't need a cost measurement, such as the vCPU comparison reruns, and only if per-run keys are available.
- Record the model ID actually used. Use the engine's default DeepSeek route through OpenRouter. If a cheaper DeepSeek "flash" variant is listed on OpenRouter, run the standard depth on 10 queries with it as a comparison.

**D5. Compute cost per run**
- Cost = (vCPU × duration × $/vCPU-s) + (GiB × duration × $/GiB-s). Use the Cloud Run instance-based rates **read from the live pricing page on the day of the run**; record the URL and the rates.
- Run standard depth at both 1 vCPU / 2 GiB and 2 vCPU / 4 GiB on 10 queries to find the cheaper configuration that doesn't slow runs by more than 20%.

**D6. Matrix runner** `python -m baseline.matrix`
- Creates and updates the Cloud Run Job `engine-baseline`, runs 30 queries × 3 depths within the caps, collects every `result.json`, and writes `results.csv` + `results.jsonl`.
- Re-runnable: skips completed `(query, depth, config)` cells.

**D7. Report** `platform/docs/baseline/E0-REPORT.md`:
- p50/p90/max per depth for: duration, Tor bootstrap, pages, entities, relationships, LLM calls, LLM $, compute $, total $.
- **Typed-relationship check (roadmap item #7).** Do bundles contain typed edges such as group → victim org (from LLM relationship extraction or ransomware.live enrichment)? Give 3 concrete examples from the data, or state that none exist.
- **Refusal rate** with the bypass prompt removed. Run a 10-query subset with it left in, for comparison only, and say whether removing it hurts output.
- **Progress-hook feasibility (roadmap item #6).** Can a runner observe stage progress by wrapping `voidaccess_cli.display` without engine edits? Show a working proof or explain why it is fragile.
- **Enrichment licence table.** For every source in sources/, list: env key, whether it works keyless, free-tier limits, whether its ToS allows commercial use on our keys (link the ToS clause), and a recommendation: on our keys / BYO only / off.
- **Recommended credits per depth.** Founding Pro is $7 for 1,600 credits. After the payment fee (4% + $0.50) that is ≈ 0.389¢ of revenue per credit. ≥ 80% margin means cost must be ≤ 0.0778¢ per credit, so `credits(depth) = ceil(p90_total_cost_cents / 0.0778)`. Show the result next to the PRD strawman (10 / 25 / 60) and propose the final numbers and per-depth caps.

**D8.** `platform/runner/baseline/README.md`: how to build, run one, run the matrix, and read the report.

── ACCEPTANCE CRITERIA ─────────────────────────────────────────────────────────
- `python -m baseline.run_one` succeeds for one quick run in Cloud Run Jobs and writes result.json.
- The full matrix completes within the caps. results.csv has ≥ 85 successful cells. Failures are listed with their cause.
- E0-REPORT.md answers every item in D7 with numbers.
- A grep of the image layers and the build context shows no `.env` and no key material.
- ../voidaccess is unchanged: `git -C ../voidaccess status --short` is empty before and after, and `main` points at the same commit.

── CONSTRAINTS ─────────────────────────────────────────────────────────────────
- Python 3.11 in the image. Pin dependencies. Justify any dependency beyond the engine's own plus `google-cloud-storage`, `google-cloud-run`, `httpx` and `pyyaml`.
- Follow the engine's pacing rule inside the harness: no hard-coded timeouts or retries without a named constant.
- Never print secret values. Never commit results that contain page text. results.* holds metrics and entity *counts* only; raw CLI JSON stays in the bucket.
- Don't create GCP resources beyond the Cloud Run Job `engine-baseline` and objects under `gs://voidaccess-cloud-runs/baseline/`. Delete the job when done unless the report says R0 should reuse it.
- Commit messages: plain, conventional, NO AI/assistant attribution of any kind. Push the branch to origin; don't merge.

── OUT OF SCOPE (later briefs) ─────────────────────────────────────────────────
- the production runner, callbacks, bundle schema and per-run key minting in production (R0)
- platform DB and app (P0+)
- engine edits (E1, E1b, E1c)
- the archive (P4)

── HANDOFF (reply with this when done) ─────────────────────────────────────────
- the image tag + engine snapshot identity
- the preset table as run
- the headline cost table (p50/p90 per depth) and recommended credits per depth
- the cheaper vCPU/memory configuration
- typed-relationship findings with examples
- refusal-rate findings
- progress-hook verdict (adapter works / needs engine hook)
- the licence table summary
- every deviation from this brief with its reason
- notes for R0, whose owner reuses the image, entrypoint and presets
