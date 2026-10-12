BRIEF — Lane ENGINE, Sub-phase E2: Multi-user security for self-hosted VoidAccess (OSS release)

Fifth brief in the ENGINE lane. VoidAccess Cloud doesn't use the engine's API or web UI: each cloud run is a throwaway container. But **self-hosters run the engine's FastAPI + Next.js stack with several users**, and the code review on 2026-10-11 found that stack isn't safe for multiple users:
- routes with no owner check (IDOR)
- entity, actor and monitor data shared across users
- a global vector search
- admin routes with no role check
- a spoofable rate-limit key
- a JavaScript-readable session token that logout doesn't revoke

This sub-phase fixes all of it for the public tool. It also adds one opt-in licence control for the cloud (RSS snippet-only). Build only E2.

**No API keys, Tor or cloud are needed.** All tests run locally against SQLite or a local Postgres, with mocks.

In parallel: platform lanes P6 and H1 (in `../platform/.worktrees/`). They don't touch the engine. Never touch `../platform`.

── CONTEXT ─────────────────────────────────────────────────────────────────────
Work ONLY in `/Users/delzyn/Brand/companies/voidaccess/voidaccess`. Create branch `e2-multiuser-security` from `main` (`0dd59da`, which equals the public `origin/main`). `git status --short` must be clean first; if not, stop and report. **Don't push: the repo is public, and the architect pushes after review.**

**Python environment:** the host Python is 3.9. Make a 3.11 environment **outside the repo**:
```
uv venv --python 3.11 /tmp/va-e2-venv
VIRTUAL_ENV=/tmp/va-e2-venv uv pip install ".[dev]"
/tmp/va-e2-venv/bin/python -m spacy download en_core_web_sm
```
- Run tests with `/tmp/va-e2-venv/bin/python -m pytest -p no:cacheprovider`. The only allowed pre-existing failure is `tests/test_pacing_quotas.py::test_nvd_burst_then_idle_is_blocked_by_the_window`.
- Check exit codes. Don't pipe a gating command through `tail` or `grep` and trust the result.
- **Never run anything from the repo root that loads the local `.env`**: it points at a dev Postgres. Use a tree copy (`git archive HEAD | tar -x -C /tmp/e2-tree`) and `HOME=/tmp/e2-home` for smoke runs, and a throwaway local Postgres database (e.g. `voidaccess_e2_test`) for API tests.

**Web UI** (`web/`, Next.js 14): `npm ci` and `npm test` in `web/`. Don't upgrade Next.js in this brief.

Read first:
- `CLAUDE.md`, `CHANGELOG.md`, `SECURITY.md`
- `api/main.py` (router mounting with `Depends(get_current_user)`), `api/auth.py`, `api/routes/*.py`
- `db/models.py`, `db/queries.py` (especially `upsert_entity_canonical` ~:328–400)
- `vector/store.py`, `ratelimit/limiter.py` (`client_key` ~:87), `api/rate_limit.py`
- `monitor/` and `monitors.yaml.example`
- `auth/token_blacklist.py`
- `web/lib/auth.ts`, `web/middleware.ts`, `web/app/api/auth/login/route.ts`, and the `web/app/api/**` proxy routes
- **The findings to fix** (file:line references from the 2026-10-11 review):
  1. no owner check on `GET /investigations/{id}/analysis/temporal` (investigations.py ~2883), `/graph`, `/graph/stats`, `/graph/actor/{node_id}`, `/graph/path` (~3419–3530), `GET /entities/{id}/analysis/stylometry` (entities.py ~292), `/analysis/opsec` (~459), `/neighbors` (~677); `/entities/{id}/related` (~212) returns relationships from all investigations
  2. global `entities` dedup mutates shared rows (snippet, confidence, `page_id`) across users
  3. actor profiles, notes and aliases are global and writable by any user (`actors.py` ~217)
  4. monitors are one global `monitors.yaml`: any user can list, delete or trigger any monitor, and webhook and email targets are visible to all
  5. Chroma semantic search (`/search/semantic`, `/similar-to`, `/cross-investigation`, `/stats`) is global
  6. `/admin/*` has no role check
  7. the rate-limit key trusts the left-most `X-Forwarded-For`
  8. the web token sits in `sessionStorage` plus a cookie that isn't httpOnly, and logout never calls `/auth/logout`

