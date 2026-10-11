import { Container, LinkButton } from "@/components/ui";
import { pageMetadata } from "@/lib/metadata";
import { checkEmail } from "@content/waitlist";

export const metadata = { ...pageMetadata(checkEmail.meta, "/waitlist/check-email"), robots: { index: false, follow: false } };

export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  return (
    <Container className="max-w-xl py-24 text-center">
      <h1 className="text-4xl font-bold">{checkEmail.title}</h1>
      <p className="mt-4 leading-relaxed text-fg-secondary">{sp.error ? checkEmail.expired : checkEmail.body}</p>
      <LinkButton href={sp.error ? "/waitlist" : "/"} variant="secondary" className="mt-8">
        {sp.error ? "Join the waitlist" : checkEmail.back}
      </LinkButton>
    </Container>
  );
}
