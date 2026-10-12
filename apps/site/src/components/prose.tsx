import type { Section as S } from "@content/types";
import { resolve } from "@/lib/facts";

export function ProseSections({ sections, headingLevel = 2 }: { sections: S[]; headingLevel?: 2 | 3 }) {
  const H = `h${headingLevel}` as "h2" | "h3";
  return (
    <div className="space-y-10">
      {sections.map((s) => (
        <section key={s.heading} id={s.id} className="scroll-mt-24">
          <H className="text-2xl font-bold">{s.heading}</H>
          {s.paragraphs?.map((p) => (
            <p key={p} className="mt-3 leading-relaxed text-fg-secondary">
              {resolve(p)}
            </p>
          ))}
          {s.bullets && (
            <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed text-fg-secondary marker:text-accent">
              {s.bullets.map((b) => (
                <li key={b}>{resolve(b)}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
