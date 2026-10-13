# Data model (P0)

Source of truth is `packages/db/src/schema/*.ts` plus the hand-written RLS migration `packages/db/drizzle/0001_rls.sql`. This page explains it; if they disagree, the code wins and this page is wrong.

## 1. ER diagram

```mermaid
erDiagram
  users ||--o{ sessions : has
  users ||--o{ accounts : has
  users ||--o{ investigations : owns
  investigations ||--o{ run_events : emits
  investigations ||--o{ inv_entities : snapshot
  investigations ||--o{ inv_relationships : snapshot
  investigations ||--o{ inv_actors : snapshot
  investigations ||--o{ inv_sources : snapshot
  investigations ||--|| inv_summary : snapshot
  investigations ||--o{ inv_exports : snapshot
  investigations ||--o| run_costs : measured
  users ||--o{ credit_ledger : "append-only"
  users ||--o{ topup_lots : buys
  topup_lots ||--o{ credit_ledger : "lot_id"
  users ||--o{ subscriptions : has
  users ||--o{ payments : pays
  users ||--o| founding_seats : holds
  users ||--o{ founding_notices : "notified by"
  users ||--o{ credential_vault : "encrypted values"
  users ||--o{ events : "funnel (nullable)"
  users ||--o{ abuse_flags : "flagged (nullable)"
  archive_entities ||--o{ archive_observations : seen
  archive_sources ||--o{ archive_observations : "seen at"
  archive_entities ||--o{ archive_relationships : a
  archive_entities ||--o{ archive_aliases : known_as
```

The archive group (bottom four lines) has **no edge to any tenant table**, by design (see §4).

## 2. Tables, grouped, and which lane writes them

| Group | Tables | Class | Written by |
|---|---|---|---|
| Auth | `users`, `sessions`, `accounts`, `verifications` | tenant (`verifications`: system-only) | P2 (Better Auth adapter, on the system role) |
| Investigations | `investigations` | tenant, app role may insert/update/delete own | P2 (create, cancel), runner callbacks (status) via system |
| | `run_events` | tenant, app read-only | callbacks route (P2) via system |
| Snapshots | `inv_entities`, `inv_relationships`, `inv_actors`, `inv_sources`, `inv_summary`, `inv_exports` | tenant, app read-only, **immutable** (UPDATE blocked by trigger) | P3 ingest via system |
| Credits | `credit_ledger`, `topup_lots`, view `credit_balances` | tenant, **append-only** | `packages/db/src/ledger.ts`: P2 (reserve), P5 (grants, top-ups), watchdog/cron (refund, expiry) |
| Billing | `subscriptions`, `payments` | tenant, app read-only | P5 webhooks via system |
| Founding | `founding_seats` (100 fixed rows), `founding_notices` | seats: own-row read; notices: tenant read-only | `founding.ts`: P5 (claim), cron (checks); P6 sends notices |
| Platform | `events`, `abuse_flags`, `audit_log`, `run_costs` | system-only | P6 (events, abuse, admin), runner/callbacks (costs), every `withSystem` call (audit) |
| Hardening (H1) | `rate_limits`, `rate_limit_events`, `blocked_email_domains` | system-only | auth rate limiter and run creation (`apps/app/lib/rate-limit.ts`); P6's abuse queue reads `rate_limit_events` and its admin UI manages `blocked_email_domains` |
| | `app_ctx_key` | nobody (owner only, read by a `SECURITY DEFINER` function) | provisioning script / test harness; see §3 "Tamper-proof tenant context" |
| Vault | `credential_vault` | system-only, envelope-encrypted | P3 ingest (`storeCredential`), admin unmask (`decryptCredential`) |
| Archive | `archive_entities`, `archive_sources`, `archive_observations`, `archive_relationships`, `archive_aliases` | shared, app read-only, **no tenant columns** | P4 ingest via system |
| Waitlist | `waitlist` | owned by SITE (P1), not in P0 | P1 |

## 3. Tenant isolation model

**Roles** (`0001_rls.sql` created `va_app` and `va_system`; `0006_h1_role_split.sql` split the login):

```mermaid
flowchart LR
  subgraph app["app server (Cloud Run)"]
    U["user-facing code: withUser"]
    S["system code: withSystem, Better Auth"]
  end
  U -- "DATABASE_URL (app pool)" --> VA["va_app: LOGIN, member of NO role, RLS own_rows"]
  S -- "DATABASE_URL_SYSTEM (system pool)" --> VW["va_worker: LOGIN, inherits va_system"]
  VW -- "member (INHERIT, SET)" --> VS["va_system: NOLOGIN, policy system_all"]
  VA -. "SET ROLE: refused" .-> VS
  SITE["marketing site"] -- "database-url-site" --> VSITE["va_site: LOGIN, waitlist only"]
  OWN["owner / migrator"] -- "MIGRATE_DATABASE_URL" --> DB[("tables, SECURITY DEFINER functions")]
```

