# Admin console, lifecycle email and the funnel (P6)

## Who can open the console

Only the **owner**. Access needs ALL of: the console is configured (`ADMIN_PATH` set), a valid session, user status active,
`users.role = 'admin'`, and a verified email equal (trimmed, case-insensitive) to `ADMIN_EMAIL` (default
`katriel@voidaccess.pro`), plus a **step-up** from the owner's authenticator app in the last hour. Anyone else, an admin with
another email and signed-out visitors included, gets the same 404 as any unknown page.

There is **no UI and no API** that assigns the role, and the app's database role cannot update the column (column-level
grants; a test proves it). The owner's account needs it once, with the ops script and the **owner** database URL:

```
MIGRATE_DATABASE_URL=postgres://<owner>@<host>/<db> \
  pnpm --filter @voidaccess/app admin:grant-role -- --email katriel@voidaccess.pro --reason "owner"
# revoke: add  --role user
```

`--reason` is required; the change and its `audit_log` row (`admin.role.grant` / `admin.role.revoke`, actor `ops:<os user>`)
are one transaction. The script refuses to run as `va_app` or `va_system`.

## Ops: setting up the console (once)

1. **Secret path.** Generate the slug and store it in Secret Manager as `admin-path` (the repo is public: the value is never
   committed, logged or put in Terraform; only the secret's name is):
   ```
   printf 'admin-%s' "$(openssl rand -hex 16)" | pbcopy   # keep a copy in your password manager
   bash infra/bootstrap/add-secret.sh admin-path
   ```
   Terraform (`infra/terraform`) passes it to the app as `ADMIN_PATH` and grants `va-app` access; `ADMIN_EMAIL` is a plain
   env var (`var.admin_email`). Create the secret **before** the next `terraform apply`, or the plan fails on the missing
   secret. Rotating it = add a new version and deploy a new revision (`latest` is read at start); the old URL is then a 404.
2. **Role.** Grant the owner's account the admin role once (above).
3. **First visit.** Open `https://app.voidaccess.pro/<slug>` signed in as the owner. The first visit shows the enrolment
   screen (QR code, the key in groups of 4, issuer `VoidAccess`, account = the email). Scan it with Google Authenticator (or
   any TOTP app) and enter the current code; only then is the enrolment saved. Do this right after the first deploy: until
   then anyone holding the owner's session could enrol.
4. **Every later visit** asks for a code once an hour ("Lock now" in the nav ends it early).

**Re-enrolment** (lost phone, new device) is an ops step, never the UI:

```
MIGRATE_DATABASE_URL=postgres://<owner>@<host>/<db> \
  pnpm --filter @voidaccess/app admin:mfa-reset -- --email katriel@voidaccess.pro --reason "new phone"
```

It deletes the owner's `admin_totp` / `admin_totp_pending` vault rows (audited `admin.mfa.reset`); the next visit enrols
again. A step-up already issued stays valid until it expires (at most an hour): if the device was lost to someone else,
also revoke the owner's sessions.

## How access is enforced

Every request, from the real session (the role and email are read from the database row each time, so revoking takes effect at once):

- **Secret path** (`proxy.ts`, `lib/admin/path.ts`): the pages live at the internal `app/(admin)/admin/**`, but only
  `/<ADMIN_PATH>/**` reaches them (rewritten), and only for the owner: the proxy reads the session for that path and
  rewrites anyone else to a path nothing serves. A direct request for `/admin` or `/admin/...` (any case or encoding), and
  everything when `ADMIN_PATH` is unset or invalid, is handled exactly like an unknown URL: the same sign-in redirect when
  signed out, the same 404 page (byte for byte, apart from Next's per-request id) when signed in. Every in-console link and redirect is built with `adminHref()` (client
  components get the base as a prop); a test fails on any hardcoded `/admin` link or any committed slug.
- **Pages**: each page and the layout call `adminPage()`. Not the owner (signed out included): **404**. The owner without a
  step-up: a redirect to `/<slug>/unlock?next=<the page>` before any data loads; a correct code returns there.
- **APIs** (`app/api/admin/**`, still at `/api/admin`): each handler is wrapped in `withAdminRoute(req, ...)`. Not the owner
  (signed out included): 404 `{error:"not_found"}`. The owner without a step-up: 403 `{error:"mfa_required"}`. Mutating
  requests also need a same-origin request, checked after the owner check. (With no session cookie at all, `proxy.ts`
  answers 401 for every API path first, as for any unknown API.)
- **Step-up** (`lib/admin/totp.ts`, `lib/admin/mfa.ts`, `lib/admin/stepup.ts`): RFC 6238 TOTP (HMAC-SHA1, 30 s, 6 digits,
  ±1 step) in `node:crypto`. The secret (20 random bytes, base32) lives only in the encrypted credential vault, kind
  `admin_totp` (pending: `admin_totp_pending`, 15 minutes), masked as a constant; every decrypt is audited. A step can be
  used once (the last accepted step is in `audit_log`, `admin.mfa.verified {step}`); at most 5 wrong codes per 10 minutes
  (the DB-backed limiter, key `admin-mfa:<user id>`). A correct code sets `va_admin_stepup`: httpOnly, Secure,
  SameSite=Strict, path `/`, Max-Age 3600, an HMAC-SHA256-signed `{userId, hash of the session id, expiresAt}` keyed from
  `BETTER_AUTH_SECRET` with its own label; another session (sign-out/in), expiry or any change invalidates it.
- `lib/admin/routes.ts` lists every admin route. `test/admin-routes.test.ts` compares it with the files on disk and calls every
  page guard and every API handler as an ordinary user, a non-owner admin, a suspended or unverified owner, signed out, and
  the owner with and without a step-up. `e2e/ops.spec.ts` does the same over HTTP, with enrolment.

## Routes

Public URLs are under the secret base; the internal paths below are where the files are.

| Page (internal) | What |
|---|---|
| `/admin` | signups, the #1 metric by signup week, runs per day, failure reasons, credits, paid conversions (latest 25, 7 and 30 day counts, plan mix), what users do (events by name, runs by depth, 7 days), subscriptions and MRR, founding seats |
| `/admin/users`, `/admin/users/[id]` | search, detail, actions |
| `/admin/abuse` | blocked queries, repeat users, open flags, rate-limit hits |
| `/admin/costs` | credits kept against measured cost per run, per depth, per day; CSV |
| `/admin/archive` | search, remove, past removals |
| `/admin/founding` | the 100 seats |
| `/admin/blocked-domains` | list, add, remove (UI over H1's table) |
| `/admin/review/[id]` | "Open for abuse review": the only way to see investigation results |
| `/admin/unlock` | the code screen; on the first visit, the authenticator enrolment |

| API | Body | Action |
|---|---|---|
| `POST /api/admin/users/[id]/status` | `{action: suspend\|unsuspend\|ban, reason}` | status change; ban also revokes sessions |
| `POST /api/admin/users/[id]/revoke-sessions` | `{reason}` | delete all sessions |
| `POST /api/admin/users/[id]/grant` | `{credits, reason, requestId?}` | `adminGrant` (lot with the default expiry) |
| `POST /api/admin/users/[id]/refund` | `{investigationId, reason}` | `refund` (once per investigation) |
| `POST /api/admin/abuse/review` | `{kind: flag\|run\|user, id, status?, reason}` | mark reviewed |
| `GET /api/admin/costs/export?days=&depth=` | | CSV |
| `POST /api/admin/archive/remove` | `{kind: entity\|source\|page, key, reason}` | `removeFromArchive` |
| `POST`/`DELETE /api/admin/blocked-domains` | `{domain, reason}` | add / remove |
| `POST /api/admin/mfa/verify` | `{code}` | confirm the enrolment or verify; sets the step-up cookie (works while locked) |
| `POST /api/admin/mfa/lock` | | "Lock now": clears the step-up cookie (works while locked) |

## Audit trail

One `audit_log` row per read of user content and per change, written **in the same transaction** as the change. `actor` is the
admin's user id (`ops:<name>` for the role script), `target` the user (or `investigation:<id>`, `domain:<name>`), and
`meta.reason` the typed reason (8 to 1000 characters; the server refuses a missing one and nothing changes).

| Action | When | Reason |
|---|---|---|
| `admin.user.view` | opening a user's detail (their queries) | no |
| `admin.abuse.view` | opening the abuse queue (it shows query text) | no |
| `admin.investigation.open_review` | opening results | yes |
| `admin.user.suspend` / `unsuspend` / `ban` | status change | yes |
| `admin.user.revoke_sessions` | | yes |
| `admin.credits.grant` / `admin.credits.refund` | | yes |
| `admin.abuse.review` | marking an item reviewed | yes |
| `archive.remove` | by `removeFromArchive`, actor = the admin | yes |
| `admin.blocked_domain.add` / `remove` | | yes |
| `admin.costs.export` | CSV download | no |
| `admin.role.grant` / `revoke` | the ops script | yes |
| `admin.mfa.enrol_started` / `enrolled` | enrolment (a new pending secret / confirmed) | no |
| `admin.mfa.verified` | a correct code, `meta.step` (the replay guard) | no |
| `admin.mfa.failed` | `meta.reason`: wrong_code, replay, rate_limited, enrolment_expired | no |
| `admin.mfa.locked` | "Lock now" | no |
| `admin.mfa.reset` | the ops re-enrolment script | yes |

Admins never see credential values: investigation entities are read as their display (masked) form only. The console reads
`credential_vault` only for the owner's own authenticator secret (kinds `admin_totp*`, decrypt audited as `credential.decrypt`).
No code or secret is ever written to the audit trail or a log.

## Abuse queue sources

1. Runs that failed with `blocked_query` and have no review yet.
2. Users with at least `ABUSE_BLOCKED_THRESHOLD` (3) of them in `ABUSE_WINDOW_DAYS` (30), no review since their latest
   (constants in `lib/admin/constants.ts`).
3. Open `abuse_flags` rows (billing refunds and disputes, founding-claim races, manual).
4. Per-account rate-limit hits, **read from `rate_limit_hits (user_id, created_at)` if H1 creates it**, otherwise "None".

Reviewing a run or a user inserts an `abuse_flags` row with the review status, which removes the item from the queue.

## Cost view

Per run: credits kept (`investigations.credits_charged`, net of refunds) against `run_costs` (compute + LLM). Revenue is
shown at the top-up list value and at the Pro subscription rate (`PLANS.pro.monthlyUsd / monthlyCredits`). Percentiles are
over completed runs; "Margin at p90 cost" is the price check from `docs/PRICING-v1.md` (depth credits at the Pro rate against
the p90 cost). Cost of refunded runs is reported separately as spent for nothing.

## Lifecycle email and consent

Transactional email (verification, reset, receipts, results-ready, usage alerts, founding notices) is always sent.
Lifecycle email (welcome, the 24-hour nudge, "what next", future newsletters) needs `users.product_emails` and carries a
one-click unsubscribe. `packages/emails` classifies every template (`TEMPLATE_CATEGORY`) and refuses to send a lifecycle
template without the `List-Unsubscribe` header. Copy lives in `packages/emails/src/content.ts`.

| Email | Trigger | Once |
|---|---|---|
| welcome | after email verification (Better Auth hook); the hourly cron is a backstop for accounts from the last 48 h | `lifecycle_emails (user, 'welcome')` |
| first-investigation nudge | `POST /api/cron/lifecycle`: verified, active, no investigation, 24 h to 7 days after sign-up | `(user, 'first_investigation_nudge')` |
| what next | same cron: 30 minutes after the first completed investigation, up to 7 days | `(user, 'what_next')` |

The ledger row is claimed before sending (unique per user and kind); a failed send releases it so the next run retries. With the
preference off the row is recorded as `suppressed`, so turning it back on never releases a stale email.

Unsubscribe links are `HMAC-SHA256(key, userId)` where `key = HMAC-SHA256(BETTER_AUTH_SECRET, "voidaccess:unsubscribe:v1")`.
`GET /unsubscribe?u&t` shows a confirmation page; `POST /api/unsubscribe?u&t` (what mail clients send for one-click) applies it. A
`GET` on the API never unsubscribes (mail scanners prefetch links). Both routes are public in `lib/guard.ts`.

## Funnel

`lib/analytics-events.ts` lists every PRD §7 event and where it fires; `test/analytics-events.test.ts` keeps it honest. Events go
to the `events` table through `trackEvent`, which takes no IP address or user agent.

## Local run

`pnpm --filter @voidaccess/app test:e2e:ops` (port 3800, database `<VA_TEST_DB>_ops_e2e`).
`SCREENSHOTS=1` also writes `docs/screenshots/ops/*.png`.

Locally the console is off until you set `ADMIN_PATH` (any slug of 24+ characters of `[a-z0-9-]`, in `.env.local`, which is
not committed) and `ADMIN_EMAIL` to your local account; grant that account the role, then open `http://localhost:3000/<slug>`.
The ops e2e sets a fixed test slug and enrols with a code computed in the test.
