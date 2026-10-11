BRIEF — Lane ENGINE, Sub-phase E1B: Speed, official progress hook, cloud source allowlist, packaging fix

Third brief in the ENGINE lane, and the last engine change before VoidAccess Cloud builds its production runner (R0). E0 measured the cloud configuration. Results are in `platform/docs/baseline/E0-REPORT.md`, which you should read in full:
- quick p50 is **282 s** and standard **307 s**, and 37% / 55% of runs exceed 5 minutes
- the four sequential stages are near-equal: source gathering 56 s, scraping 74 s, extraction 50 s, enrichment 52 s
- the CLI ignores `MAX_LLM_PAGES_PER_INV`
- 2.3% of summaries are lost to the 90 s summary timeout
- the only progress signal is a fragile wrapper around the Rich display
- 13 enrichment sources are not licensed for our commercial use
- `pip install voidaccess` omits 13 packages and crashes

This sub-phase fixes all of that and proves the speed gain with a new measurement wave. Build only E1B.

Nothing else runs in parallel. The platform repo is idle apart from the small harness change listed below.

── CONTEXT ─────────────────────────────────────────────────────────────────────
**Engine:** work in /Users/delzyn/Brand/companies/voidaccess/voidaccess. Create branch `e1b-speed-hook` from `main` (at d384b1e, which includes E1). `git status --short` must be clean first; if it isn't, stop and report. **Don't push this repo. It's public and the push is held until after E1B.**

**Measurement harness:** in /Users/delzyn/Brand/companies/voidaccess/platform, create branch `e1b-measure` from `main`. Change only `runner/baseline/`. The harness builds from `git archive main`, so add an `ENGINE_REF` parameter (default `main`) and build from your branch.

Read first:
- engine CLAUDE.md (the pacing rule and the never-break-the-pipeline rule)
- `pacing/README.md` and `pacing/__init__.py`
- `search/config.py` and `search/engine_catalog.py` (engine status and quarantine)
- `benchmark/`: the existing engine health probe and its artifacts
- `voidaccess_cli/commands/investigate.py`: `DEPTH_PRESETS`, `INVESTIGATION_STEPS`, the display calls, `_run_investigation`, and where `extract_entities_from_pages` is called without `max_llm_pages`
- `voidaccess_cli/display.py`
- `sources/enrichment.py` and every `sources/*` module it calls
- `voidaccess/llm.py` `generate_summary` and the summary phase timeout (`VOIDACCESS_SUMMARY_TIMEOUT`)
- `pyproject.toml` `[tool.setuptools.packages.find]`
- `tests/test_setup.sh`
- in the platform repo: `docs/ENGINE-CONTRACT.md` §2 (the `Stage` list and `ProgressEvent` shape), `docs/baseline/E0-REPORT.md`, `docs/baseline/E0-LICENCE-TABLE.md`, and `runner/baseline/` (presets, wave driver, `progress_hook.py`, `policy.py`)

GCP for the measurement wave is the same as E0: `CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess`, Cloud Build, a Cloud Run Job, and the secret `openrouter-api-key`, with about $8 left on its $10 limit. Use the parallel wave driver; sequential runs are not allowed.

── NON-NEGOTIABLE GUARANTEES ───────────────────────────────────────────────────
1. **Self-hosters see no unwanted change.** New behaviour that only the cloud wants is **opt-in through env vars**: faster pacing, the source allowlist, and worker counts. Default changes are allowed only for:
   - bug fixes (packaging, the CLI honouring `MAX_LLM_PAGES_PER_INV`, summary loss)
   - quarantining search engines that the probe proves dead or chronically timing out
   
   List every default change in CHANGELOG.md.
2. **The E1 safety gates stay intact.** Nothing in this sub-phase may reorder or bypass `gate_pages`, the URL gate or the entity gate. `tests/test_content_safety_parity.py` must still pass.
3. **Pacing discipline.** Every new timeout, retry count or worker count is a named constant scaled through `pacing`, or an env-configurable value with a named default. No bare literals.
4. **Speed may not be bought with lost results.** Every speed change is judged against the E0 quality numbers (guarantee 5 and the acceptance criteria).
5. **Quality floor (paired per query against E0 for the same depth):**
   - the median ratio of pages ≥ 0.85
   - the median ratio of entities ≥ 0.85 (excluding the effect of the source allowlist, which is measured separately)
   - non-empty summaries in ≥ 99% of runs
6. **The progress hook can't hurt a run.** Exceptions raised by a sink are caught and logged, and never propagate into the pipeline. A slow sink never blocks a stage, so use a bounded queue or fire-and-forget.

