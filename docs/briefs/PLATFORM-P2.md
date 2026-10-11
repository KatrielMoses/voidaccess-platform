BRIEF — Lane APP, Sub-phase P2: App core (auth, onboarding, run lifecycle on the mock engine, history, settings)

First brief in the APP lane. It builds the product loop on the foundations P0 merged: sign up, verify email, accept the AUP, see the first-run screen, start an investigation at an exact credit price, watch live progress, leave and come back, cancel with a partial refund, get a full refund on failure, and see history and settings. Everything runs against the **mock engine** through a launcher interface; the real Cloud Run runner (R0) plugs into the same interface later.

The results screens (summary, graph, entities, actors, sources, exports) belong to lane RESULTS (P3), which runs in parallel. You link to `/investigations/[id]/results` and build nothing under it. Build only P2.

In parallel:
- RESULTS (P3), later, in `.worktrees/p3`
- SITE (P1) in `.worktrees/p1`
- ENGINE E1B (harness in the main `platform/` checkout)

Never touch `apps/site/`, `apps/app/app/(app)/investigations/[id]/results/**`, `apps/app/features/results/**`, `packages/ingest/`, `runner/`, the main `platform/` checkout, or `../voidaccess`.

── CONTEXT ─────────────────────────────────────────────────────────────────────
Work ONLY in `/Users/delzyn/Brand/companies/voidaccess/platform/.worktrees/p2` (git worktree, branch `p2-app-core`, created from `main`). Run `pnpm install` first. First push: `git push -u origin p2-app-core`. **Never push to `main`.**

Parallel-safe local setup: databases `voidaccess_p2_dev` and (for tests) `VA_TEST_DB=voidaccess_p2_test`; app dev server on **port 3000** (P1 uses 3100, P3 will use 3200). Never touch other lanes' databases.

