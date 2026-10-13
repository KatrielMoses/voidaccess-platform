# Admin console, lifecycle email and the funnel (P6)

## Who is an admin

`users.role = 'admin'`. There is **no UI and no API** that assigns it, and the app's database role cannot update the column
(column-level grants; a test proves it). Run the ops script with the **owner** database URL:

```
MIGRATE_DATABASE_URL=postgres://<owner>@<host>/<db> \
  pnpm --filter @voidaccess/app admin:grant-role -- --email you@example.com --reason "founder"
# revoke: add  --role user
```

`--reason` is required; the change and its `audit_log` row (`admin.role.grant` / `admin.role.revoke`, actor `ops:<os user>`)
are one transaction. The script refuses to run as `va_app` or `va_system`.

## How access is enforced

Every request, from the real session (the role is read from the database row each time, so revoking takes effect at once):

- **Pages** (`app/(admin)/admin/**`): each page and the layout call `adminPage()`. Signed out: redirect to the site's sign-in.
  Signed in but not an active admin (including a suspended admin): **404**, so `/admin` doesn't reveal itself.
- **APIs** (`app/api/admin/**`): each handler is wrapped in `withAdminRoute(req, ...)`. Signed out: 401. Not an active admin: 404.
  Mutating requests also need a same-origin request, checked after the admin check.
- `lib/admin/routes.ts` lists every admin route. `test/admin-routes.test.ts` compares it with the files on disk and calls every
  page guard and every API handler as an ordinary user, a suspended admin and signed out. `e2e/ops.spec.ts` does the same over HTTP.

## Routes

| Page | What |
|---|---|
| `/admin` | signups, the #1 metric by signup week, runs per day, failure reasons, credits, subscriptions and MRR, founding seats |
| `/admin/users`, `/admin/users/[id]` | search, detail, actions |
| `/admin/abuse` | blocked queries, repeat users, open flags, rate-limit hits |
| `/admin/costs` | credits kept against measured cost per run, per depth, per day; CSV |
| `/admin/archive` | search, remove, past removals |
| `/admin/founding` | the 100 seats |
| `/admin/blocked-domains` | list, add, remove (UI over H1's table) |
| `/admin/review/[id]` | "Open for abuse review": the only way to see investigation results |

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

Admins never see credential values: investigation entities are read as their display (masked) form only; `credential_vault`
is not touched.

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