── DELIVERABLES ────────────────────────────────────────────────────────────────
**B1. Official progress hook (engine)**
- A small module `progress/` with an `__init__.py` and README.md. It defines:
  - an `EventSink` protocol
  - a `ProgressEvent` dataclass matching ENGINE-CONTRACT §2, including `type`, `stage`, `stage_index`, `stage_total=8` and a `counts` dict (`sources_queried`, `results_found`, `pages_fetched`, `entities_found`, `actors_found`), plus `refined_queries` on a `refined` event
  - the 8-stage enum `refine, collect, filter, fetch, enrich, extract, graph, summarize`
- The CLI pipeline emits events at every stage start and end, with **numeric counts as fields**, not inside display strings.
- Sinks:
  - the existing Rich display becomes one sink, with identical output
  - a `JsonlSink(path)`
  - a `CallbackSink(fn)`
- New CLI flag: `--events-jsonl PATH`.
- The API path emits the same events if that's straightforward. If it isn't, document what's missing and leave it for later. The API keeps its DB progress columns.

**B2. Speed (opt-in, measured)**
- Add env controls for the levers E0 identified:
  - pacing profile: `VOIDACCESS_PACE=aggressive` already exists; confirm it covers search and scraping
  - scrape workers per depth: `VOIDACCESS_SCRAPE_WORKERS`, overriding `DEPTH_PRESETS` `max_workers`
  - the search stage deadline: return what has arrived when the deadline passes, instead of waiting for the slowest engine
  - the enrichment phase timeout: `VOIDACCESS_ENRICHMENT_TIMEOUT` exists; verify it applies on the CLI path
  - optionally, running enrichment **concurrently** with scraping or extraction where the data dependencies allow it. Show the dependency analysis before doing this.
- **Engine quarantine:**
  - run the existing benchmark engine probe over Tor in a Cloud Run Job (not locally) with ≥ 3 samples per engine
  - set `quarantined` in `search/engine_catalog.py` only for engines at 0% success, or for engines with p90 latency above the search deadline and less than 10% unique-result contribution
  - commit the probe report to `benchmark/artifacts/`
- Settle a **recommended cloud speed profile** (the env values) by measurement (B6). Don't change engine defaults for this, apart from the quarantine.

**B3. Cloud enrichment source allowlist (opt-in)**
- `VOIDACCESS_ENRICHMENT_SOURCES=<comma list>` restricts enrichment to the named sources. When it's unset, behaviour is unchanged. Honour it on both the CLI and API paths through the shared enrichment entry point.
- Use stable source IDs and document every ID in docs/architecture.md (configuration reference).
- The cloud value is exactly the **9 "fine on our keys" sources** in E0-LICENCE-TABLE.md. Conditional, BYO-only and off sources are excluded until a human verifies the terms.
- Search-stage sources (onion engines, paste sites, code forges) are not part of this allowlist. If the licence table marks a search-stage source as off, report it rather than changing it.

**B4. Bug fixes (default changes allowed)**
- **Packaging.**
  - Fix `pyproject.toml` so a wheel includes every runtime package (the 13 E0 listed plus any others you find).
  - Add `tests/test_packaging.py`. It builds a wheel, installs it in a fresh venv **outside the repo**, and imports every top-level package. Run `voidaccess --help` and `voidaccess version` from a directory without the source tree.
- **CLI page cap.** The CLI passes `MAX_LLM_PAGES_PER_INV` (and the relationship cap) to `extract_entities_from_pages`, so the harness wrapper is no longer needed.
- **Summary loss.**
  - When the summary phase times out, retry once with a reduced context (top-N pages trimmed) inside the remaining budget.
  - If that also fails, produce a deterministic, non-LLM fallback summary built from the top entities and sources, and mark it as such in the JSON (`summary_kind: "llm" | "fallback"`).
  - An empty summary with pages present must become impossible.
- **Dead credentials in a test.** `tests/test_setup.sh` contains a revoked OpenRouter key (`sk-or-v1-…`) and a hard-coded admin password. Replace both with obviously fake placeholders (`sk-or-v1-TEST-NOT-A-REAL-KEY`, `test-password-not-real`). The test must still work. Don't rewrite history.

**B5. Tests (engine)**
- `tests/test_progress.py`:
  - the event order is correct and covers all 8 stages
  - counts are numeric
  - a raising sink doesn't break a run
  - the JSONL sink writes valid lines
  - the Rich display output is unchanged (snapshot or structural assertion)