GitHub Actions is blocked by account billing, so run the CI steps locally and report them: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @voidaccess/db db:check`.

Read first:
- `docs/LANES.md` (you are APP), `docs/DATA-MODEL.md`, `docs/ARCHITECTURE.md` §4 (run lifecycle, watchdog, masking), `docs/ENGINE-CONTRACT.md` v0.3, `docs/PRICING-v1.md`
- `packages/db` (`withUser`, `withSystem`, `ledger.ts`, founding code, schema), `packages/engine-client`, `packages/engine-mock`, `packages/ui`, `apps/app` (P0 shell, `env.ts`)
- `packages/config/src/pricing.ts`: `DEPTHS`, `PLANS`, `hasFeature`, `STAGES`, `STAGE_WEIGHTS`
- the PRD sections 3.2, 3.3, 3.5, 3.8 and 5, pasted at the end of this brief

Versions: Next.js 16.4, Better Auth 1.7. Read the current Better Auth docs (Drizzle adapter, email verification, magic link, GitHub provider) instead of relying on memory.

── NON-NEGOTIABLE GUARANTEES ───────────────────────────────────────────────────
1. **Isolation.** Every user-facing read and write goes through `withUser`. `withSystem` is used only by the engine callback, the spec endpoint, cron routes and account deletion, each with a specific reason string. No route accepts a `user_id` from the client. A test proves user B gets a 404 on user A's investigation page, API, spec URL, SSE stream and cancel action.
2. **The price shown is the price charged.** The form shows `DEPTHS[depth].credits` from config. The server reserves exactly that amount **in the same transaction** as the investigation insert. A balance that is too low means no run and a clear message, never a negative balance.
3. **Every terminal state settles exactly once.**
   - completed: no ledger change
   - failed (including blocked_query, deadline, crash, watchdog): full refund
   - cancelled: refund `ceil(charged × weight of stages not completed / 100)` using `STAGE_WEIGHTS` and `stages_completed`
   
   Idempotency keys make duplicate callbacks and watchdog races harmless. Test it.
4. **Session and access security.** httpOnly, Secure (production), SameSite=Lax cookies; no token readable by JavaScript; CSRF protection on mutations. Email verification is required **before the first investigation**. AUP acceptance is mandatory at signup and its timestamp is stored. Run creation is rate-limited per account: at most 3 concurrent runs, plus a daily cap per plan. Put these defaults in one clearly named constants module and request in the handoff that they move into config.
5. **The engine boundary.** Callbacks are accepted only with a valid HMAC and a timestamp within 300 s, deduplicated on `(run_id, seq)`. The spec URL is single-use, valid for 10 minutes at most, and its token is stored only as a hash. The query never travels in launcher arguments or env vars (ENGINE-CONTRACT §1).
6. **No public dev surfaces.** `/dev/ui` is reachable only in development or by `role=admin`; production returns 404.

── DELIVERABLES ────────────────────────────────────────────────────────────────
**A1. Auth** (Better Auth with the Drizzle adapter on P0's tables)
- email and password, magic link, and GitHub OAuth. GitHub is enabled only when `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set (they don't exist yet; tests use email and password).
- email verification, password reset, sign out, and sign out of all sessions.
- The signup form has a required AUP checkbox linking to `/acceptable-use` on the site; store `aup_accepted_at`.
- On account creation, in one transaction: set plan `free`, call `grantMonthly(free)`, and save `first_touch` and `referral_code`. Read attribution from a `va_ft` cookie (JSON: utm_*, ref, landing, at) or from query params, behind one parser, because P1's exact shape may change.

**A2. `packages/emails`** (new; you own it for now)
- a sender with a log transport in dev and test, and Resend in production when `RESEND_API_KEY` is set
- plain-text templates for verify-email, magic-link and password-reset, with copy in a content file (the growth architect rewrites it later)

**A3. Onboarding** (PRD 3.2)
- After verification, the first-run screen has one search box, **3 example query chips** from a content file (a ransomware group, a malware family, a CVE), and a short "what credits are" note showing the live balance and the Quick and Standard prices from config.
- An optional, skippable 2-question profile (role, main use case) stored on the user.

**A4. New investigation** (PRD 3.3)
- A search box, a depth selector (Quick and Standard only; Deep stays hidden because `DEPTHS.deep.launched` is false), and the exact credit price from config next to each option.
- Block the run with a clear message when the email is unverified or the balance is too low (and offer top-up and upgrade links; billing itself is P5).
- The AI refinement preview ("we'll search for: …") appears as the first live stage of the run, from the `refined` event. Don't add a separate paid preview step.
- On submit: one `withUser` transaction creates the investigation (`reserved`) and calls `reserve`; then the launcher is invoked outside that transaction. A launcher failure moves the run to `failed` and refunds in full.

**A4b. Launcher interface** (`apps/app/lib/launcher/`)
- `RunLauncher { launch(runSpec): Promise<{ executionId }>; cancel(executionId): Promise<void> }`.
- `MockLauncher` starts `packages/engine-mock` in-process or as a child process, pointed at the app's own callback URL. It supports all mock modes through an env var, so every terminal path can be tested.
- `CloudRunLauncher` is a **stub** that throws "not implemented (R0)". Selection is by env var.
- The spec endpoint is `GET /api/engine/runs/{run_id}/spec?t=<token>` (single-use). Callbacks go to `POST /api/engine/runs/{run_id}/events`.

**A5. Run lifecycle**
- States: `reserved → launching → running → ingesting → completed | failed | cancelled`.
- The callback route verifies the HMAC, deduplicates on `(run_id, seq)`, writes `run_events`, and moves the state. On `completed` it sets `ingesting` and calls an `ingestBundle(runId)` hook. Lane P3 provides the real ingest. **Ship a no-op default that marks the run `completed`**, so you can test without P3, and let P3 register its implementation with one line.
- Progress delivery: an SSE endpoint `GET /api/investigations/[id]/events` streaming `run_events` from the database (poll the DB every 1–2 s per open stream, resume from `Last-Event-ID`). Runs continue server-side when the page closes.
- Watchdog: `POST /api/cron/watchdog` (the Cloud Scheduler OIDC identity, or a shared secret in dev). A run with no event for 10 minutes, or an execution that failed without a terminal event, becomes `failed` and refunds. Terraform's Scheduler jobs already exist paused; don't change them.
- Cancel: `POST /api/investigations/[id]/cancel` calls the launcher's cancel and settles per guarantee 3 once the `cancelled` event arrives, or after a short timeout.

**A6. Progress and history UI**
- `/investigations/[id]`: the live progress page. It shows the 8 stages (from `STAGES`) with the current stage highlighted, counts that tick up (sources, pages, entities, actors), the refined queries, elapsed time, a Cancel button, and a "you can leave; we'll email you" note. When the run completes, link to `/investigations/[id]/results` (P3). Until P3 merges, that link may 404; that's expected.
- Failed and cancelled runs show what was refunded and why, in plain words.
- `/investigations`: a list with title (the query), date, depth, credits used and status; search by text and filter by status; rename; delete. Delete calls a `deleteInvestigation` function that removes the snapshot rows too.
- A "results ready" email when a run completes with the user away: a plain-text template using the A2 sender (logged in dev).

**A7. Header and settings**
- The header shows the live credit balance pill (from `credit_balances`) and a user menu.
- `/settings`: profile (name, email with re-verification), password, connected GitHub account, a data export button (JSON of the user's own rows) and **account deletion**. Deletion removes tenant rows and anonymises ledger rows (P0 keeps ledger rows with `user_id ON DELETE RESTRICT`, so anonymise the user instead of hard-deleting). Do it through a documented `withSystem("account.delete")` path and write an `audit_log` row.
- `/dev/ui` is gated per guarantee 6.

**A8. Analytics events** (first-party `events` table, via `withSystem`): `signup_started`, `signup_completed`, `email_verified`, `first_investigation_started`, `first_investigation_completed`. Attach the first-touch attribution. Other PRD events belong to later lanes.

**A9. Tests**
- Isolation: guarantee 1 across every route, using two users.
- Lifecycle: a table-driven test for each mock mode (success, failure, cancel, blocked-query, deadline) that checks the final status, the ledger rows and the refund amounts.
- Idempotency: duplicate callbacks, out-of-order events, a late event after a terminal one, and a watchdog racing a real completion; the ledger changes exactly once.
- The reserve: 20 parallel starts on a balance that covers 2 runs give exactly 2 runs.
- Auth: unverified users can't start a run, the AUP is required, and signup grants the free credits exactly once.
- One Playwright end-to-end test on the mock engine: sign up, verify through the log transport, accept the AUP, start a Quick run, watch progress finish, see the balance drop by 20, then start a second run and cancel it to see the partial refund.

── ACCEPTANCE CRITERIA ─────────────────────────────────────────────────────────
- The local CI steps pass, and the Playwright end-to-end test passes.
- Sign up to a finished mock run takes under 5 minutes of real time with the mock set to its default speed, with no documentation needed.
- Every terminal path leaves the ledger correct (shown in the test output).
- `/dev/ui` returns 404 in a production build for a non-admin.
- Screenshots of sign-up, first-run, new investigation, live progress, history and settings at 375 px and 1440 px are in `apps/app/docs/screenshots/`.

── CONSTRAINTS ─────────────────────────────────────────────────────────────────
- Justify every dependency in the handoff; keep them few.
- Don't edit architect-owned paths (`packages/config`, `tokens.css`, root workspace files except adding devDependencies, `docs/`), P0's database schema except by adding new migrations in `packages/db`, or lane RESULTS' paths. If you need a schema change, add a migration, keep it minimal and explain it in the handoff.
- Never print secrets. No real user data in the repo.
- Commit messages: plain, conventional, NO AI/assistant attribution of any kind.
- Push `p2-app-core` only. **Don't merge.** The architect reviews and merges.

── OUT OF SCOPE (later briefs) ─────────────────────────────────────────────────
- the results screens, bundle ingest, graph and exports (P3)
- the Cloud Run launcher and the production runner (R0)
- Dodo billing, top-ups, upgrades, founding-seat claim UI and the credit usage ledger page (P5)
- lifecycle emails beyond the three auth emails and "results ready", plus the admin UI (P6)
- Google OAuth, 2FA and BYO API keys (P8)

── HANDOFF (reply with this when done) ─────────────────────────────────────────
- the route map and which `withSystem` reasons exist
- the launcher interface and the mock modes
- the ingest hook contract for P3
- a table of the settlement behaviour for each terminal path, with test evidence
- the Better Auth configuration (cookie flags, CSRF, rate limits)
- the rate-limit constants you chose
- any schema migrations you added
- every dependency with its reason
- the local CI output and the end-to-end test result
- screenshots
- requests for architect-owned files
- deviations with reasons

── APPENDIX: PRD sections 3.2, 3.3, 3.5, 3.8 and 5 ─────────────────────────────
Katriel will paste these PRD sections below this line when sending the brief.
