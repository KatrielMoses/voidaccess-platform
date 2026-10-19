# Editing the site copy

All words on voidaccess.pro live in this folder, one file per page. You don't need to touch
anything under `src/`.

| File | Page |
|---|---|
| `home.ts` | Copy used by llms.txt and the structured data. The home page itself is the static site in `src/home/index.html` (copied from website-mockups/site; edit it there) |
| `pricing.ts` | Pricing (plan blurbs, credit explainer, top-ups, founding rules, FAQ) |
| `features.ts` | Features |
| `trust.ts` | Trust |
| `open-source.ts` | Open source |
| `waitlist.ts` | Waitlist form, "check your email", "confirmed" page, and the confirmation email |
| `terms.ts`, `privacy.ts`, `acceptable-use.ts` | Legal drafts (keep the "pending legal review" notice until counsel signs off) |
| `chrome.ts` | The header and footer around the sign-in, legal and 404 pages (they match the home page, which is the static site in `src/home/`) |
| `auth.ts` | Sign-in, sign-up, forgot/reset password, "check your email" and "email verified" pages |
| `site.ts` | Menu, footer, button labels, 404 text |
| `consent.ts` | The one privacy prompt |
| `graph-hero.json` | The hero graph data. **Do not edit by hand**: it is redacted real data (see `docs/GRAPH-PROVENANCE.md`) |

## How to edit

1. Open the file, find the sentence, change the words between the quotes (`"..."` or `` `...` ``).
2. Keep the quotes, commas and brackets exactly as they are.
3. Run `pnpm --filter site dev` and look at http://localhost:3100, or ask an engineer to.

## Never type a price or a credit number

Prices, credit amounts, seat counts and plan limits come from one place
(`packages/config/src/pricing.ts`). Where you need one, write a placeholder in double curly braces
and the site fills in the current value:

| Write | Shows |
|---|---|
| `{{pro.monthly}}` / `{{pro.annual}}` / `{{pro.credits}}` | Pro monthly price / annual price / credits per month |
| `{{plus.monthly}}` / `{{plus.annual}}` / `{{plus.credits}}` | the same for Pro+ |
| `{{free.credits}}`, `{{free.historyDays}}` | Free credits, Free history days |
| `{{depth.quick}}`, `{{depth.standard}}` | credits for a Quick / Standard investigation |
| `{{pro.standardRuns}}`, `{{pro.quickRuns}}` | how many Standard / Quick runs a month of Pro covers |
| `{{pro.monthsFree}}` | months free on annual billing |
| `{{founding.price}}`, `{{founding.seats}}`, `{{founding.credits}}` | founding price, seat count, credits |
| `{{founding.termMonths}}`, `{{founding.renewalMonths}}`, `{{founding.inactivityMonths}}`, `{{founding.noticeDays}}` | the founding rule numbers |
| `{{founding.proPrice}}` | the normal Pro price a released founder moves to |
| `{{founding.copy}}` | the official founding line ("Founding price …/mo, kept every year you stay active.") |
| `{{topup.min}}`, `{{topup.max}}`, `{{topup.rate}}` | smallest and largest top-up, credits per dollar |
| `{{topup.expiryMonths}}` | months until top-up credits expire |
| `{{topup.volume}}`, `{{topup.tier1.from}}`, `{{topup.tier1.bonus}}` (tier2, …) | volume bonus tiers (all of them in one phrase, or one at a time) |
| `{{topup.proBonus}}`, `{{topup.plusBonus}}` | subscriber bonus on top-ups for Pro / Pro+ |
| `{{topup.example.usd}}`, `.base`, `.volumePct`, `.withVolume`, `.subscriberPct`, `.credits` | the worked example (top volume tier on Pro) |

If you type a real `$` amount or "N credits", the automated test `no-hardcoded-prices` fails, on
purpose. A misspelt placeholder fails the build instead of showing the wrong number.

To change an actual price, an engineer edits `docs/PRICING-v1.md` and then `packages/config`; the
site, `/llms.txt` and the structured data update on the next build.

## Rules of thumb

- Claim only what the product does today. No victim attribution, no source counts beyond the engine
  README, no certifications.
- Keep this sentence wherever coverage is discussed: "We guarantee these sources and formats. We can't
  guarantee every mention on the dark web will be found. Nobody honestly can."
- "As featured by" on the home page is hidden until `proof.featuredBy.visible` is set to `true` in `home.ts`
  and real items are added.
