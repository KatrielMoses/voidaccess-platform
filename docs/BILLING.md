# Billing

Prices, credits and the top-up rule live only in `packages/config/src/pricing.ts` (source: `docs/PRICING-v1.md`).
The app talks to the payment provider only through `apps/app/lib/billing/provider.ts` (`BillingProvider`); tests and
e2e use the in-memory `FakeProvider` (`BILLING_PROVIDER=fake`).

## Creem (merchant of record, since P7)

Creem replaced Dodo Payments (P7, 2026-10-19). Creem is the merchant of record: it charges the card, adds tax, sends
receipts and invoices, and hosts the customer portal. Fees: 3.9% + $0.40 per transaction.

### What the app uses

| Purpose | Creem endpoint |
|---|---|
| Customer for a user (one per email per mode; Creem returns the existing one for a known email) | `POST /v1/customers` |
| Checkout (subscription, or credits with `custom_price` in cents, `units: 1`) | `POST /v1/checkouts` |
| Plan change: upgrade now (`proration-charge-immediately`); pending downgrade applied by cron just before the period end (`proration-none`) | `POST /v1/subscriptions/{id}/upgrade` |
| Upgrade estimate (Creem has no preview endpoint: price difference × time left, from the subscription and both products) | `GET /v1/subscriptions?subscription_id=`, `GET /v1/products/{id}` |
| Cancel at period end / resume before it | `POST /v1/subscriptions/{id}/cancel` (`mode: scheduled`), `POST /v1/subscriptions/{id}/resume` |
| Customer portal (card, invoices, receipts) | `POST /v1/customers/billing` |
| Catalogue sync | `GET /v1/products/search`, `POST /v1/products` (only for products that don't exist) |

Base URLs: test `https://test-api.creem.io`, live `https://api.creem.io`. Header `x-api-key`. A test key
(`creem_test_...`) is refused in live mode and a live key in test mode, so test keys can never charge.

### Environment

| Variable | Value |
|---|---|
| `CREEM_API_KEY` | Secret `creem-api-key-test` (live: `creem-api-key-live`) |
| `CREEM_WEBHOOK_SECRET` | Secret `creem-webhook-secret-test` (live: `creem-webhook-secret-live`) |
| `CREEM_ENV` | `test_mode` (default) or `live_mode` |
| `BILLING_PROVIDER` | `creem` (default) or `fake` (tests only; refused in production) |

Terraform wires these from `var.creem_env`, `var.creem_api_key_secret` and `var.creem_webhook_secret`
(`infra/terraform/variables.tf`).

### Catalogue: `creem:sync`

```
CREEM_API_KEY=creem_test_... DATABASE_URL=... DATABASE_URL_SYSTEM=... pnpm --filter @voidaccess/app creem:sync
```

The products are created in the Creem dashboard; the sync **adopts** them. For each catalogue entry derived from config
(`desiredCatalog()` in `lib/billing/catalog.ts`) it looks for an active Creem product with the same **name, price,
currency (USD) and billing period**, and records its id in `billing_catalog` (per mode). It creates a product only
when no product with that name exists. A product with the configured name but a different price or period is a
**conflict**: nothing is written or created, and the script exits 1 (rename or archive it in Creem, then re-run).
A re-run prints every key as `unchanged`. Product ids are data in `billing_catalog`, never in code.

| Key | Creem product name | Price |
|---|---|---|
| `pro_month` | VoidAccess Pro | Pro monthly, every-month |
| `pro_year` | VoidAccess Pro (annual) | Pro annual, every-year |
| `pro_plus_month` | VoidAccess Pro+ | Pro+ monthly, every-month |
| `pro_plus_year` | VoidAccess Pro+ (annual) | Pro+ annual, every-year |
| `founding_pro_month` | VoidAccess Pro (Founder) | founding price, every-month |
| `topup_credits` | VoidAccess credits | one-time, listed at the top-up minimum; each checkout sets its own `custom_price` |

### Pay-as-you-go top-ups

Any whole-dollar amount from `TOPUP_MIN_USD` to `TOPUP_MAX_USD`. `POST /api/billing/checkout { kind: "topup", usd }`
refuses anything else (400, `reason` = `not_whole_dollars` | `below_minimum` | `above_maximum`), records the checkout in
`billing_checkouts` (user, mode, amount) and sends `custom_price = usd × 100` with `request_id` = that row's id.
On `checkout.completed` the webhook credits `topupCredits(usd, plan at payment time)` once per order, and only if:
the checkout is ours and the customer's; `metadata.user_id` matches; `order.sub_total` (the pre-tax price; Creem adds
tax on top) equals the recorded amount; `custom_price`, if sent back, matches; no discount; USD. Otherwise nothing is
credited, the event is `rejected` (audit row) and a `billing_topup_mismatch` abuse flag asks an admin to refund or
grant by hand.

