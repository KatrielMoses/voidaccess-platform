# E1B report: speed, progress hook, cloud source allowlist, packaging

**Engine:** branch `e1b-speed-hook` (not pushed, not merged), measured image built from `43b2b7b` (wave 1 from `0a0ed80`, which differs only by the opt-in `VOIDACCESS_LLM_CHUNK_TIMEOUT`).
**Harness:** branch `e1b-measure` (this repo). Data: `runner/baseline/results_e1b.jsonl` (wave 1), `results_e1b_confirm.jsonl` (wave 2), `results_e1b_pilot{1,2,3}.jsonl` (pilots). Metrics and counts only.
**Model:** `openrouter/deepseek/deepseek-chat`, same 30 queries and E0 presets. **Date:** 2026-10-11/12.

## 1. Headline

| | Result |
|---|---|
| **Speed target, variant B** | **Not met for quick** (p50 180 s vs 150, p90 245 s vs 210). **Standard p90 met** (283 s vs 300), **p50 missed by 0.3 s** (240.3 s vs 240) in the recommended profile. A tighter profile met standard (p50 204 s, p90 228 s) but broke the quality floor, so it is not recommended. |
| **Quality floor, variant A (recommended profile)** | **Met.** Paired median pages ratio 0.96, entities 0.98 (quick 0.95 / 0.92, standard 1.00 / 1.00). |
| **Empty summaries** | **0 in all variants.** 2 B runs hit the summary timeout and produced a `fallback` summary (non-empty). |
| **Tor bootstrap failures** | **0** in 280 tasks (0 retries needed). Bootstrap p50 2.5-3.0 s, max 3.8 s, vs E0 p50 5-6 s and max 162 s. |
| **Memory (variant C)** | 1 vCPU / **1 GiB**: 10/10 standard runs succeeded, peak RSS **620-623 MB** (full-source variant A peaks at 1.27 GB). Recommend 1 GiB with the allowlist; deep not run at 1 GiB. |
| **Allowlist cost (B vs A)** | Entities lost mostly in `ONION_URL` (-63%), `MITRE_TECHNIQUE` (-18%), `RANSOMWARE_GROUP` (-22%), `EMAIL_ADDRESS` (-31%); co-appearance edges -25%. Typed edges not reduced overall. Section 5. |
| **Spend** | Wave 1 $1.98, wave 2 $1.29, three pilots about $0.97 (OpenRouter key delta, billed). Total E1B about $4.25. Each wave is under the $5 cap. Key now has $3.87 left of $10. |

## 2. What was measured

| Wave | Variants and cells | Profile |
|---|---|---|
| Wave 1 (160 tasks, one parallel wave, 0-60 s random start stagger) | A quick+standard, B quick+standard+deep, C standard x10 (1 vCPU / 1 GiB) | search deadline 15 s, enrichment cap 20 s |
| Wave 2, confirmation (120 tasks) | A2 and B2, quick+standard | search deadline 25 s, enrichment cap 40 s, `LLM_CHUNK_TIMEOUT=60` |

Common to both: `VOIDACCESS_SEARCH_WORKERS=16`, `SCRAPE_WORKERS=12`, `EXTRACT_CONCURRENCY=8`, `CONCURRENT_COLLECT=1`, normal pacing. B and C add `VOIDACCESS_ENRICHMENT_SOURCES=rdap,crtsh,wayback,cisa_kev,nvd,mitre_attack`.

**Deviation:** the brief asked for one wave. Wave 1's variant A missed the quality floor (pages ratio 0.75), so I ran wave 2 with relaxed values to find a profile that meets it. Wave 2 has no deep and no C cells.

Pilots (5 queries each, A and B): pilot 1 used `VOIDACCESS_PACE=aggressive`; page ratio in A standard fell to 0.44, so aggressive pacing was dropped. Pilot 2 added `LLM_CHUNK_CONCURRENCY=4`, which showed no consistent gain (extraction stalls were provider-side), so it was dropped. Pilot 3 (deadline 25, cap 40) gave A ratios 0.94 / 0.79 on n=5.

