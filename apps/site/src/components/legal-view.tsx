import { ProseSections } from "@/components/prose";
import { Container } from "@/components/ui";
import { resolve } from "@/lib/facts";
import type { LegalPage } from "@content/types";

export function LegalView({ page }: { page: LegalPage }) {
  return (
    <Container className="max-w-3xl py-14 sm:py-20">
      <p role="note" className="rounded-lg border border-warning/50 bg-warning/10 px-4 py-3 text-sm font-medium text-warning">
        {page.draftNotice}
      </p>
      <h1 className="mt-8 text-4xl font-bold sm:text-5xl">{page.title}</h1>
      <p className="mt-2 font-mono text-xs text-fg-secondary">{page.updated}</p>
      <p className="mt-6 text-lg leading-relaxed text-fg-secondary">{resolve(page.intro)}</p>
      <div className="mt-12">
        <ProseSections sections={page.sections} />
      </div>
    </Container>
  );
}
