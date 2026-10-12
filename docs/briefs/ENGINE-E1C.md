BRIEF — Lane ENGINE, Sub-phase E1C: Engine clean-ups from the production runner (summary failure, quiet mode, honest source status, cancel checkpoints, cloud source deny-list)

Fourth brief in the ENGINE lane. R0 built the production runner on the engine at `bf2213c` and found five rough edges. It works around them in the runner today; this sub-phase fixes them in the engine so the workarounds can go. It also closes the remaining licence gap: several feeds whose terms were never checked still run in cloud investigations. Build only E1C.

**No API keys, Tor or cloud are needed.** Every check here runs locally (`--no-tor --no-llm`, fixtures and mocks). The cloud verification of these changes happens in the final verification pass, not in this brief.

In parallel: DEPLOY (D1) in `platform/.worktrees/d1`. It doesn't touch the engine. Never touch `../platform`.

── CONTEXT ─────────────────────────────────────────────────────────────────────
Work ONLY in `/Users/delzyn/Brand/companies/voidaccess/voidaccess`. Create branch `e1c-cleanups` from `main` (`bf2213c`, which is also the public `origin/main`). `git status --short` must be clean first; if not, stop and report. **Don't push: this repo is public, and the architect pushes after review.**

The host Python is 3.9. Make a 3.11 environment **outside the repo**:
```
uv venv --python 3.11 /tmp/va-e1c-venv
VIRTUAL_ENV=/tmp/va-e1c-venv uv pip install ".[dev]"
/tmp/va-e1c-venv/bin/python -m spacy download en_core_web_sm
```
Run tests with `/tmp/va-e1c-venv/bin/python -m pytest -p no:cacheprovider`. The only allowed pre-existing failure is `tests/test_pacing_quotas.py::test_nvd_burst_then_idle_is_blocked_by_the_window`. Check exit codes; don't pipe a gating command through `tail` or `grep` and trust the result.

**Run CLI smoke tests from a copy of the tree, never from the repo root.** The engine's `config.py` loads the repo's local `.env`, which points at a dev Postgres. Use `git archive HEAD | tar -x -C /tmp/e1c-tree` and run there with `HOME=/tmp/e1c-home`.

Read first:
- CLAUDE.md (development rules, the pacing rule, never break the pipeline) and CHANGELOG.md
- `voidaccess/llm.py` (`generate_summary` ~:1224 returns `"Summary unavailable — LLM error: …"`)
- the summary call sites and the E1B summary retry and fallback in `voidaccess_cli/commands/investigate.py` and `api/routes/investigations.py`
- `voidaccess_cli/display.py` (`quiet`), `voidaccess_cli/reporter.py`, and the CLI header that prints `VoidAccess — <query>`
- `progress/` (the E1B progress hook and sinks)
- `sources/enrichment.py` and `sources/enrichment_allowlist.py` (the E1B allowlist and its IDs)
- `feeds/__init__.py` (SSLBL, OpenPhish, PhishTank matchers), `sources/historical_intel.py`, `credential_presence/` (HIBP Pwned Passwords), the RSS and press feeds (FBI and DoJ press), the ransomwhe.re integration, and the clearnet paste-site scrapers in `sources/`
- how `sources_used` is built and reported in the CLI JSON
- the cancellation design: `_check_cancelled` and cancel flags in the API path, how the CLI handles SIGTERM, and where the runner cancels (`platform/runner/cloud/` can be read for context only, at `/Users/delzyn/Brand/companies/voidaccess/platform/runner/cloud/`)
- `platform/docs/baseline/E0-LICENCE-TABLE.md` (read only) for the licence status of each source

── NON-NEGOTIABLE GUARANTEES ───────────────────────────────────────────────────
1. **Self-hosters see no unwanted change.** Behaviour changes that only the cloud wants are opt-in through env vars, with defaults unchanged. Bug fixes may change defaults; list every one in CHANGELOG.md.
2. **The E1 safety gates are untouched.** Nothing reorders or bypasses `gate_pages`, the URL gate or the entity gate. `tests/test_content_safety_parity.py` must pass.
3. **No secret or query text is printed in quiet mode.** With `--quiet`, the CLI writes nothing to stdout or stderr except fatal errors (which must not echo the query) and the paths of the output files, if the flag's contract says so. A test captures both streams.
4. **Pacing discipline.** New timeouts, intervals or poll periods are named constants scaled through `pacing`, or env-configurable values with named defaults.
5. **Cancellation is safe.** A cancel stops promptly at a checkpoint, never leaves a half-written output file, and emits the progress hook's terminal `cancelled` event with `stages_completed` accurate.

── DELIVERABLES ────────────────────────────────────────────────────────────────
**C1. The summary raises instead of returning an error string.**
- `generate_summary` raises a typed `SummaryUnavailable` (with a cause) when the LLM fails, instead of returning `"Summary unavailable — LLM error: …"`.
- Every caller (CLI and API) catches it and runs the existing E1B path: retry once with reduced context, then the deterministic fallback summary.
- `summary_kind` in the JSON is `llm`, `fallback` or `none`, and a failed LLM can no longer surface as `llm`.
- No user-facing text contains the raw exception message.

