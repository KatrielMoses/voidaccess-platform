BRIEF — Lane ENGINE, Sub-phase E1: CLI content-safety parity and fail-closed gates

Second brief in the ENGINE lane, and the only engine change required for launch. VoidAccess Cloud runs the CLI pipeline inside a container and keeps every finding permanently. Prohibited content must therefore be blocked **before** it reaches entity extraction, the LLM summary or any stored output. Today the API path scans page text (Layer 4, `sanitize_content`) but the CLI path does not scan Tor pages, and one URL-gate error path fails open. This sub-phase brings the CLI to parity and makes the gates fail closed, without changing behaviour for clean content. Build only E1.

In parallel: ENGINE E0 (cost baseline, in ../platform, read-only on this repo). E0 builds from `main`, so commit only on your branch and never rewrite `main`.

── CONTEXT ─────────────────────────────────────────────────────────────────────
Work ONLY in /Users/delzyn/Brand/companies/voidaccess/voidaccess.

**Precondition:** Katriel has committed the dev working tree as one local snapshot commit on `main`, which is **not pushed**. Check that `git status --short` is empty, apart from ignored files. If it isn't, stop and report. Then create branch `e1-safety-parity` from `main`.

Read:
- CLAUDE.md, the development rules (never break the existing pipeline, pacing rule, tests in tests/test_<module>.py)
- utils/content_safety.py: `is_blocked_query`, `is_blocked_url`, `sanitize_content`, `is_blocked_entity_value`, `log_content_safety_event`
- api/routes/investigations.py ~:1880-1940 and ~:2110-2130, where the API scans and persists
- voidaccess_cli/commands/investigate.py: the scrape → extract → summarize path
- scraper/scrape.py ~:520-560 (the URL gate inside a try/except) and `_persist_pages` ~:967
- extractor/pipeline.py ~:602 (the entity gate)
- vector/store.py `store_page`
- the existing tests for content safety

── NON-NEGOTIABLE GUARANTEES ───────────────────────────────────────────────────
1. **Scan before use, on every path.** On the CLI path, every Tor page's text passes `sanitize_content` after fetch and **before** it is persisted, cached or vector-stored, and before extraction, relationship extraction or summarization. The same holds for every clearnet side source (paste, code forge, RSS) that is not already scanned. A flagged page is dropped from all downstream steps and logged with `log_content_safety_event` (hash only, never content).
2. **The API path is fixed too.** Pages must not be written to `pages` or Chroma before the Layer-4 scan (today the order is fetch → persist → scan at ~:1887-1926). Reorder so that a flagged page is never persisted.
3. **Fail closed.** If any gate raises (URL, content or entity), the item is treated as blocked, not allowed. Remove the silent `except: pass` around `is_blocked_url` in scraper/scrape.py. Log the error with a URL hash.
4. **No behaviour change for clean content.** Same pages, entities and summary for non-flagged input. Prove it with a fixture-based parity test.
5. **Can't be disabled.** No new env var or flag that turns these gates off.

── DELIVERABLES ────────────────────────────────────────────────────────────────
- **E1-1.** The CLI scans Tor pages and side sources per guarantee 1. Put the logic in one shared helper, e.g. `utils/content_safety.py: gate_pages(pages) -> (clean_pages, dropped_count)`. Use it from both CLI and API, so the two paths can't drift again.
- **E1-2.** API persist ordering per guarantee 2.
- **E1-3.** Fail-closed URL, content and entity gates per guarantee 3.
- **E1-4.** A clean configuration switch for the safety-bypass prompt, so the cloud runner doesn't need to monkeypatch it:
  - env `VOIDACCESS_SAFETY_BYPASS_PROMPT=off`; default stays `on`, so self-hosters see no change
  - read in voidaccess/llm.py
  - when off, `SAFETY_BYPASS_PROMPT` contributes nothing to any prompt
  - document it in `.env.example` and docs/architecture.md (configuration reference)
- **E1-5.** Tests in `tests/test_content_safety_parity.py`:
  - **(a)** A fixture Tor page containing a prohibited marker (use the existing test markers in the content-safety tests; never real prohibited material) is dropped on the CLI path and never reaches extraction, summary, SQLite `pages`, the vector store or the JSON output.
  - **(b)** The same on the API path, including the `pages` table.
  - **(c)** A gate that raises → item blocked.
  - **(d)** A clean fixture produces identical entities and summary inputs before and after.
  - **(e)** `VOIDACCESS_SAFETY_BYPASS_PROMPT=off` removes the text from the rendered prompts for refine, filter and summary.
- **E1-6.** A CHANGELOG.md entry under Unreleased.

── ACCEPTANCE CRITERIA ─────────────────────────────────────────────────────────
- The full existing test suite passes (`pytest`), plus the new tests.
- `git diff --stat main...e1-safety-parity` touches only the files needed for E1. List them.
- A short manual run, `voidaccess investigate "<benign public query>" --no-tor --no-llm --depth shallow`, still completes.

── CONSTRAINTS ─────────────────────────────────────────────────────────────────
- No new dependencies.
- Follow the pacing rule. Don't refactor beyond what parity needs; this is a surgical change.
- Don't touch: E0's harness (it lives in ../platform), the shared corpus modules, auth or routes unrelated to the scan order.
- Commit messages: plain, conventional, NO AI/assistant attribution of any kind.
- **Don't push.** This repo is public. Katriel reviews the branch locally and decides what to publish.

── OUT OF SCOPE (later briefs) ─────────────────────────────────────────────────
- the progress hook (E1b, only if E0 finds the display adapter fragile)
- typed-relationship output (E1c, only if E0 finds the edges missing)
- self-hoster multi-user security fixes (E2: IDORs, admin role, monitors, cookie)
- the runner and anything in ../platform

── HANDOFF (reply with this when done) ─────────────────────────────────────────
- the helper's API and where it is called (file:line for CLI and API)
- the new persist order on the API path
- every fail-open site you found and fixed
- the bypass-prompt switch behaviour
- test names and results
- the diff stat
- anything that looked unsafe but was out of scope, for E2