### Webhook

URL: `https://app.voidaccess.pro/api/webhooks/creem` (public in `lib/guard.ts`; it authenticates by signature).
Signature: header `creem-signature` = hex HMAC-SHA256 of the raw body with the webhook secret, compared in constant
time. Missing secret 503, bad or missing signature 400, malformed body 400, processing error 500 (Creem retries:
30 s, 5 min, 30 min, 6 h), everything else 200. Each event is stored once in `billing_events`, keyed by
(provider, mode, event id), in the same transaction as its effects. Objects whose `mode` doesn't match `CREEM_ENV`
are rejected.

| Event | Effect |
|---|---|
| `checkout.completed` | One-time: the top-up (above). Subscription: closes the checkout record; plan and credits follow the subscription events |
| `subscription.active`, `subscription.paid`, `subscription.update`, `subscription.trialing` | Subscription snapshot: plan, period, monthly grant once per period, upgrade difference once, pending downgrade, founding seat claim/release. `paid` also records the payment (`last_transaction_id`) for the founding 3-of-12 rule |
| `subscription.scheduled_cancel` | Still active, cancel date = period end |
| `subscription.past_due`, `subscription.unpaid`, `subscription.expired` | Plan kept while Creem retries (Creem: terminal only on `canceled`); payment-failed email |
| `subscription.paused` | Status only |
| `subscription.canceled` | Free at the period end (cron) or at once if the period is over |
| `refund.created`, `dispute.created` | Abuse flag + audit row; credits never move |
| anything else (`credits.*`, ...) | Acknowledged, logged as `ignored` |

Register it in the Creem dashboard (Developers > Webhooks) with all events; the test-mode endpoint is already there.

### Test mode

- Smoke: `CREEM_API_KEY=creem_test_... DATABASE_URL=... DATABASE_URL_SYSTEM=... pnpm --filter @voidaccess/app creem:checkout-smoke [dollars]`
  creates two real test checkouts (Pro monthly, and a credit top-up, default the minimum) for a throwaway customer and
  prints their URLs. Nothing is charged.
- Test cards (any future expiry, any CVC): `4111 1111 1111 1111` succeeds; `4507 9900 0000 0028` declined;
  `4507 9900 0000 0010` insufficient funds; `4507 9900 0000 0044` incorrect CVC.

### Going live (checklist)

1. In Creem live mode, create the six products with the exact names above and the config prices (or let
   `creem:sync --live` create the missing ones), and register the webhook `https://app.voidaccess.pro/api/webhooks/creem`
   with all events.
2. Store the live API key as secret `creem-api-key-live` and the live webhook signing secret as `creem-webhook-secret-live`.
3. Against the production database: `CREEM_ENV=live_mode CREEM_API_KEY=<live key> pnpm --filter @voidaccess/app creem:sync --live`
   (needs both the flag and the env). Expect six `adopted` (or `created`), no conflicts.
4. `terraform apply -var creem_env=live_mode -var creem_api_key_secret=creem-api-key-live -var creem_webhook_secret=creem-webhook-secret-live`,
   then deploy. Test and live rows (catalogue, customers, events) are separate, so switching back is the same apply
   with the test values.
5. Buy a $5 top-up and a Pro month with a real card, check the credits and the plan, then refund both from the Creem
   dashboard (the refunds raise review flags; no credits move automatically).
