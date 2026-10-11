BRIEF — Lane CORE, Sub-phase P0: Platform foundations (data model, ledger, founding seats, engine contract, app shell, CI, infra)

First brief in the CORE lane. It builds the foundations every later platform lane stands on:
- the complete Postgres data model with tenant isolation enforced in the database
- the credit ledger and founding-seat logic
- the engine contract types plus a mock engine
- a minimal app shell
- CI
- Terraform for the GCP pieces

There is **no auth UI, billing UI or investigation UI** in P0; those are later lanes. Build only P0.

In parallel:
- SITE (P1, the marketing site in `.worktrees/p1`)
- ENGINE E1B (engine speed and progress hook; its measurement harness is on branch `e1b-measure` in the main `platform/` checkout)

Never touch `apps/site/`, `runner/`, the main `platform/` checkout, or `../voidaccess`.

── CONTEXT ─────────────────────────────────────────────────────────────────────
Work ONLY in `/Users/delzyn/Brand/companies/voidaccess/platform/.worktrees/p0`. It's a git worktree on branch `p0-foundations`, created from `main` at the scaffold commit. Run `pnpm install` first. The first time you push, use `git push -u origin p0-foundations`. **Never push to `main`.**

Read first:
- `docs/LANES.md`: path ownership; you are CORE
- `docs/ARCHITECTURE.md`: the run lifecycle, the credits reserve → settle → refund model, and masking. §2's job-mode details are superseded by ROADMAP v0.3.
- `docs/ROADMAP.md` v0.3: principles, the archive (P4), and the P0 row
- `docs/ENGINE-CONTRACT.md`: §2 `ProgressEvent`, §3 `ResultBundle`, §4 cloud policy
- `docs/PRICING-v1.md`: including amendment 1 (founding seats) and the engineering interpretations (a)–(e)
- `packages/config/src/pricing.ts`: owned by the architect; import it, never edit it
- `packages/ui/src/tokens.css`: brand tokens; build components on them
- `docs/baseline/E0-REPORT.md` §3, §5: real entity and relationship types and volumes
- the engine's entity taxonomy in `../voidaccess` (read only): `extractor/` entity types and `voidaccess_cli/commands/investigate.py` JSON payload ~:1377

Toolchain: Node 22+ (24 is installed) and pnpm 10.

Versions as of today: Next.js 16.4, Tailwind 4.3, Drizzle ORM 0.45, Better Auth 1.7, Turbo 2.11. Use current stable releases and read each library's current docs, not memory.

Local Postgres 17 is running on the default socket. Create databases `voidaccess_dev` and `voidaccess_test`.

GCP: project `voidaccess-cloud`, region `us-central1`, always with `CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess` (impersonates `va-agent`, which has no project-IAM rights). Existing resources:
- Artifact Registry `voidaccess`
- buckets `voidaccess-cloud-archive` and `voidaccess-cloud-runs`
- KMS key `voidaccess/credentials`
- secrets `openrouter-api-key`, `engine-callback-secret` and `database-url` (the last may have no version yet)
- service accounts `va-app` and `va-runner`

── NON-NEGOTIABLE GUARANTEES ───────────────────────────────────────────────────
1. **Tenant isolation is enforced by the database, not only by app code.**
   - Every tenant-owned table has `user_id NOT NULL` and **Postgres Row-Level Security** keyed on a transaction-local setting (`set_config('app.user_id', …, true)`).
   - The app connects as a non-owner role subject to RLS. A `withUser(userId, fn)` helper is the only way to run tenant queries.
   - A separate, explicitly named `withSystem(fn)` is used for webhooks, cron and admin, and is greppable and audited.
   - Tests prove that user A can't read or write user B's rows through any table, even with a forged ID.