| Role | Purpose | Notes |
|---|---|---|
| owner / migrator | runs migrations, owns tables and `SECURITY DEFINER` functions | never used by the running app; `MIGRATE_DATABASE_URL` |
| `va_app` | user-facing work only: `withUser` (`DATABASE_URL`) | not owner, not superuser, no BYPASSRLS, **a member of no role** (since H1 it cannot `SET ROLE va_system`). Least-privilege grants (below). Created `NOLOGIN`; ops sets `LOGIN PASSWORD` (the test harness does it for tests) |
| `va_worker` | the login for system work: `withSystem` and Better Auth (`DATABASE_URL_SYSTEM`, a separate pool) | member of `va_system` with `INHERIT TRUE, SET TRUE`, so the system policies and grants reach it **through `va_system`**; it owns no privilege of its own (a test asserts this). Created `NOLOGIN`; ops sets `LOGIN PASSWORD` |
| `va_system` | the role the `system_all` policies and system grants are written for | `NOLOGIN`; only `va_worker` is a member. `withSystem` still runs `SET LOCAL ROLE va_system`, so `current_user` is `va_system` inside it |
| `va_site` | the marketing site's waitlist writes | `LOGIN`, `waitlist` table only (created by the provisioning script) |

**Design choice:** `va_worker` inherits `va_system` instead of owning the system policies directly. The policies stay exactly as written in `0001` (one `system_all` per table, `TO va_system`), a table nobody grants to `va_worker` stays closed, and the audit/ledger rules that are written against `va_system` (for example no `UPDATE`/`DELETE` on `credit_ledger`) apply unchanged.

**Two entry points, nothing else** (`packages/db/src/client.ts`; `createDatabase(url, { systemUrl, contextKey })` opens two pools):

- `withUser(userId, fn)`: on the **app pool**, opens a transaction and sets `app.user_id` and `app.user_sig` (transaction-local). Every tenant policy is `user_id = app_user_id()`, with the same expression as `WITH CHECK`, so reads, updates, deletes and inserts are all scoped, and a forged `user_id` on insert is rejected. With no valid context, `app_user_id()` is NULL and nothing matches.
- `withSystem(reason, fn)`: on the **system pool**, a transaction with `SET LOCAL ROLE va_system`; policy `system_all` (`USING true`). Requires a reason and writes an `audit_log` row (`action = system_tx`, `meta.reason`) unless `{ audit: false }` is passed explicitly. `grep -rn withSystem` lists every place that bypasses tenant scoping. Better Auth's adapter uses the same system pool (`apps/app/lib/auth/auth-db.ts`).
- In production the app refuses to start without `DATABASE_URL`, `DATABASE_URL_SYSTEM` and `RLS_CONTEXT_KEY` (`apps/app/instrumentation.ts`, `getDatabase()`).

**Tamper-proof tenant context (H1).** `app.user_id` alone is a plain GUC: any statement running as `va_app` could overwrite it (`select set_config('app.user_id', '<victim>', true)`, even inside the same statement as the query), which would defeat every `own_rows` policy for an SQL-injection attacker. So `withUser` also sets `app.user_sig = HMAC-SHA256(RLS_CONTEXT_KEY, user id)`, and `app_user_id()` (`SECURITY DEFINER`) returns the id only when the signature verifies against the key stored in `app_ctx_key`, a table no login can read (RLS on, no policy, all grants revoked). Consequences, all covered by `packages/db/test/role-split.test.ts`:

| An attacker with arbitrary SQL as `va_app` ... | Possible? |
|---|---|
| `SET ROLE va_system` / `va_worker` / a superuser / `pg_read_all_data`, `SET SESSION AUTHORIZATION`, `set_config('role', ...)` | No (permission denied) |
| read another user's rows after `set_config('app.user_id', victim)` with no, a wrong, or a replayed (another user's) signature, in a separate statement or the same one | No: zero rows |
| read `app_ctx_key` or call anything that returns the key | No |
| act as the user the transaction was opened for, and read that user's own signature (`current_setting('app.user_sig')`) | Yes, by design: it is that user's data and the signature is useless for any other id |
| anything **without** an open `withUser` transaction | Sees nothing: no context, no rows |
| read system-only tables (`accounts`, `audit_log`, ...) | No (no grants) |