── NON-NEGOTIABLE GUARANTEES ───────────────────────────────────────────────────
1. **A user sees only their own data on every route.** Investigations, entities, relationships, graph, analysis, actors and their notes and aliases, monitors and alerts, exports, search and vector search: everything is scoped to the requesting user. An object belonging to another user returns **404**, never 403, so no existence is leaked. Admin endpoints are the only exception, and they require the admin role.
2. **No cross-user mutation.** Nothing user A does changes what user B sees in B's own investigations: no snippet, confidence, `page_id`, actor note or alias written by A's activity appears in B's responses. Shared deduplicated rows may remain as an internal cache, but **responses are built only from the requesting user's own investigation links**.
3. **Single-user and CLI installs keep working** with no configuration change. A fresh install with one user behaves as before. The CLI path (SQLite, no auth) is unaffected.
4. **Existing self-hosted data survives the upgrade.**
   - Alembic migrations add the owner columns.
   - Existing global rows (monitors from `monitors.yaml`, actor notes and aliases, vector entries) are assigned to the install's first admin user, with a documented, idempotent migration.
   - Nothing is deleted.
5. **The E1, E1B and E1C safety gates and the cloud job path are untouched.** `tests/test_content_safety_parity.py` passes, and the CLI JSON shape the cloud runner reads doesn't change.

── DELIVERABLES ────────────────────────────────────────────────────────────────
**S1. Ownership checks on every route.**
- A shared dependency, e.g. `require_owned_investigation(id, user)` and `require_accessible_entity(id, user)`, applied to every route in finding 1 and to every other route that takes an object id.
- A **route-enumeration test** walks the FastAPI app's routes and fails if any route taking an `{id}` lacks an ownership dependency. Add explicit allow-list entries, with reasons, for routes that are deliberately public or admin-only.

**S2. Per-user entity views** (finding 2)
- Responses for entities, relationships and analysis (`/related`, `/neighbors`, stylometry, opsec, temporal) draw only on the requesting user's investigations (`investigation_entity_links` and the user's pages).
- Snippets, confidence and `page_id` come from the user's own link rows. Add the columns to the link table if needed, with a migration.
- `upsert_entity_canonical` may keep deduplicating, but it no longer overwrites per-investigation context on the shared row.

**S3. Actors.** Actor visibility is limited to actors linked to the user's investigations. Notes and aliases gain an owner and are visible only to their owner. Admins can see everything. Migrate existing notes and aliases to the first admin.

**S4. Monitors** (finding 4)
- Monitors move from `monitors.yaml` into the database, with an owner (migration plus an importer for the YAML).
- Every monitor route and the scheduler respect ownership. Alerts are owner-scoped.
- Webhook, email and Telegram targets are visible only to the owner.
- `monitors.yaml` stays supported as a **read-only import** for single-user installs. Document it.

**S5. Vector search** (finding 5)
- Pages stored in Chroma carry `user_id` (and `investigation_id`) metadata, and every query filters by the requesting user.
- Backfill existing vectors to the first admin.
- `/stats` reports only the user's own counts; admins get global counts.

**S6. Admin role** (finding 6)
- A `role` column on users (`user` or `admin`).
- Every `/admin/*` route requires `admin`.
- The bootstrap or default-admin path and `scripts/reset_password.py` create or keep the first user as admin.
- A CLI or script command `voidaccess admin promote --email …` for self-hosters.

**S7. Rate-limit client key** (finding 7)
- `client_key` uses the right-most untrusted hop, given `VOIDACCESS_TRUSTED_PROXIES` (count or CIDRs, default 0, meaning the direct peer address).
- Add a per-user limit on authenticated routes, alongside the per-IP one.
- Document both for reverse-proxy setups.

