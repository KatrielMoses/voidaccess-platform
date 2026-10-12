BRIEF — Lane HARDENING, Sub-phase H1: Platform hardening (DB role split, shared rate limits, ledger and lifecycle fixes)

First brief in the HARDENING lane. Reviews of P0–P5, R0, P4 and D1 left a short list of security and correctness items, too small to block the merges but each worth fixing before real users arrive. This sub-phase closes them all. Build only H1.

In parallel:
- OPS (P6) in `.worktrees/p6`: the admin console, emails, analytics. P6 uses `withUser`/`withSystem` through their public API and builds the admin UI for blocked email domains on top of **your** `blocked_email_domains` table.
- ENGINE (E2) in `../voidaccess`.

Never touch P6's paths (`app/(admin)/**`, `app/api/admin/**`, `lib/admin/**`, `packages/emails` lifecycle templates, `/settings/notifications`), `runner/`, `apps/site/`, or `../voidaccess`.

── CONTEXT ─────────────────────────────────────────────────────────────────────
Work ONLY in `/Users/delzyn/Brand/companies/voidaccess/platform/.worktrees/h1` (git worktree, branch `h1-hardening`, created from `main`). Run `pnpm install` first. First push: `git push -u origin h1-hardening`. **Never push to `main`.**

**Local setup:** databases `voidaccess_h1_dev` and (for tests) `VA_TEST_DB=voidaccess_h1_test`; app dev server on **port 3900**. Playwright suites use per-suite `outputDir` and `NEXT_DIST_DIR`, as the existing configs do.

CI runs on GitHub on every push (the repository is public) and must be green. Run the steps and all end-to-end suites locally from a clean worktree, and check exit codes. Don't pipe a gating command through `tail` or `grep` and trust the result. **The repository is public:** no secrets.

**Nothing in this brief touches production.** Migrations, secrets and deploys happen in the final verification pass, which the architect runs. Deliver the code, the migrations and an updated provisioning script.

Read first:
- `docs/DATA-MODEL.md`
- `packages/db`:
  - `src/client.ts` (`createDatabase`, `withUser`, `withSystem`, which today does `SET LOCAL ROLE va_system`)
  - `drizzle/0001_rls.sql` (roles: `va_app` is granted `va_system` with `SET TRUE`)
  - `ledger.ts` (`refund`, lots and expiry)
  - `scripts/neon-provision.ts`
- `apps/app`:
  - `lib/auth/**` (Better Auth config; its pool connects as `va_app` with `-c role=va_system`; rate limits are in-memory per instance)
  - `lib/runs/**`: the callbacks, which store stage events as types `stage`, `stage_end`, `stage_skipped` and `stage_failed`; the SSE stream; the per-instance "viewer active" marker for the results-ready email; `complete.ts`
  - `lib/limits.ts` and `lib/limits-auth.ts`
