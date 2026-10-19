# VoidAccess Cloud: Architecture & Infrastructure

**Status:** draft v0.2, 2026-10-11, for Katriel's review · **Implements:** PRD v1.0 (2026-10-11)
**Companions:** [ENGINE-CONTRACT.md](ENGINE-CONTRACT.md) (what the engine must provide) · [ROADMAP.md](ROADMAP.md) (phases for both roadmaps)

---

## 1. Story so far

The engine in `../voidaccess` (v2.0.3) can run three ways: as a CLI on SQLite, as a FastAPI service with a durable job queue backed by Postgres, and as a Next.js 14 UI. It was built for **one trusted operator per install**. The code map from 2026-10-11 found it is not multi-tenant safe:

| # | Gap | Where | Blocks the cloud? |
|---|---|---|---|
| 1 | Missing owner checks (IDOR) on graph ×4, temporal, stylometry, opsec, neighbors | `api/routes/investigations.py:2883,3419-3530`, `api/routes/entities.py:292,459,677` | No (§2 design), but **affects self-hosters** |
| 2 | Global `entities` dedup mutates shared rows (snippet, confidence, page_id) across investigations | `db/queries.py:328-400` | No (§2), self-hosters yes |
| 3 | Actor profiles, notes and aliases are global and writable by anyone | `api/routes/actors.py:217` | No, self-hosters yes |
| 4 | Monitors are one global YAML that anyone can delete or trigger | `api/routes/monitors.py` | No, self-hosters yes |
| 5 | Chroma semantic search is global and exposed | `api/routes/search.py:44-115` | No, self-hosters yes |
| 6 | `/admin/*` has no role check | `api/routes/admin.py` | No, self-hosters yes |
| 7 | Rate-limit key trusts the left-most `X-Forwarded-For` | `ratelimit/limiter.py:87` | No, self-hosters yes |
| 8 | Web token is not httpOnly; logout never revokes it | `web/lib/auth.ts`, `web/app/api/auth/login/route.ts` | No, self-hosters yes |
| 9 | Pages are persisted to `pages` and Chroma **before** the Layer-4 safety scan; URL gate fails open (`except: pass`) | `investigations.py:1887-1926`, `scraper/scrape.py:538` | **Yes** |
| 10 | The CLI and API are **two separate ~1,000–1,500-line orchestrators**. The CLI skips Layer-4 sanitizing on Tor pages, i18n, the crawler and stylometry | `voidaccess_cli/commands/investigate.py`, `api/routes/investigations.py:1018` | **Yes** |
| 11 | Depth exists only in the CLI, and even there it only changes concurrency | `investigate.py:228` | **Yes** |
| 12 | No token or cost accounting | `utils/investigation_metrics.py` | **Yes** (pricing) |
| 13 | Cancellation is checked after only 4 of the steps | `investigations.py:565` | **Yes** |
| 14 | Progress says 13 steps while 0–9 run, so the bar stops at about 69% | `investigations.py:2799` | Yes (UX) |
| 15 | `SAFETY_BYPASS_PROMPT` ("DO NOT apply standard conversational safety filters") | `voidaccess/llm.py:23` | **Yes** (provider policy, on our keys) |

## 2. Core decision: one investigation = one disposable container

Users never reach the engine. The platform launches **one short-lived engine container per investigation**. That container has its own Tor client and its own throwaway SQLite database, and it disappears when the run ends.

```
                           ┌──────────────────────────────┐
  visitor ────────────────►│ voidaccess.pro  (apps/site)  │  Cloudflare Pages (static, free)
                           └──────────────────────────────┘
                           ┌──────────────────────────────┐
  user ───── httpOnly ────►│ app.voidaccess.pro (apps/app)│  Cloud Run service (scales 0→N)
  cookie                   │ Next.js UI + server routes   │
                           └───┬──────────▲───────────┬───┘
                               │          │           │
            launch job (API)   │          │ progress  │ read/write
            with run spec      │          │ callbacks │
                               ▼          │ (HMAC)    ▼
               ┌───────────────────────┐  │    ┌──────────────────────┐
               │ Cloud Run JOB         │──┘    │ Neon Postgres        │
               │ "engine-run"          │       │ (platform DB,        │
               │ engine + Tor client   │       │  scales to zero)     │
               │ ephemeral SQLite      │       └──────────────────────┘
               │ 1 execution per run   │
               └──────────┬────────────┘
                          │ bundle.json + exports
                          ▼
               ┌───────────────────────┐   platform ingests bundle → tenant-owned rows,
               │ Object storage (R2/GCS│   masks sensitive values, then the artifacts
               │ runs/{run_id}/…       │   expire (lifecycle: 7 days)
               └───────────────────────┘
  Cloud Scheduler ──► app /api/cron/*  (watchdog for stuck runs, monthly credit grants, alerts, monitors P1)
```

