# E0 baseline report

**Engine snapshot:** `f7b85fa937f92c22a3f219343492f29e529395c4` (`main` at prepare time)  
**Image tag:** `us-central1-docker.pkg.dev/voidaccess-cloud/voidaccess/engine-baseline:f7b85fa937f92c22a3f219343492f29e529395c4`  
**Status:** Matrix pending — run `python -m baseline.matrix` after image build; then refresh stats via `python -m baseline.report`.

---

## Preset table (as run)

| Cloud depth | CLI `--depth` | Env / flags |
|---|---|---|
| quick | shallow | `ENABLE_RELATIONSHIP_EXTRACTION=false`, `MAX_LLM_PAGES_PER_INV=3`, `MAX_REL_PAGES_PER_INV=3`, `PASTE/GITHUB/GITLAB_MAX_RESULTS=5`; harness patches CLI LLM page cap |
| standard | normal | Engine defaults |
| deep | deep | `MAX_LLM_PAGES_PER_INV=20`, `MAX_REL_PAGES_PER_INV=15`, paste/github/gitlab max 25; **no CLI crawler** |

---

## Headline cost table (p50 / p90 USD)

| Depth | Duration p50/p90 | Tor bootstrap p50/p90 | Pages p50/p90 | LLM $ p50/p90 | Compute $ p50/p90 | Total $ p50/p90 |
|---|---|---|---|---|---|---|
| quick | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| standard | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| deep | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |

Cloud Run rates source: [Cloud Run pricing](https://cloud.google.com/run/pricing) (us-central1 instance billing; matrix defaults vCPU $0.000018/s, GiB $0.000002/s unless overridden by live scrape).

---

## Recommended credits per depth

Formula: `credits = ceil(p90_total_cost_cents / 0.0778)` (80% margin at Founding Pro net ≈ 0.389¢/credit).

| Depth | p90 cost | Credits (formula) | PRD strawman |
|---|---|---:|---:|
| quick | _pending_ | _pending_ | 10 |
| standard | _pending_ | _pending_ | 25 |
| deep | _pending_ | _pending_ | 60 |

---

## vCPU / memory comparison (standard, 10 queries)

| Config | p50 duration | vs 1 vCPU / 2 GiB | Cheaper at p90? |
|---|---|---|---|
| 1 vCPU / 2 GiB | _pending_ | baseline | — |
| 2 vCPU / 4 GiB | _pending_ | _pending_ | _pending_ |

---

## Typed relationships (roadmap #7)

_pending — inspect `metrics.typed_relationship_samples` and relationship types in GCS `result.json` files after matrix. Expect typed edges from `extractor/relationship_extract.py` and ransomware.live enrichment pages when relationship extraction is enabled (standard/deep).

---

## Refusal rate (bypass off vs on)

| Cohort | Runs | Refusal flags | Notes |
|---|---:|---:|---|
| default (`SAFETY_BYPASS` cleared) | 90 | _pending_ | Primary matrix |
| bypass comparison (10 queries, standard) | 10 | _pending_ | `SAFETY_BYPASS=1` |

---

## Progress hook (roadmap #6)

**Verdict:** adapter **works** for stage-level progress without engine edits.

Proof module: `runner/baseline/progress_hook.py` wraps `voidaccess_cli.display.InvestigationDisplay.update_step` and records `(step, status, detail)` events. Fragility: breaks if display class is refactored, if `--quiet` skips updates, or if Rich live display is bypassed; no seq numbers or cancellation checkpoints.

---

## Enrichment licence summary

| Source module | Env key(s) | Keyless? | Commercial on our keys | Recommendation |
|---|---|---|---|---|
| ransomware.live | — | Yes (public API) | API terms — verify before production scale | On our keys (keyless) |
| abuse.ch / MB/TF/UH | `ABUSECH_API_KEY` | Partial | [abuse.ch terms](https://abuse.ch/) — non-commercial research framing; verify commercial | BYO or keyless tier only |
| OTX | `OTX_API_KEY` | No | [AlienVault OTX terms](https://otx.alienvault.com/) | BYO |
| VirusTotal | `VT_API_KEY` | No | [VT ToS](https://www.virustotal.com/gui/terms-of-service) — commercial needs paid | BYO only |
| Shodan InternetDB | — | Yes | [Shodan ToS](https://shodan.io/terms) | On our keys (InternetDB) |
| NVD / EPSS / CISA feeds | `NVD_API_KEY` optional | Yes | US gov data / NVD terms | On our keys |
| GitHub / GitLab search | `GITHUB_TOKEN`, `GITLAB_TOKEN` | Rate-limited without | [GitHub ToS](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) | BYO tokens for scale |
| Paste scrapers | toggles | Yes | Target site ToS varies | On our keys (keyless), monitor |
| ScrapingAnt | `SCRAPINGANT_*` | No | [ScrapingAnt ToS](https://scrapingant.com/terms) | Off in cloud default |
| HIBP / EmailRep / etc. | `HIBP_API_KEY`, `EMAILREP_API_KEY` | Partial | Provider ToS | BYO |
| Blockchain | `BLOCKCYPHER_TOKEN`, `ETHERSCAN_API_KEY` | Partial | Provider ToS | BYO optional |

Full per-file audit: re-run against `voidaccess/sources/*.py` before R0 production keys.

---

## Deviations

1. **voidaccess working tree not clean** during E0 (parallel E1 edits). Image stages **`git archive main`** only (`f7b85fa…`); uncommitted E1 files are not in the build context.
2. **CLI `MAX_LLM_PAGES_PER_INV`**: harness monkeypatches `extract_entities_from_pages` (platform-only); engine tree unchanged.
3. **OpenRouter provisioning key**: fallback shared-key delta metering until provisioning secret has a version.
4. **Matrix / report numbers**: pending Cloud Build + Job executions (this document updated after `baseline.matrix` completes).

---

## R0 notes

- Reuse image `engine-baseline:<engine-git-sha>`, entrypoint `python -m baseline.run_one`, env `QUERY_ID` + `DEPTH` + `RUN_ID`, secrets via Secret Manager, artifacts under `gs://voidaccess-cloud-runs/baseline/`.
- Promote `presets.yaml` to `packages/config` depth caps when R0 runner ships.
- Replace shared-key cost delta with per-run OpenRouter provisioning keys when secret is populated.