- `packages/ingest` (`ingestBundle`; it doesn't set `investigations.summary_kind`) and `packages/engine-client` (`ResultBundle.summary.summary_kind`, added by R0)

── NON-NEGOTIABLE GUARANTEES ───────────────────────────────────────────────────
1. **Tenant isolation must not regress.** Every existing isolation, guard and RLS test keeps passing, and the new roles are covered by new tests.
2. **The app's normal role can no longer escalate.** After H1, the role the app uses for user-facing work (`va_app`) can't `SET ROLE` to anything that bypasses RLS. A SQL-injection bug in user-facing code must not be able to read other users' data. System work runs on a separate login and a separate pool.
3. **No behaviour change for users** beyond the fixes listed. The prices, the ledger semantics of every existing test and the run lifecycle stay as they are.
4. **Migrations are forward-only and safe on a live database** (production has real rows from the proof runs). Data migrations are idempotent.

── DELIVERABLES ────────────────────────────────────────────────────────────────
**H1-1. DB role split** (guarantee 2)
- **A new login role, `va_worker`.** It's the only role that can act as `va_system` (or owns the system policies directly; choose the simpler design and document it).
  - Revoke `va_system` from `va_app`.
  - `va_worker` has no table rights of its own beyond what `va_system`'s policies grant.
- **`createDatabase` gets two pools:**
  - the app pool (`DATABASE_URL`, `va_app`) for `withUser`
  - the system pool (`DATABASE_URL_SYSTEM`, `va_worker`) for `withSystem`

  Keep the `withSystem` signature and its audit row. If `DATABASE_URL_SYSTEM` is missing in production, fail at startup. In dev and test, both URLs come from the harness.
- **Better Auth** uses the system pool, instead of `va_app` with `-c role=va_system`.
- **Tests:**
  - `va_app` can't `SET ROLE va_system` (or any role that bypasses RLS)
  - a raw `va_app` query can't read another user's rows, even with `set_config('app.user_id', …)` tricks inside one statement (document what's possible and what isn't)
  - `withSystem` still works and still audits
  - Better Auth sign-in and sign-up still work
- **Update `packages/db/scripts/neon-provision.ts`:** create `va_worker` with a random password and store `database-url-system` (the architect runs it in the verification pass; don't run it). Update `apps/app/env.ts`, Terraform's app secret list (`database-url-system`) and `.env.example`.

**H1-2. Shared rate limiting**
- **Auth limits:** Better Auth's rate limiter switches to its **database storage** (a migration adds its table), so limits hold across Cloud Run instances. Keep the per-path limits in `lib/limits-auth.ts`.
- **Run creation:** confirm the concurrency and daily caps are DB-backed. Fix any in-memory part.
- **Rate-limit hits:** record each hit (auth path or run creation, user id if known, an IP hash only, never the raw IP, and a time) in a system-only `rate_limit_events` table, so P6's abuse queue can show them.

**H1-3. Blocked email domains**
- A table, `blocked_email_domains` (domain, reason, created_by, created_at), system-only.
- The sign-up path rejects an email whose domain, or any parent domain, is blocked. Return the same generic error as other sign-up failures (no enumeration). Cover magic-link sign-up too.
- P6 builds the admin UI on this table. Name the migration clearly, so the architect can drop P6's placeholder.

**H1-4. `run_events` status column** (P2's request)
- Add a nullable `status` column (`start`, `end`, `skipped`, `failed`).
- Data migration: rows with type `stage_end`, `stage_skipped` or `stage_failed` become type `stage` with the matching status.
- The callback handler stores stage events that way.
- The SSE stream and the cancel-settlement logic (which derives completed stages) read the new shape.
- Every existing lifecycle and idempotency test passes.

**H1-5. `summary_kind` at ingest.** Ingest sets `investigations.summary_kind` from the bundle's `summary.summary_kind` (`llm`, `fallback` or `none`; default `none` when absent), in the same transaction. P3's results page already reads it.

**H1-6. Results-ready email across instances.** Replace the per-instance "viewer active" marker with a DB timestamp (`investigations.last_viewed_at`, updated by the SSE stream at most every 30 s). The results-ready email is sent only when nobody has viewed the run in the last 60 s. Test it with two simulated instances.

**H1-7. Refunds into expired buckets.** A refund whose original credits came from a grant or top-up lot that has since expired is credited to the user's current grant bucket, never to an expired lot, so no refund is silently lost. Test it at a month boundary and on lot expiry.

**H1-8. Tests and docs.** Update `docs/DATA-MODEL.md` with the role diagram (`va_app`, `va_worker`, `va_system`, `va_site`, owner) and the new tables. Every migration is named clearly; the architect renumbers at merge.

── ACCEPTANCE CRITERIA ─────────────────────────────────────────────────────────
- CI is green on `h1-hardening`. Local steps and **all** end-to-end suites pass from a clean worktree, exit codes checked: `test:e2e` (in production mode with `E2E_PROD=1 COOKIE_DOMAIN=localhost SITE_URL=http://localhost:3700 TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA`), `test:e2e:results`, `test:e2e:billing` and `test:e2e:archive`.
- The role-escalation tests prove guarantee 2.
- Auth rate limits hold across two app instances sharing one database (a test with two server instances or two auth handlers).
- The data migration for `run_events` is idempotent and leaves existing runs readable.

── CONSTRAINTS ─────────────────────────────────────────────────────────────────
- No new dependencies unless justified.
- Don't edit P6's paths, architect-owned paths (`packages/config`, `tokens.css`, root workspace files except adding devDependencies, `docs/` except `DATA-MODEL.md`), or anything in production.
- Never print secrets.
- Commit messages: plain, conventional, NO AI/assistant attribution of any kind.
- Push `h1-hardening` only. **Don't merge.** The architect reviews and merges.

── OUT OF SCOPE (later briefs) ─────────────────────────────────────────────────
- running the provisioning script, migrations, secrets or deploys (the final verification pass)
- 2FA, monitors, BYO keys (P8)
- the relationship-precision pass
- engine changes (E2)

── HANDOFF (reply with this when done) ─────────────────────────────────────────
- the role design (diagram) and how `withSystem` and Better Auth connect now
- the escalation test evidence
- the rate-limit storage and the `rate_limit_events` shape
- the blocked-domain check (where it runs, and its response)
- the `run_events` migration and the code paths updated
- the `summary_kind`, `last_viewed_at` and refund-bucket fixes with test evidence
- migrations added
- the provisioning script, env, Terraform and `.env.example` changes the verification pass needs
- CI and local results, including all end-to-end suites
- deviations with reasons
