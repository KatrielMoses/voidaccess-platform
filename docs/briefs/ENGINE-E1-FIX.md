BRIEF — Lane ENGINE, Sub-phase E1-FIX: Close out E1 (test fix, summary coverage, commit)

Follow-up in the same chat as E1. Validation of your E1 handoff (2026-10-11, Python 3.11 venv, full suite on `main` vs your branch):
- **12 of your 13 new tests pass.** You introduced no new regressions: the same 14 failures exist on `main`.
- **1 new test fails:** `test_safety_bypass_prompt_off_removes_text_from_refine_filter_summary`. It raises `TypeError: expected string or bytes-like object, got 'MagicMock'` at `voidaccess/llm.py:399`. Cause: `refine_query` builds `prompt | llm | StrOutputParser()`. Your fake template returns a MagicMock whose `__or__` yields a *new* MagicMock, so the configured `chain.invoke` is never the one called. The test also never exercises `generate_summary`, despite its name.
- **The 14 pre-existing failures are environmental.** 13 come from the spaCy model `en_core_web_sm` not being installed: `test_dependency_relationship` ×8 and `test_snapshot_store` ×5 (where `sanitize_page` fails closed and returns `None`). The other is `tests/test_pacing_quotas.py::test_nvd_burst_then_idle_is_blocked_by_the_window` (timing). They are not caused by E1.

Build only E1-FIX.

── CONTEXT ─────────────────────────────────────────────────────────────────────
Work ONLY in /Users/delzyn/Brand/companies/voidaccess/voidaccess, on branch `e1-safety-parity`. Your E1 changes are uncommitted there. Keep them.

The host Python is 3.9. Make a 3.11 environment **outside the repo** with `uv venv --python 3.11 /tmp/va-e1-venv`, then `VIRTUAL_ENV=/tmp/va-e1-venv uv pip install ".[dev]"` and `/tmp/va-e1-venv/bin/python -m spacy download en_core_web_sm`. Run tests with `/tmp/va-e1-venv/bin/python -m pytest -p no:cacheprovider`.

── NON-NEGOTIABLE GUARANTEES ───────────────────────────────────────────────────
1. No behaviour change beyond the items below. The E1 gate logic and ordering stay as they are.
2. The bypass-prompt switch still defaults to `on`, so self-hosters see no change.

── DELIVERABLES ────────────────────────────────────────────────────────────────
- **F1. Fix the test** so the composed chain returns a string. For example, make the fake template object implement `__or__` returning an object whose `invoke` returns the canned string, or patch at the `invoke` boundary that `refine_query` and `filter_results` actually use. Assert on the captured system-prompt text.
- **F2. Summary coverage.** Add an assertion that `generate_summary` with `VOIDACCESS_SAFETY_BYPASS_PROMPT=off` sends no `CRITICAL AUTHORIZATION` text, for every preset (`threat_intel`, `ransomware_malware`, `personal_identity` and any others in `PRESET_PROMPTS`). Also check that with the default (`on`) the text is still present. `PRESET_PROMPTS` is built at import time, so confirm `generate_summary` goes through `_preset_system_prompt()` on every call; fix it if any path reads `PRESET_PROMPTS` directly.
- **F3.** Make the entity-listing response filter fail closed: `api/routes/investigations.py` ~:3117 should use `entity_value_is_blocked` instead of the raw `is_blocked_entity_value`. This is the item you flagged for E2. It's one line and belongs with E1.
- **F4. Commit** E1 + E1-FIX as **one** commit on `e1-safety-parity`: `fix(safety): scan pages before persist/extract on CLI and API, fail-closed gates, bypass-prompt switch`. Stage by explicit path, including `tests/test_content_safety_parity.py`.

── ACCEPTANCE CRITERIA ─────────────────────────────────────────────────────────
- `pytest tests/test_content_safety_parity.py` passes in full.
- With `en_core_web_sm` installed, the full suite shows **at most 1 failure** (the pre-existing pacing timing test), or 0. If anything else fails, report it.
- `git log --oneline main..e1-safety-parity` shows exactly one commit, and `git status --short` is clean.
- `voidaccess investigate "LockBit ransomware" --no-tor --no-llm --depth shallow` completes.

── CONSTRAINTS ─────────────────────────────────────────────────────────────────
- No new dependencies; the spaCy model is a data download, not a dependency change.
- Never create the venv inside the repo.
- Commit messages: plain, conventional, NO AI/assistant attribution of any kind.
- **Don't push and don't merge into `main`.** Katriel decides.

── OUT OF SCOPE (later briefs) ─────────────────────────────────────────────────
- double content-safety logging when display and DB text are both scanned (cosmetic)
- the Telegram persist path and other E2 self-hoster items
- the pacing timing test

── HANDOFF (reply with this when done) ─────────────────────────────────────────
- the commit hash
- the test fix approach
- the presets covered
- whether any summary path bypassed `_preset_system_prompt()` and how it was fixed
- full-suite counts with the spaCy model installed
- the CLI smoke-run result
