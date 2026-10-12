import { Container, Eyebrow } from "@/components/ui";
import { WaitlistForm } from "@/components/waitlist-form";
import { resolve } from "@/lib/facts";
import { pageMetadata } from "@/lib/metadata";
import { form, meta } from "@content/waitlist";

export const metadata = pageMetadata(meta, "/waitlist");

export default async function WaitlistPage({ searchParams }: { searchParams: Promise<{ founding?: string }> }) {
  const sp = await searchParams;
  const labels = { ...form, founding: resolve(form.founding) };
  return (
    <Container className="max-w-xl py-14 sm:py-20">
      <Eyebrow>Waitlist</Eyebrow>
      <h1 className="mt-3 text-4xl font-bold">{form.title}</h1>
      <p className="mt-4 leading-relaxed text-fg-secondary">{form.lead}</p>
      <div className="mt-10">
        <WaitlistForm labels={labels} defaultFounding={sp.founding === "1"} />
      </div>
    </Container>
  );
}
