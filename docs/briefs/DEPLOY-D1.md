BRIEF — Lane DEPLOY, Sub-phase D1: Production deploy — app.voidaccess.pro (signed-in only), sign-in at voidaccess.pro, scheduled jobs, production proof

First brief in the DEPLOY lane. It puts the product live:
- **`app.voidaccess.pro`** is public on the internet but usable **only by signed-in users**. Every signed-out request is redirected to `voidaccess.pro`.
- **Sign-in, sign-up, password reset and email verification live at `voidaccess.pro`**, on a **minimal** version of the site: those auth pages plus a simple placeholder home. The full marketing site stays local until the growth architect's rework replaces the placeholder.
- One session works across both domains.
- The scheduled jobs run, and Dodo test-mode webhooks reach the app.
- A real investigation runs end to end in production, from sign-up to results, and the isolation checks pass against production.

Build only D1.

In parallel: ARCHIVE (P4) in `.worktrees/p4`, working in the results area, `packages/archive`, one line in `lib/runs/complete.ts`, a cron route `/api/cron/archive` and a new migration. Never touch those paths. P4's archive cron job is created by the architect after P4 merges. Also never touch `runner/` or `../voidaccess`.

── CONTEXT ─────────────────────────────────────────────────────────────────────
Work ONLY in `/Users/delzyn/Brand/companies/voidaccess/platform/.worktrees/d1` (git worktree, branch `d1-deploy`, created from `main`). Run `pnpm install` first. First push: `git push -u origin d1-deploy`. **Never push to `main`.**

Local setup: databases `voidaccess_d1_dev` and (for tests) `VA_TEST_DB=voidaccess_d1_test`; app dev server on **port 3600**, site dev server on **port 3700**. For local cross-domain testing, use hostnames that share a parent domain, e.g. `app.va.localhost:3600` and `va.localhost:3700`, so the shared-cookie behaviour is real.

CI runs on GitHub on every push (the repository is public) and must be green. Run the steps and all the end-to-end suites locally from a clean worktree, and check exit codes. Don't pipe a gating command through `tail` or `grep` and trust the result.

**The repository is public.** Never commit secrets, live IDs, personal emails or real user data.

Read first:
- `docs/LANES.md`, `docs/ARCHITECTURE.md` §3 (infrastructure), `docs/DATA-MODEL.md`, `docs/PRICING-v1.md`
- **auth (P2):** `apps/app/lib/auth/**` (Better Auth config, session, actions, attribution, bootstrap, AUP), the auth pages under `apps/app/app/(auth)` or wherever sign-up, sign-in, forgot-password, reset-password, check-email and accept-terms live, `apps/app/middleware.ts` (or the layout-level guards), and `apps/app/env.ts`
- **runs (P2, R0):** `lib/runs/**` (watchdog, limits), `lib/limits.ts`, `lib/launcher/**` (Cloud Run launcher, GCS readers)
- **billing (P5):** `lib/billing/**`, `app/api/webhooks/dodo`, the cron routes `/api/cron/{watchdog,grants,founding,credit-alerts}` and `lib/runs/cron-auth.ts`
- **the site (P1):** `apps/site` (content files, the waitlist, `scripts/deploy.sh`, the OpenNext Cloudflare config, Turnstile, the first-touch attribution and its consent prompt)
- `infra/terraform/**` (app, runner, scheduler, iam modules) and `infra/bootstrap/**`
- PRD sections 3.2 and 6, pasted at the end of this brief

