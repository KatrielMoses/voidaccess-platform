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

## NOWPayments (crypto, one-time)

Crypto payments are one-time purchases through NOWPayments' hosted invoice: pay-as-you-go credits and plan passes
(Pro or Pro+, one month or one year) that **don't renew**. They never touch Creem: a pass has no cancel, change or
portal (those operations answer `not_supported`, the portal route 409), and the cron never sends a crypto pass to
the card provider. Code: `apps/app/lib/billing/crypto/*`; table `crypto_orders` (migration 0014, system-only RLS).

### Shared account: the `va_` rule

The NOWPayments account and its IPN secret are **shared with MailAccess**. Every VoidAccess invoice is created with
`order_id = "va_<crypto_orders id>"` (MailAccess uses `ma_`). The IPN handler accepts only an order id that is
exactly `va_` + a UUID; anything else (`ma_...`, no prefix, `VA_`, not a UUID, a number) is refused with **403
`not_a_voidaccess_order` before any database work**, even when the signature is valid (`lib/billing/crypto/order-ref.ts`).
MailAccess must do the same for `va_` orders it receives. Each product sets its own `ipn_callback_url` per invoice, so
NOWPayments calls the right app; the prefix check is the guard if a callback ever reaches the wrong one.

### What the app uses

| Purpose | NOWPayments |
|---|---|
| Hosted invoice (`price_amount` in USD, `order_id` `va_...`, `ipn_callback_url`, `success_url` `/billing?crypto=pending`, `cancel_url` `/billing?crypto=cancelled`, `is_fixed_rate: true`, `is_fee_paid_by_user: false`) | `POST /v1/invoice` |
| Payment status callbacks | IPN to `https://app.voidaccess.pro/api/webhooks/nowpayments` |

Base URLs: live `https://api.nowpayments.io/v1`, sandbox `https://api-sandbox.nowpayments.io/v1` (the mode follows the
base: sandbox = `test`, otherwise `live`). Header `x-api-key`; the key is never logged.

### Top-ups and passes

- **Credits:** the same pay-as-you-go rule and calculator as card top-ups (`topupCredits()`: rate, volume bonus,
  subscriber bonus at payment time; same `TOPUP_MAX_USD`), with its own floor **`CRYPTO_TOPUP_MIN_USD` = $10**
  (`packages/config`), validated server-side (`POST /api/billing/crypto/checkout { kind: "topup", usd }` answers 400
  `topup_invalid` with `reason` `below_minimum` | `not_whole_dollars` | `above_maximum`) and shown on the Billing page
  ("Crypto top-ups from $10"). Card top-ups keep their lower minimum.
- **Passes:** `{ kind: "pass", plan: "pro" | "pro_plus", interval: "month" | "year" }` at exactly the plan's config
  price. Refused (409) while a card subscription is live (`already_subscribed`) or while a pass for the other plan is
  active (`pass_active`). Buying the same plan again extends the pass from its current end. A pass writes a
  `subscriptions` row with provider `nowpayments`, `cancel_at = current_period_end`; the plan's credits are granted at
  purchase and then monthly by the grants cron while the pass lasts; the cron ends an expired pass and moves the user
  to Free.

### Minimums (why $10)

NOWPayments enforces a minimum per pay currency and network, and it moves with network fees and rates; it is not a
published fixed table. The live value is `GET /v1/min-amount?currency_from=<coin>&currency_to=<outcome>&fiat_equivalent=usd`
(API docs: <https://documenter.getpostman.com/view/7907941/2s93JusNJt>, "Get the minimum payment amount"; the docs'
own example, ETH to TRX, is 0.0079 ETH = $35.41). Low-fee rails (USDT on TRC20/BSC/Polygon, LTC, USDC on L2s) are
usually a few dollars; BTC and ETH on L1 are often well above $10 (merchant reports put BTC near €39 when other coins
worked from about €4). At $10 most stablecoins and LTC can pay; for a small amount the hosted invoice simply doesn't
offer coins whose minimum is higher. Before launch, check the live values with the production key:

```
curl -s -H "x-api-key: $NOWPAYMENTS_API_KEY" "https://api.nowpayments.io/v1/min-amount?currency_from=usdttrc20&fiat_equivalent=usd"
```

for `usdttrc20`, `usdterc20`, `btc`, `eth`, `ltc`, and raise `CRYPTO_TOPUP_MIN_USD` if the stablecoins come out above $10.

### IPN

URL: `https://app.voidaccess.pro/api/webhooks/nowpayments` (public in `lib/guard.ts`; it authenticates by signature).
Signature: header `x-nowpayments-sig` = hex HMAC-SHA512 of the key-sorted JSON body with the IPN secret. Sources
disagree on "sorted" for nested objects (top-level `JSON.stringify(body, Object.keys(body).sort())` vs a recursive
sort), so both canonical forms are accepted; both are HMACs under our secret, so this doesn't weaken the check.
Constant-time compare. Missing secret 503, missing or bad signature 400, malformed body 400, not a `va_` order 403,
switched off 200 `ignored` (audit row), processing error 500 (NOWPayments retries), everything else 200.

Each callback is stored once in `billing_events` as provider **`nowpayments`**, the crypto mode, event id
`<payment_id>:<payment_status>`, in the same transaction as its effects; the (provider, mode, event id) key means a
crypto event can never collide with a Creem event. The callback must name our order, in our mode, priced in USD at
exactly the order's amount (to the cent) with a matching invoice id; otherwise it is rejected and flagged
(`billing_crypto_mismatch`). Credits move only on `finished`, and only once per order (`applied_at`, set in the same
transaction); other statuses only update the order. A second `finished` payment for an already credited order, a pass
that conflicts with a card subscription or another pass, and a refund after credit raise review flags
(`billing_crypto_review`, `billing_refund`); nothing is clawed back automatically.

### Environment

| Variable | Value |
|---|---|
| `CRYPTO_PAYMENTS` | `on` / `off` (app default `off`; production `on` from terraform) |
| `CRYPTO_PROVIDER` | `nowpayments` (default) or `fake` (tests and e2e only; **refused in production**) |
| `NOWPAYMENTS_API_KEY` | Secret `nowpayments-api-key` (live, shared with MailAccess) |
| `NOWPAYMENTS_IPN_SECRET` | Secret `nowpayments-ipn-secret` (shared with MailAccess) |
| `NOWPAYMENTS_API_BASE` | `https://api.nowpayments.io/v1` (live, default) or the sandbox |

Terraform wires these from `var.crypto_payments` (default `on`), `var.nowpayments_api_base` (default live),
`var.nowpayments_api_key_secret` and `var.nowpayments_ipn_secret` (`infra/terraform/variables.tf`).

### Go-live switch

1. The secrets `nowpayments-api-key` and `nowpayments-ipn-secret` exist (with a version) in Secret Manager.
2. In the NOWPayments dashboard, keep the IPN secret as it is (MailAccess uses it too); nothing needs registering:
   every invoice carries its own `ipn_callback_url`.
3. Check the live minimums (above) and the outcome wallet settings.
4. `terraform apply` (crypto is `on` by default), then deploy. To switch off without a deploy of code:
   `terraform apply -var crypto_payments=off` (the page hides Pay with crypto, the checkout route answers 404, and
   IPNs for orders already created are acknowledged with 200 and logged as `billing.crypto.ipn_ignored_off`, never
   applied: NOWPayments won't resend them, so credit any paid ones by hand from that audit trail).
5. Buy a $10 top-up with a stablecoin and a Pro month pass, check the credits, the plan and the pass end date.