## 3. Speed and cost against E0

### 3.1 Duration, p50 / p90 / max seconds (in-container, excludes the 0-60 s stagger)

| | quick | standard | deep |
|---|---|---|---|
| E0 | 282.3 / 327.9 / 456.3 | 306.7 / 348.9 / 365.1 | 326.4 / 385.6 / 488.0 |
| **A, recommended profile (wave 2)** | 211.7 / 243.4 / 271.1 | 250.7 / 292.5 / 313.0 | n/a |
| **B, recommended profile (wave 2)** | **180.1 / 244.9 / 262.0** | **240.3 / 283.1 / 333.7** | n/a |
| A, tight profile (wave 1) | 181.3 / 201.8 / 206.9 | 200.4 / 227.4 / 310.9 | n/a |
| B, tight profile (wave 1) | 183.0 / 229.9 / 862.3 | 204.1 / 227.9 / 291.3 | 235.7 / 260.8 / 336.4 |

Runs over 5 minutes: E0 quick 11/30, standard 16/29, deep 17/28. Wave 2 B: quick 0/30, standard 1/30. Wave 1 B: quick 3/30 (one 862 s outlier, see 3.3), standard 0/30, deep 1/30.

| Acceptance target (variant B) | Target | Recommended profile | Tight profile |
|---|---|---|---|
| quick p50 | <= 150 s | **180 s, missed** | 183 s, missed |
| quick p90 | <= 210 s | **245 s, missed** | 230 s, missed |
| standard p50 | <= 240 s | **240.3 s, missed by 0.3 s** | 204 s, met |
| standard p90 | <= 300 s | 283 s, met | 228 s, met |

### 3.2 Stage breakdown (p50 s, from the progress hook)

| Stage | E0 quick | B2 quick | B2 standard | E0 standard |
|---|---:|---:|---:|---:|
| refine | 1.9 | 1.5 | 1.9 | 1.8 |
| collect (E0: source gathering) | 56.4 | 30.2 | 32.2 | 56.0 |
| filter | n/a (in collect) | 3.9 | 4.1 | n/a |
| fetch (E0: scraping) | 74.4 | 28.7 | 26.2 | 53.2 |
| extract | 49.9 | 51.7 | 86.0 | 96.2 |
| enrich | 51.9 | 36.2 | 39.1 | 53.0 |
| graph | 0.1 | 0.1 | 0.1 | 0.1 |
| summarize | 22.9 | 30.0 | 27.8 | 20.8 |

(E0 stage names come from the display wrapper; E0 "source gathering" included filtering.) Wave 1 B standard p50: collect 32.4, fetch 34.3, extract 77.5, enrich 20.0, summarize 16.6. The full per-variant tables are in `e1b_report.py` output.

### 3.3 Remaining bottleneck and next levers

Collect, fetch and enrich roughly halved. What is left, for B2 quick (p50 180 s): **extract 52 s (29%)**, **enrich 36 s (20%)**, **collect 30 s (17%)**, **summarize 30 s (17%)**, **fetch 29 s (16%)**. For standard: **extract 86 s (36%)**.