What this does **not** cover: code that holds `DATABASE_URL_SYSTEM` (any `withSystem` caller, Better Auth) is trusted and bypasses tenant RLS by design, and a leak of `RLS_CONTEXT_KEY` (Secret Manager, app service account) lets its holder sign any user id. Rotating the key = update `app_ctx_key` and the secret together, then restart (the provisioning script keeps the existing key on re-run). With no key installed, `app_user_id()` is NULL: the app fails closed (empty results), never open.

**Least privilege for `va_app`** (beyond RLS): read-only on snapshots, run events, billing and lots; `INSERT` on `credit_ledger` limited by policy to rows that are `reason = 'reserve' AND amount < 0` for the caller's own investigation (a user cannot mint credits); column-level `UPDATE` on `users` (name, image, profile fields, AUP timestamp only); no access to `accounts` (password hashes, tokens), `verifications`, `events`, `abuse_flags`, `audit_log`, `run_costs` or `credential_vault`. New tables get grants for `va_system` only (default privileges), so a table someone forgets to grant is closed to the app, not open.

**Guards that fail the build** (`packages/db/test/guards.test.ts`, `isolation.test.ts`, `role-split.test.ts`): every public table has RLS unless explicitly allow-listed; every table with a `user_id` column must be covered by the isolation seed; the app role is not owner/superuser/BYPASSRLS, is a member of no role, and cannot `SET ROLE` to one that bypasses RLS; cross-user reads, updates, deletes and forged inserts return nothing or fail for every tenant table, through `withUser` and through raw app-role SQL.

**Notes for lanes:**
- Better Auth looks up sessions before a user is known: its adapter uses the system pool (`va_worker`).
- New system-only table (no `va_app` grants): `ENABLE ROW LEVEL SECURITY` plus the `system_all` policy, and list it in the system-only tests (`isolation.test.ts`). New tables get `va_system` grants by default privileges, which `va_worker` inherits: if a table must be unreadable even to system code (like `app_ctx_key`), `REVOKE` it explicitly.
- New tenant table: add `user_id uuid NOT NULL`, `ENABLE ROW LEVEL SECURITY`, an `own_rows` policy and a `system_all` policy (copy from `0001_rls.sql`), grant only what `va_app` needs, and add it to the isolation seed. The guard test will tell you if you forget.
- Migrations from different lanes share one drizzle journal; the architect resolves numbering when merging.

## 4. The archive has no tenant link

`archive_*` tables carry findings only: no `user_id`, no query text, no investigation id, no session or IP. `guards.test.ts` fails the build if any archive column name matches user/query/investigation/session/owner/account/tenant/email/ip or if an archive table gains a foreign key to a non-archive table. Ingest (P4) must write through `withSystem` from the bundle's entities and sources only.

## 5. Credits ledger

- Append-only: triggers block `UPDATE`/`DELETE`/`TRUNCATE` (even for the owner), and `va_system` has no `UPDATE`/`DELETE` grant. Users with ledger rows are anonymised, not hard-deleted (`ON DELETE RESTRICT`); `investigation_id` and `actor_id` are plain uuids with no FK so deleting an investigation never rewrites history.
- Every row has a unique `idempotency_key` (`reserve:<inv>:grant`, `reserve:<inv>:lot:<id>`, `refund:<inv>:…`, `grant:<user>:<period>`, `topup:<paymentRef>`, `expiry:lot:<id>`, `admin:<key>`).
- A `BEFORE INSERT` trigger takes a per-user advisory lock and refuses any insert that would take the grant bucket below zero; for top-up rows it updates `topup_lots.remaining`, which has `CHECK (0 <= remaining <= credits_initial)`. So no code path, including a buggy one, can overdraw or double-spend.
- Spend order: grant bucket, then lots by soonest `expires_at`. Expired-but-unswept lots are never spendable. `expireLots(now)` writes the `expiry` rows.
- `credit_balances` is `security_invoker`, so RLS applies to whoever queries it. It reflects ledger sums, so lots past expiry still show until `expireLots` runs.
- Stage weights for partial refunds live in `packages/db/src/stage-weights.ts` (request: move to `@voidaccess/config`).

## 6. Founding seats