**C2. Quiet mode is quiet** (guarantee 3)
- `--quiet` suppresses the Rich header (`VoidAccess — <query>`), spinners, step lines and any `console.print` in the pipeline.
- The progress hook's sinks other than Rich (JSONL, callback) keep working in quiet mode.

**C3. Honest source status and per-source counts.**
- `sources_used` reports each source's real state: `ok`, `error`, `timed_out`, `skipped_by_allowlist`, `disabled`, `no_key`.
- An allowlisted-off source never shows as `ok`.
- Add per-source request counts (HTTP calls made) to `sources_used` and to the run's step metrics, so a runner can report `enrichment_calls` per source.

**C4. Cancel checkpoints inside the long stages** (guarantee 5)
- Cancellation is checked between engines in the search fan-out, between pages in fetch and scrape, and between sources in enrichment, on both the CLI and the API paths. The API already has `_check_cancelled` at stage boundaries; add the in-stage checks through one shared cancel-token helper.
- For the CLI: on SIGTERM, set the token, finish the current item, emit `cancelled` with accurate `stages_completed` through the progress hook, and exit without writing a partial JSON or Markdown file.
- Test: a mocked slow fetch of 50 pages, cancelled mid-stage, stops within one item and reports the right completed stages.

**C5. A cloud source deny-list** (opt-in; closes the licence gap)
- `VOIDACCESS_DISABLED_SOURCES=<comma list of source IDs>` disables the named sources in **every** stage: the search and paste stage, feed matchers, historical intel, credential presence and enrichment. Unset means today's behaviour.
- Use stable IDs, and document each one in docs/architecture.md (configuration reference), next to the E1B enrichment allowlist IDs.
- Disabled sources report `disabled` in `sources_used` (C3).
- Provide the recommended **cloud value**: the sources whose commercial terms are unverified or non-commercial. At minimum: `openphish`, `sslbl`, `phishtank`, `ransomwhere`, `hibp_pwned_passwords`, `fbi_doj_press`, and the clearnet paste sites the licence table marks "off" (each by its own ID). Report anything else you find running in the cloud profile that isn't on the E0 licence table's "fine on our keys" list.

**C6. Packaging check**
- R0 reported that the published package still omits runtime packages. E1B's `tests/test_packaging.py` should prove otherwise.
- Build a wheel from this branch, install it in a fresh venv outside the repo, import every top-level package, and run `voidaccess --help` and `voidaccess version` from a directory without the source tree.
- If anything is missing, fix `pyproject.toml` and extend the test.

**C7. Tests and docs**
- New or extended tests for C1–C6: `tests/test_summary_fallback.py`, `tests/test_quiet_mode.py`, `tests/test_sources_status.py`, `tests/test_cancel_checkpoints.py`, `tests/test_disabled_sources.py`, and the packaging test.
- CHANGELOG.md entries under Unreleased, with every default change listed.
- docs/architecture.md: the new env vars and source IDs.

── ACCEPTANCE CRITERIA ─────────────────────────────────────────────────────────
- The full engine suite passes in the 3.11 venv; the only allowed failure is the pre-existing pacing test. The parity, packaging and new tests all pass.
- The CLI smoke run from a tree copy, `voidaccess investigate "LockBit ransomware" --no-tor --no-llm --depth shallow --quiet --events-jsonl /tmp/e1c-events.jsonl`, completes. Captured stdout and stderr contain no query text and no Rich output. The events file has all 8 stages plus `completed`.
- The same run with `VOIDACCESS_DISABLED_SOURCES=<cloud value>` shows each of those sources as `disabled` and makes zero requests to them (asserted through the per-source counts, with HTTP mocked or blocked).
- A cancel during the smoke run (SIGTERM after the collect stage starts) leaves no output file and the events file ends with `cancelled`.
- `git log --oneline main..e1c-cleanups` shows focused conventional commits, `git status --short` is clean, and nothing is pushed.

── CONSTRAINTS ─────────────────────────────────────────────────────────────────
- No new dependencies.
- Don't touch the E1 gate ordering, the shared-corpus modules, auth or API routes beyond what C1 and C4 need, or anything in `../platform`.
- Never print secrets. Never run anything from the repo root that loads the local `.env` against a real database.
- Commit messages: plain, conventional, NO AI/assistant attribution of any kind.
- **Don't push and don't merge.** The architect reviews, merges and pushes.

── OUT OF SCOPE (later briefs) ─────────────────────────────────────────────────
- bumping the platform runner to this engine version and removing its workarounds (the architect does this after merge)
- WhoisFreaks and ipgeolocation enrichment (out of scope for now)
- the relationship-precision pass for group → victim claims
- self-hoster multi-user security fixes (E2)
- any cloud or Tor measurement (the final verification pass)

── HANDOFF (reply with this when done) ─────────────────────────────────────────
- the commit list
- C1: the exception type and how each caller handles it, with `summary_kind` behaviour
- C2: what quiet mode now suppresses, with the captured-output evidence
- C3: the status values and per-source count fields, with an example `sources_used` block
- C4: the cancel-token helper, where the checkpoints are, and the test timing evidence
- C5: every source ID, the recommended cloud deny-list value, and anything else found running that isn't on the licence table's "fine" list
- C6: the packaging result
- every default change
- full-suite results
- deviations with reasons
