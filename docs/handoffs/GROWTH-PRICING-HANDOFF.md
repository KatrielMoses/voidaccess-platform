# VoidAccess Cloud: pricing and credits handoff

**From:** Engineering (architect) · **To:** Growth architect · **Date:** 2026-10-11
**Ask:** decide the dollar price and credit system for VoidAccess Cloud using the measured costs below. Engineering builds whatever you choose within the constraints in §6.

---

## 1. What the product is (pricing-relevant facts only)

- **VoidAccess Cloud** is a hosted version of the open-source VoidAccess dark-web OSINT engine (MIT, ~800 GitHub stars). A user types a query (a ransomware group, a domain, a handle, a wallet, a CVE). We run a full investigation on our infrastructure over Tor and return:
  - an AI summary
  - extracted entities (IOCs, wallets, handles, credentials, CVEs …)
  - a relationship graph
  - sources
  - exports (STIX, MISP, CSV, JSON …)
- **The user installs nothing**, runs no Tor and holds no API keys.
- **One investigation = one billable action.** Viewing results, the graph and exports is free once a run completes.
- **The shared archive:** every run's findings are stored permanently and anonymously, dated. Later searches are enriched with history even after dark-web sources disappear. The archive gets more valuable with usage, which matters for retention and positioning.
- **Payments:** Dodo Payments (merchant of record) at **4% + $0.50 per transaction**.
- **Target users:** OSINT researchers, security pros and bug hunters, small security teams and MSSPs, journalists and students.
- **Competitor anchors:**
  - enterprise tools (Recorded Future, Flare, SOCRadar, DarkOwl) cost $5k–$100k+ per year
  - the free open-source alternatives (TorBot, Robin) have no hosted product and no full enrichment pipeline

## 2. Measured cost per investigation (2026-10-11)

The baseline was 87 real investigations run in our production setup: one Cloud Run Job container per investigation, Tor inside the container, DeepSeek (`deepseek-chat`) through OpenRouter, 1 vCPU / 2 GiB. The full report is `docs/baseline/E0-REPORT.md`.

| Depth | What it does | Cost p50 | Cost p90 | Worst seen | Wall time p50 |
|---|---|---:|---:|---:|---:|
| **Quick** | search + fetch + extract, light AI (~7 LLM calls), no typed relationships | **1.10¢** | **1.26¢** | 1.97¢ | 4.7 min |
| **Standard** | + full AI extraction and typed relationships (~22 LLM calls) | **2.27¢** | **2.97¢** | 3.03¢ | 5.1 min |
| **Deep** | higher page and AI limits (~28 LLM calls); no crawling yet | **2.46¢** | **3.59¢** | 3.95¢ | 5.4 min |

What the cost is made of:
- **Compute** is about 0.6–0.9¢ per run at every depth. It's the fixed part, and it scales with *time*, not depth.
- **AI (LLM)** is about 0.5¢ quick, 1.6¢ standard and 1.8¢ deep at p50.
- **Conservative estimate.** The LLM figures use list price. OpenRouter's actual bill was **~20–25% lower**, so real margins will be better than any calculation using this table.

**Hard per-run caps engineering will enforce** (worst-case protection): 10-minute wall clock, 45 LLM calls and 45 pages per run. That keeps any single run under ~4¢.

**Expected changes** (they affect the cost but not the credit price):
- An engine speed tuning pass is planned that targets quick ≤ 2.5 min and standard ≤ 4 min. Compute cost falls proportionally, roughly 0.3–0.4¢ per run.
- "Deep" will become meaningfully deeper once crawling is added, raising its cost. Until then deep is only ~20% more expensive than standard, and its value difference is small.
- If we add paid commercial threat feeds (see §5), they add a fixed monthly cost, not a per-run cost.

## 3. Other costs to include

| Item | Cost | Notes |
|---|---|---|
| Idle platform (no users) | ~$0–10/mo | scales to zero; Neon DB free tier, Cloud Run free tier, ~$9 analytics |
| Cloud Run free tier | covers ~800 runs/month of compute | then the per-run compute above applies |
| Archive storage | ~$0.02 per GB-month | negligible per run; grows forever by design |
| Email (Resend) | free tier, then small | transactional + lifecycle |
| Payment fee | 4% + $0.50 per transaction | the flat 50¢ dominates on small charges (≈ 7% on a $9 plan, ≈ 54% on a $1 top-up) |
| **Free-tier usage** | **real cost per free run (§2)** | every free investigation costs us 1–3¢; abuse controls (email verification, rate limits) are in scope |

