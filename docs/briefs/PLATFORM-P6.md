BRIEF — Lane OPS, Sub-phase P6: Admin console, lifecycle emails, the analytics funnel, notification preferences

First brief in the OPS lane. It gives the team the tools to run the service:
- an admin console: users, abuse review, suspensions, credit grants and refunds, cost against charge per run, founding seats, archive removals and the funnel
- the remaining lifecycle emails from PRD §5
- the full PRD §7 analytics funnel
- the small in-app growth hooks
- notification preferences, with unsubscribe for non-transactional email

Build only P6.

In parallel:
- HARDENING (H1) in `.worktrees/h1`: DB role split, shared rate limiting, Better Auth pool, `run_events` status, `summary_kind` at ingest. **H1 owns `packages/db/src/client.ts` (the `withSystem` internals), `packages/db` roles migrations, `apps/app/lib/auth/**` rate-limit config and `lib/runs/**`.** Use `withUser` and `withSystem` through their public API only.
- ENGINE (E2) in `../voidaccess`.

Never touch H1's paths, `runner/`, `apps/site/`, `packages/archive/src/**` internals (call its public API), or `../voidaccess`.

── CONTEXT ─────────────────────────────────────────────────────────────────────
Work ONLY in `/Users/delzyn/Brand/companies/voidaccess/platform/.worktrees/p6` (git worktree, branch `p6-ops`, created from `main`). Run `pnpm install` first. First push: `git push -u origin p6-ops`. **Never push to `main`.**

**Local setup:**
- databases `voidaccess_p6_dev` and (for tests) `VA_TEST_DB=voidaccess_p6_test`
- app dev server on **port 3800**
- your Playwright config gets its own `outputDir` (`test-results/<suite>`) and its own `NEXT_DIST_DIR` (`.next-e2e-<suite>`), like the existing suites, so suites can run side by side
- since D1, sign-up pages live on the site: in end-to-end tests, sign up through the app's auth API with the helper in `apps/app/e2e/helpers.ts`, as the existing suites do

CI runs on GitHub on every push (the repository is public) and must be green. Run the steps and all end-to-end suites locally from a clean worktree, and check exit codes. Don't pipe a gating command through `tail` or `grep` and trust the result. **The repository is public:** no secrets, no real user data.

Read first:
- `docs/LANES.md`, `docs/DATA-MODEL.md`, `docs/PRICING-v1.md`
- `packages/db`: the schema (`users.role`/`status`, `events`, `abuse_flags`, `audit_log`, `run_costs`, `founding_seats`, `credit_ledger`, `subscriptions`, `payments`) plus `ledger.ts` (`adminGrant`, `refund`) and `founding.ts`
- `packages/emails`: the sender, templates and content file. Emails that already exist: auth, results-ready, the billing ones from P5 (welcome to Pro, usage alerts, founding notices, cancel survey, payment failed). **Don't duplicate them.**
- `apps/app`: `lib/auth/session.ts` (`requireUser`, `SessionUser.role`), `proxy.ts` and `lib/guard.ts` (route classes), the cron routes and `lib/runs/cron-auth.ts`, the results area (for the `graph_viewed` and `export_used` events), `/settings`, and the P5 billing code (for the funnel)
- `packages/archive`: `removeFromArchive` and its README (the removal process)
- PRD §3.8, §3.9, §3.10, §5 and §7, pasted at the end of this brief

