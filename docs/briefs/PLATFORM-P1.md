BRIEF — Lane SITE, Sub-phase P1: Marketing site (voidaccess.pro) and waitlist

First brief in the SITE lane. Build the public marketing site with every PRD P0 page, SEO and AI-search readiness, analytics, and a working waitlist / founding-member signup that stores to Postgres and sends a confirmation email. This site goes live **before** the app.

**Content is placeholder.** The growth architect rewrites all copy before launch. Your job is the infrastructure, structure, performance and design quality, with copy kept in content files that are trivial to edit. Build only P1.

In parallel:
- CORE (P0) in `.worktrees/p0`: data model, UI kit, app shell
- ENGINE E1B (engine work; its harness is in the main `platform/` checkout)

Never touch `apps/app/`, `packages/` (except `packages/db/src/schema/waitlist.ts` and its one export line), `runner/`, the main `platform/` checkout, or `../voidaccess`.

── CONTEXT ─────────────────────────────────────────────────────────────────────
Work ONLY in `/Users/delzyn/Brand/companies/voidaccess/platform/.worktrees/p1`. It's a git worktree on branch `p1-site`, created from `main` at the scaffold commit. Run `pnpm install` first. The first time you push, use `git push -u origin p1-site`. **Never push to `main`.**

Read first:
- `docs/LANES.md`: you are SITE
- **the PRD**, pasted at the end of this brief: §2 (marketing site), §2.3 copy anchors, §2.4 site-wide requirements, §7 events
- `docs/PRICING-v1.md`: including amendment 1 (founding seats); the copy line is "Founding price $7/mo, kept every year you stay active."
- `packages/config/src/pricing.ts`: **the only source of prices**; import it, never edit it
- `packages/ui/src/tokens.css`: brand tokens
- the engine's `../voidaccess/docs/USAGE_POLICY.md` (basis for the Acceptable Use page) and `SECURITY.md` (responsible disclosure); read only
- `docs/baseline/E0-REPORT.md` §5 (honest capability limits for the Trust page)
- the engine logo and visuals in `../voidaccess/public/` (`logo_circle.png`, `voidaccess_logo.png`, `va_svg.svg`); copy what you need into `apps/site/public/`

Versions: Next.js 16.4, Tailwind 4.3. Read the current docs for Next.js, `@opennextjs/cloudflare` and Cloudflare Turnstile; don't rely on memory.

Local Postgres 17 is running. Use database `voidaccess_dev`, which P0 also uses; your table is `waitlist` only.

── PRODUCT FACTS THE SITE MUST STATE ACCURATELY ────────────────────────────────
- **What it is:** a hosted VoidAccess with AI-assisted dark-web search, enrichment, an entity and actor graph, and exports (STIX 2.1, MISP, CSV, JSON, Markdown, IOC package; Sigma/YARA/Snort/Suricata where available). The user installs nothing, runs no Tor, holds no keys, and no dark-web traffic touches their machine.
- **Pricing** comes from config: Free (100 credits, no card), Pro $9 (2,000), Pro+ $19 (4,500), annual (2 months free), top-ups, a Quick 20 / Standard 40 credit explainer, and the founding $7 offer with its rules stated plainly. **Deep is not shown at launch.**
- **The archive:** your searches and investigations are private; findings go into a shared, anonymous, dated archive that enriches future searches.
- **Credentials** found in sources are shown masked. Raw values are encrypted and never shown by default.
- **No images or media** from dark-web pages are ever fetched or shown.
- **Honesty line:** "We guarantee these sources and formats. We can't guarantee every mention on the dark web will be found. Nobody honestly can."
- **Don't claim** victim attribution ("see which group hit a company"). E0 found the typed relationships aren't reliable yet. Don't claim specific source counts beyond what the engine README lists, or any certification.

── NON-NEGOTIABLE GUARANTEES ───────────────────────────────────────────────────
1. **One source of truth for prices.** Every price, credit amount and plan feature on any page, in `/llms.txt` and in JSON-LD comes from `@voidaccess/config` at build time. A test fails if a dollar amount or credit number is hard-coded in `apps/site`, apart from the config import.
2. **Copy is separate from code.**
   - All page copy lives in `apps/site/content/` (typed TS objects or MDX), one file per page.
   - Components only render content.
   - Add `apps/site/content/README.md` explaining to a non-engineer how to edit copy.
3. **Privacy-respecting analytics only.**
   - Plausible (script via a proxied first-party path), no other trackers, no third-party cookies.
   - First-touch attribution (utm_*, `ref`, landing path, timestamp) is kept in first-party storage and submitted with the waitlist form.
   - Disclose it on the Privacy page. If any non-essential storage needs consent under GDPR/ePrivacy, implement a minimal consent prompt only for that, and flag it in the handoff for a growth/legal decision.
