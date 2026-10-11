import Link from "next/link";
import { siteContent } from "@content/site";
import { GITHUB_URL, MAILACCESS_URL, SPONSORS_URL } from "@/lib/site";

const h = "font-mono text-xs uppercase tracking-[0.18em] text-fg-secondary";
const a = "block py-1.5 text-sm text-fg-secondary hover:text-fg";

export function Footer() {
  const f = siteContent.footer;
  return (
    <footer className="mt-24 border-t border-border-dim bg-surface">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-4">
        <div>
          <p className="font-display text-lg font-bold">VoidAccess</p>
          <p className="mt-2 text-sm leading-relaxed text-fg-secondary">{siteContent.tagline}</p>
          <p className="mt-4 text-sm text-fg-secondary">
            <a href={MAILACCESS_URL} className="underline decoration-border-strong underline-offset-4 hover:text-fg" rel="noopener">
              {f.also}
            </a>
          </p>
        </div>
        <nav aria-label="Product">
          <p className={h}>Product</p>
          <ul className="mt-3">
            {f.product.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={a}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Legal">
          <p className={h}>Legal and trust</p>
          <ul className="mt-3">
            {f.legal.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={a}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Community">
          <p className={h}>Community</p>
          <ul className="mt-3">
            <li>
              <a href={GITHUB_URL} className={a} rel="noopener">
                GitHub
              </a>
            </li>
            <li>
              <a href={SPONSORS_URL} className={a} rel="noopener">
                GitHub Sponsors
              </a>
            </li>
            {f.socials.map((s) => (
              <li key={s.label} className="py-1.5 text-sm text-fg-secondary">
                {s.label}
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-border-dim py-6 text-center text-xs text-fg-secondary">{f.legalLine}</div>
    </footer>
  );
}
