import { PlaceholderHome } from "@/components/placeholder-home";
import { FaqList } from "@/components/faq";
import { HeroGraph } from "@/components/hero-graph";
import { JsonLd } from "@/components/json-ld";
import { Card, Container, Eyebrow, H2, Lead, LinkButton, Section } from "@/components/ui";
import { resolve } from "@/lib/facts";
import { getStars } from "@/lib/github";
import { homeFaqLd, softwareApplicationLd } from "@/lib/jsonld";
import { pageMetadata } from "@/lib/metadata";
import { IS_MINIMAL } from "@/lib/site-mode";
import { getPypiDownloads } from "@/lib/pypi";
import { GITHUB_URL } from "@/lib/site";
import * as home from "@content/home";
import { placeholderHome } from "@content/placeholder-home";
import { siteContent } from "@content/site";

export const metadata = pageMetadata(IS_MINIMAL ? placeholderHome.meta : home.meta, "/");

export default async function HomePage() {
  if (IS_MINIMAL) return <PlaceholderHome />;
  const [stars, downloads] = await Promise.all([getStars(), getPypiDownloads()]);
  const shownStars = stars ?? siteContent.githubStarsFallback;
  const r = resolve;

  return (
    <>
      <JsonLd data={softwareApplicationLd()} />
      <JsonLd data={homeFaqLd()} />

      <section className="relative overflow-hidden">
        <Container className="grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <Eyebrow>{home.hero.eyebrow}</Eyebrow>
            <h1 className="mt-4 text-4xl font-bold leading-[1.05] sm:text-6xl">{home.hero.title}</h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-fg-secondary">{home.hero.sub}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/waitlist?founding=1">{siteContent.cta.joinLong}</LinkButton>
              <LinkButton href="/pricing" variant="secondary">
                {siteContent.cta.pricing}
              </LinkButton>
            </div>
            <p className="mt-5 text-sm text-fg-secondary">{r(home.hero.note)}</p>
          </div>
          <HeroGraph />
        </Container>
      </section>

      <Section tone="raised" id="pillars">
        <div className="grid gap-5 md:grid-cols-3">
          {home.pillars.map((p) => (
            <Card key={p.name}>
              <h2 className="font-display text-2xl font-bold text-accent">{p.name}</h2>
              <p className="mt-3 leading-relaxed text-fg-secondary">{r(p.body)}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section id="how-it-works">
        <Eyebrow>How it works</Eyebrow>
        <H2>Three steps, nothing to install</H2>
        <ol className="mt-10 grid gap-5 md:grid-cols-3">
          {home.steps.map((s, i) => (
            <li key={s.title} className="rounded-xl border border-border-subtle bg-surface p-6">
              <span className="font-mono text-sm text-accent">0{i + 1}</span>
              <h3 className="mt-2 text-xl font-bold">{s.title}</h3>
              <p className="mt-2 leading-relaxed text-fg-secondary">{r(s.body)}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section tone="raised" id="compare">
        <Eyebrow>Cloud vs install</Eyebrow>
        <H2>{home.compare.heading}</H2>
        <Lead>{home.compare.intro}</Lead>
        <div className="mt-8 overflow-x-auto rounded-xl border border-border-subtle">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <caption className="sr-only">{home.compare.heading}</caption>
            <thead>
              <tr className="bg-raised">
                {home.compare.columns.map((c, i) => (
                  <th key={i} scope="col" className="px-4 py-3 font-display text-base">
                    {c || <span className="sr-only">Aspect</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-dim">
              {home.compare.rows.map(([k, a, b]) => (
                <tr key={k}>
                  <th scope="row" className="px-4 py-3 font-medium">
                    {k}
                  </th>
                  <td className="px-4 py-3 text-fg-secondary">{a}</td>
                  <td className="px-4 py-3 text-fg-secondary">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="proof">
        <Eyebrow>{home.proof.heading}</Eyebrow>
        <div className="mt-6 grid gap-5 md:grid-cols-[1fr_1fr_1.4fr]">
          <Card>
            <p className="font-mono text-4xl font-bold">{shownStars.toLocaleString("en-US")}</p>
            <p className="mt-1 text-sm text-fg-secondary">
              <a href={GITHUB_URL} className="underline underline-offset-4 hover:text-fg" rel="noopener">
                {home.proof.starsLabel}
              </a>
            </p>
          </Card>
          {downloads !== null && (
            <Card>
              <p className="font-mono text-4xl font-bold">{downloads.toLocaleString("en-US")}</p>
              <p className="mt-1 text-sm text-fg-secondary">{home.proof.downloadsLabel}</p>
            </Card>
          )}
          <Card className="md:col-start-auto">
            <h2 className="font-display text-xl font-bold">{home.founder.heading}</h2>
            <p className="mt-2 leading-relaxed text-fg-secondary">{home.founder.body}</p>
            <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {home.founder.links.map((l) => (
                <a key={l.href} href={l.href} className="text-accent underline underline-offset-4" rel="noopener">
                  {l.label}
                </a>
              ))}
            </p>
          </Card>
        </div>
        {home.proof.featuredBy.visible && home.proof.featuredBy.items.length > 0 && (
          <div className="mt-8">
            <p className="text-sm text-fg-secondary">{home.proof.featuredBy.label}</p>
            <ul className="mt-2 flex flex-wrap gap-6">
              {home.proof.featuredBy.items.map((i) => (
                <li key={i.name}>
                  <a href={i.href} rel="noopener">
                    {i.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section tone="raised" id="faq">
        <Eyebrow>FAQ</Eyebrow>
        <H2>Questions, answered straight</H2>
        <div className="mt-8 max-w-3xl">
          <FaqList items={home.faq} />
        </div>
      </Section>

      <Section id="join">
        <div className="rounded-2xl border border-accent-border bg-accent-dim p-8 text-center sm:p-14">
          <H2>{home.finalCta.title}</H2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-fg-secondary">{r(home.finalCta.body)}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <LinkButton href="/waitlist?founding=1">{siteContent.cta.joinLong}</LinkButton>
            <LinkButton href="/pricing" variant="secondary">
              {siteContent.cta.pricing}
            </LinkButton>
          </div>
        </div>
      </Section>
    </>
  );
}
