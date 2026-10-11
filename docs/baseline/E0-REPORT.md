# E0 baseline report: VoidAccess Cloud cost and quality

**Engine snapshot:** `d384b1e3c32ceb4c3763554969822c579c3e6762` (`main`, includes the merged E1 safety-parity work; tree clean before and after)
**Image:** `us-central1-docker.pkg.dev/voidaccess-cloud/voidaccess/engine-baseline:d384b1e3c32ceb4c3763554969822c579c3e6762` (about 286 MB compressed; Python 3.11; Tor client with a baked consensus cache; no `nlp` extra, spaCy `en_core_web_sm` only)
**Model used:** `openrouter/deepseek/deepseek-chat` (the engine default; OpenRouter served it as `deepseek/deepseek-chat`)
**Dates:** 2026-10-11. Data: `runner/baseline/results.csv` / `results.jsonl` (metrics and counts only); raw CLI JSON stays in `gs://voidaccess-cloud-runs/baseline/`.

## 1. Result in five lines

- **87 of 90 main cells succeeded** (acceptance asks for 85), plus all 10 vCPU, 10 flash and 9 of 10 bypass comparison cells. Zero cells hit the 30/40-minute timeouts.
- **Cost per run is 1.1 to 2.5¢ at p50 and 1.3 to 3.6¢ at p90.** Compute is about half of a quick run's cost, so the cost does not scale with depth the way the strawman assumed.
- **Wall time barely depends on depth:** p50 282 s (quick), 307 s (standard), 326 s (deep). Depth changes LLM calls (7 / 22 / 28), not duration. See section 7.
- **Recommended credits:** quick 18, standard 40, deep 48. The strawman (10 / 25 / 60) under-prices quick and standard and over-prices deep.
- **The token-based cost estimate over-reads the real bill by about 25%** (outside the requested ±10% check, explained in section 3), so the credit numbers are conservative.

**Secret hygiene (acceptance):** the staged build context was checked before the build (no `.env`, `*.db`, `.git`, `chroma_db`, `__pycache__` or key-shaped strings), and the built image was scanned afterwards with a Cloud Build step: no `.env` files, no `*.db` in `/app`, no key-shaped strings under `/app`, `/root`, `/etc`, `/home`. API keys reach containers only through the Secret Manager reference on the job.

## 2. Presets as run

| Our depth | CLI `--depth` | Env set by the preset |
|---|---|---|
| quick | shallow | `ENABLE_RELATIONSHIP_EXTRACTION=false`, `MAX_LLM_PAGES_PER_INV=3`, `MAX_REL_PAGES_PER_INV=3`, `PASTE_MAX_RESULTS=5`, `GITHUB_MAX_RESULTS=5`, `GITLAB_MAX_RESULTS=5` |
| standard | normal | engine defaults (`MAX_LLM_PAGES_PER_INV=10`, `MAX_REL_PAGES_PER_INV=10`) |
| deep | deep | `MAX_LLM_PAGES_PER_INV=20`, `MAX_REL_PAGES_PER_INV=15`, `PASTE/GITHUB/GITLAB_MAX_RESULTS=25` |

Every run also sets `VOIDACCESS_PRIVATE_MODE=1`, no Meilisearch host, a throwaway Chroma path, `PLAYWRIGHT_ENABLED=false`, content safety on, `VOIDACCESS_SAFETY_BYPASS_PROMPT=off`. Tor is client-only (`SocksPort` and `DataDirectory`, no relay or exit options). No enrichment API keys were configured, so enrichment ran keyless.

Notes: the CLI investigate path **ignores `MAX_LLM_PAGES_PER_INV`** (it never passes `max_llm_pages`), so the harness wraps `extractor.pipeline.extract_entities_from_pages` to honour it. The CLI path **does not run the recursive crawler** (`crawler/spider.py` is API-only), so "deep" here means higher caps, not crawling.

## 3. Headline cost table (default model, 1 vCPU / 2 GiB)

