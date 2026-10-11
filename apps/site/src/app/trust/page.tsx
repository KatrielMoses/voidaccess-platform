import { Container, Eyebrow } from "@/components/ui";
import { ProseSections } from "@/components/prose";
import { pageMetadata } from "@/lib/metadata";
import * as t from "@content/trust";

export const metadata = pageMetadata(t.meta, "/trust");

export default function TrustPage() {
  return (
    <Container className="py-14 sm:py-20">
      <Eyebrow>Trust</Eyebrow>
      <h1 className="mt-3 text-4xl font-bold sm:text-5xl">{t.hero.title}</h1>
      <p className="mt-4 text-lg text-fg-secondary">{t.hero.sub}</p>
      <div className="mt-12 grid gap-12 lg:grid-cols-[220px_1fr]">
        <nav aria-label="On this page" className="hidden lg:block">
          <ul className="sticky top-24 space-y-2 text-sm">
            {t.sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-fg-secondary hover:text-fg">
                  {s.heading}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="max-w-3xl">
          <ProseSections sections={t.sections} />
          <p className="mt-10 rounded-xl border border-border-subtle bg-surface p-5 text-sm">
            {t.contact.label}:{" "}
            <a href={`mailto:${t.contact.security}`} className="text-accent underline underline-offset-4">
              {t.contact.security}
            </a>
          </p>
        </div>
      </div>
    </Container>
  );
}
