import { Card, Container, Eyebrow, LinkButton } from "@/components/ui";
import { getStars } from "@/lib/github";
import { pageMetadata } from "@/lib/metadata";
import { GITHUB_URL, SPONSORS_URL } from "@/lib/site";
import { content, meta } from "@content/open-source";
import { siteContent } from "@content/site";

export const metadata = pageMetadata(meta, "/open-source");

export default async function OpenSourcePage() {
  const stars = (await getStars()) ?? siteContent.githubStarsFallback;
  return (
    <Container className="py-14 sm:py-20">
      <Eyebrow>Open source</Eyebrow>
      <h1 className="mt-3 max-w-3xl text-4xl font-bold sm:text-5xl">{content.title}</h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-fg-secondary">{content.lead}</p>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <LinkButton href={GITHUB_URL} external>
          {content.github} · ★ {stars.toLocaleString("en-US")}
        </LinkButton>
        <LinkButton href={SPONSORS_URL} external variant="secondary">
          {content.sponsors}
        </LinkButton>
      </div>
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {content.points.map((p) => (
          <Card key={p.title}>
            <h2 className="font-display text-xl font-bold">{p.title}</h2>
            <p className="mt-2 leading-relaxed text-fg-secondary">{p.body}</p>
          </Card>
        ))}
      </div>
      <pre className="mt-10 overflow-x-auto rounded-xl border border-border-subtle bg-surface p-5 font-mono text-sm">
        <code>$ {content.install}</code>
      </pre>
      <p className="mt-10 max-w-2xl text-fg-secondary">{content.sponsorsBody}</p>
    </Container>
  );
}
