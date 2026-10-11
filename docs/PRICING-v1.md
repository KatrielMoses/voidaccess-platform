# VoidAccess Cloud: Pricing v1 (source of truth)

**Status:** DECIDED by Growth, 2026-10-12; amendment 1 (founding seat rules) the same day. Engineering verified the maths the same day (all margins reproduce to ±0.1 point). It is implemented as configuration in `packages/config/pricing.ts` (P0). This file and that config must stay in sync. Change prices here first.

## Credit unit
1 credit = 1¢ of list value (the top-up price). Credits are integers. Subscriptions give about 2.2× more credits per dollar than top-ups.

## Credits per action
| Action | Credits | Availability |
|---|---:|---|
| Quick investigation | 20 | all plans |
| Standard investigation (the default depth) | 40 | all plans |
| Deep investigation | 50 | **hidden at launch**; paid plans only once crawling ships |
| Re-run / refresh | same as its depth | — |
| Monitor check (P1) | 20 per check | Pro+ only; cost shown upfront (daily ≈ 600/mo, weekly ≈ 80/mo) |
| Viewing, graph, exports, share links | 0 | — |
| Marketing `/check` | 0 | no signup, counts only; 3/day per IP + captcha; **global spend cap $30/mo** |
| Failed or cancelled run | automatic refund | — |

## Plans
| Plan | Monthly | Annual | Credits/mo | Gated features |
|---|---:|---:|---:|---|
| Free | $0, no card | — | 100 | Quick + Standard, CSV/JSON export, 7-day history |
| Pro | $9 | $90 | 2,000 | + all exports (STIX/MISP/…), unlimited history, share links, Deep (when live) |
| Pro+ | $19 | $190 | 4,500 | + monitors & alerts, actor library, BYO API keys, priority queue |
| Team / MSSP | later | later | — | P2 |

Subscription credits reset monthly with no rollover. Spend order: monthly grant first, then top-ups.

## Founding offer (amendment 1, 2026-10-12)
- **Seats:** the first 100 paid Pro subscribers get **$7/mo** (2,000 credits, the same as Pro) and a "Founding member" badge.
- **Term:** $7 for 12 months from the founder's first payment. It is **not** locked for life.
- **Anniversary check (yearly):**
  - if the founder paid for ≥ 3 of the trailing 12 months, the seat renews at $7 for another 12 months
  - otherwise the seat is released, and the user moves to Pro at $9 if still subscribed, or Free if not
- **Inactivity release:** no investigations for 10 consecutive months releases the seat early, with the same outcome.
- **Pool:** released seats return to the pool for the next new subscriber. The pricing-page counter shows **available** seats, including reopened ones.
- **Data per founder:** seat start date, anniversary date, paid months in the trailing 12, date of last investigation.
- **Notices:** email 30 days before a release (inactivity or failed renewal check) and on the day of release.
- **Copy (pricing page and ToS state the rules plainly):** "Founding price $7/mo, kept every year you stay active."

**Engineering interpretation (Growth to confirm):**
- **(a) A lapsed founder keeps the seat** until the anniversary check or the inactivity release. The "3 of 12 paid months" rule implies this. Resubscribing within that window restores $7.
- **(b) A founder who pays but is inactive for 10 months:** after the 30-day notice, the subscription moves to $9 at its next renewal. It never changes mid-period.
- **(c) The renewal-check notice** is sent 30 days before the anniversary if paid months in the trailing window, plus one more renewal if the subscription is active, are still fewer than 3.
- **(d) Founding is monthly only.** Upgrading to Pro+ releases the seat, with a warning before confirming.
- **(e) Seat claims are race-safe:** a DB constraint guarantees at most 100 held seats.

## Top-ups (all plans, including Free)
| Pay | Credits | Bonus vs base |
|---:|---:|---|
| $10 (minimum) | 1,000 | — |
| $25 | 2,750 | +10% |
| $50 | 6,000 | +20% |

Subscribers get an extra bonus on top: Pro +20%, Pro+ +30%. Top-up credits expire 12 months after purchase.

## Margin rule
- ≥ 80% gross margin per action at p90 cost on standard Pro pricing. Founding and annual seats may sit at 75–80%.
- If costs move, change the action's credit price, never the plan price.

| Plan | Net/mo | Standard @p90 | Quick @p90 |
|---|---:|---:|---:|
| Founding Pro $7 | $6.22 | 76.1% | 79.7% |
| Pro $9 | $8.14 | 81.8% | 84.5% |
| Pro annual | $7.16 | 79.3% | 82.4% |
| Pro+ $19 | $17.74 | 81.2% | 84.0% |
| Pro+ annual | $15.16 | 78.0% | 81.3% |
| Top-ups | — | 87.8–91.8% (lowest: $50 with the Pro+ bonus) | — |

## Paid threat feed
Approved: up to $100/mo for one commercial victim/ransomware feed. Buy at launch if it clearly improves the "search a company → see which group hit it" demo; otherwise buy at 20 paid subscribers. A second feed needs ≥ $1K MRR.

## Revisit triggers
- After 30 paid users or 4 weeks post-launch, review conversion, credit burn per plan and real cost per run.
- If free→paid conversion is below 2%, fix onboarding before touching price.
- If Pro users regularly hit zero credits, test Pro at $12 for new users.

## Engineering defaults for points the decision doesn't cover (Growth may override)
1. *(Superseded by amendment 1; see Founding offer.)*
2. **Upgrade Pro → Pro+ mid-cycle:** Dodo prorates the charge, and the credit difference (2,500) is granted immediately. **Downgrade:** takes effect at period end; credits are not clawed back.
3. **Founding to Pro+:** upgrading gives up the founding price, with a warning shown before confirming.
4. **Priority queue:** runs start immediately on Cloud Run Jobs. A global concurrency cap protects spend, and Pro+ jumps the line only when that cap is reached.
5. **`/check`** needs a search-only engine mode (the source-gathering stage only). It is scheduled as an engine item with P1 `/check`; it is not part of launch.
6. **Cost recheck after E1B:** if the speed pass lowers p90 cost, credit prices stay as decided. The margin gain is kept as headroom.
