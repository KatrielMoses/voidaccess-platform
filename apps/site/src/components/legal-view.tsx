import { resolve } from "@/lib/facts";
import type { LegalPage } from "@content/types";

const pad = (i: number) => String(i + 1).padStart(2, "0");
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Long-form legal page in the design system: section-head pattern on the 12-column grid (title in columns 1-9, the
 * draft note in 10-12), a mono-indexed contents list beside a ~68ch reading column, hairline rules between sections.
 */
export function LegalView({ page }: { page: LegalPage }) {
  const sections = page.sections.map((s, i) => ({ ...s, id: s.id ?? slug(s.heading), n: pad(i) }));
  return (
    <div className="va-wrap">
      <header className="grid grid-cols-1 gap-y-6 pt-14 pb-11 min-[961px]:grid-cols-12 min-[961px]:pt-[132px] min-[961px]:pb-[84px]">
        <div className="min-[961px]:col-span-9">
          <h1 className="va-title">{page.title}</h1>
          <p className="mt-6 font-mono text-[13px] leading-none text-dim">{page.updated}</p>
        </div>
        <p role="note" className="self-end text-[15px] leading-normal text-dim min-[961px]:col-start-10 min-[961px]:col-end-13 min-[961px]:border-t min-[961px]:border-line-2 min-[961px]:pt-4">
          {page.draftNotice}
        </p>
      </header>

      <div className="grid grid-cols-1 border-t border-line pb-28 min-[961px]:grid-cols-12 min-[961px]:pb-[168px]">
        <nav aria-label="On this page" className="hidden min-[961px]:col-span-3 min-[961px]:block">
          <ol className="sticky top-[108px] flex flex-col gap-3.5 pt-12 pr-8">
            {sections.map((s) => (
              <li key={s.id} className="flex gap-3 text-[15px] leading-snug">
                <span className="w-6 flex-none pt-[3px] font-mono text-[12px] leading-none text-mute">{s.n}</span>
                <a href={`#${s.id}`} className="text-dim transition-colors duration-300 hover:text-paper">
                  {s.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-[961px]:col-start-4 min-[961px]:col-end-11">
          <p className="va-lede max-w-[62ch] py-10 min-[961px]:py-12">{resolve(page.intro)}</p>
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-24 border-t border-line pt-10 pb-12">
              <p className="font-mono text-[13px] leading-none text-dim">{s.n}</p>
              <h2 className="mt-4 text-[26px] leading-[1.1] tracking-[-0.03em] min-[961px]:text-[30px]">{s.heading}</h2>
              <div className="mt-5 flex max-w-[68ch] flex-col gap-4 text-[17px] leading-[1.6] text-dim">
                {s.paragraphs?.map((p) => (
                  <p key={p}>{resolve(p)}</p>
                ))}
                {s.bullets && (
                  <ul className="flex flex-col gap-3">
                    {s.bullets.map((b) => (
                      <li key={b} className="relative pl-6 before:absolute before:left-0 before:top-[0.8em] before:h-px before:w-3 before:bg-line-3">
                        {resolve(b)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
