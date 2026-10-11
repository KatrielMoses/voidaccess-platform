import { resolve } from "@/lib/facts";
import type { Faq } from "@content/types";

export function FaqList({ items }: { items: Faq[] }) {
  return (
    <div className="divide-y divide-border-dim rounded-xl border border-border-subtle bg-surface">
      {items.map((f) => (
        <details key={f.q} className="group px-5 py-4 sm:px-6">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-4 text-left font-medium">
            <span>{resolve(f.q)}</span>
            <span aria-hidden className="font-mono text-accent transition-transform group-open:rotate-45">
              +
            </span>
          </summary>
          <p className="pb-2 pt-1 leading-relaxed text-fg-secondary">{resolve(f.a)}</p>
        </details>
      ))}
    </div>
  );
}
