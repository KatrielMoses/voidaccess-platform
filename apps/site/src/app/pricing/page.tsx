import { PLANS, type Feature } from "@voidaccess/config";
import { FaqList } from "@/components/faq";
import { JsonLd } from "@/components/json-ld";
import { SeatCounter } from "@/components/seat-counter";
import { Card, Container, Eyebrow, H2, LinkButton, Section } from "@/components/ui";
import { money, number, resolve, topupRows } from "@/lib/facts";
import { pricingFaqLd } from "@/lib/jsonld";
import { pageMetadata } from "@/lib/metadata";
import { getFoundingSeats } from "@/lib/seats";
import * as pricing from "@content/pricing";

export const metadata = pageMetadata(pricing.meta, "/pricing");

const r = resolve;
const radioLabel =
  "inline-flex min-h-11 cursor-pointer items-center rounded-md px-4 text-sm font-semibold text-fg-secondary transition-colors";

function FeatureList({ features }: { features: readonly Feature[] }) {
  return (
    <>
      {features
        .filter((f) => f !== "deep" && pricing.featureLabels[f])
        .map((f) => {
          const l = pricing.featureLabels[f]!;
          return (
            <li key={f} className="flex gap-2.5">
              <span aria-hidden className="mt-0.5 text-success">
                ✓
              </span>
              <span>
                {l.label}
                {l.soon && <span className="ml-2 rounded bg-raised px-1.5 py-0.5 font-mono text-[11px] text-fg-secondary">{pricing.planCopy.soonNote}</span>}
              </span>
            </li>
          );
        })}
    </>
  );
}

