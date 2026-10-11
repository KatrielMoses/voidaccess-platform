import Link from "next/link";
import { Container, LinkButton } from "@/components/ui";
import { siteContent } from "@content/site";

export const metadata = { title: "Page not found: VoidAccess", robots: { index: false } };

export default function NotFound() {
  return (
    <Container className="max-w-xl py-24 text-center">
      <p className="font-mono text-sm text-accent">404</p>
      <h1 className="mt-2 text-4xl font-bold">{siteContent.notFound.title}</h1>
      <p className="mt-4 text-fg-secondary">{siteContent.notFound.body}</p>
      <ul className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm">
        {siteContent.nav.map((n) => (
          <li key={n.href}>
            <Link href={n.href} className="text-accent underline underline-offset-4">
              {n.label}
            </Link>
          </li>
        ))}
      </ul>
      <LinkButton href="/" className="mt-8">
        Back to the home page
      </LinkButton>
    </Container>
  );
}