## 4. Current placeholder plans from the PRD (yours to replace)

The PRD (v1.0, 2026-10-11) used strawman numbers, not decisions:
- **Free:** ~100 credits, no card. **Pro:** $9/mo (founding $7 locked for life) for ~1,600 credits. **Pro+:** ~$19/mo for ~4,500 credits. **Team:** later.
- **Top-ups:** $10 = 1,000 credits (1 credit = 1¢ list); subscribers get a bonus.
- **Strawman credits per action:** quick 10, standard 25, deep 60.

Measured reality vs the strawman: at the strawman's 1,600 credits for $7, an 80% margin needs credits per run of about **18 (quick), 40 (standard), 48 (deep)**. The worked formula is in §7.

## 5. Questions engineering needs answered

Please return a decision for each. Engineering implements them as configuration (one pricing file), so they can be changed later without code changes.

1. **Credit unit.** What is 1 credit worth to the user (e.g. 1¢), or do you prefer pricing in "investigations" directly with no credits?
2. **Billable actions and their price:**
   - Quick / Standard / Deep investigation
   - re-run/refresh of an existing investigation
   - scheduled monitor check (P1 feature: re-runs a query daily or weekly and alerts on new findings)
   - the free no-signup "dark-web quick check" on the marketing site, which shows counts only (it costs us about one search stage, est. <0.5¢, unmeasured)
3. **How many depths at launch.** Engineering recommends **two (Quick, Standard)** until crawling makes Deep distinct. Your call.
4. **Plans:** names, monthly prices, annual discount, credit grant per plan, and what (if anything) differs besides credits. The PRD suggests: monitors on the higher tier, Deep on paid only, history length, and share links.
5. **Free tier:** credits per month, or a fixed number of free investigations? Does a free account need a card?
6. **Top-ups:** price points, minimum (the 50¢ fee makes small top-ups costly), expiry, subscriber bonus.
7. **Founding offer:** price lock, bonus credits, seat count.
8. **Rollover:** do unused subscription credits expire monthly? (The PRD says yes.)
9. **Margin target:** is 80% per action at the *lowest* paid price the right rule, or a different target?
10. **Commercial threat feeds:** the licence review marks key victim/ransomware sources (ransomware.live, RansomLook and others) as not usable commercially for free. Several sell commercial API plans. Is there a budget for 1–2 paid feeds (a fixed monthly cost)? This affects the quality of the "search a company, see the group that hit it" feature.

## 6. Engineering constraints (what we can and can't build)

- **The price shown before a run is the price charged.** Each action has a fixed integer credit price. No surprise charges, and failed runs are refunded automatically.
- **Credits are integers.**
- **If our costs change, we change the credit price of the action, not the plan prices.** Keep plan prices stable.
- **Ledger:** two credit buckets: monthly grant (expires at period end) and top-ups (with their own expiry). Spend order is grant first, then top-up. Bonuses and manual grants are supported.
- **Proration and annual billing** are supported through Dodo.
- **Feature gating per plan is fine** (e.g. monitors only on a higher tier). Keep it to a short list.

## 7. Worked formula (to test your own numbers)

```
net revenue per credit = (plan price × (1 − 0.04) − $0.50) ÷ credits granted
max cost per credit    = net revenue per credit × (1 − margin target)
credits per action     = ceil( p90 cost of action ÷ max cost per credit )
```

Example: $7 for 1,600 credits, 80% margin → net 0.389¢/credit → max cost 0.0778¢/credit → standard = ceil(2.97 ÷ 0.0778) = **39 → 40**.

A higher plan price, or fewer credits per dollar, lowers the credits per action. The **lowest-priced paid plan** sets the binding constraint, because the $0.50 fee is a bigger share of a small charge.

## 8. What we'd like back

A short table:
- plans (name, monthly and annual price, credits, feature differences)
- credits per action
- the free tier
- top-ups (price → credits, bonus, expiry)
- founding offer terms
- the margin target you used
- your answer on paid feeds

With that, engineering finalises the pricing config, the pricing page data and the billing integration.
