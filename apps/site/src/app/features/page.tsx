import { Card, Container, Eyebrow, H2, Section } from "@/components/ui";
import { ProseSections } from "@/components/prose";
import { pageMetadata } from "@/lib/metadata";
import * as f from "@content/features";

export const metadata = pageMetadata(f.meta, "/features");

export default function FeaturesPage() {
  return (
    <>
      <Section className="!pb-8">
        <Eyebrow>Features</Eyebrow>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">{f.hero.title}</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-fg-secondary">{f.hero.sub}</p>
      </Section>

      <Container>
        <ol className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Pipeline stages">
          {f.stages.map((s, i) => (
            <li key={s.name} className="relative rounded-xl border border-border-subtle bg-surface p-5">
              <span className="font-mono text-xs text-accent">STAGE {i + 1}</span>
              <h2 className="mt-1.5 font-display text-xl font-bold">{s.name}</h2>
              <p className="mt-2 text-sm leading-relaxed text-fg-secondary">{s.body}</p>
              {i < f.stages.length - 1 && (
                <span aria-hidden className="absolute -right-3 top-1/2 hidden -translate-y-1/2 font-mono text-accent lg:block [&:nth-child(4n)]:hidden">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
      </Container>

      <Section id="entities">
        <Eyebrow>Entity types</Eyebrow>
        <H2>What gets extracted</H2>
        <dl className="mt-8 grid gap-4 md:grid-cols-2">
          {f.entityTypes.map((e) => (
            <Card key={e.category}>
              <dt className="font-display text-lg font-bold">{e.category}</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-fg-secondary">{e.examples}</dd>
            </Card>
          ))}
        </dl>
      </Section>

      <Section tone="raised" id="enrichment">
        <Container className="!px-0 max-w-3xl">
          <ProseSections sections={[f.enrichment]} />
        </Container>
      </Section>

      <Section id="exports">
        <Eyebrow>Exports</Eyebrow>
        <H2>{f.exportsSection.heading}</H2>
        <p className="mt-3 text-fg-secondary">{f.exportsSection.body}</p>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {f.exportsSection.formats.map((x) => (
            <li key={x.name} className="rounded-xl border border-border-subtle bg-surface p-4">
              <p className="font-mono text-sm font-semibold">{x.name}</p>
              <p className="mt-1 text-xs text-fg-secondary">{x.note}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section tone="raised" id="ai-archive">
        <div className="grid gap-12 md:grid-cols-2">
          <ProseSections sections={[f.aiSearch]} />
          <ProseSections sections={[f.archive]} />
        </div>
      </Section>
    </>
  );
}