**GCP:** project `voidaccess-cloud`, region `us-central1`, always with `CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess` (va-agent; no project-IAM rights).
- **Service:** `va-app` (private today). Its current revisions are `va-app-00001-x8b` (serving) and `va-app-00002-s5l` (R0's leftover throwaway; remove it once a newer revision exists).
- **The `va-runner` job** is live and proven by R0.
- **Production Neon** is migrated through `0004`.
- **Secrets that exist:**
  - `database-url` (the `va_app` login, direct host), `database-url-site` (`va_site`, waitlist only), `database-url-owner-direct`
  - `better-auth-secret`, `engine-callback-secret`, `cron-shared-secret`, `va-fingerprint-key`
  - `resend-api-key` (`voidaccess.pro` is verified in Resend; `EMAIL_FROM` = `VoidAccess <hello@voidaccess.pro>`)
  - `github-oauth-client-id` and `-secret` (callback `https://app.voidaccess.pro/api/auth/callback/github`)
  - `turnstile-site-key` and `-secret-key`, `cloudflare-api-token`, `cloudflare-account-id`, `waitlist-ip-salt`
  - `dodo-api-key-test` (may still lack scopes, see Prerequisites), `openrouter-api-key`
- **The KMS key for the credential vault:** `projects/voidaccess-cloud/locations/us-central1/keyRings/voidaccess/cryptoKeys/credentials` (`va-app` can encrypt and decrypt).

**Cloudflare:** the `voidaccess.pro` zone is on Cloudflare. The token has DNS edit, Workers, KV, R2 and Turnstile rights.

── PREREQUISITES KATRIEL DOES (check them first; if one is missing, build everything else and list it) ──
1. **Google Search Console:** `voidaccess.pro` is verified, and `va-agent@voidaccess-cloud.iam.gserviceaccount.com` is added as an **Owner** in its Users and permissions. A Cloud Run domain mapping needs the caller to be a verified owner.
2. **Dodo:** a test-mode API key with the products, checkout sessions, customers, subscriptions and customer-portal scopes, stored as a new version of `dodo-api-key-test`.
3. **Dodo webhook:** after you deploy the app, Katriel registers `https://app.voidaccess.pro/api/webhooks/dodo` in Dodo's test-mode dashboard and stores its signing secret as `dodo-webhook-secret`. Give him the exact steps in your handoff, then verify it worked with a real test event.

── NON-NEGOTIABLE GUARANTEES ───────────────────────────────────────────────────
1. **Signed-out means redirected, everywhere.**
   - Every page on `app.voidaccess.pro` requires a valid session. A signed-out visitor gets a redirect to `https://voidaccess.pro/sign-in?next=<original app URL>`; `next` accepts only `https://app.voidaccess.pro/...`, never an open redirect.
   - App APIs answer 401 JSON instead of redirecting.
   - The only exceptions are machine endpoints: `/api/auth/*`, the engine spec and callback routes, the cron routes (each with its own auth), the Dodo webhook, `/api/health` and `GET /api/founding/seats`.
   - A test enumerates every route and proves it.
2. **One session across both domains, and nothing weaker.**
   - Better Auth stays the only auth system, on `app.voidaccess.pro`.
   - Session cookies are shared across `voidaccess.pro` and `app.voidaccess.pro` (Better Auth's cross-subdomain cookie setting, domain `.voidaccess.pro`), and stay httpOnly, Secure and SameSite=Lax.
   - Better Auth's trusted origins are exactly the two domains, plus the local dev pair outside production.
   - CORS on `/api/auth/*` allows only `https://voidaccess.pro`, with credentials.
   - P2's own mutation routes keep their same-origin checks (`app.voidaccess.pro` only).
3. **Sign-up rules move with the pages.**
   - Email sign-up on the site **requires the AUP checkbox**, enforced on the server: the sign-up endpoint rejects a request without `aupAccepted: true` and stores `aup_accepted_at`.
   - Magic-link and GitHub users still land on the app's `/accept-terms` before anything else.
   - Email verification is still required before a first investigation.
   - The first-touch attribution from the site (only what the consent prompt allows) is sent with sign-up and stored as before.
   - Free credits are granted once.
4. **`/dev/ui` and every development surface stay closed in production.**
5. **Least privilege in production.**
   - The app connects as `va_app` (RLS-bound) and never as the owner.
   - Migrations run only from a deliberate step with `database-url-owner-direct`, never from the running app.
   - The site's server code never holds the app's database URL (the minimal site needs no database at all).
   - Secrets reach services only as Secret Manager references, never baked into images or printed.
6. **The production proof uses throwaway test accounts and deletes them.** No real person's email.

── DELIVERABLES ────────────────────────────────────────────────────────────────
**D1-1. Auth pages move to the site** (`apps/site`)
- **Pages:** `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `/check-email` and `/verified`. They use the shared tokens and look like the site.
- **How they talk to Better Auth:** through its client pointed at `https://app.voidaccess.pro/api/auth`, with credentials included.
- **Sign-up form:** email and password (10+ characters), name, the **required AUP checkbox** linking to `/acceptable-use`, Turnstile, and the consented first-touch data.
- **Sign-in options:** email and password, magic link, and "Continue with GitHub".
- **After success:** go to `next`, or `https://app.voidaccess.pro/welcome`.
- **Email links:** verification and magic-link emails point at the app's Better Auth endpoints and finish on the app. Password-reset emails point at `https://voidaccess.pro/reset-password?token=…`. Update `packages/emails` and the Better Auth URLs accordingly.
- **Remove the app's own auth pages,** leaving `/accept-terms` in the app. Their old URLs redirect to the site's equivalents.

**D1-2. App guards and Better Auth config** (`apps/app`)
- Guarantee 1 is enforced in one place (middleware or a root layout guard) plus the API 401 rule, with tests.
- Better Auth config per guarantee 2:
  - cross-subdomain cookies on `.voidaccess.pro` in production (host-only locally, unless using the `*.va.localhost` pair)
  - trusted origins
  - a server-side `aupAccepted` requirement on email sign-up (guarantee 3)
  - sign-up attribution fields
- `/accept-terms` keeps working for social and magic-link users.
- **The cold-start fix:** R0 measured 75–150 s of image import before a run's first event under bursts.
  - Raise the "launching stuck" watchdog limit to 8 minutes.
  - Show "Starting a secure environment…" on the progress page while the status is `launching`.
  - Optionally cut the runner image size if there's an easy win (report the before and after).

**D1-3. The minimal site** (`apps/site`)
- **A `SITE_MODE=minimal` build flag:**
  - only the auth pages, `/acceptable-use`, `/privacy`, `/terms` (still marked "Draft, pending legal review") and a placeholder home are built and served
  - every marketing route returns 404
  - the waitlist and its database are disabled
- **Placeholder home:** the logo, one line ("VoidAccess Cloud: dark-web OSINT in your browser."), Sign in and Create account buttons, and links to GitHub and the legal pages. The copy lives in a content file for the growth architect.
- The full site keeps working unchanged without the flag (`pnpm --filter site dev`), for the later rework.
- **Deploy to Cloudflare at `voidaccess.pro`** (and redirect `www.voidaccess.pro`) with P1's OpenNext setup, adapted for minimal mode. The deploy reads only the secrets the minimal site needs (Turnstile, plus the app URL as config).

**D1-4. Production app** (Terraform first; `apply` only resources you own and have planned)
- **The `va-app` service:**
  - `allow_unauthenticated=true` (the app does its own auth, guarantee 1)
  - the image built from this branch by Cloud Build, run as `node .next/standalone/server.js` (the build already uses `output: standalone`)
  - min 0 / max 10 instances
- **Env:** every variable `env.ts` requires in production, as Secret Manager references or plain config:
  - `APP_URL`, `SITE_URL`, `EMAIL_FROM`, `ENGINE_LAUNCHER=cloudrun`, `NODE_ENV=production`
  - `KMS_KEY_NAME`, `VA_FINGERPRINT_KEY`, `BETTER_AUTH_SECRET`, `ENGINE_CALLBACK_SECRET`, `CRON_SHARED_SECRET`, `CRON_OIDC_EMAIL`
  - `RESEND_API_KEY`, the GitHub OAuth pair, `DODO_PAYMENTS_API_KEY` (test), `DODO_WEBHOOK_SECRET` (once it exists), `DODO_ENV=test_mode`, `SITE_ORIGIN`
  - `DATABASE_URL` (`va_app`)

  Add any missing secret-accessor bindings at resource level.
- **The domain `app.voidaccess.pro`:** a Cloud Run domain mapping in `us-central1`, plus a DNS-only (grey cloud) CNAME in Cloudflare so Google can issue the certificate. If the mapping is impossible (for example, verification isn't done), fall back to a Cloudflare Worker route on `app.voidaccess.pro` that proxies to the `run.app` URL, preserving cookies and headers. Report which one you used.
- **Scheduler:** create and **enable** the Cloud Scheduler jobs with OIDC to the app (`CRON_OIDC_EMAIL` service account):
  - `/api/cron/watchdog` every 5 min
  - `/api/cron/grants` daily
  - `/api/cron/founding` daily
  - `/api/cron/credit-alerts` hourly
- **Billing catalogue:** run the Dodo **test-mode** catalogue sync and the checkout smoke test (`dodo:sync`, `billing:checkout-smoke`) once the key has the scopes.
- **Clean-up:** remove the leftover revision `va-app-00002-s5l`, and make `terraform plan` clean (no drift) at the end.

**D1-5. Production proof** (throwaway accounts; delete them at the end)
1. Sign up at `https://voidaccess.pro/sign-up` (Playwright against production) with a plus-addressed or disposable test address you control programmatically. If no inbox is reachable, verify that one test account through a clearly named `withSystem("ops.verify-test-account")` script, and note it.
2. Land on `app.voidaccess.pro/welcome` signed in, with 100 credits.
3. Start a **Quick** investigation and watch the live progress through the real runner.
4. Results: the summary, the graph (with PNG export) and the entities all load, the ledger shows −20, and the `run_costs` row exists.
5. Sign out. `app.voidaccess.pro` redirects to `voidaccess.pro/sign-in`.
6. Isolation in production: a second throwaway account gets 404 on the first account's investigation page, results tabs, APIs, exports and SSE stream.
7. Billing (if the Dodo prerequisites are done): a test-mode checkout for Pro completes with Dodo's test card, the webhook arrives, the plan becomes Pro and the credits are granted once.
8. Delete both accounts through the account-delete API, and confirm their sessions die.

── ACCEPTANCE CRITERIA ─────────────────────────────────────────────────────────
- CI is green on `d1-deploy`; local steps and all end-to-end suites pass (exit codes checked), plus your new cross-domain auth tests.
- **`https://app.voidaccess.pro`:** signed out, every page redirects to `https://voidaccess.pro/sign-in?next=…`, APIs return 401, and the machine endpoints behave as specified.
- **`https://voidaccess.pro`:** serves the placeholder home and the auth pages; marketing routes 404 in minimal mode.
- The production proof (D1-5) passes, with evidence: screenshots, run id, ledger rows and timings. Billing step 7 passes or is listed as blocked on a prerequisite.
- `terraform plan` is clean. The scheduler jobs are enabled and have each run successfully at least once (show their last-run status).
- Secret hygiene: `gcloud run services describe` shows only secret references for sensitive values, and the images contain no secrets.

── CONSTRAINTS ─────────────────────────────────────────────────────────────────
- Justify every dependency.
- Don't edit P4's paths. Don't edit `packages/config` or `tokens.css`; request changes in the handoff.
- Use only va-agent rights. If an IAM or ownership step is denied, **don't work around it**: list the exact command or click-path for Katriel. Never print secrets.
- Throwaway test accounts only; delete them.
- Commit messages: plain, conventional, NO AI/assistant attribution of any kind.
- Push `d1-deploy` only. **Don't merge.** The architect reviews and merges.

── OUT OF SCOPE (later briefs) ─────────────────────────────────────────────────
- the full marketing site and its copy (growth rework)
- live-mode payments (switching Dodo to live)
- the archive cron job (after P4 merges)
- WhoisFreaks and ipgeolocation enrichment
- emails beyond what auth and billing already send (P6)
- the admin UI (P6)
- 2FA and Google OAuth (P8)

── HANDOFF (reply with this when done) ─────────────────────────────────────────
- the redirect and guard design, and the route-by-route test result
- the cookie and trusted-origin config, and the cross-domain test evidence
- the auth page move (old URLs and redirects, email link targets)
- how AUP and attribution are enforced at sign-up
- minimal-site mode: what's served and what 404s; the Cloudflare deploy details
- the app's Cloud Run config (env names and secret references, never values), the image, the start command
- the domain mapping (or Worker fallback) and the DNS records
- scheduler jobs and their last-run status
- the Dodo catalogue sync and checkout smoke results, and the webhook steps for Katriel
- the production proof evidence (D1-5)
- the cold-start mitigation (limits, UI, image size)
- `terraform plan` output summary
- every prerequisite or IAM step Katriel must still do
- every dependency with its reason
- CI and local results
- deviations with reasons

── APPENDIX ────────────────────────────────────────────────────────────────────
**Product owner's decision (2026-10-12):** "The app should be public at app.voidaccess.pro but only for signed-in users; if not signed in, they are redirected to voidaccess.pro. The sign-in will be at voidaccess.pro."

**Agreed option A:** deploy a minimal `voidaccess.pro` now (the auth pages plus a placeholder home). The full marketing site stays local until the growth rework.

**PRD v1.0 (2026-10-11), verbatim.** Pricing in the PRD is superseded by `docs/PRICING-v1.md`.

### 3.2 Account and onboarding (P0)
- Sign up with **email (magic link or password)** + **GitHub OAuth** (our audience lives on GitHub). Google OAuth is P1.
- **Email verification required** before the first investigation (abuse control).
- **Mandatory acceptance of the Acceptable Use Policy** at signup (checkbox + timestamp stored).
- First-run screen: one search box with **3 example queries as clickable chips** (e.g. a ransomware group, a sample domain, a crypto wallet), plus a short "what credits are" note showing the free balance.
- Optional 2-question profile (role, main use case) for segmentation. Skippable.

## 6. Non-functional requirements
- **Isolation (critical, given the engine's audit history):** a user can **never** see another user's investigations, entities, actors, monitors, exports or search results, including via shared caches, vector search or IDs in URLs. Must be tested explicitly before launch.
- **User safety:** all dark-web traffic originates from our infrastructure; **nothing is fetched from the user's browser or IP.** No dark-web HTML is rendered in the browser.
- **Abuse controls:** per-account rate limits; email verification; AUP acceptance; prohibited-query filtering (on by default, not user-configurable); logging of queries for abuse review; ability to ban.
- **Data retention:** clear default (e.g. investigation data kept while account is active; deleted on account deletion); state it on `/trust`.
- **Security basics:** HTTPS everywhere, secure session handling (no tokens readable by JavaScript), encrypted secrets and BYO keys, 2FA (P1).
- **Reliability:** runs survive page refreshes and deploys; failed runs auto-refund credits; status visible to the user.
- **Performance:** dashboard pages load fast; the graph stays usable up to at least a few thousand nodes (with filtering).
- **Accessibility:** readable contrast, keyboard navigation for main flows.
- **Observability:** per-investigation cost and duration logged (feeds admin cost view and credit pricing).