| Metric (p50 / p90 / max) | quick | standard | deep |
|---|---|---|---|
| n (successful cells) | 30 | 29 | 28 |
| Duration (s) | 282.3 / 327.9 / 456.3 | 306.7 / 348.9 / 365.1 | 326.4 / 385.6 / 488.0 |
| Tor bootstrap (s) | 5.0 / 19.4 / 143.2 | 6.0 / 11.6 / 50.1 | 5.9 / 59.5 / 162.2 |
| Pages | 20.0 / 32.2 / 41.0 | 21.0 / 31.2 / 34.0 | 20.5 / 30.3 / 36.0 |
| Entities | 122.0 / 167.1 / 375.0 | 119.0 / 265.8 / 397.0 | 139.5 / 220.2 / 418.0 |
| Relationships | 78.5 / 170.9 / 205.0 | 72.0 / 181.6 / 244.0 | 114.5 / 180.9 / 218.0 |
| LLM calls | 7.0 / 8.0 / 8.0 | 22.0 / 27.2 / 29.0 | 28.0 / 37.0 / 43.0 |
| LLM $ | 0.0048 / 0.0060 / 0.0097 | 0.0155 / 0.0225 / 0.0237 | 0.0182 / 0.0284 / 0.0318 |
| Compute $ | 0.0062 / 0.0072 / 0.0100 | 0.0067 / 0.0077 / 0.0080 | 0.0072 / 0.0085 / 0.0107 |
| Total $ | 0.0110 / 0.0126 / 0.0197 | 0.0227 / 0.0297 / 0.0303 | 0.0246 / 0.0359 / 0.0395 |