`founding_seats` holds exactly 100 pre-inserted rows (`seat_no` 1–100, enforced by PK and CHECK). A seat is held while `holder_user_id IS NOT NULL` (unique). Claim is one `UPDATE … WHERE seat_no = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`, so 100 concurrent claims for the last 3 seats give exactly 3 winners. Paid months in the trailing 12 are derived from `payments` (distinct calendar months of `period_start` in `[anniversary − 12 months, anniversary)`); the last-investigation date is derived from `investigations`. `founding_notices` rows are scheduled by `runFoundingChecks`, deduped on `(user_id, kind, ref_at)`, and sent by the emails lane (`sent_at IS NULL AND scheduled_for <= now`). `availableSeats()` calls the `SECURITY DEFINER` function `founding_seats_available()`, which is safe to expose to the public pricing page.

## 7. Credential vault

Raw sensitive values exist only in `credential_vault.ciphertext` (AES-256-GCM, random DEK per value, DEK wrapped by Cloud KMS in production via `KMS_KEY_NAME`, or by a local KEK via `VA_LOCAL_KEK` in dev/test). Other tables store only `masked_value`/`display_value` and the HMAC fingerprint (`VA_FINGERPRINT_KEY`). `decryptCredential()` is the single decrypt path and writes an `audit_log` row (`credential.decrypt`, actor, reason) before decrypting.

## 8. Environment

| Variable | Used by |
|---|---|
| `DATABASE_URL` | app: `va_app` connection (RLS applies); `withUser` |
| `DATABASE_URL_SYSTEM` | app: `va_worker` connection; `withSystem` and Better Auth. Required in production |
| `RLS_CONTEXT_KEY` | app: signs the tenant context; must equal the key in `app_ctx_key`. Required in production (>= 32 chars); outside production the development key from `packages/db/src/local.ts` is used |
| `VA_APP_LOCAL_PASSWORD` / `VA_WORKER_LOCAL_PASSWORD` | local and test harnesses only: the passwords of the two logins (`@voidaccess/db/local`) |
| `MIGRATE_DATABASE_URL` | `pnpm --filter @voidaccess/db db:migrate`, `drizzle-kit`: owner connection |
| `TEST_DATABASE_URL` | tests: a superuser connection to any database on the test server; the harness drops and recreates `voidaccess_test` |
| `KMS_KEY_NAME` / `VA_LOCAL_KEK` | vault key wrapping (KMS in production, local KEK in dev/test) |
| `VA_FINGERPRINT_KEY` | HMAC fingerprints |

## 9. Rate limits, blocked domains, run events, viewing (H1)

- **`rate_limits`** (system-only): counters for Better Auth's rate limiter, one row per `<ip>|<path>` key (`id`, `key` unique, `count`, `last_request` epoch ms), same shape as Better Auth's own `rateLimit` model. `apps/app/lib/rate-limit.ts` implements the limiter's `customStorage` over it with one atomic upsert per request, on the database clock, so limits hold across Cloud Run instances. The per-path limits stay in `apps/app/lib/limits-auth.ts`.
- **`rate_limit_events`** (system-only): one row per request that hit a limit: `source` (`auth` or `run_create`), `path` (the auth path, or `rate_limited_concurrent` / `rate_limited_daily`), `user_id` (null when unknown, `ON DELETE SET NULL`), `ip_hash` (a keyed hash, never the address) and `at`. P6's abuse queue reads it.
- **`blocked_email_domains`** (system-only): `domain` (primary key, lower-case, at least one dot), `reason`, `created_by`, `created_at`. A sign-up is refused when the address's domain **or any parent domain** is listed. Checked in the Better Auth `before` hook for `/sign-up/email` and `/sign-in/magic-link` (new addresses only: existing accounts still sign in) and again in the user-creation database hook, which every path (email, magic link, GitHub) goes through. Every refusal returns the same message.
- **`run_events.status`** (nullable; `start`, `end`, `skipped`, `failed`): stage events are stored as `type = 'stage'` with the lifecycle in `status`; every other event type has a null status. Migration `0008` rewrites the legacy `stage_end` / `stage_skipped` / `stage_failed` rows (and gives old `stage` rows `start`); it is idempotent. Completed stages are the `stage` events with status `end`.
- **`investigations.last_viewed_at`**: written by the SSE stream (when it opens, then at most every 30 s, on the database clock). The results-ready email is sent only when no instance has viewed the run in the last 60 s. **`investigations.summary_kind`** is set by ingest from the bundle (`llm`, `fallback`, `none`; `none` when absent).
- **Refunds:** credits taken from a top-up or admin lot that has expired by the time of the refund go to the user's current grant bucket (key `refund:<inv>:expired-lot:<lot>`), never into the expired lot.