1. **Extraction is LLM latency, not CPU.** Local profiling of 20 pages without the LLM took 8.8 s (3.5 s of it spaCy); the remainder is sequential 12,000-character chunk calls to the model. Provider stalls drive the tail: one wave 1 B run spent 759 s in extraction (862 s total). `VOIDACCESS_LLM_CHUNK_TIMEOUT=60` (added after that run, used in wave 2) removed the outlier (wave 2 max 262 s). Concurrent chunk calls (`VOIDACCESS_LLM_CHUNK_CONCURRENCY`) gave no consistent gain under a shared key. Next lever: fewer or smaller LLM extraction pages for quick, or a faster non-reasoning model for extraction (E0 found V4.1 Flash slower because it reasons).
2. **Enrichment is pinned at its cap** (40 s p50 in wave 2 B vs 20 s in wave 1): NVD without a key allows 5 requests per 30 s. A free NVD key on the cloud account (`NVD_API_KEY`, 50 per 30 s) is the next lever and does not remove data.
3. **Collect is pinned at the search deadline plus side sources** (about 30 s). Lowering the deadline to 15 s saved about 12 s but cost pages (below).
4. **Summarize 28-30 s** is one LLM call on up to 10 pages; it could run concurrently with community detection, or on fewer pages.

## 4. Quality against E0 (paired per query, same depth)

Floor: median pages ratio >= 0.85, entities ratio >= 0.85, non-empty summaries >= 99%.

| | pages ratio | entities ratio | relationships ratio | floor |
|---|---|---|---|---|
| **A, recommended (wave 2)**, quick / standard / all | 0.95 / 1.00 / **0.96** | 0.92 / 1.00 / **0.98** | 0.77 / 0.96 | **met** |
| A, tight profile (wave 1), all | 0.75 | 0.86 | 0.68 / 0.78 | **pages missed** |
| B, recommended (wave 2), all | 0.83 | 0.88 | 0.68 / 0.85 | allowlist effect included |
| B, tight profile (wave 1), quick / standard / deep | 0.71 / 0.84 / 0.90 | 0.81 / 0.90 / 0.95 | 0.57 / 0.72 / 0.88 | allowlist effect included |

The wave 1 profile combined a 15 s search deadline and a 20 s enrichment cap; I did not separate which one cost the pages (enrichment pages count as pages). The relaxed profile recovers them. Summaries: A 60/60 non-empty (`llm`); B2 58 `llm` + 2 `fallback`; wave 1 160/160 `llm`; C 10/10.

## 5. Entity and edge loss caused by the allowlist (B vs A, same profile)

Wave 2, 60 paired cells (quick + standard):

| Entity type | A | B | lost | loss |
|---|---:|---:|---:|---:|
| ONION_URL | 1315 | 488 | 827 | 63% |
| MITRE_TECHNIQUE | 1290 | 1052 | 238 | 18% |
| ORGANIZATION_NAME | 2448 | 2322 | 126 | 5% |
| RANSOMWARE_GROUP | 421 | 328 | 93 | 22% |
| BITCOIN_ADDRESS | 216 | 190 | 26 | 12% |
| CVE_NUMBER | 141 | 119 | 22 | 16% |
| FILE_HASH_SHA256 / MD5 | 246 / 146 | 226 / 128 | 20 / 18 | 8% / 12% |
| EMAIL_ADDRESS | 48 | 33 | 15 | 31% |
| IP_ADDRESS | 41 | 30 | 11 | 27% |
| MALWARE_FAMILY, THREAT_ACTOR_HANDLE | 562, 114 | 558, 110 | 4, 4 | 1%, 4% |

| Edge type | A | B | lost | loss |
|---|---:|---:|---:|---:|
| CO_APPEARED_ON | 4641 | 3469 | 1172 | 25% |
| DROPS | 21 | 7 | 14 | 67% |
| CONTROLS | 14 | 9 | 5 | 36% |
| TARGETS / EXPLOITS / USES | 350 / 56 / 18 | 404 / 65 / 19 | -54 / -9 / -1 | typed edges did not drop |

Reading it: the biggest loss is leak-site `.onion` addresses, which come from ransomware.live and RansomLook (both marked "off" in the licence table); the second is MITRE technique rows and ransomware group names. Those are a marketed feature (actor and group coverage), so the product decision is whether to license ransomware.live PRO or verify RansomLook's terms. Wave 1 (tight profile) showed a similar ONION_URL loss (42%). Some wave 1 types gained in B (URL, IP_ADDRESS); with 30 queries and live Tor noise I would not read gains as caused by the allowlist.