**S8. Web session** (finding 8)
- The web UI stores the session only in an **httpOnly, Secure (in production), SameSite=Lax** cookie set by the Next.js login route. No token in `sessionStorage` or any JavaScript-readable cookie.
- The Next.js API proxy reads the cookie server-side and forwards `Authorization` to FastAPI.
- Logout calls `/auth/logout`, which revokes the JWT `jti`, and clears the cookie.
- The middleware keeps protecting pages.

**S9. RSS snippet-only (cloud licence control)**
- An opt-in `VOIDACCESS_RSS_SNIPPET_ONLY=1` keeps only the headline, link, published date and the feed's own summary or snippet from RSS feeds, and doesn't fetch full article bodies.
- Unset means today's behaviour.
- Document it next to the E1C deny-list.

**S10. Release notes and advisory**
- CHANGELOG.md under a new version (`2.1.0`, since there are schema migrations). Bump `pyproject.toml`.
- A security advisory section in `SECURITY.md` (or `docs/SECURITY-ADVISORY-2026-10.md`): affected versions, what was exposed in multi-user installs, upgrade steps, and the migration notes.
- **Don't publish to PyPI.**

**S11. Tests**
- A **two-user API test suite** covering every route, run against Postgres. For each route, user B gets 404 on A's objects, and B's responses never contain A's data.
- The route-enumeration test (S1), plus migration tests (upgrade an existing database with global monitors, notes, aliases and vectors).
- Rate-limit spoofing tests (a forged `X-Forwarded-For` doesn't change the key without trusted proxies).
- Web tests: no token in `sessionStorage` or JavaScript-readable cookies, and logout revokes.
- RSS snippet-only.
- The full existing suite.

── ACCEPTANCE CRITERIA ─────────────────────────────────────────────────────────
- The full engine suite passes in the 3.11 venv; the only allowed failure is the pre-existing pacing test. The two-user suite and route enumeration pass. `npm test` in `web/` passes.
- The CLI smoke run from a tree copy, `voidaccess investigate "LockBit ransomware" --no-tor --no-llm --depth shallow --quiet --events-jsonl /tmp/e2-events.jsonl`, completes with **no change** to its JSON shape (diff its keys against the same run on `main`).
- Upgrade test: a database created by `main` (`0dd59da`), with global monitors, notes, aliases and vectors, upgrades cleanly and every item ends up owned by the first admin.
- `git log --oneline main..e2-multiuser-security` shows focused conventional commits, `git status --short` is clean, and nothing is pushed.

── CONSTRAINTS ─────────────────────────────────────────────────────────────────
- No new Python dependencies unless justified. No Next.js upgrade.
- Don't touch the E1, E1B or E1C safety ordering, the progress hook, the deny-list, or the CLI JSON shape the cloud runner reads.
- Never print secrets. Never run against the repo's `.env` database.
- Commit messages: plain, conventional, NO AI/assistant attribution of any kind.
- **Don't push and don't merge.** The architect reviews, merges and pushes.

── OUT OF SCOPE (later briefs) ─────────────────────────────────────────────────
- anything in `../platform` (the cloud doesn't run this API)
- a PyPI release
- the relationship-precision pass
- WhoisFreaks and ipgeolocation enrichment

── HANDOFF (reply with this when done) ─────────────────────────────────────────
- the commit list
- for each finding (1–8): what changed, the files touched, and the test that proves it
- the route-enumeration result (with the allow-list and its reasons)
- the per-user entity design and the migration
- the monitor migration and YAML import behaviour
- vector metadata and backfill
- the admin role bootstrap
- the rate-limit key logic and the trusted-proxy configuration
- web session changes
- RSS snippet-only
- upgrade-test evidence
- release notes and advisory text
- full-suite and web test results
- the CLI JSON-shape diff (empty expected)
- deviations with reasons