- `tests/test_enrichment_allowlist.py`: unset means all sources run; set means only the listed ones; an unknown ID gives a clear error.
- The summary fallback test.
- `tests/test_packaging.py` as above.
- The full suite must pass with `en_core_web_sm` installed. The only allowed failure is the pre-existing `tests/test_pacing_quotas.py::test_nvd_burst_then_idle_is_blocked_by_the_window`. Run the suite in a Python 3.11 venv outside the repo (`uv venv --python 3.11 /tmp/va-e1b-venv`). The host Python is 3.9.

**B6. Measurement wave (platform branch `e1b-measure`)**
- Update the harness:
  - build from `ENGINE_REF=e1b-speed-hook`
  - drop the page-cap wrapper (B4 makes it obsolete)
  - replace the display-wrapping progress hook with a `CallbackSink` and record per-stage timings from it
  - add a **Tor bootstrap retry** (2 attempts) and **staggered task start** (e.g. a random 0–60 s delay per task, or waves of 25), so the 3% burst failures disappear
- Run one parallel wave in a single hour, with the same 30 queries:

| Variant | Cells |
|---|---|
| **A** speed profile, full sources (isolates the speed effect) | quick + standard |
| **B** speed profile + cloud allowlist (the launch configuration) | quick + standard + deep |
| **C** speed profile + allowlist, 1 vCPU / 1 GiB (E0 suggested memory could drop) | standard × 10 |

- Spend cap: ≤ $5 of OpenRouter usage. Poll the key every 2 minutes and cancel if it's exceeded.
- Write `platform/docs/baseline/E1B-REPORT.md`:
  - p50/p90 duration and cost per depth for A and B, against E0
  - the stage breakdown
  - quality ratios against E0 (paired)
  - entity and edge loss caused by the allowlist (B vs A), by entity type
  - the C memory result
  - Tor bootstrap failures
  - the final recommended **cloud preset env values** in a `presets.yaml` diff
  - an updated cost table in the same format as E0 §3–4, so the growth handoff can be refreshed

── ACCEPTANCE CRITERIA ─────────────────────────────────────────────────────────
- **Speed (variant B):**
  - quick p50 ≤ 150 s and p90 ≤ 210 s
  - standard p50 ≤ 240 s and p90 ≤ 300 s
  - If a target is missed, report the remaining bottleneck with stage numbers and the next lever. Don't trade away the quality floor to hit a number.
- **Quality floor** (guarantee 5) met for variant A.
- **No empty summaries** in any variant.
- **Tor bootstrap failures:** 0 or 1 in the whole wave.
- **Tests:** the full engine suite passes as in B5, the parity tests pass, and the packaging test passes from a clean venv.
- **Engine git:**
  - `git log --oneline main..e1b-speed-hook` shows focused conventional commits (one per deliverable is fine)
  - `git status --short` is clean
  - nothing is pushed
- **Platform git:** `e1b-measure` is pushed, not merged.

── CONSTRAINTS ─────────────────────────────────────────────────────────────────
- No new engine dependencies. Justify any new harness dependency.
- Don't touch: the E1 gate ordering, the shared-corpus modules, auth or API routes beyond progress events, or the platform repo outside `runner/baseline/` and `docs/baseline/`.
- Don't change GCP IAM. If the harness needs a permission it lacks, work around it as E0 did (for example, env-passed manifests) and report it.
- Never print secrets. Results files hold metrics and counts only.
- Commit messages: plain, conventional, NO AI/assistant attribution of any kind.
- **Don't merge either branch.** The architect reviews and merges.

── OUT OF SCOPE (later briefs) ─────────────────────────────────────────────────
- the production runner, per-run spec, callbacks, bundle builder and archive ingest (R0)
- recursive crawling for Deep (later engine brief; Deep stays caps-only for now)
- typed-relationship precision work (needed before the archive markets victim attribution)
- self-hoster multi-user security fixes (E2)
- any pricing or credit decision (the growth architect decides)
- pushing the engine repo

── HANDOFF (reply with this when done) ─────────────────────────────────────────
- **Engine:** the branch commit list; the progress hook API (event shape, sinks, CLI flag, API-path status); every new env var with its default; every default change and why; the quarantine list with probe evidence; the allowlist IDs and the cloud value; the summary-fallback behaviour; packaging fix details; full-suite results.
- **Measurement:** the E1B-REPORT headline table (A and B against E0, quality ratios, allowlist loss by entity type, memory result, bootstrap failures, spend); the recommended cloud presets diff; whether each acceptance target was met and, if not, the next lever.
- **Deviations** with reasons.
- **Notes for R0.**