## 6. Memory (variant C)

10/10 standard runs at 1 vCPU / 1 GiB succeeded; peak RSS p50/max 620 / 623 MB vs 619 / 626 MB at 2 GiB (B standard). No out-of-memory events. Standard duration 223 s p50, in line with 2 GiB runs in the same wave (204 s). Peak RSS by variant (wave 1 max): B quick 657 MB, B standard 626 MB, B deep 626 MB, but **A (full sources) 1,243-1,267 MB**: the unrestricted enrichment sources (ransomware.live and RansomLook data) roughly double memory, so **1 GiB is safe only with the allowlist**. Recommend 1 GiB for the allowlisted cloud profile; deep at 1 GiB was not run, so confirm with one deep batch before switching deep.

## 7. Tor bootstrap

0 failures and 0 retries across 280 tasks (160 + 120). The two changes were the random 0-60 s start stagger and the 2-attempt bootstrap with a 90 s per-attempt limit (E0: 4 of 114 tasks failed at 180 s under a 50-wide burst). Bootstrap p50 2.5-3.0 s, p90 3.1 s, max 3.8 s, so the stagger keeps the baked consensus cache effective.

## 8. Engine quarantine (probe in a Cloud Run Job, over Tor)

Report: `benchmark/artifacts/E1B_engine_probe.json` in the engine repo (17 engines, 4 samples each, normal pacing).

| Engine | success | p90 latency | unique share | action |
|---|---:|---:|---:|---|
| Kaizer, Anima, Tornado, Find Tor | 0% | 22.8-91.9 s | 0% | already quarantined; probe confirms 0% |
| **OSS** | 100% (0 results) | **48.6 s** | **0%** | **quarantined** (p90 above the 25 s deadline, unique share under 10%) |
| **TorNet** | 100% | **76.1 s** | **7.2%** | **quarantined** (same rule) |
| Torland | 100% | 43.8 s | 10.8% | kept (unique share above 10%) |

