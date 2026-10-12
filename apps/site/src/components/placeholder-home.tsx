import Image from "next/image";
import { placeholderHome as c } from "@content/placeholder-home";
import { GITHUB_URL } from "@/lib/site";
import { Container, LinkButton } from "./ui";

/** Home page for SITE_MODE=minimal. Copy: content/placeholder-home.ts. */
export function PlaceholderHome() {
  return (
    <Container className="flex max-w-2xl flex-col items-center py-24 text-center sm:py-32">
      <Image src="/logo-96.png" alt="VoidAccess" width={72} height={72} unoptimized priority />
      <h1 className="mt-8 text-3xl font-bold leading-tight sm:text-5xl">{c.line}</h1>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <LinkButton href="/sign-in">{c.signIn}</LinkButton>
        <LinkButton href="/sign-up" variant="secondary">
          {c.createAccount}
        </LinkButton>
      </div>
      <p className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
        <a href={GITHUB_URL} className="text-accent underline underline-offset-4" rel="noopener">
          {c.github}
        </a>
        {c.legal.map((l) => (
          <a key={l.href} href={l.href} className="text-fg-secondary underline underline-offset-4 hover:text-fg">
            {l.label}
          </a>
        ))}
      </p>
    </Container>
  );
}
