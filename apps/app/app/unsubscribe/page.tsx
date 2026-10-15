import { Button } from "@voidaccess/ui";
import { verifyUnsubscribe } from "@/lib/ops/unsubscribe";
import { AuthCard } from "@/components/auth-card";
import { Logo } from "@/components/logo";

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
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line">
        <div className="va-wrap flex h-[68px] items-center max-[960px]:h-[60px]">
          <Logo />
        </div>
      </header>
      <main className="va-wrap flex flex-1 flex-col pt-[clamp(56px,12vh,128px)] pb-24">
        <div className="va-rise w-full max-w-[560px]">
          {!valid ? (
            <div className="flex flex-col gap-4">
              <h1 className="text-[clamp(32px,3.2vw,44px)] leading-[1.02] font-medium tracking-[-0.04em]">
                This link isn&apos;t valid
              </h1>
              <p className="text-[17px] leading-[1.55] text-dim">
                It may have been copied incompletely. Sign in and open Settings, then Notifications, to change
                your email preferences.
              </p>
            </div>
          ) : done ? (
            <div className="flex flex-col gap-4">
              <h1
                className="text-[clamp(32px,3.2vw,44px)] leading-[1.02] font-medium tracking-[-0.04em]"
                data-testid="unsubscribed"
              >
                You&apos;re unsubscribed
              </h1>
              <p className="text-[17px] leading-[1.55] text-dim">
                You won&apos;t get product tips or tutorials from us. Receipts, security and usage emails
                still arrive, because you need those to use your account. You can turn tips back on in
                Settings.
              </p>
            </div>
          ) : (
            <AuthCard
              title="Stop product emails?"
              description="This stops tips and tutorials. Receipts, security and usage emails still arrive."
            >
              <form
                method="post"
                action={`/api/unsubscribe?u=${encodeURIComponent(u)}&t=${encodeURIComponent(t)}`}
              >
                <input type="hidden" name="from" value="page" />
                <Button type="submit" size="lg" data-testid="confirm-unsubscribe">
                  Unsubscribe
                </Button>
              </form>
            </AuthCard>
          )}
        </div>
      </main>
    </div>
  );
}