export default async function PricingPage() {
  const seats = await getFoundingSeats();
  const rows = topupRows();
  const plans = [PLANS.free, PLANS.pro, PLANS.pro_plus];

  return (
    <>
      <JsonLd data={pricingFaqLd()} />
      <Section className="!pb-8">
        <Eyebrow>Pricing</Eyebrow>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">{pricing.hero.title}</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-fg-secondary">{r(pricing.hero.sub)}</p>
      </Section>

      <Container>
        <div className="group/bill">
          <fieldset className="relative inline-flex gap-1 rounded-lg border border-border-strong bg-surface p-1">
            <legend className="sr-only">Billing period</legend>
            <input type="radio" name="billing" id="bill-monthly" defaultChecked className="peer/m sr-only" />
            <label htmlFor="bill-monthly" className={`${radioLabel} peer-checked/m:bg-accent peer-checked/m:text-fg-inverse peer-focus-visible/m:outline-2 peer-focus-visible/m:outline-accent`}>
              {pricing.billing.monthly}
            </label>
            <input type="radio" name="billing" id="bill-annual" className="peer/a sr-only" />
            <label htmlFor="bill-annual" className={`${radioLabel} gap-2 peer-checked/a:bg-accent peer-checked/a:text-fg-inverse peer-focus-visible/a:outline-2 peer-focus-visible/a:outline-accent`}>
              {pricing.billing.annual}
              <span className="font-mono text-[11px] opacity-90">{r(pricing.billing.annualNote)}</span>
            </label>
          </fieldset>

          <div className="mt-6 grid gap-5 lg:grid-cols-3">
            {plans.map((p) => {
              const copy = pricing.planCopy[p.id];
              const featured = p.id === "pro";
              return (
                <Card key={p.id} className={`flex flex-col ${featured ? "border-accent-border bg-raised" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-display text-2xl font-bold">{p.name}</h2>
                    {featured && <span className="rounded-full bg-accent-dim px-2.5 py-1 font-mono text-[11px] text-accent">{pricing.planCopy.proBadge}</span>}
                  </div>
                  <p className="mt-1 text-sm text-fg-secondary">{copy.tagline}</p>
                  <div className="mt-6">
                    <p className="group-has-[#bill-annual:checked]/bill:hidden">
                      <span className="font-display text-5xl font-bold">{money(p.monthlyUsd)}</span>
                      <span className="text-fg-secondary">{pricing.planCopy.perMonth}</span>
                    </p>
                    <p className="hidden group-has-[#bill-annual:checked]/bill:block">
                      <span className="font-display text-5xl font-bold">{money(p.annualUsd ?? p.monthlyUsd)}</span>
                      <span className="text-fg-secondary">{p.annualUsd ? pricing.planCopy.perYear : pricing.planCopy.perMonth}</span>
                    </p>
                  </div>
                  <p className="mt-3 font-mono text-sm text-accent">
                    {number(p.monthlyCredits)} {pricing.planCopy.credits}
                  </p>
                  <ul className="mt-6 flex-1 space-y-2.5 text-sm leading-relaxed">
                    {copy.extras.map((e) => (
                      <li key={e} className="flex gap-2.5">
                        <span aria-hidden className="mt-0.5 text-success">
                          ✓
                        </span>
                        {r(e)}
                      </li>
                    ))}
                    <FeatureList features={p.features} />
                  </ul>
                  <LinkButton href={`/waitlist${featured ? "?founding=1" : ""}`} variant={featured ? "primary" : "secondary"} className="mt-8">
                    {copy.cta}
                  </LinkButton>
                </Card>
              );
            })}
          </div>
        </div>
      </Container>

      <Section id="founding">
        <div className="rounded-2xl border border-accent-border bg-accent-dim p-6 sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <Eyebrow>{pricing.founding.badge}</Eyebrow>
              <h2 className="mt-3 text-3xl font-bold sm:text-4xl">{r(pricing.founding.title)}</h2>
              <p className="mt-3 text-lg text-fg-secondary">{r(pricing.founding.lead)}</p>
              <div className="mt-6">
                <SeatCounter initial={seats} label={pricing.founding.counterLabel} of={pricing.founding.counterOf} loading={pricing.founding.counterLoading} />
              </div>
              <LinkButton href="/waitlist?founding=1" className="mt-6">
                {pricing.founding.cta}
              </LinkButton>
            </div>
            <div>
              <h3 className="text-lg font-bold">{pricing.founding.rulesHeading}</h3>
              <ul className="mt-3 list-disc space-y-2.5 pl-5 text-sm leading-relaxed text-fg-secondary marker:text-accent">
                {pricing.founding.rules.map((x) => (
                  <li key={x}>{r(x)}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Section>

      <Section tone="raised" id="credits">
        <Eyebrow>Credits</Eyebrow>
        <H2>{pricing.explainer.heading}</H2>
        <p className="mt-3 max-w-2xl text-fg-secondary">{pricing.explainer.body}</p>
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {pricing.explainer.rows.map((x) => (
            <Card key={x.name}>
              <p className="font-mono text-4xl font-bold text-accent">{r(x.credits)}</p>
              <h3 className="mt-1 text-lg font-bold">{x.name}</h3>
              <p className="mt-1 text-sm text-fg-secondary">{x.note}</p>
            </Card>
          ))}
        </div>
        <p className="mt-6 text-lg">{r(pricing.explainer.example)}</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-fg-secondary">
          {pricing.explainer.rules.map((x) => (
            <li key={x}>{r(x)}</li>
          ))}
        </ul>
      </Section>

      <Section id="topups">
        <Eyebrow>{pricing.topups.heading}</Eyebrow>
        <H2>{pricing.topups.heading}</H2>
        <p className="mt-3 max-w-2xl text-fg-secondary">
          {pricing.topups.body} {r(pricing.topups.minimum)}
        </p>
        <div className="mt-8 overflow-x-auto rounded-xl border border-border-subtle">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <caption className="sr-only">{pricing.topups.heading}</caption>
            <thead>
              <tr className="bg-raised">
                {Object.values(pricing.topups.columns).map((c) => (
                  <th key={c} scope="col" className="px-4 py-3 font-display">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-dim font-mono">
              {rows.map((t) => (
                <tr key={t.usd}>
                  <th scope="row" className="px-4 py-3 font-semibold">
                    {t.usd}
                  </th>
                  <td className="px-4 py-3">{t.credits}</td>
                  <td className="px-4 py-3 text-fg-secondary">{t.baseBonus}</td>
                  <td className="px-4 py-3">{t.proCredits}</td>
                  <td className="px-4 py-3">{t.plusCredits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section tone="raised" id="faq">
        <Eyebrow>FAQ</Eyebrow>
        <H2>Pricing questions</H2>
        <div className="mt-8 max-w-3xl">
          <FaqList items={pricing.faq} />
        </div>
      </Section>
    </>
  );
}
