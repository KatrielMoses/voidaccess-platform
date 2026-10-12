BRIEF — Lane BILLING, Sub-phase P5: Dodo billing, plans, top-ups, founding seats, credit alerts and usage

First brief in the BILLING lane. It turns Pricing v1 into working money flows on top of the ledger and founding-seat logic P0 built:
- subscriptions for Pro and Pro+, monthly and annual
- the founding Pro offer, with its seat rules and live counter
- top-ups with the subscriber bonus
- upgrades and downgrades
- cancellation
- monthly credit grants
- credit alerts at 80% and 100%
- the usage ledger page
- the founding-seat notices

Dodo Payments is the merchant of record, so tax, invoices and receipts are Dodo's. Build only P5.

In parallel: RUNNER (R0) in `.worktrees/r0` (production runner, the app's Cloud Run launcher, `run_costs`). Never touch `apps/app/lib/launcher/**`, `apps/app/lib/runs/**`, the results routes, `packages/ingest/`, `runner/`, `apps/site/` (the site's pricing page links to the app; the architect wires those links), or `../voidaccess`.

── CONTEXT ─────────────────────────────────────────────────────────────────────
Work ONLY in `/Users/delzyn/Brand/companies/voidaccess/platform/.worktrees/p5` (git worktree, branch `p5-billing`, created from `main`). Run `pnpm install` first. First push: `git push -u origin p5-billing`. **Never push to `main`.**

Parallel-safe local setup: databases `voidaccess_p5_dev` and (for tests) `VA_TEST_DB=voidaccess_p5_test` (the app suite appends `_app`); app dev server on **port 3400**. Never touch other lanes' databases.

GitHub Actions now runs on every push (the repository is public), so CI must be green on your branch. Also run the steps locally and check exit codes. Don't pipe a gating command through `tail` or `grep` and trust the result.

**The repository is public.** Never commit keys, webhook secrets, real customer data or Dodo product IDs from live mode.

Read first:
- `docs/PRICING-v1.md` (including amendment 1 and the engineering defaults) and `packages/config/src/pricing.ts`: `PLANS`, `TOPUPS`, `topupCredits`, `FOUNDING`, `PAYMENT_FEE`, `RUN_LIMITS`, `hasFeature`. **These are the only source of prices.**
- `docs/DATA-MODEL.md`
- `packages/db`:
  - `ledger.ts`: `grantMonthly`, `topup`, `adminGrant`, `expireLots`, `getBalance`; spend order and expiry
  - `founding.ts`: `claimFoundingSeat`, `runFoundingChecks`, `releaseFoundingSeat`, `availableSeats`
  - the `subscriptions`, `payments`, `founding_seats`, `founding_notices` and `users.plan` schema
  - `withUser` and `withSystem`
- `apps/app`:
  - P2's auth and session (`lib/auth/**`), `lib/runs/service.ts` (how insufficient credits are reported)
  - the header credit pill, `/settings`, the `/billing` placeholder links P2 and P3 left (the upgrade prompts)
  - `lib/runs/cron-auth.ts` (how cron routes authenticate)