**Why this design:**
1. **Isolation by construction.** There is no shared engine database, cache, vector store or long-lived process between users. Gaps 1–8 can't be reached from the cloud, because the cloud never runs the engine's API or UI. PRD check #4 then reduces to auditing **one** platform codebase, where every row carries `user_id`.
2. **True scale to zero.** With no runs there are no engine containers. Fifty parallel investigations means fifty parallel job executions, with no queue to babysit.
3. **Safety in one place.** The job image runs a locked cloud policy: forced gates, no bypass prompt, private mode, no media. Users can't change any of it.
4. **It uses the CLI's existing shape.** The CLI already runs end to end on SQLite. The engine work becomes "make the single pipeline headless and emit events", not "make a multi-tenant server". That's also why roadmap 1 is about the CLI and engine.
5. **Results are immutable snapshots.** Once ingested, a completed investigation lives in platform Postgres. Exports such as CSV, JSON and Markdown come from the snapshot. STIX, MISP, Sigma, YARA and Snort are generated by the job and stored with the bundle, then copied into platform storage at ingest.

**What we give up**
- No cross-run cache, so every run fetches fresh. That costs a little more and is a little slower.
- Tor has to bootstrap at each start. That's about 10–30s, reduced by baking a recent consensus into the image, and it's measured in Engine phase E5.
- The actor library (P1) is built **in the platform** from each user's own bundles. That keeps it tenant-scoped, which is what we want anyway.

**The AI refinement step stays visible.** It runs as the first live stage of the run ("We're searching for: …"), so no always-on engine API is needed. A paid-before-preview step can come later if users ask.

## 3. Infrastructure (recommended: Google Cloud Run + Neon + Cloudflare)

| Component | Service | Scales | Idle cost |
|---|---|---|---|
| Marketing site | Cloudflare Pages (static Next.js export) | CDN | $0 |
| App (UI + API + webhooks + cron routes) | **Cloud Run service**, min 0 (min 1 at launch week to avoid cold starts), concurrency 80 | 0 → N | $0 at min 0 |
| Engine runs | **Cloud Run Jobs**, 1 execution per investigation, Tor inside the container, task timeout 60 min, ~1 vCPU / 2 GiB (tune in E5) | 0 → regional quota (hundreds) | $0 |
| Platform DB | **Neon Postgres** (serverless, scales to zero after 5 min idle; branch per preview env) | autoscaling compute | $0 on the free plan, then usage-based |
| Artifacts | Cloudflare R2 (no egress fees) or a GCS bucket in the same region | — | ~$0 |
| Schedules | Cloud Scheduler → app `/api/cron/*` (OIDC-authenticated) | — | ~$0 (3 free jobs) |
| Secrets | Secret Manager (OpenRouter key, Creem, Resend, HMAC secrets) | — | ~$0 |
| Email | Resend | — | free tier |
| Payments | Creem (merchant of record, P7; replaced Dodo) | — | 3.9% + $0.40 per transaction |
| Analytics | Plausible (site) + first-party `events` table (funnel) | — | ~$9/mo or self-host |
| Errors and logs | Cloud Logging + Sentry free tier | — | $0 |