Cloud Run rates, read from the live page on 2026-10-11 ([cloud.google.com/run/pricing](https://cloud.google.com/run/pricing), instance-based billing, Tier 1 region): **$0.000018 per vCPU-second, $0.000002 per GiB-second**. Compute = vCPU x seconds x rate + GiB x seconds x rate, using the in-container duration (container start-up time is not included; the 50-way burst took about 1m47s to start).

**LLM cost method.** Per-call prompt and completion tokens are recorded by a LangChain callback attached by wrapping `voidaccess.llm.get_llm` (no engine edits), then priced at the live per-token list price from `GET /api/v1/models`. The first 6 quick cells ran sequentially before the redirect and use the measured shared-key delta instead.

**Cross-check against the shared key (requested, ±10%).** Estimated wave total $2.308 against key usage delta $1.851: **the estimate is 24.7% higher, which fails the ±10% bound.** Cause, verified with a small direct test: OpenRouter bills below list price x tokens. `deepseek-chat` via StreamLake billed $0.000654 for a call whose list-price calculation is $0.000813 (-19.5%), and `deepseek-v4.1-flash` billed $0.000205 and $0.000433 on two providers against a $0.000787 list calculation. So the token estimate is a conservative upper bound, and billed cost depends on which provider OpenRouter routes to. The 4 failed tasks (below) used a small, unmeasured amount of the delta, so the true gap is slightly larger. Calibrated credits (LLM x0.80) are shown next to the list-price credits.

**Failures.** 4 of the 114 wave tasks left no result (confirmed in the task logs): all four died with `tor bootstrap exceeded 180s` when 50 tasks started at once (q09 deep, q21 deep, q14 standard, and one bypass-compare cell). Tor bootstrap across all 116 successful runs was p50 6.0 s, p90 48 s, max 162 s, so the 3 s seen in sequential runs does not hold under a 50-wide burst from one egress. Two successful runs have an empty summary because the summary phase hit its 90 s timeout (section 5).

## 4. Recommended credits per depth

Founding Pro: $7 for 1,600 credits, net 0.389¢ per credit after the 4% + $0.50 fee, so cost must be <= 0.0778¢ per credit for 80% margin.

| Depth | p50 total ¢ | p90 total ¢ | max ¢ | credits (p90 / 0.0778¢) | calibrated credits (LLM x0.80) | PRD strawman | Proposed |
|---|---:|---:|---:|---:|---:|---:|---:|
| quick | 1.10 | 1.26 | 1.97 | 17 | 16 | 10 | 18 |
| standard | 2.27 | 2.97 | 3.03 | 39 | 33 | 25 | 40 |
| deep | 2.46 | 3.59 | 3.95 | 47 | 40 | 60 | 48 |

Proposed final numbers: **quick 18, standard 40, deep 48.** Reasons: the list-price formula gives 17 / 39 / 47, rounded up by one for headroom, and the calibrated figures (16 / 33 / 40) show these are not under-priced. Deep costs only about 20% more than standard at p90 because the deep preset raises caps but the CLI does not crawl, so keeping the strawman 60 would over-charge by about 25%. Proposed per-run caps: hard wall-clock 10 minutes (max observed 488 s, deep), at most 45 LLM calls (max observed 43), a per-run OpenRouter key limit of $0.10 (2.5x the highest observed run cost), and 45 pages (max observed 41). Margin is sensitive to compute, which is about 57% of a quick run, so shortening quick runs (section 7) cuts its price directly.

## 5. Quality and policy findings

**Typed relationships (roadmap item #7): yes, in standard and deep; none in quick.** Across the 87 successful default cells, the relationship table holds mostly `CO_APPEARED_ON` (7,620) plus typed edges only when relationship extraction is on: `TARGETS` (606), `EXPLOITS` (117), `DROPS` (133), `USES` (57), `COMMUNICATES_WITH` (44), `CONTROLS` (18). Quick runs (extraction off) have only `CO_APPEARED_ON`. Three concrete examples (q02, deep, confidence from the engine): `Royal (RANSOMWARE_GROUP) -TARGETS-> PeopleSoft (ORGANIZATION_NAME)` 0.9; `Cl0p -TARGETS-> PeopleSoft` 0.9; `Royal -TARGETS-> BleepingComputer` 0.7. **Quality caveat:** these examples show the typed edges are not reliable group-to-victim facts: PeopleSoft is a software product and BleepingComputer is a news site, and two groups share identical targets, which looks like co-mention in one article. I did not attribute edges to LLM extraction versus ransomware.live enrichment. Do not market typed edges as victim attribution without a precision check.

**Actors.** `THREAT_ACTOR_HANDLE` entities appear in every depth (35 quick, 79 standard, 105 deep in total). My harness `actors_count` column looked for the wrong type string and reads 0; use the entity-type column.

**Refusal rate with the bypass prompt removed: 0 refusals in 87 runs.** Two runs (q06 standard, q11 deep) were flagged `empty_or_tiny_summary_with_pages`; both are the 90 s summary-phase timeout (stage time 90.07 s), not refusal text, so the real refusal rate is 0 of 87 and the flagged rate is 2.3%. With the prompt **left in** (9 paired standard cells): 0 refusals, 0 timeouts; entities 121 vs 130 and relationships 97 vs 69 (paired medians, prompt left in vs removed), duration 289 s vs 307 s, LLM cost the same within noise. **Conclusion: removing the bypass prompt does not hurt output on these legitimate queries.** Sample size is small (9) and queries are public threat topics.

**Flash model (`deepseek/deepseek-v4.1-flash`, 10 standard cells): not cheaper.** It is a reasoning model: about 15x more completion tokens (66,884 vs 3,859 on q01), median list-price LLM cost 3.7x higher ($0.068 vs $0.018) and 24% slower (380 s vs 308 s), with slightly more entities (148 vs 132). Its billed price also varies 2x across providers. **Do not switch the hosted route to V4.1-Flash without disabling reasoning** (an OpenRouter `reasoning` parameter would need an engine or wrapper change), and re-measure. This measures investigations, not test writing, so it does not directly contradict the growth notes' 0.4-1¢ per written test, but the same reasoning overhead may apply there and should be checked before the Flash cost claim is used in pricing.

**vCPU / memory (standard, 10 paired queries).** 1 vCPU / 2 GiB: median 308 s, p90 347 s, median total $0.0252. 2 vCPU / 4 GiB: median 302 s (-2%), p90 447 s, median total $0.0324 (+29%). **Keep 1 vCPU / 2 GiB.** No run hit an out-of-memory error at 2 GiB across 116 runs, so 1 GiB is worth testing (not done).

**Progress-hook feasibility (roadmap item #6): the adapter works without engine edits, but is fragile.** Wrapping `voidaccess_cli.display.InvestigationDisplay.update_step` captured 39 events in a sample run (the harness stores the step names per run), covering the engine's 14 display steps plus sub-steps. Fragility: it depends on a rich-console display class name and method signatures; step names are display strings that do not match the contract's 8 stages (they need a mapping table); counts (pages, entities) exist only inside free-text detail strings; and the hook runs in the same process as the pipeline, so exceptions in a callback could affect the run. Verdict: **usable for R0 as a stopgap; a small official engine hook is the durable fix.**

**Enrichment licences.** Full 40-row table with clauses, URLs and UNVERIFIED markers: [E0-LICENCE-TABLE.md](E0-LICENCE-TABLE.md). Summary: 9 sources fine on our keys (RDAP, crt.sh, Wayback, CISA KEV, NVD, MITRE ATT&CK, GitHub, .onion engines and paste sites), 7 conditional, 11 BYO-only (VirusTotal, AbuseIPDB, SecurityTrails, Hybrid Analysis, EmailRep, XposedOrNot, BlockCypher, Etherscan, GitLab, DarkSearch, Telegram), 13 off (OTX, GreyNoise, urlscan, CIRCL, abuse.ch/Feodo, C2-Tracker, ransomware.live, RansomLook, Shodan InternetDB, LeakCheck, Hudson Rock, clearnet paste sites). 27 of the table's cells are UNVERIFIED because several terms pages were unreachable; a human must read the real pages. **Important for these numbers:** the baseline ran keyless against several sources the table marks off or BYO (ransomware.live and RansomLook, Hudson Rock, LeakCheck, XposedOrNot, the abuse.ch family), so the measured entity and edge counts include data we may not be able to ship.

## 6. Stage breakdown (quick runs, n=30)

| Stage (quick, n=30) | p50 s | p90 s | max s | share of p50 total |
|---|---:|---:|---:|---:|
| tor_bootstrap | 5.0 | 19.4 | 143.2 | 2% |
| query_refinement | 1.9 | 7.4 | 22.7 | 1% |
| source_gathering | 56.4 | 70.7 | 143.9 | 20% |
| scraping | 74.4 | 95.3 | 104.1 | 26% |
| entity_extraction | 49.9 | 60.4 | 218.7 | 18% |
| enrichment | 51.9 | 70.1 | 80.6 | 18% |
| graph_build | 0.1 | 0.2 | 0.6 | 0% |
| summary_generation | 22.9 | 33.2 | 56.5 | 8% |
| finalization | 0.0 | 0.1 | 0.1 | 0% |

For comparison, standard (n=29):

| Stage (standard, n=29) | p50 s | p90 s | max s | share of p50 total |
|---|---:|---:|---:|---:|
| tor_bootstrap | 6.0 | 11.6 | 50.1 | 2% |
| query_refinement | 1.8 | 7.4 | 7.9 | 1% |
| source_gathering | 56.0 | 74.6 | 77.4 | 18% |
| scraping | 53.2 | 68.6 | 78.1 | 17% |
| entity_extraction | 96.2 | 120.3 | 130.2 | 31% |
| enrichment | 53.0 | 78.8 | 86.8 | 17% |
| graph_build | 0.1 | 0.2 | 0.4 | 0% |
| summary_generation | 20.8 | 30.5 | 90.1 | 7% |
| finalization | 0.0 | 0.1 | 0.3 | 0% |

## 7. Why quick takes about five minutes, and what would cut it

Measured in-container p50 is 282 s and p90 328 s, so 11 of 30 quick runs (37%) finish after 5 minutes, and so do 55% of standard and 61% of deep runs, before container start-up (up to about 2 minutes under a burst) is counted. The earlier "6-7 minutes" came from sequential cells that also included cost-settle polling. Four stages are near-equal and sequential, which is why depth does not move wall time. **Top three contributors and the setting that would cut each (proposals, not tested, no preset was changed mid-wave):**

1. **Scraping, 74 s p50 (26%).** Shallow runs 3 workers (`DEPTH_PRESETS`) and the pacing profile applies politeness delays per host. Setting `VOIDACCESS_PACE=aggressive` scales timeouts to 0.55x and delays to 0.25x (`pacing/__init__.py`), and raising shallow `max_workers` from 3 to 6-8 targets the same stage.
2. **Search fan-out ("source gathering"), 56 s p50 (20%), max 144 s.** The stage waits on the slowest of many Tor engines at `SEARCH_TIMEOUT=30` s with 2 retries (`search/config.py`); logs show repeated `Engine ... timed out`. `VOIDACCESS_PACE=aggressive` gives about 17 s timeouts; dropping chronic timeouts (`torch`, `haystack` returned `error_timeout`) by marking engines `quarantined` in `search/engine_catalog.py` would remove the long tail.
3. **Enrichment, 52 s p50 (18%).** About ten keyless third-party calls run in sequence under a phase timeout of 120 s (`VOIDACCESS_ENRICHMENT_TIMEOUT`). Turning off the sources the licence table marks off or BYO removes most of this stage and fixes the licensing problem at the same time; lowering the phase timeout to about 20 s caps the rest.

A close fourth is entity extraction (50 s, 18%; includes spaCy NER and up to 3 LLM pages in quick) which I did not diagnose. Tor bootstrap is not a bottleneck at p50 (5 s) but has a tail under bursts (p90 19 s quick, up to 162 s), so start jobs in smaller batches or retry bootstrap.

## 8. Deviations from the brief, with reasons

1. **Engine tree was dirty at start (E1 in progress).** I stopped; you chose to proceed (option 2). E1 then merged, so the final image is built from the clean `main` at `d384b1e`, not the earlier `f7b85fa`, and acceptance (clean status before and after, `main` unchanged) holds.
2. **Parallel wave instead of sequential measurement,** per your redirect. LLM cost is token-based, with the shared-key delta as a cross-check that did not meet ±10% (section 3). The first 6 quick cells ran sequentially.
3. **Two executions, not one,** because Cloud Run CPU and memory are per execution: 104 tasks at 1 vCPU / 2 GiB (parallelism 50) and 10 tasks at 2 vCPU / 4 GiB, run concurrently. The 30-minute (quick, standard) and 40-minute (deep) limits are enforced inside the entrypoint, with a 41-minute Cloud Run task timeout as a backstop, because a task has one timeout per execution.
4. **Safety-bypass prompt:** used the engine's own `VOIDACCESS_SAFETY_BYPASS_PROMPT=off` (added by E1) instead of overriding the module string, because zeroing the module string breaks the engine's own stripping of the text embedded in the summary presets. Verified by rendering all six prompt paths with the marker present when on and absent when off.
5. **Cell manifest is passed as an env var,** not read from the bucket: `va-runner` can write to the bucket but not read it, and I did not change IAM. The first wave (114 tasks) failed in seconds on this with no LLM spend.
6. **Engine `tests/` directory excluded from the build context** because `tests/test_setup.sh` in `main` contains a 73-character `sk-or-v1-` string shaped like a real OpenRouter key. I did not print or test it. **Rotate it if it is live.**
7. **The engine's `pyproject.toml` omits 13 top-level packages** (`shared_corpus`, `trust_gate`, `netpool`, `jobqueue`, `hygiene`, `sanitizer`, `ratelimit`, `observability`, `snapshot_store`, `credential_presence`, `feeds`, `ingest`, `benchmark`), so a pip-only install crashes with `No module named 'shared_corpus'`. The image puts the full staged tree on `PYTHONPATH`. This is an engine bug for a later brief.
8. **Per-run provisioning keys were not used** (secret has no version; no key will be added).
9. **Image tag uses the engine commit sha,** not the tree hash.
10. **Compute cost for the wave is derived** from recorded duration, vCPU and memory with the verified rates, because the tasks were not given the rates; the 6 sequential rows recorded it directly.
11. **Job-execution accounting:** 12 job executions in total (8 sequential, of which 2 were early debugging failures, 2 for the failed first wave, 2 for the final wave), under the cap of 120. Total OpenRouter usage $1.88 of the $9 cap ($8.12 left on the key).
12. **Bypass-compare has 9 cells, not 10,** because one task died in Tor bootstrap. Not re-run.
13. **Three main cells are missing** (q09 deep, q21 deep, q14 standard) for the same Tor-bootstrap reason; 87 of 90 are above the acceptance threshold, so I did not re-run them.
14. **A hung-process guard is a timeout, not a retry:** the cell timeouts are named constants, and no retries were added.

## 9. Notes for R0

- Reuse the image, the entrypoint `python -m baseline.run_one`, and `presets.yaml`. The entrypoint maps `CLOUD_RUN_TASK_INDEX` to a cell, but R0 should replace that with the per-run spec.
- Use `VOIDACCESS_SAFETY_BYPASS_PROMPT=off`, keep `PYTHONPATH=/app/engine:/app/runner`, and keep the usage-recording `get_llm` wrapper: it gives per-run token counts without a provisioning key (priced conservatively; real billing is about 20% lower and provider-dependent).
- Do not start many Tor clients at once from one egress; expect about 3% bootstrap failures at a burst of 50, so retry bootstrap inside the job.
- Cap the summary phase deliberately (`VOIDACCESS_SUMMARY_TIMEOUT`, default 90 s): 2.3% of runs lose their summary to it.
- Decide the enrichment source list from the licence table before launch; the measured runs used sources that are likely not shippable.
- The Cloud Run Job `engine-baseline` is redeployable by `baseline.matrix` or `baseline.wave`; it is deleted at the end of E0.