2. **The archive has no tenant link.** The archive (shared corpus) tables have **no** `user_id`, query or investigation-ID columns. A test fails the build if any archive table gains such a column.
3. **Credentials are encrypted at rest.**
   - Raw credential values live only in `credential_vault`: ciphertext from Cloud KMS envelope encryption (a local dev key in dev/test), plus a masked display value and an HMAC fingerprint.
   - Every other table stores only the masked value and the fingerprint.
   - Decryption goes through one function that writes an `audit_log` row each time.
4. **The ledger is append-only and idempotent.**
   - Credits never go negative.
   - Every movement is a row with a unique `idempotency_key`.
   - Concurrent reservations can't double-spend; prove it with a concurrency test.
   - The spend order is the grant bucket first, then top-ups ordered by soonest expiry.
5. **Prices come only from `@voidaccess/config`.** No hard-coded prices or credit amounts anywhere else.
6. **Founding seats can't exceed 100 held at once,** even under concurrent claims. This is a DB-level guarantee, not a check-then-insert.

── DELIVERABLES ────────────────────────────────────────────────────────────────
**C1. `packages/db`** (Drizzle, migrations with drizzle-kit, one schema file per group, exported from `src/schema/index.ts`)

**Auth:** the Better Auth core tables (user, session, account, verification), generated for the Drizzle adapter. Add these columns to `users`:
- `aup_accepted_at`
- `plan` (FK-safe enum from config `PlanId`)
- `status` (active / suspended / banned)
- `role` (user / admin)
- `profile_role`, `profile_use_case`
- `first_touch` jsonb (utm, ref, landing, at)
- `referral_code`

Auth flows themselves are P2.

**Investigations (tenant):**
- `investigations`: id, user_id, query, depth, status (`reserved → launching → running → ingesting → completed | failed | cancelled`), engine_run_id, credits_charged, refined_queries, timestamps, failure_reason, `summary_kind`
- `run_events`: run_id, seq, type, stage, counts jsonb, at; unique (run_id, seq)
- snapshot tables per investigation (immutable after ingest):
  - `inv_entities`: type, value or masked display, fingerprint, sensitive, confidence, first_seen, source_ids, tags
  - `inv_relationships`
  - `inv_actors`
  - `inv_sources`: kind, name, url, fetched_at, excerpt ≤ 500
  - `inv_summary`
  - `inv_exports`: format → object path

**Credits (tenant):**
- `credit_ledger`: user_id, bucket (grant / topup), amount (+ / −), reason (grant, expiry, reserve, settle, refund, topup, bonus, admin), investigation_id?, expires_at?, idempotency_key unique, actor_id?, created_at
- a `credit_balances` view
- `topup_lots`: per-purchase remaining amount and expiry, so the spend order and expiry are exact

**Billing (tenant):**
- `subscriptions`: provider ids, plan, interval, status, period start/end, cancel_at
- `payments`: provider id, amount, currency, kind (subscription / topup), paid_at, period covered

**Founding seats:**
- `founding_seats`: `seat_no` 1–100 primary key; holder user_id unique, nullable; claimed_at, term_start, anniversary_at, released_at, release_reason
- the paid-months-in-trailing-12 calculation derives from `payments`; the last-investigation date derives from `investigations`
- `founding_notices`: scheduled 30-day and release-day notices, so the emails lane can send them

**Platform:**
- `events`: analytics funnel; the names from PRD §7, with user_id nullable, props jsonb, utm/ref
- `abuse_flags`
- `audit_log`: actor, action, target, at, meta
- `run_costs`: investigation_id, compute_usd, llm_usd, tokens, duration, measured_at
- `credential_vault`: guarantee 3

**Archive (no tenant columns, guarantee 2):**
- `archive_entities`: type, canonical value or fingerprint, first_seen, last_seen, observation_count, independent_source_count, confidence_tier
- `archive_sources`: url or onion, first_seen, last_seen, last_alive, content_hash, snapshot object path
- `archive_observations`: entity, source, observed_at, bundle object path
- `archive_relationships`: a, b, type, first_seen, last_seen, evidence_count
- `archive_aliases`
- Only the schema here. Ingest logic is P4.

