# VoidAccess Cloud: Phase Roadmap

**Status:** draft v0.3, 2026-10-11, for Katriel's review. This version supersedes the "engine job mode" in ENGINE-CONTRACT v0.2 and decision D2 in ARCHITECTURE v0.2.
**Working rule:** every phase becomes a paste-ready brief, implemented in its own chat. I validate the results and fix only small issues (syntax, CI, wiring). Every change to `../voidaccess` is proposed to Katriel before it's made.

---

## Principles (changed after Katriel's review)

1. **The engine stays as close to untouched as possible.** A platform-owned **runner** (Python, inside the job image) imports and runs the existing CLI pipeline. It applies depth through the engine's existing env caps, enforces cloud policy and converts the run's local SQLite into a JSON bundle. Engine edits are limited to a short list of small changes, each proposed first.
2. **The platform builds all intelligence views from JSON:** the identity graph, the searchable dashboard and exports.
3. **The shared corpus is ON.** We keep everything we find, permanently and dated, so later searches are enriched with history even after the dark-web source has disappeared. The corpus stores **findings, never who searched or what they typed**.
4. **Cost is measured, not engineered.** We run a baseline, set fixed credit prices per depth with headroom, and cap every run's spend.
5. **All infra is on GCP + Neon.** GCS Standard is about $0.02/GB-month (verify on the live page), so 200 GB is about $4/mo. That is within a dollar or two of a Hetzner Storage Box, so we stay uniform on GCP.

## How cost is balanced without building a meter

| Lever | How | Engine change? |
|---|---|---|
| **Baseline** | Run a query matrix (E0) in Cloud Run Jobs. Cost = compute (duration × rate) + LLM (OpenRouter key usage before and after each run, runs executed sequentially) | None |
| **Exact per-run LLM cost in production** | The runner creates a **per-run OpenRouter key with a spend limit** through OpenRouter's key-provisioning API, reads its usage at the end, then deletes it. That gives exact cost per run **and** a hard cap against runaway runs. *(Verify the provisioning API supports this; fallback: per-run cost = depth average from the baseline.)* | None |
| **Pricing** | Fixed credits per depth, set at **p90 baseline cost** with ≥80% margin at the founding price. The estimate always equals the charge. | — |
| **Guardrails** | Per-depth caps (pages, LLM pages, timeout) + the per-run spend cap + the admin cost view (cost vs credits charged, per run) | — |

## Engine changes: re-evaluated