**Approximate run compute** *(to be confirmed against the live [Cloud Run pricing](https://cloud.google.com/run/pricing) page; third-party 2026 sources quote about $0.000018/vCPU-s and $0.000002/GiB-s, with an instance-billing free tier of about 240k vCPU-s and 450k GiB-s per month)*:
- A 5-minute Standard run at 1 vCPU / 2 GiB is about 300 vCPU-s + 600 GiB-s, which comes to **~0.7¢**.
- The free tier covers roughly **800 such runs a month**.
- The **LLM cost is the bigger unknown**. Engine phase E3 meters it per call. PRD margin rule: at the $7 founding price after payment fees (computed with Dodo's; Creem's are lower), we must stay at or below 0.078¢ per credit. That means a **Standard run must total ≤ 1.9¢ and a Deep run ≤ 4.7¢**. If compute plus LLM exceeds that, we change the credit price per depth (per the PRD), never the plan price.

**Expected idle total:** about $0–10/mo, mostly Plausible and the min-1 instance during launch week.

**Risks to check before we commit**

| Risk | Mitigation |
|---|---|
| Cloud Run Jobs bill wall-clock time while Tor waits (I/O-bound) | E5 measures it. If runs spend most of their time waiting, run 3–5 investigations per container (an async pipeline). Same contract, cheaper. |
| Some clearnet sources (pastes, feeds) block Google Cloud IPs | The engine's existing ScrapingAnt or proxy option for clearnet only. Tor traffic is unaffected. |
| GCP acceptable-use terms for Tor client traffic | Client traffic only, no relays. Review the AUP. Fallback is the same container image on Fly.io Machines, which also scale to zero and bill per second. |
| Neon cold start (~0.5–1s on the first query after idle) | Acceptable for the app. Keep the app at min 1 during launch if it's noticeable. |

**Alternatives considered:**
- **One Hetzner box:** about €15–40/mo fixed. It's the cheapest at steady load, but it doesn't scale to zero or burst, and we'd need to run our own queue.
- **Fly.io Machines:** a good fallback that runs the same image.
- **AWS Fargate / Lambda:** Lambda's 15-minute cap and lack of Tor support rule it out, and Fargate has more setup than Cloud Run Jobs.

## 4. Platform internals

**Credits: an append-only ledger with reserve → settle → refund**

| Event | Ledger rows |
|---|---|
| Monthly grant | `+N` grant (previous grant remainder expires: `-rem`, reason `expiry`) |
| Run start | `-price(depth)` reserve, in **one transaction** with the investigation insert; rejected if the balance is too low |
| Completed | nothing (price is fixed per depth, so the estimate always equals the charge, PRD check #3) |
| Failed | `+price` refund (full) |
| Cancelled | `+` refund for stages not run (stage weights in `pricing.ts`) |
| Top-up | `+N` top-up (+ subscriber bonus), 12-month expiry |
| Admin grant | `+N`, reason `admin`, actor recorded |

- Spend order: grant first, then top-up.
- Every row has a unique `idempotency_key`, so webhooks and retries never double-apply.
- Measured cost is stored separately (`run_costs`) for the admin cost view.

**Run lifecycle**
- Statuses: `reserved → launching → running → ingesting → completed | failed | cancelled`.
- The **watchdog** cron runs every 5 minutes. If a run has had no progress event for 10 minutes, or its job execution has failed, it marks the run failed, refunds it, and sends an email.
- Results survive refreshes and deploys, because state lives in Postgres and runs live in Cloud Run.

**Masking**
- At ingest, every entity marked `sensitive` is stored as a masked display value plus an HMAC fingerprint, for dedup and the later verified-owner unmask (P1).
- Raw passwords never arrive (the contract forbids it). If one did, the masking step would still mask it.

**Stack**
- pnpm + Turborepo monorepo
- Next.js 15 App Router, React 19, TypeScript, Tailwind v4, Radix-based own components
- sigma + graphology (WebGL graph, ported from the engine UI)
- Drizzle ORM
- Better Auth, passwordless: Google, Microsoft or GitHub OAuth, or a 6-digit email code (10 min, 5 attempts). No separate sign-up: the first sign-in creates the account. httpOnly cookie sessions; AUP accepted once on `/accept-terms` and enforced server-side at run start; 2FA is P1
- Resend + React Email
- Creem REST API (plain fetch) + webhooks (P7; was the Dodo SDK)
- Vitest + Playwright (with a dedicated cross-tenant isolation suite)

**Repo layout**
```
platform/
├── apps/site · apps/app
├── packages/config (pricing.ts = single source for prices/credits/depths) · db · ui · engine-client · engine-mock · emails
├── infra/ (Terraform or gcloud scripts: Cloud Run, Jobs, Scheduler, Secrets, buckets)
├── tests/isolation
└── docs/
```

## 5. Decisions needed (Katriel)

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | Infra: Cloud Run Jobs + Neon + Cloudflare as above | **Yes** | True scale to zero; per-run isolation; ~$0 idle |
| D2 | Shared corpus in the cloud | **Off at launch** (`PRIVATE_MODE`) | Matches PRD §6 "no leakage via shared caches"; removes Meilisearch and Chroma from the infra; revisit as an opt-in with disclosure |
| D3 | `SAFETY_BYPASS_PROMPT` in the cloud policy | **Drop it** and measure the refusal rate in E5 | Provider bans on our keys would take the product down; contradicts `/trust` |
| D4 | Engine gaps 1–8 (self-hoster security bugs) | Fix them in **E1** as an OSS release (2.0.4), in parallel with the cloud work | Not cloud blockers in this design, but they are live, public issues in a 10k-install tool |
| D5 | Version control for `../voidaccess` (no `.git` in the copy) | Restore the real repo checkout before E-phase work starts | Briefs produce diffs that need review |