- `packages/emails` (P2's sender, log transport in dev/test)
- the PRD sections pasted at the end of this brief
- **Dodo Payments' current documentation:** checkout sessions, subscriptions (plan changes and proration, cancel at period end), one-time payments, the customer portal, webhooks (event types, signature verification, retries, idempotency) and test mode. Read the docs; don't rely on memory.

Secrets: the Dodo test-mode API key is in Secret Manager as `dodo-api-key-test` (read with `CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess gcloud secrets versions access latest --secret=dodo-api-key-test`; never print it). Use **test mode only**.

There is no public app URL yet, so a real Dodo webhook can't reach you. Webhooks are tested with signed fixture payloads built exactly as Dodo signs them. The live webhook endpoint is registered during the deploy phase.

── NON-NEGOTIABLE GUARANTEES ───────────────────────────────────────────────────
1. **Credits move only from verified, idempotent events.** A webhook is processed only with a valid signature and a fresh timestamp. Each Dodo event id is processed exactly once: a unique processed-events record, plus ledger idempotency keys derived from the Dodo payment or subscription period. Replays, retries and out-of-order deliveries never grant credits twice or skip a grant. Prove it with tests.
2. **Prices come only from config.** Checkout amounts, plan cards, bonus credits and founding terms are read from `@voidaccess/config`. The Dodo catalogue is created from config by a sync script, never by hand. A test fails if a price or credit number is hard-coded under `apps/app` billing code.
3. **The founding rules hold exactly** (PRICING-v1 amendment 1 and interpretations (a)–(e)):
   - at most 100 held seats, claimed race-safely at the first paid founding subscription
   - $7 for 12 months from the first payment
   - a yearly renewal when the founder paid for at least 3 of the trailing 12 months, otherwise release
   - release after 10 inactive months
   - notices 30 days before and on the day of a release
   - the price never changes mid-period
   - monthly only
   - upgrading to Pro+ releases the seat, after a warning
   - a lapsed founder keeps the seat until the anniversary check or the inactivity release
   - the pricing counter shows available seats, including reopened ones

   Reuse P0's `founding.ts`. Don't reimplement it.
4. **The plan follows the subscription.** `users.plan` changes only from Dodo state (activation, plan change, cancellation taking effect, failed-payment end state), inside the same transaction as the related ledger rows. Paid features (from `hasFeature`) switch when the plan does.
5. **Isolation.** Users see only their own subscription, payments, ledger and usage, through `withUser`. Webhooks and cron use `withSystem` with specific reasons. Dodo customer and subscription ids map to exactly one user, and a webhook for an unknown mapping is logged and rejected, never applied to a guessed user.
6. **No surprise charges.** Every paid action states the price before checkout. Upgrades show the prorated amount from Dodo before confirming. Cancel is one click away and takes effect at period end. Auto top-up is out of scope (P8).

── DELIVERABLES ────────────────────────────────────────────────────────────────
**B1. Catalogue sync** (`apps/app/scripts/dodo-sync.ts`)
- From config, create or update the Dodo **test-mode** products and prices: Pro monthly and annual, Pro+ monthly and annual, Founding Pro monthly ($7), and the three top-ups (one-time).
- Store the Dodo product ids in a new `billing_catalog` table (plan or top-up key, interval, mode, Dodo product id), added through a migration.
- Idempotent: a re-run changes nothing. A config price change creates a new Dodo price and points the catalogue at it, and existing subscribers keep their price.

**B2. Checkout and portal** (`lib/billing/**`, `app/api/billing/**`)
- Create checkout sessions for: subscribe (plan and interval), founding Pro (only while `availableSeats() > 0`; otherwise show standard Pro), and top-ups (all plans, including Free).
- The Dodo customer is created or reused per user. Pass the user id as metadata and verify it on the webhook.
- Return and cancel URLs come back to `/billing`.
- Show a "Manage billing" link to the Dodo customer portal (payment method, invoices, receipts).

**B3. Webhooks** (`app/api/webhooks/dodo/route.ts`)
- Verify the signature and timestamp per Dodo's docs, keep the raw body, and store each processed event id.
- Handle:
  - payment succeeded: top-up lots via `topup()` with the plan's subscriber bonus, 12-month expiry
  - subscription activated or renewed: set the plan, write a `payments` row for the period, call `grantMonthly(plan, periodStart)`, and claim or confirm the founding seat when it's the founding product
  - subscription plan changed: for an upgrade, grant the difference in monthly credits immediately; a downgrade takes effect at period end
  - subscription cancelled: plan becomes `free` at period end, and the grant bucket expires per the ledger rules
  - payment failed and on hold: show an in-app banner; downgrade per Dodo's final state
  - refunds and disputes: log, flag for admin review (`abuse_flags` or `audit_log`), and never auto-claw credits back

  Read Dodo's docs for the exact event names.
- Unknown event types are acknowledged and logged.

**B4. Cron routes** (authenticated exactly like P2's watchdog)
- `POST /api/cron/grants` (daily): monthly grants for **Free** users on their period boundary (paid plans are granted from webhooks), plus `expireLots(now)`.
- `POST /api/cron/founding` (daily): `runFoundingChecks(now)`, apply the resulting plan moves at the next renewal (never mid-period), and send the due `founding_notices` emails.
- `POST /api/cron/credit-alerts` (hourly): send the 80% and 100% usage emails once per period per threshold. Also fire the alert inline after a run's reservation crosses a threshold.

**B5. UI** (`app/(app)/billing/**`, `app/(app)/usage/**`)
- **`/billing`:**
  - plan cards from config: current plan highlighted, monthly/annual toggle (annual is 2 months free), feature list from `PLANS`
  - the founding banner with live available seats and the plain-language rules (copy in a content file; the founding line from config)
  - the top-up table with the subscriber bonus shown for this user
  - the current subscription: renewal date, cancel at period end, resume
  - an upgrade or downgrade confirmation with the prorated amount from Dodo
  - for founders: term end, the renewal rule, and status (renews / at risk / releasing on date)
- **`/usage`:** the ledger as a table (date, action, investigation link, amount, bucket, balance after); current balance by bucket (monthly grant with reset date, top-up lots with expiry dates); filters by type and month; CSV download.
- **In-app alerts:** a non-blocking banner at 80% and at 100% with Top up and Upgrade buttons.
- **Out-of-credits:** replace P2's insufficient-credits message with a prompt offering the cheapest fitting top-up and the upgrade.
- Every `/billing` placeholder link P2 and P3 left now points to the right place.
- Mobile-ready at 375 px.

**B6. Emails** (in `packages/emails`, plain text, copy in content files)
- welcome to Pro (receipts come from Dodo)
- the 80% and 100% usage alerts
- founding: the 30-day release warning and the release-day notice
- the cancellation survey: "What made you leave?", a one-line reply ask (PRD §5)
- a payment-failed nudge

**B7. Analytics events** (first-party `events` table): `credits_80`, `upgrade_viewed`, `subscribed` (with plan and interval), `topup_purchased`, `cancelled` (with reason when given). Attach first-touch attribution where available.

**B8. Tests**
- **Webhooks:** signature valid, invalid, stale and replayed; out-of-order delivery (renewal before activation); a duplicate event id; an unknown customer.
- **Ledger:**
  - every top-up tier × plan grants exactly `topupCredits()`
  - an upgrade grants the difference once
  - a downgrade waits for the period end
  - a cancel leaves Free at the period end
  - a refund raises a flag and moves no credits
- **Founding:**
  - the claim at the 100th seat under concurrency
  - founding checkout is refused when the seats are gone
  - renewal and release outcomes applied at the next renewal
  - notices sent once
  - an upgrade to Pro+ releases the seat after a warning
  - the counter shows reopened seats
- **Cron:** idempotent re-runs.
- **Isolation:** user B can't read A's billing, usage or subscription.
- **Price guard:** no hard-coded prices.
- **One Playwright test on test mode:** sign in, open `/billing`, start a Pro checkout (assert the redirect to Dodo's test checkout URL), then simulate the signed activation webhook. The plan becomes Pro, credits are granted, the usage page shows the grant, the header pill updates, and a locked export unlocks.

── ACCEPTANCE CRITERIA ─────────────────────────────────────────────────────────
- CI is green on `p5-billing` on GitHub, and the local steps pass with exit codes checked.
- The catalogue sync has run against Dodo test mode, and `billing_catalog` lists every product (report the product names, not ids).
- A real test-mode checkout session is created for Pro monthly, founding Pro and a $10 top-up, with the URLs returned. No purchase is needed.
- Every webhook, ledger, founding and cron test passes, and the Playwright flow passes.
- Screenshots of `/billing` (free, Pro and founder states), `/usage` and the alert banners at 375 px and 1440 px are in `apps/app/docs/screenshots/billing/`.

── CONSTRAINTS ─────────────────────────────────────────────────────────────────
- Justify every dependency (prefer Dodo's official SDK if one is maintained, otherwise `fetch`).
- Don't edit architect-owned paths (`packages/config`, `tokens.css`, root workspace files except adding devDependencies, `docs/`) or the RUNNER or RESULTS lanes' paths. Schema changes go in new migrations under `packages/db`. Name them clearly; the architect renumbers at merge.
- Test mode only. Never print or commit secrets. No real cards.
- Commit messages: plain, conventional, NO AI/assistant attribution of any kind.
- Push `p5-billing` only. **Don't merge.** The architect reviews and merges.

── OUT OF SCOPE (later briefs) ─────────────────────────────────────────────────
- registering the live webhook endpoint and switching to live mode (deploy phase)
- auto top-up, Team/MSSP seats, the affiliate and referral payouts (P8)
- the admin billing views: refunds, manual grants UI, revenue (P6)
- changing anything on the marketing site

── HANDOFF (reply with this when done) ─────────────────────────────────────────
- the catalogue (product names, intervals, prices from config)
- the webhook events handled and their ledger and plan effects (a table)
- the idempotency design
- the founding flow (claim, renewal, release, notices) with test evidence
- the cron routes and schedules
- the routes and screens
- the email templates
- analytics events
- every migration added
- every dependency with its reason
- the CI run URL and local results
- the Playwright result
- screenshots
- anything the deploy phase must do (webhook URL, live keys)
- deviations with reasons

── APPENDIX: PRD sections 3.7, 3.9 and the payment rows of 5 ───────────────────
(Verbatim from PRD v1.0, 2026-10-11. Prices, credit amounts and the founding terms in the PRD are superseded by docs/PRICING-v1.md and packages/config.)

### 3.7 Credits and billing (P0)
- **Always-visible credit balance** in the header, with a usage meter.
- **Usage page:** a ledger of every credit movement (investigation, refund, top-up, monthly grant), with date and amount.
- **Alerts:** in-app and email at **80% and 100%** of monthly credits, with "Top up" and "Upgrade" buttons.
- **At zero credits:** Free stops (clear upgrade prompt). Paid plans: offer a top-up; **opt-in auto top-up** (P1).
- **Billing via Dodo Payments** (merchant of record; handles tax/VAT): subscribe, upgrade/downgrade (prorated), cancel anytime, invoices/receipts, update card, annual billing.
- **Founding member offer:** the first 100 paid subscribers get the price locked for life + bonus credits; show the remaining count on the site.

### 3.9 In-app growth hooks (P0 unless noted)
- After the first successful investigation: prompt "Star us on GitHub" (non-blocking) and "Invite a colleague" (P1, referral bonus credits).
- **Referral / affiliate code capture:** codes from the marketing site attach to the account (P0 capture, P1 payouts).
- Upgrade prompts tied to moments of value (out of credits, wanting Deep mode, wanting monitors). No nagging banners.

### 5. Emails (rows relevant to billing)
| Trigger | Email |
|---|---|
| 80% / 100% credits | Usage alert + top-up/upgrade |
| Payment | Receipt (via Dodo), welcome to Pro |
| Cancel | Short "what made you leave?" (one-line reply ask; Katriel reads these) |
- Plain, founder-voiced, mostly text. Unsubscribe for non-transactional. Emails feed the marketing list (with consent).

Note on 3.7: the founding offer is no longer "locked for life + bonus credits". It is $7/mo for renewable 12-month terms with no bonus (PRICING-v1 amendment 1). The live counter belongs on both the site and `/billing`; you build the app side and an API the site can read.