| # | Change | Needed? | Why / alternative |
|---|---|---|---|
| 1 | Job mode / new orchestrator / bundle builder | **No** | The runner does this outside the engine |
| 2 | Depth presets | **No** | The runner sets `MAX_LLM_PAGES_PER_INV`, `MAX_REL_PAGES_PER_INV`, the `*_MAX_RESULTS` caps and `--depth` per preset |
| 3 | Cost metering | **No** | Per-run OpenRouter key (above) |
| 4 | Remove the safety-bypass prompt in the cloud | **No** (D3 accepted) | The runner overrides it at import time; a clean env flag can come later |
| 5 | **CLI content-safety parity:** run the Layer-4 content scan on Tor pages *before* extraction and summary (the API does this; the CLI doesn't), and make the URL gate fail closed | **Yes, small** | We store results permanently and show them to users. Prohibited content must never reach the LLM, the summary or the corpus. This can't be done after the fact. |
| 6 | **Progress hook:** an optional callback on the CLI's step display | **Maybe, small** | The runner first tries an adapter around `voidaccess_cli.display`. It proposes a tiny hook only if that turns out to be fragile. |
| 7 | **Typed relationships** (for example `group —claimed_victim→ org`) in output | **Decide after E0** | If bundles already carry these edges (LLM relationship extraction + ransomware.live), nothing is needed. Otherwise the platform does an LLM edge pass, or the engine change is proposed. |
| 8 | Self-hoster security fixes (IDORs, admin role, global monitors/actors, cookie) | **Separate OSS track, your call** | They don't affect the cloud, where each run uses a throwaway SQLite. They are live in the public tool. |

---

## Roadmap E: Engine (`../voidaccess`)

| Phase | Goal | Done when |
|---|---|---|
| **E0. Baseline** (no engine code; runs on runner v0 from R0) | Restore the git repo. Run **30 queries × 3 depths** (ransomware groups, domains, handles, wallets, an org that was a victim) in Cloud Run Jobs. Record duration, Tor bootstrap, pages, entities, typed edges, LLM calls and cost, compute cost, and refusals without the bypass prompt. Audit enrichment-source licences for commercial use (which sources run on our keys vs BYO). | A cost table (p50/p90 per depth) → final credit prices in `pricing.ts`; decision on change #7; licence list |
| **E1. Small changes** (each proposed to Katriel first) | #5 safety parity (required); #6 progress hook (only if needed); #7 if E0 says so | CLI tests pass; a planted prohibited page never reaches the summary or the bundle |
| **E2. OSS security release** (optional, any time) | #8 for self-hosters | A two-user test suite passes on every API route |

## Roadmap P: Platform (`platform/`)

Lanes run in parallel chats. **P0 goes first.** After that, every lane builds against a **mock bundle generated from a real CLI JSON**, so no lane waits on another.

| Phase | Lane | Goal | Done when | Depends on |
|---|---|---|---|---|
| **P0. Foundations** | CORE | git; pnpm + Turbo monorepo; `pricing.ts` (single source); env schema; Drizzle schema (auth, investigations, run_events, per-investigation snapshot tables, credit_ledger, billing, events, waitlist, abuse, run_costs, **corpus tables**); brand tokens + UI kit; the **bundle schema** (JSON Schema shared by runner and app) + a mock bundle + a mock runner; CI; `infra/` skeleton (Terraform: Cloud Run, Jobs, Scheduler, Secret Manager, GCS buckets) | `pnpm dev` runs site + app + mock; CI is green | — |
| **R0. Runner v0** | RUNNER | Python package `platform/runner` + job image: installs the pinned engine, runs the CLI pipeline with depth presets, applies cloud policy (no bypass prompt, engine's internal shared tier off, gates on), turns the run's SQLite into a bundle (entities, typed relationships, actors, sources with dates, **sanitized page text** via the engine's own `sanitizer.gate`), uploads to GCS, posts signed progress callbacks, uses a per-run OpenRouter key with a cap, handles SIGTERM | A real run in Cloud Run Jobs produces a schema-valid bundle; it powers E0 | P0 (bundle schema) |
| **P1. Site + waitlist** | SITE | PRD P0 pages, copy anchors, graph hero, SEO/AEO (`/llms.txt`, JSON-LD, sitemap, OG), Plausible, UTM/ref capture, waitlist → DB + confirmation email; deploy | Lighthouse mobile ≥ 90; prices readable in source and `llms.txt`; waitlist works end to end | P0. **Ships first** |
| **P2. App core** | APP | Auth (email/password + magic link + GitHub, verification, AUP timestamp), onboarding, shell + credit balance, new investigation (depth → fixed credit price, reserve in one transaction), launch the Cloud Run Job, live progress (SSE from run_events), history, cancel + refunds, watchdog | Signup → first run → results page in < 5 min on the mock | P0 |
| **P3. Results & identity graph** | RESULTS | Ingest bundle → per-investigation tables; entity resolution within a run; **identity graph** (sigma/WebGL; filter by type; node detail with sources and dates; PNG/SVG export); **searchable dashboard** per investigation (summary, entities with faceted search, actors, sources timeline); masking at ingest; exports (CSV/JSON/MD/IOC from the snapshot; STIX/MISP from runner artifacts) | Graph usable at 3k nodes; every sensitive value masked; exports valid | P0 (mock bundle) |
| **P4. Corpus ("the archive")** | CORPUS | Permanent, dated, anonymous findings store: **GCS** holds immutable dated bundles + sanitized page snapshots (retention lock, never deleted); **Neon** holds a compact index (canonical entities, observations with `observed_at`, sources with first/last seen + last alive, relationships with evidence and first/last seen). Ingest after every run with **no user or query linkage**. Cross-run entity resolution (canonical rules + alias table + LLM-assisted merge for orgs and groups). **Enrich at read time:** a "From the VoidAccess archive" section + 1–2 hop graph expansion (a search for an org surfaces the group that claimed it, with the dates seen). Confidence by independent-source count (poisoning guard). A legal removal process. | A second search on a related term shows dated archive findings that are no longer live; the Deloitte↔group case passes with fixture data; no corpus row references a user | P0, P3 (shared entity model) |
| **P5. Billing** | BILLING | Dodo: Free/Pro/Pro+, annual (2 months free), proration, cancel, top-ups (+ subscriber bonus, 12-month expiry), founding offer (first 100, live counter), 80/100% alerts, usage ledger page, receipts | Upgrade, top-up, cancel and annual all work end to end in Dodo test mode | P0 |
| **P6. Ops** | OPS | Emails (verify, welcome, 24h nudge, results ready, credit alerts, cancel survey); the PRD §7 funnel events with attribution; admin (users, abuse flags, suspend/ban, refunds, grants, **cost vs charge per run**, corpus stats); per-account rate limits; query logging for abuse review | Every §7 event fires with UTM/ref intact | P0 |
| **P7. Launch hardening** | QA (me + a QA chat) | Isolation suite (private tier: two accounts, every route, URL, export and search); PRD §9 checks; 50 parallel jobs load test; security review; `/trust` + legal updated for the corpus; mobile pass; production deploy | All §9 checks pass | P1–P6, E1 |
| **P8. Fast follow** | — | `/check`, monitors (re-run + diff against the archive), share links/PDF, cross-investigation actor library, BYO keys, Google OAuth, auto top-up, 2FA, status page, blog, vs pages | — | Launch |

## Suggested order (parallel chats)

- **Day 1:** P0 (CORE). Then the same day, in parallel: P1 (SITE), R0 (RUNNER).
- **Days 2–4:** P2 (APP), P3 (RESULTS), P5 (BILLING), P6 (OPS) in parallel; E0 runs as soon as R0 works.
- **Days 4–6:** P4 (CORPUS) and E1; credit prices finalised from E0.
- **Day 7 on:** P7 validation.

## Open items for Katriel

1. **Corpus vs PRD and `/trust` wording.** PRD §6 says no leakage "including via shared caches". The new rule is: *your searches and investigations are private; findings go into a shared, anonymous, dated archive*. Ace needs to update the PRD and Trust copy.
2. **Corpus content policy.** Store sanitized page text (credentials and personal data redacted by the engine's sanitizer), never raw credentials or media. Also define how a takedown/legal-removal request is handled.
3. **Restore git** for `../voidaccess` (E0 needs it), and confirm that `platform/` gets its own private repo.
