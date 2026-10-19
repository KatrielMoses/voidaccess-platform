import { FOUNDING, PLANS, type Feature, type PlanId } from "@voidaccess/config";
import { SUPPORT_EMAIL } from "@content/legal-common";
import * as pricing from "@content/pricing";
import { APP_URL } from "@/lib/auth/config";
import { money, resolve, topupRows, topupTiers } from "@/lib/facts";
import { pageMetadata } from "@/lib/metadata";
import { Reveal } from "@/components/motion";

export const metadata = pageMetadata(pricing.meta, "/pricing");

const r = resolve;
/** Paid plans go through sign-in to Billing in the app, where checkout starts. */
const billingNext = `/sign-in?next=${encodeURIComponent(`${APP_URL}/billing`)}`;
const ctaHref = (id: PlanId) => (id === "free" ? "/sign-in" : billingNext);

/**
 * A plan's list: its lead lines (credits first, in paper), its extras, then its features from config. With
 * `roadmap`, features that haven't shipped move to their own group under a heading instead of carrying a "soon" note.
 */
function Features({
  features,
  lead,
  extras,
  roadmap = false,
}: {
  features: readonly Feature[];
  lead: readonly string[];
  extras: readonly string[];
  roadmap?: boolean;
}) {
  const all = features
    .filter((f) => f !== "deep" && pricing.featureLabels[f])
    .map((f) => ({ key: f, label: pricing.featureLabels[f]!.label, soon: !!pricing.featureLabels[f]!.soon }));
  const rows = [
    ...lead.map((e) => ({ key: e, label: r(e), soon: false, lead: true })),
    ...extras.map((e) => ({ key: e, label: r(e), soon: false, lead: false })),
    ...all.filter((x) => !roadmap || !x.soon).map((x) => ({ ...x, lead: false })),
  ];
  const later = roadmap ? all.filter((x) => x.soon) : [];
  return (
    <div className="mt-6 flex flex-1 flex-col">
      <ul className="flex flex-col border-t border-line text-[15px] leading-snug text-dim">
        {rows.map((x) => (
          <li key={x.key} className={`border-b border-line py-3 ${x.lead ? "text-paper" : ""}`}>
            {x.label}
            {x.soon && <span className="ml-2 font-mono text-[12px] text-mute">{pricing.planCopy.soonNote.toLowerCase()}</span>}
          </li>
        ))}
      </ul>
      {later.length > 0 && (
        <>
          <p className="mt-7 font-mono text-[12px] text-mute">{pricing.planCopy.roadmapHeading}</p>
          <ul className="mt-3 flex flex-col border-t border-line text-[15px] leading-snug text-mute">
            {later.map((x) => (
              <li key={x.key} className="border-b border-line py-3">
                {x.label}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Pro's monthly price during the founding offer: the regular price struck through, then the founding price. */
function FoundingPrice() {
  return (
    <>
      <p className="font-mono tabular-nums group-has-[#bill-annual:checked]/bill:hidden">
        <span className="sr-only">{pricing.planCopy.regularPrice} </span>
        <s className="text-[22px] leading-none tracking-[-0.03em] text-mute">{money(PLANS[FOUNDING.plan].monthlyUsd)}</s>
        <span className="sr-only">, {pricing.planCopy.foundingPriceLabel} </span>
        <span className="ml-3 text-[40px] leading-none tracking-[-0.04em]">{money(FOUNDING.monthlyUsd)}</span>
        <span className="ml-1 text-[13px] text-mute">{pricing.planCopy.perMonth}</span>
      </p>
      <p className="mt-3 font-mono text-[13px] text-paper group-has-[#bill-annual:checked]/bill:hidden">{r(pricing.planCopy.foundingNote)}</p>
    </>
  );
}

function Head({ id, index, title, note }: { id?: string; index: string; title: string; note?: string }) {
  return (
    <div className="grid grid-cols-1 gap-y-4 min-[961px]:grid-cols-12">
      <p className="flex items-center gap-3 font-mono text-[13px] text-dim min-[961px]:col-span-2">
        <i aria-hidden className="inline-block h-px w-7 bg-line-3" />
        {index}
      </p>
      <h2 id={id} className="text-[clamp(32px,3.6vw,52px)] leading-none tracking-[-0.04em] min-[961px]:col-span-7">{title}</h2>
      {note && <p className="text-[16px] leading-normal text-dim min-[961px]:col-span-3">{note}</p>}
    </div>
  );
}

export default function PricingPage() {
  const rows = topupRows();
  const tiers = topupTiers();
  const plans = [PLANS.free, PLANS.pro, PLANS.pro_plus];

  return (
    <div className="va-wrap pb-28 min-[961px]:pb-[168px]">
      {/* the home page's load sequence: headline lines rise, then the lede, then the plans fade up */}
      <Reveal />
      <header className="pt-14 pb-12 min-[961px]:pt-[132px] min-[961px]:pb-[84px]">
        <h1 className="va-title max-w-[16ch]" data-va-split="title">
          {pricing.hero.title}
        </h1>
        <p className="va-lede mt-6 max-w-[58ch]" data-va-split="lede">
          {r(pricing.hero.sub)}
        </p>
      </header>

      {/* Plans. The billing toggle is two radios; CSS shows the matching prices (works without JavaScript). */}
      <section aria-labelledby="plans-h" className="group/bill" data-va-up>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <h2 id="plans-h" className="text-[30px] leading-none tracking-[-0.03em]">
            Plans
          </h2>
          <fieldset className="inline-flex rounded-[4px] border border-line-2 p-1">
            <legend className="sr-only">Billing period</legend>
            <input type="radio" name="billing" id="bill-monthly" defaultChecked className="peer/m sr-only" />
            <label
              htmlFor="bill-monthly"
              className="inline-flex h-9 cursor-pointer items-center rounded-[3px] px-4 text-[14px] text-dim transition-colors duration-300 peer-checked/m:bg-paper peer-checked/m:text-ink peer-focus-visible/m:outline peer-focus-visible/m:outline-[1.5px] peer-focus-visible/m:outline-v-200"
            >
              {pricing.billing.monthly}
            </label>
            <input type="radio" name="billing" id="bill-annual" className="peer/a sr-only" />
            <label
              htmlFor="bill-annual"
              className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[3px] px-4 text-[14px] text-dim transition-colors duration-300 peer-checked/a:bg-paper peer-checked/a:text-ink peer-focus-visible/a:outline peer-focus-visible/a:outline-[1.5px] peer-focus-visible/a:outline-v-200"
            >
              {pricing.billing.annual}
              <span className="font-mono text-[11.5px] opacity-80">{r(pricing.billing.annualNote)}</span>
            </label>
          </fieldset>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-px border border-line bg-line min-[961px]:grid-cols-3">
          {plans.map((p) => {
            const copy = pricing.planCopy[p.id];
            return (
              <div key={p.id} className="flex flex-col bg-bg p-7 min-[961px]:p-8">
                <h3 className="text-[24px] leading-none tracking-[-0.03em]">{p.name}</h3>
                <p className="mt-2 text-[15px] text-dim">{copy.tagline}</p>
                {/* one price block height on desktop, so the founding note under Pro's price doesn't push its list lower */}
                <div className="mt-8 min-[961px]:min-h-[96px]">
                  {p.id === FOUNDING.plan ? (
                    <FoundingPrice />
                  ) : (
                    <p className="font-mono tabular-nums group-has-[#bill-annual:checked]/bill:hidden">
                      <span className="text-[40px] leading-none tracking-[-0.04em]">{money(p.monthlyUsd)}</span>
                      <span className="ml-1 text-[13px] text-mute">{pricing.planCopy.perMonth}</span>
                    </p>
                  )}
                  <p className="hidden font-mono tabular-nums group-has-[#bill-annual:checked]/bill:block">
                    <span className="text-[40px] leading-none tracking-[-0.04em]">{money(p.annualUsd ?? p.monthlyUsd)}</span>
                    <span className="ml-1 text-[13px] text-mute">
                      {p.annualUsd ? pricing.planCopy.perYear : pricing.planCopy.perMonth}
                    </span>
                  </p>
                </div>
                <Features features={p.features} lead={copy.lead} extras={copy.extras} roadmap={p.id === "pro_plus"} />
                <a href={ctaHref(p.id)} className={`va-btn va-btn-block mt-8 ${p.id === "pro" ? "va-btn-light" : "va-btn-line"}`}>
                  <span>{copy.cta}</span>
                </a>
              </div>
            );
          })}
        </div>
      </section>

      {/* Founding seats: the page's one violet field. The rules sit in a native disclosure (closed; works without JavaScript). */}
      <section id="founding" aria-labelledby="founding-h" className="mt-24 rounded-[6px] bg-v-600 p-8 text-paper min-[961px]:mt-[150px] min-[961px]:p-12">
        <div className="grid grid-cols-1 gap-8 min-[961px]:grid-cols-12 min-[961px]:items-end">
          <div className="min-[961px]:col-span-8">
            <p className="font-mono text-[13px] text-v-100">{pricing.founding.badge}</p>
            <h2 id="founding-h" className="mt-4 text-[clamp(32px,3.6vw,48px)] leading-none tracking-[-0.04em]">
              {r(pricing.founding.title)}
            </h2>
            <p className="mt-5 max-w-[56ch] text-[17px] leading-normal text-v-100">{r(pricing.founding.lead)}</p>
          </div>
          <div className="min-[961px]:col-span-4 min-[961px]:justify-self-end">
            <a href={billingNext} className="va-btn va-btn-light">
              <span>{pricing.founding.cta}</span>
            </a>
          </div>
        </div>
        <details className="group/rules mt-10 border-t border-paper/30">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4 font-mono text-[13px] text-v-100 transition-colors duration-300 hover:text-paper [&::-webkit-details-marker]:hidden">
            {pricing.founding.rulesSummary}
            <span
              aria-hidden
              className="relative inline-block h-3 w-3 before:absolute before:inset-x-0 before:top-1/2 before:h-px before:bg-current after:absolute after:inset-x-0 after:top-1/2 after:h-px after:rotate-90 after:bg-current after:transition-transform after:duration-500 group-open/rules:after:rotate-0"
            />
          </summary>
          <ol className="flex flex-col border-t border-paper/30">
            {pricing.founding.rules.map((x, i) => (
              <li key={x} className="grid grid-cols-[40px_1fr] border-b border-paper/30 py-4 text-[15px] leading-normal">
                <span className="font-mono text-[12px] text-v-100">{String(i + 1).padStart(2, "0")}</span>
                <span>{r(x)}</span>
              </li>
            ))}
          </ol>
        </details>
      </section>

      <section id="credits" aria-labelledby="credits-h" className="mt-24 min-[961px]:mt-[150px]">
        <Head id="credits-h" index="01 Usage" title={pricing.explainer.heading} note={pricing.explainer.body} />
        <div className="mt-12 grid grid-cols-1 gap-px border border-line bg-line min-[961px]:grid-cols-2">
          {pricing.explainer.rows.map((x) => (
            <div key={x.name} className="bg-bg p-7 min-[961px]:p-8">
              <p className="font-mono text-[40px] leading-none tracking-[-0.04em] tabular-nums">{r(x.credits)}</p>
              <h3 className="mt-4 text-[21px] leading-none tracking-[-0.02em]">{x.name}</h3>
              <p className="mt-2 text-[15px] text-dim">{x.note}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-[17px] text-paper">{r(pricing.explainer.example)}</p>
        <ul className="mt-3 flex flex-col gap-1 text-[15px] text-dim">
          {pricing.explainer.rules.map((x) => (
            <li key={x}>{r(x)}</li>
          ))}
        </ul>
      </section>

      <section id="topups" aria-labelledby="topups-h" className="mt-24 min-[961px]:mt-[150px]">
        <Head id="topups-h" index="02 Top-ups" title={pricing.topups.heading} note={`${pricing.topups.body} ${r(pricing.topups.minimum)}`} />

        {/* the rule: four figures, read straight from config */}
        <dl className="mt-12 grid grid-cols-2 gap-px border border-line bg-line min-[961px]:grid-cols-4">
          {pricing.topups.rule.map((x) => (
            <div key={x.label} className="flex flex-col-reverse justify-end bg-bg p-6 min-[961px]:p-8">
              <dt className="mt-3 text-[15px] leading-snug text-dim">{x.label}</dt>
              <dd className="font-mono text-[32px] leading-none tracking-[-0.04em] tabular-nums min-[961px]:text-[40px]">{r(x.value)}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-12 grid grid-cols-1 gap-12 min-[961px]:grid-cols-2 min-[961px]:gap-8">
          <div>
            <h3 className="text-[21px] leading-none tracking-[-0.02em]">{pricing.topups.volume.heading}</h3>
            <p className="mt-2 text-[15px] text-dim">{pricing.topups.volume.note}</p>
            <ul className="mt-5 flex flex-col border-t border-line font-mono text-[14px] tabular-nums">
              {tiers.map((t) => (
                <li key={t.from} className="flex justify-between gap-4 border-b border-line py-3">
                  <span className="text-dim">
                    {pricing.topups.volume.from} <span className="text-paper">{t.from}</span>
                  </span>
                  <span className="text-paper">{t.bonus}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-[21px] leading-none tracking-[-0.02em]">{pricing.topups.subscriber.heading}</h3>
            <p className="mt-2 text-[15px] text-dim">{pricing.topups.subscriber.note}</p>
            <ul className="mt-5 flex flex-col border-t border-line font-mono text-[14px] tabular-nums">
              {pricing.topups.subscriber.rows.map((x) => (
                <li key={x.plan} className="flex justify-between gap-4 border-b border-line py-3">
                  <span className="text-dim">{x.plan}</span>
                  <span className="text-paper">{r(x.bonus)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <h3 className="mt-16 text-[21px] leading-none tracking-[-0.02em]">{pricing.topups.example.heading}</h3>
        <p className="mt-3 max-w-[72ch] text-[15px] leading-normal text-dim">{r(pricing.topups.example.body)}</p>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[340px] border-collapse text-left">
            <caption className="sr-only">{pricing.topups.example.caption}</caption>
            <thead>
              <tr className="border-b border-line">
                {Object.values(pricing.topups.example.columns).map((c, i) => (
                  <th
                    key={c}
                    scope="col"
                    className={`py-3 pr-3 font-mono text-[12px] font-normal text-mute last:pr-0 min-[961px]:pr-4 min-[961px]:last:pr-0 ${i > 0 ? "text-right" : ""}`}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono text-[13px] tabular-nums min-[961px]:text-[14px]">
              {rows.map((t) => (
                <tr key={t.usd} className="border-b border-line">
                  <th scope="row" className="py-4 pr-3 font-normal text-paper min-[961px]:pr-4">
                    {t.usd}
                  </th>
                  <td className="py-4 pr-3 text-right text-dim min-[961px]:pr-4">{t.volumeBonus}</td>
                  <td className="py-4 pr-3 text-right min-[961px]:pr-4">{t.freeCredits}</td>
                  <td className="py-4 pr-3 text-right min-[961px]:pr-4">{t.proCredits}</td>
                  <td className="py-4 text-right">{t.plusCredits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="faq" aria-labelledby="faq-h" className="mt-24 min-[961px]:mt-[150px]">
        <Head id="faq-h" index="03 Questions" title="Pricing questions" />
        <dl className="mt-12 border-t border-line">
          {pricing.faq.map((f) => (
            <div key={f.q} className="grid grid-cols-1 gap-2 border-b border-line py-6 min-[961px]:grid-cols-12">
              <dt className="text-[19px] leading-snug tracking-[-0.01em] min-[961px]:col-span-5">{f.q}</dt>
              <dd className="text-[16px] leading-relaxed text-dim min-[961px]:col-span-7">{r(f.a)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-10 text-[16px] text-dim">
          Anything else? Email{" "}
          <a className="va-ul text-paper" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          . We reply within 3 business days.
        </p>
      </section>
    </div>
  );
}
