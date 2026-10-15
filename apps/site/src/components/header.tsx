import Image from "next/image";
import Link from "next/link";
import { siteContent } from "@content/site";
import { GITHUB_URL } from "@/lib/site";
import { LinkButton } from "./ui";

function Stars({ stars }: { stars: number | null }) {
  return stars === null ? null : (
    <span className="rounded-full bg-accent-dim px-2 py-0.5 font-mono text-xs text-accent" aria-label={`${stars} stars`}>
      ★ {stars.toLocaleString("en-US")}
    </span>
  );
}

export function Header({ stars }: { stars: number | null }) {
  const link = "rounded-md px-3 py-2 text-sm text-fg-secondary transition-colors hover:text-fg";
  return (
    <header className="sticky top-0 z-40 border-b border-border-dim bg-void/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 font-display text-lg font-bold" aria-label="VoidAccess home">
          <Image src="/assets/logo.png" alt="" width={28} height={28} unoptimized priority />
          VoidAccess
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {siteContent.nav.map((n) => (
            <Link key={n.href} href={n.href} className={link}>
              {n.label}
            </Link>
          ))}
          <a href={GITHUB_URL} className={`${link} flex items-center gap-2`} rel="noopener">
            GitHub <Stars stars={stars} />
          </a>
          <LinkButton href="/waitlist" className="ml-2 !min-h-10 !py-2">
            {siteContent.cta.join}
          </LinkButton>
        </nav>
        <div className="flex items-center gap-2 md:hidden">
          <LinkButton href="/waitlist" className="!min-h-10 !px-3 !py-2">
            {siteContent.cta.join}
          </LinkButton>
          <details className="relative">
            <summary className="flex size-11 cursor-pointer items-center justify-center rounded-lg border border-border-strong" aria-label="Menu">
              <span aria-hidden className="font-mono text-lg leading-none">
                ≡
              </span>
            </summary>
            <nav aria-label="Mobile" className="absolute right-0 mt-2 w-56 rounded-xl border border-border-strong bg-raised p-2 shadow-2xl">
              {siteContent.nav.map((n) => (
                <Link key={n.href} href={n.href} className={`block ${link} min-h-11 leading-7`}>
                  {n.label}
                </Link>
              ))}
              <a href={GITHUB_URL} className={`flex items-center gap-2 ${link} min-h-11`} rel="noopener">
                GitHub <Stars stars={stars} />
              </a>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