4. **Performance and accessibility:**
   - Lighthouse mobile ≥ 90 for Performance, Accessibility, Best Practices and SEO on Home and Pricing
   - LCP < 2 s on simulated mobile 4G
   - no layout shift from fonts
   - readable contrast and keyboard navigation everywhere
5. **The waitlist is abuse-safe:**
   - Cloudflare Turnstile
   - a per-IP rate limit
   - server-side email validation
   - double opt-in (a confirmation link)
   - IPs stored only as a salted hash
   - no account enumeration (the same response for new and existing emails)
6. **Honest claims only.** Nothing on the site claims more than the product facts above.

── DELIVERABLES ────────────────────────────────────────────────────────────────
**S1. `apps/site`** (Next.js 16 App Router, Tailwind v4 with `@voidaccess/ui/tokens.css`, fonts via `next/font`: Space Grotesk, Inter, JetBrains Mono). Pages (PRD §2.2 P0):

**`/` Home:**
- the hero one-liner and subline (PRD §2.3 anchors)
- the primary CTA "Join the waitlist / founding seats" (until the app is live) and the secondary "See pricing"
- **the signature visual:** an animated investigation graph built from a **real E0 run**. Pull one CLI JSON from `gs://voidaccess-cloud-runs/baseline/` with va-agent (`CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess`).
  - keep public group, malware and CVE names; replace IPs, handles, wallets, emails and onions with realistic fakes
  - commit only the redacted node/edge JSON
  - render it lightweight (canvas or SVG, with a static frame for `prefers-reduced-motion`), not the full sigma stack
- the 3 pillars (Coverage · Context · Control)
- "How it works" in 3 steps
- a "Cloud vs install" comparison
- social proof: live GitHub stars from the GitHub API, cached at build/ISR, with a static fallback; installs; leave an "as featured by" slot **hidden** until real
- a founder credibility strip (CVE-2026-50112 Apache CloudStack RCE, MailAccess)
- FAQ and a final CTA

**`/pricing`:**
- plan cards, a monthly/annual toggle, the credit explainer (Quick 20 / Standard 40, "≈ 50 Standard investigations a month on Pro"), the top-up table with subscriber bonus, and the founding banner with the rules and a **seat counter**
- the counter reads `GET /api/founding/seats`. Implement that route to return `{ available, total }`. P0's `founding_seats` table isn't merged yet, so return `total` from config and `available = total` with a `source: "static"` flag, behind a single function so it can be wired to the DB later. **Never invent a scarcity number.**
- the pricing FAQ: what a credit is, no rollover, top-up expiry, cancel anytime, refunds of failed runs, the founding rules

**`/features`:** the pipeline explained visually (use the 8 stages: refine, collect, filter, fetch, enrich, extract, graph, summarize), entity types, enrichment categories, exports, AI search, and the archive.

**`/trust`:**
- a usage policy summary
- what we cover and don't cover (honest)
- the content-safety approach (gates, no media, masking)
- data retention (investigations kept while the account is active and deleted with it; the archive is anonymous and permanent)
- tenant isolation, the archive disclosure, the credential handling, the audit history, and the responsible disclosure contact (from SECURITY.md)

**`/terms`, `/privacy`, `/acceptable-use`:**
- drafts based on the engine USAGE_POLICY and standard SaaS terms, **marked "Draft, pending legal review"** on the page
- they must include the founding-seat rules (amendment 1) and the archive disclosure

**`/open-source`:** the MIT engine, the GitHub link and star count, "self-host free forever", and GitHub Sponsors.

**`/waitlist/confirmed`, `/waitlist/check-email`, and a 404.**

**Header:** logo, Features, Pricing, Trust, GitHub with star count, "Join waitlist". **Footer:** product links, legal, Trust, GitHub, Sponsors, "Also by Katriel: MailAccess", social placeholders.

**S2. SEO and AI-search readiness:**
- a unique title and meta per page
- OG and Twitter images via `next/og`
- `sitemap.xml`, `robots.txt`, canonical URLs
- **`/llms.txt`** (and `/llms-full.txt`) generated from content and config: product, pricing, features, policies
- JSON-LD: `SoftwareApplication` + `Offer`s (from config), `FAQPage`, `Organization`
- pricing and features rendered as real HTML text (verify in the page source)