── NON-NEGOTIABLE GUARANTEES ───────────────────────────────────────────────────
1. **Admin is server-enforced.**
   - Every `/admin` page and `/api/admin/*` route checks `role === "admin"` on the server from the real session. Non-admins get a **404** (don't reveal that admin exists), signed-out users get the normal guard behaviour, and a test enumerates every admin route as an ordinary user.
   - No admin capability is reachable from client-side checks alone.
   - Admin role assignment is **not** possible from the UI or any API. It's a documented ops script (`pnpm --filter @voidaccess/app admin:grant-role -- --email …`) run with the owner database URL.
2. **Every admin action is audited.** Each read of a user's queries or investigation content, and each change (suspend, ban, grant, refund, removal, role change through the script), writes an `audit_log` row with actor, action, target, reason and timestamp. Actions that change something require a typed reason. A test proves each one writes its row.
3. **Admins see what's needed for abuse review, nothing more.** Admin views of a user's investigations show query text, status, depth, credits and timestamps. Investigation *results* are viewable only through an explicit "Open for abuse review" action, which is audited. Credential values stay masked everywhere, including for admins.
4. **No new tenant leaks.** Admin reads use `withSystem` with specific reasons. Everything else in the app keeps using `withUser`. The isolation tests keep passing, and the new tables are classified in the isolation test lists.
5. **Email consent.**
   - Transactional email (verification, reset, receipts, results-ready, usage alerts, founding notices) is always sent.
   - Lifecycle and marketing email (welcome, the 24-hour nudge, "what next", and future newsletters) respects a per-user preference and carries a one-click unsubscribe: a `List-Unsubscribe` header plus a signed link that works without signing in.
   - Unsubscribe links are signed with a key derived from an existing app secret, and can't be used to unsubscribe someone else.
6. **Analytics stay first-party and private.** Events go to the `events` table only, without IP addresses or user agents, with first-touch attribution where available. No third-party trackers in the app.

── DELIVERABLES ────────────────────────────────────────────────────────────────
**O1. Admin console** (`app/(admin)/admin/**`, `app/api/admin/**`, `lib/admin/**`)

**Overview:** a dashboard with:
- signups (7- and 30-day)
- verified signups
- the **#1 metric**: the % of verified signups who completed a first investigation within 24 hours, per signup cohort
- runs per day by depth and status
- the failure-reason breakdown
- credits granted and spent
- active subscriptions by plan, and MRR from `subscriptions`, with a link to Dodo's dashboard
- founding seats held and available

**Users:**
- search by email or id
- detail: plan, status, role, credits by bucket, signup date, first-touch attribution, investigations (query, status, depth, credits, date), payments, abuse flags and the audit trail
- actions: suspend, unsuspend, ban (status changes), revoke all sessions, grant credits (`adminGrant`), refund an investigation (`refund`), each with a reason

**Abuse queue:**
- runs failed with `blocked_query`, plus users with repeated blocked queries (a threshold in a constants module)
- `abuse_flags` (P5 refunds and disputes, the founding-claim races)
- per-account rate-limit hits, once H1 records them (read them if the table exists; otherwise show "none")
- each item opens the user detail, with "mark reviewed" (audited)

**Costs:**
- per run: credits charged against measured cost (`run_costs`: compute plus LLM), with the margin
- aggregates per depth and per day (p50, p90 and the worst runs)
- a CSV export

This view is how credit prices get checked against reality.

**Archive:**
- search archive entities, sources and pages by canonical value or URL
- show tier, first and last seen, and observation counts
- "Remove" calls `removeFromArchive` with a required reason (tombstone plus object deletion, audited)
- a list of past removals

**Founding:** the 100 seats with holder, term, anniversary, paid months in the last 12, last investigation date and the pending notice.

**O2. Lifecycle emails** (PRD §5 rows not yet built)

Plain text, founder-voiced, with copy in `packages/emails` content files for the growth architect:
- **Welcome from Katriel** after email verification: what VoidAccess is, 3 example queries, a link back to the app
- **"Your first investigation takes 2 minutes"**: 24 hours after signup if the user has no investigation. Sent by a new cron route, `POST /api/cron/lifecycle` (hourly, same auth as the other cron routes), once per user.
- **"Here's what you can do next"**: after the first completed investigation, sent once, separate from the existing results-ready email. Mention the graph, exports, the archive context and upgrade.

Each is sent once per user (idempotent, recorded) and respects the preference in guarantee 5. **Add the scheduler entry for `/api/cron/lifecycle` to `infra/terraform/modules/scheduler`** (hourly). Don't apply it.

**O3. Notification preferences and unsubscribe**
- `/settings/notifications`:
  - product tips and lifecycle email: on or off
  - usage alerts: always on (transactional, explained)
  - monitor alerts: shown as "coming soon"
- the signed one-click unsubscribe endpoint, plus the `List-Unsubscribe` and `List-Unsubscribe-Post` headers on non-transactional emails
- schema: a preferences column or table in a new migration, named clearly; the architect renumbers at merge

**O4. Analytics funnel** (PRD §7)

Make every event in the list fire, server-side wherever possible:
- `signup_started` (record it in the sign-up endpoint path; the site's beacon was removed in D1)
- `signup_completed` and `email_verified`
- `first_investigation_started` and `first_investigation_completed`
- `graph_viewed` (the first open of a results graph, per investigation)
- `export_used` (with the format)
- `credits_80`, `upgrade_viewed`, `subscribed` (plan), `topup_purchased` and `cancelled` (reason)
- `monitor_created`: define it, but there are no monitors yet

Add a test that lists the PRD events and asserts each has an emitter (or is explicitly marked not yet applicable). `site_visit` belongs to the site; note it as out of scope.

**O5. Growth hooks** (PRD §3.9)
- After the first successful investigation, a non-blocking "Star us on GitHub" prompt on the results page, dismissible and remembered per user.
- The referral and affiliate code captured at signup is shown on the admin user detail. Payouts are P8.
- No nagging banners.

**O6. Tests**
- the admin 404 route enumeration for non-admins, and the admin happy paths (each action plus its audit row)
- the role script
- the abuse queue contents
- the cost view against fixture `run_costs`
- lifecycle emails sent exactly once and suppressed when the preference is off; transactional emails unaffected by the preference
- unsubscribe signature validation (wrong user and tampered link are rejected)
- the analytics coverage test
- one Playwright suite: an admin suspends a test user (whose session then fails), grants credits (balance updates), opens the cost view, and removes an archive entity; an ordinary user gets 404 on `/admin`

── ACCEPTANCE CRITERIA ─────────────────────────────────────────────────────────
- CI is green on `p6-ops`. Local steps and **all** end-to-end suites pass from a clean worktree, exit codes checked: `test:e2e` (production mode needs `COOKIE_DOMAIN=localhost SITE_URL=http://localhost:3700 TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA` set when `E2E_PROD=1`), `test:e2e:results`, `test:e2e:billing`, `test:e2e:archive` and yours.
- Every admin route returns 404 to a non-admin, and every admin action leaves an audit row.
- Every PRD §7 event has an emitter, or an explicit not-yet note.
- Screenshots of the admin overview, user detail, abuse queue, costs, archive removal and notification settings at 1440 px (375 px for the settings page) are in `apps/app/docs/screenshots/ops/`.

── CONSTRAINTS ─────────────────────────────────────────────────────────────────
- Justify every dependency (charts: prefer plain SVG or CSS bars over a charting library).
- Don't edit H1's paths or architect-owned paths (`packages/config`, `tokens.css`, root workspace files except adding devDependencies, `docs/`). Schema changes go in new migrations.
- Never print secrets. No real user data.
- Commit messages: plain, conventional, NO AI/assistant attribution of any kind.
- Push `p6-ops` only. **Don't merge.** The architect reviews and merges.

── OUT OF SCOPE (later briefs) ─────────────────────────────────────────────────
- monitors and their alerts, share links and PDFs, the actor library, BYO keys, 2FA, Google OAuth, auto top-up, referral payouts, the status page (P8)
- the marketing site, and `site_visit` (growth rework)
- verified-owner unmasking
- feature flags

── HANDOFF (reply with this when done) ─────────────────────────────────────────
- the admin route map, and how admin is enforced (with the 404 enumeration result)
- the role-grant script
- every admin action and its audit row
- abuse-queue sources
- the cost-view queries
- the lifecycle emails, their triggers, idempotency, and the scheduler entry added
- preferences and unsubscribe design
- the analytics coverage table (each event and where it fires)
- the growth hooks
- migrations added
- every dependency with its reason
- CI and local results, including all end-to-end suites
- screenshots
- deviations with reasons

── APPENDIX: PRD v1.0 (2026-10-11), verbatim ───────────────────────────────────
Pricing in the PRD is superseded by `docs/PRICING-v1.md`.

### 3.8 Settings (P0)
- Profile, email, password/OAuth, delete account (with data deletion), data export.
- **Bring-your-own API keys (P1, optional):** users can add their own VirusTotal/Shodan/HIBP keys for deeper enrichment. Keys are stored encrypted.
- Notification preferences.

### 3.9 In-app growth hooks (P0 unless noted)
- After the first successful investigation: prompt "Star us on GitHub" (non-blocking) and "Invite a colleague" (P1, referral bonus credits).
- **Referral / affiliate code capture:** codes from the marketing site attach to the account (P0 capture, P1 payouts).
- Upgrade prompts tied to moments of value (out of credits, wanting Deep mode, wanting monitors). No nagging banners.

### 3.10 Admin (internal, P0 minimal)
- See users, plans, credit balances, investigations count, revenue (or link to Dodo dashboard).
- **Abuse tools:** view flagged queries, suspend user, refund credits, ban email/domain.
- **Cost view:** per-investigation actual cost (LLM tokens, Tor/proxy, enrichment) vs credits charged. **This is how we set credit prices.**
- Feature flags / manual credit grants (for influencers, beta users, affiliates).

## 5. Emails (P0 transactional + core lifecycle)
| Trigger | Email |
|---|---|
| Signup | Verify email |
| Verified | Welcome from Katriel: what it is, 3 example queries, link back to app |
| No investigation 24h after signup | "Your first investigation takes 2 minutes" + example |
| First investigation done | Results ready (also for long runs) + "here's what you can do next" |
| 80% / 100% credits | Usage alert + top-up/upgrade |
| Payment | Receipt (via Dodo), welcome to Pro |
| Cancel | Short "what made you leave?" (one-line reply ask; Katriel reads these) |
| Monitor finding (P1) | New finding alert |
- Plain, founder-voiced, mostly text. Unsubscribe for non-transactional. Emails feed the marketing list (with consent).

## 7. Analytics events (P0, so growth can see the funnel)
`site_visit (with utm/ref)` → `signup_started` → `signup_completed` → `email_verified` → `first_investigation_started` → `first_investigation_completed` → `graph_viewed` → `export_used` → `credits_80` → `upgrade_viewed` → `subscribed (plan)` → `topup_purchased` → `monitor_created` → `cancelled (reason)`.
**The #1 metric:** % of verified signups who complete a first investigation within 24h.

Note for "ban email/domain" (§3.10): user bans use `users.status`. **H1 creates the `blocked_email_domains` table and enforces it at sign-up.** P6 builds the admin UI to list, add and remove blocked domains, with each change audited, on top of H1's table. Until H1 merges, build against a local migration file named `pending_h1_blocked_email_domains` that the architect drops at merge in favour of H1's.
