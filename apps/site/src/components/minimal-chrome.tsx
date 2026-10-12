import Image from "next/image";
import Link from "next/link";
import { placeholderHome as c } from "@content/placeholder-home";
import { GITHUB_URL } from "@/lib/site";
import { Container, LinkButton } from "./ui";

/** Header and footer for SITE_MODE=minimal: they link only to pages that exist in that mode. */
export function MinimalHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border-dim bg-void/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 font-display text-lg font-bold" aria-label="VoidAccess home">
          <Image src="/logo-96.png" alt="" width={28} height={28} unoptimized priority />
          VoidAccess
        </Link>
        <nav aria-label="Account" className="flex items-center gap-2">
          <LinkButton href="/sign-in" variant="ghost" className="!min-h-10 !py-2">
            {c.signIn}
          </LinkButton>
          <LinkButton href="/sign-up" className="!min-h-10 !py-2">
            {c.createAccount}
          </LinkButton>
        </nav>
      </div>
    </header>
  );
}

export function MinimalFooter() {
  const a = "py-1.5 text-sm text-fg-secondary hover:text-fg";
  return (
    <footer className="mt-24 border-t border-border-dim bg-surface">
      <Container className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 py-8">
        <nav aria-label="Legal" className="flex flex-wrap gap-x-6">
          {c.legal.map((l) => (
            <Link key={l.href} href={l.href} className={a}>
              {l.label}
            </Link>
          ))}
          <a href={GITHUB_URL} className={a} rel="noopener">
            {c.github}
          </a>
        </nav>
        <p className="text-xs text-fg-secondary">{c.footerLine}</p>
      </Container>
    </footer>
  );
}