**S3. Waitlist:**
- `packages/db/src/schema/waitlist.ts` (yours) plus its export line in `schema/index.ts`
- table `waitlist`: id, email (unique, case-insensitive), role?, use_case?, wants_founding bool, first_touch jsonb, ref_code?, ip_hash, consent_marketing bool, created_at, confirm_token_hash, confirmed_at
- a drizzle-kit migration for that table only, placed so the architect can merge it alongside P0's migrations (name it clearly, e.g. `waitlist_init`)
- `POST /api/waitlist`: Turnstile verify, rate limit, validation, insert or upsert, a confirmation email
- `GET /api/waitlist/confirm?token=…`
- analytics events from PRD §7 that apply pre-launch: `site_visit` (with utm/ref) and `waitlist_joined`. Send them to Plausible as custom events; there's no app events table yet.
- **Email:** Resend with a plain founder-voiced text email (placeholder copy in `content/`). In dev and test, use a log transport. In production, read the secret `resend-api-key`. If it has no version, deploy with email disabled and report it.

**S4. Deployment (Cloudflare, via `@opennextjs/cloudflare` so static pages are prerendered and the waitlist routes run as Workers):**
- the DB connection from Workers uses `@neondatabase/serverless` (HTTP) with Drizzle. Locally use node-postgres against local Postgres, behind one adapter.
- `wrangler` config and a deploy script that reads `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DATABASE_URL`, `RESEND_API_KEY` and `TURNSTILE_SECRET_KEY` from GCP Secret Manager (`cloudflare-api-token`, `cloudflare-account-id`, `database-url`, `resend-api-key`, `turnstile-secret-key`) at deploy time, without printing them
- **If any of those secrets is missing, deploy nothing.** Produce a local production build plus a `wrangler dev` preview and list what's missing in the handoff. The architect will get the accounts set up.

**S5. Tests:**
- Vitest unit tests: the price-hard-coding guard, the llms.txt and JSON-LD built from config, and the waitlist validation, rate limit and no-enumeration behaviour
- one Playwright smoke test: home → pricing → waitlist submit → confirm → confirmed page, with Turnstile in test mode
- a Lighthouse CI run (or Lighthouse via Playwright) asserting the guarantee-4 thresholds on Home and Pricing

── ACCEPTANCE CRITERIA ─────────────────────────────────────────────────────────
- `pnpm --filter site build`, `pnpm typecheck`, `pnpm lint` and `pnpm test` pass, and the Playwright smoke test passes locally.
- Lighthouse mobile ≥ 90 ×4 on Home and Pricing, with the LCP number reported.
- The price-hard-coding guard passes, and changing a price in config changes the site, `/llms.txt` and JSON-LD after a rebuild. Show it.
- The waitlist works end to end locally (row created, confirmation email in the log transport, confirm flips `confirmed_at`), and a duplicate email gets the identical response.
- Every page renders well at 375 px and 1440 px. Include screenshots of Home, Pricing and Trust at both widths in `apps/site/docs/screenshots/`.
- Either deployed to Cloudflare with the URL reported, or a list of the missing secrets/accounts.

── CONSTRAINTS ─────────────────────────────────────────────────────────────────
- Justify every dependency.
- Keep the site light: no sigma or graphology, no UI kit beyond tokens plus site-local components, no client JS on pages that don't need it.
- Don't edit architect-owned paths (`packages/config`, `tokens.css`, root workspace files except adding devDependencies, and `docs/`) or anything CORE owns. Request changes in the handoff.
- No real user data, no secrets in the repo, no unredacted graph data.
- Commit messages: plain, conventional, NO AI/assistant attribution of any kind.
- Push `p1-site` only. **Don't merge.** The architect reviews and merges.

── OUT OF SCOPE (later briefs) ─────────────────────────────────────────────────
- the blog, `/vs/*` and `/alternatives/*` pages, `/about`, `/changelog`
- the `/check` free tool (needs an engine search-only mode)
- the affiliate page
- wiring the seat counter to the database (after P0 merges)
- final copy (growth architect)

── HANDOFF (reply with this when done) ─────────────────────────────────────────
- the page list with their content files
- how prices flow from config (and the guard test)
- llms.txt and JSON-LD samples
- graph-visual provenance (which E0 run, the redaction rules)
- the analytics and attribution design, plus any consent decision needed
- the waitlist API and schema, and the migration file name
- test and Lighthouse results
- screenshots
- the deployment URL or the missing accounts/secrets
- every dependency with its reason
- requests for architect-owned files
- deviations with reasons

── APPENDIX: PRD (VoidAccess Cloud v1.0, 2026-10-11) ───────────────────────────
Katriel will paste the PRD below this line when sending the brief.
