import { Container, LinkButton } from "@/components/ui";
import { pageMetadata } from "@/lib/metadata";
import { confirmed } from "@content/waitlist";

export const metadata = { ...pageMetadata(confirmed.meta, "/waitlist/confirmed"), robots: { index: false, follow: false } };

export default function ConfirmedPage() {
  return (
    <Container className="max-w-xl py-24 text-center">
      <h1 className="text-4xl font-bold">{confirmed.title}</h1>
      <p className="mt-4 leading-relaxed text-fg-secondary">{confirmed.body}</p>
      <LinkButton href="/pricing" className="mt-8">
        {confirmed.cta}
      </LinkButton>
    </Container>
  );
}