Reported, not changed (outside the brief's rule): Ahmia, Torgle, Torgol and OSS return 0 results while counting as successes; Torgol had one HTTP error in four.

## 9. Recommended cloud preset (`runner/baseline/presets.yaml`, `cloud_profile`)

```diff
+cloud_profile:
+  env:
+    VOIDACCESS_SEARCH_WORKERS: "16"
+    VOIDACCESS_SCRAPE_WORKERS: "12"
+    VOIDACCESS_EXTRACT_CONCURRENCY: "8"
+    VOIDACCESS_SEARCH_DEADLINE: "25"
+    VOIDACCESS_CONCURRENT_COLLECT: "1"
+    VOIDACCESS_LLM_CHUNK_TIMEOUT: "60"
+    VOIDACCESS_ENRICHMENT_TIMEOUT: "40"
+    VOIDACCESS_ENRICHMENT_SOURCES: "rdap,crtsh,wayback,cisa_kev,nvd,mitre_attack"
+  container: { vcpu: 1, memory_gib: 1 }
```

Not recommended: `VOIDACCESS_PACE=aggressive`, the 15 s deadline with a 20 s enrichment cap, and chunk concurrency 4 (reasons in section 2). Add `NVD_API_KEY` on the cloud account to relieve enrichment.

## 10. Updated cost tables (E0 section 3-4 format, 1 vCPU / 2 GiB compute, list-price LLM)

Launch configuration (variant B, recommended profile for quick and standard; deep is from wave 1 under the tight profile).

| Metric (p50 / p90 / max) | quick | standard | deep (wave 1) |
|---|---|---|---|
| n | 30 | 30 | 30 |
| Duration (s) | 180.1 / 244.9 / 262.0 | 240.3 / 283.1 / 333.7 | 235.7 / 260.8 / 336.4 |
| Tor bootstrap (s) | 3.0 / 3.3 / 3.3 | 3.0 / 3.3 / 3.8 | 2.5 / 2.8 / 2.8 |
| Pages | 17.0 / 26.0 / 30.0 | 19.5 / 28.1 / 32.0 | 19.5 / 28.0 / 30.0 |
| Entities | 93.0 / 115.5 / 235.0 | 120.5 / 168.4 / 309.0 | 132.5 / 173.9 / 374.0 |
| Relationships | 18.5 / 138.1 / 214.0 | 73.5 / 141.1 / 189.0 | 97.5 / 131.4 / 217.0 |
| LLM calls | 7.0 / 8.1 / 10.0 | 25.0 / 27.0 / 28.0 | 37.5 / 43.1 / 45.0 |
| LLM $ | 0.0058 / 0.0076 / 0.0109 | 0.0189 / 0.0220 / 0.0238 | 0.0249 / 0.0316 / 0.0365 |
| Compute $ | 0.0040 / 0.0054 / 0.0058 | 0.0053 / 0.0062 / 0.0073 | 0.0052 / 0.0057 / 0.0074 |
| Total $ | 0.0100 / 0.0121 / 0.0150 | 0.0246 / 0.0273 / 0.0290 | 0.0304 / 0.0370 / 0.0415 |

Compute is 40% of a quick run (E0: 56%), so shorter runs and the 1 GiB container (which cuts the memory share of compute by half) bring cost down, but LLM spend is now the larger part and did not fall. LLM cost is the token estimate at list price; E0 showed billed cost is about 20% lower (key deltas: wave 1 $1.98 for 160 runs).

Founding Pro $7 for 1,600 credits, 0.389¢ net per credit, cost must be <= 0.0778¢ per credit for 80% margin.

| Depth | p50 total ¢ | p90 total ¢ | max ¢ | credits (p90 / 0.0778¢) | calibrated credits (LLM x0.80) | E0 proposed | Proposed now |
|---|---:|---:|---:|---:|---:|---:|---:|
| quick | 1.00 | 1.21 | 1.50 | 16 | 14 | 18 | **16** |
| standard | 2.46 | 2.73 | 2.90 | 35 | 30 | 40 | **36** |
| deep | 3.04 | 3.70 | 4.15 | 48 | 39 | 48 | **48** |

Quick drops from 18 to 16 credits. Standard drops from 40 to 36, but standard cost per run went up against the tight profile because the relaxed profile does more LLM work; deep is unchanged. The wave 1 outlier (862 s) cost 3.98¢, still inside the $0.10 per-run key limit proposed in E0, but it shows why the per-chunk timeout and a hard wall-clock cap matter. These are measurements for the growth architect, not pricing decisions.

## 11. Findings that need a decision

1. **Speed targets not met for quick** with quality intact. Choose: accept about 180 s p50 for quick, or fund the extraction lever (model or page budget) in a later engine brief.
2. **The allowlist costs the leak-site coverage** (section 5). Licensing ransomware.live PRO or verifying RansomLook would restore most of the ONION_URL and RANSOMWARE_GROUP loss.
3. **Licence-table gaps** found while gating: `sslbl`, `openphish` (its own `LICENSES` entry says non-commercial), `phishtank`, `ransomwhere`, `hibp_pwned_passwords` and the justice.gov FBI/DOJ press feed (`fbi_doj_press`) are called by the pipeline but are not in E0-LICENCE-TABLE. All are off under the cloud allowlist. The three other "fine on our keys" rows (GitHub, onion search engines, onion paste sites) are search-stage and unaffected by the allowlist. The table also marks clearnet paste sites (`paste_scraper.py`: pastebin, paste.ee, dpaste, rentry) "off"; they still run in the search stage. **Reported, not changed.**
4. `securitytrails` is documented as called by `dns_enrichment.py` but has no call site.