**Waitlist:** owned by SITE (P1) in `src/schema/waitlist.ts`. Don't create it. Leave its export line for P1.

**Also in `packages/db`:**
- RLS policies plus the two DB roles (owner/migrator and app) in migrations
- `withUser` and `withSystem`
- a seed script: two users, one per plan, sample investigations from the mock bundle
- `docs/DATA-MODEL.md`: an ER diagram (Mermaid), the RLS model, and which lane writes each table

**C2. Ledger and seat library** (`packages/db/src/ledger.ts`, `founding.ts`):
- **Ledger operations:**
  - `grantMonthly(userId, plan, periodStart)`: expires the previous grant remainder
  - `reserve(userId, investigationId, depth)`: fails cleanly when the balance is too low
  - `refund(...)` (full or partial by stages not run)
  - `topup(userId, usd)`: applies the subscriber bonus from config
  - `adminGrant(...)`
  - `expireLots(now)`
- **Founding-seat operations:**
  - `claimFoundingSeat(userId)` is race-safe and returns the seat number or null
  - `runFoundingChecks(now)`: anniversary renewal by the ≥ 3-of-12 rule, the 10-month inactivity release, scheduling notices, releasing seats, and returning the user's target plan
  - `availableSeats()` for the pricing counter
- Unit tests, plus concurrency tests (parallel reserves, parallel claims for the last seat) against the test database.

**C3. `packages/engine-client`:**
- zod schemas and TS types for `RunSpec`, `ProgressEvent` (8-stage enum: refine, collect, filter, fetch, enrich, extract, graph, summarize) and `ResultBundle`, from ENGINE-CONTRACT
- also exported as JSON Schema files (`schemas/*.json`), so the Python runner (R0) validates against the same contract
- HMAC sign and verify for callbacks (timestamp skew ≤ 5 min)
- masking helpers: credentials and tokens shown as `len:N`; emails as `j***@acme.com`; other sensitive values partly masked
- the HMAC fingerprint function

E1B is finalising the engine's event shape now. Keep the event schema in one file, so R0 can reconcile it with a one-line change.

**C4. `packages/engine-mock`:** a fake run that follows the contract.
- Given a `RunSpec`, it emits realistic `ProgressEvent`s over about 60 s (configurable; about 2 s in tests) to the callback URL with valid HMACs, then writes a bundle and posts `completed`.
- Modes: success, failure mid-run, cancel, and blocked-query.
- Fixtures: 3 bundles derived from real E0 runs. Pull CLI JSON from `gs://voidaccess-cloud-runs/baseline/` with va-agent, and convert it into the bundle shape. **Redact for fixtures:**
  - keep public group, malware and CVE names
  - replace IPs, handles, wallets, emails and onion addresses with realistic fakes
  - never commit page text beyond 200-character sanitized excerpts

  The fixtures need real scale (~100–400 entities) so later lanes can test the graph.
- A CLI entrypoint: `pnpm --filter engine-mock run:mock`.

**C5. `packages/ui` components** (CORE owns them; built on tokens.css, Tailwind v4, Radix primitives):
- Button, Input, Textarea, Select, Checkbox, Card, Badge (including entity-type colours), Tabs, Dialog, Toast, Tooltip, Skeleton, Table primitives, EmptyState, CreditPill
- Dark and premium, with keyboard support and readable contrast
- A `/dev/ui` page in apps/app that renders them all

**C6. `apps/app` shell** (Next.js 16 App Router):
- the layout with fonts (Space Grotesk, Inter, JetBrains Mono via `next/font`) and tokens
- a header placeholder with logo, credit pill (static) and user menu placeholder
- `/api/health`: checks the DB and returns the version
- a zod-validated env schema (`apps/app/env.ts`)
- `/dev/ui`
- No auth or product pages.

