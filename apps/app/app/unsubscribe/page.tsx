import Link from "next/link";
import { Button } from "@voidaccess/ui";
import { verifyUnsubscribe } from "@/lib/ops/unsubscribe";

export const metadata = { title: "Unsubscribe | VoidAccess" };
export const dynamic = "force-dynamic";

/** Public page (no sign-in): the signed link in the query is the credential. Confirming is a POST, never a GET. */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string; t?: string; done?: string }>;
}) {
  const { u = "", t = "", done } = await searchParams;
  const valid = verifyUnsubscribe(u, t);
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4 py-16">
      <Link href="/" className="font-display text-2xl font-semibold tracking-tight text-fg">
        Void<span className="text-accent">Access</span>
      </Link>
      {!valid ? (
        <>
          <h1 className="font-display text-2xl font-semibold">This link isn&apos;t valid</h1>
          <p className="text-fg-secondary">
            It may have been copied incompletely. Sign in and open Settings, then Notifications, to change
            your email preferences.
          </p>
        </>
      ) : done ? (
        <>
          <h1 className="font-display text-2xl font-semibold" data-testid="unsubscribed">
            You&apos;re unsubscribed
          </h1>
          <p className="text-fg-secondary">
            You won&apos;t get product tips or tutorials from us. Receipts, security and usage emails still
            arrive, because you need those to use your account. You can turn tips back on in Settings.
          </p>
        </>
      ) : (
        <>
          <h1 className="font-display text-2xl font-semibold">Stop product emails?</h1>
          <p className="text-fg-secondary">
            This stops tips and tutorials. Receipts, security and usage emails still arrive.
          </p>
          <form
            method="post"
            action={`/api/unsubscribe?u=${encodeURIComponent(u)}&t=${encodeURIComponent(t)}`}
          >
            <input type="hidden" name="from" value="page" />
            <Button type="submit" data-testid="confirm-unsubscribe">
              Unsubscribe
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