**C7. CI** (`.github/workflows/ci.yml`):
- pnpm install with cache, typecheck, lint (ESLint flat config + Prettier), test (Vitest) with a Postgres 17 service container, `drizzle-kit check`
- runs on PRs and pushes to `main` and lane branches
- must pass on your branch's push

**C8. `infra/terraform`:**
- **State:** a GCS backend in a new bucket `voidaccess-cloud-tfstate` (versioned).
- **Modules:**
  - Cloud Run service `va-app`: min 0, max 10, `va-app` SA, secrets as env references
  - Cloud Run Job `va-runner`: placeholder image, `va-runner` SA, 1 vCPU / 2 GiB, task timeout 15 min, max retries 0
  - Cloud Scheduler jobs, created **paused**: watchdog every 5 min, founding checks daily, monthly grants daily
  - secret IAM bindings for `va-app` and `va-runner` (resource-level only; va-agent can't change project IAM)
  - a `voidaccess-cloud-runs` bucket IAM binding letting `va-app` read artifacts
- `terraform plan` must be clean.
- **Apply only:** the state bucket, and the Cloud Run service with the app shell image built by Cloud Build. If the `database-url` secret has no version, deploy with health reporting `db: unconfigured` and report it.
- Leave the Scheduler jobs paused.

── ACCEPTANCE CRITERIA ─────────────────────────────────────────────────────────
- **Locally:** `pnpm install`, `pnpm typecheck`, `pnpm lint` and `pnpm test` all pass, and **CI is green** on `p0-foundations`.
- **Isolation tests prove:**
  - cross-user reads and writes return nothing or fail on every tenant table, via both `withUser` and raw app-role SQL
  - a forged `user_id` in an insert is rejected
  - the archive-columns guard works
- **Ledger tests prove:**
  - no negative balance
  - no double spend under 20 parallel reserves
  - spend order and expiry are correct
  - every top-up credit amount equals `topupCredits()`
- **Founding tests prove:**
  - 100 concurrent claims for the last 3 seats give exactly 3 winners
  - renewal at ≥ 3 paid months, release at < 3, release after 10 inactive months, release-day and 30-day notices scheduled correctly
  - `availableSeats` counts reopened seats
- **Mock engine:** a full run against a local test callback server produces valid, HMAC-verified events and a bundle that validates against the JSON Schema.
- **Deploy:** `va-app` is deployed on Cloud Run, and `/api/health` returns 200 at its run.app URL.

── CONSTRAINTS ─────────────────────────────────────────────────────────────────
- Justify every dependency in the handoff. Prefer few, well-maintained ones.
- Don't edit architect-owned paths (`packages/config`, `tokens.css`, root workspace files except adding devDependencies, and `docs/` except `DATA-MODEL.md`). If you need a change there, put it in the handoff.
- No real user data, keys or page text in the repo. Fixtures are redacted.
- Use only va-agent GCP rights. Don't attempt project-IAM changes. Never print secret values.
- Commit messages: plain, conventional, NO AI/assistant attribution of any kind.
- Push `p0-foundations` only. **Don't merge.** The architect reviews and merges.

── OUT OF SCOPE (later briefs) ─────────────────────────────────────────────────
- auth flows and onboarding (P2)
- investigation UI, progress and results (P2/P3)
- archive ingest and enrichment logic (P4)
- Dodo billing integration and billing UI (P5)
- emails and the admin UI (P6)
- the production runner (R0)
- the marketing site and waitlist (P1)

── HANDOFF (reply with this when done) ─────────────────────────────────────────
- the schema overview (tables per group, RLS model, roles)
- isolation-test evidence
- the ledger and founding APIs with test results
- the engine-client contract files and the event-shape note for R0
- the mock modes and fixture provenance (which E0 runs, how they were redacted)
- the UI component list
- the CI run URL
- the Terraform resources: planned vs applied, and the Cloud Run URL
- every dependency with its reason
- requests for architect-owned files
- deviations with reasons
