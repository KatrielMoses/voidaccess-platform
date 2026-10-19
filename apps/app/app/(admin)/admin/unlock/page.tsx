import QRCode from "qrcode";
import { redirect } from "next/navigation";
import { adminPage } from "@/lib/admin/guard";
import { isEnrolled, pendingEnrolment } from "@/lib/admin/mfa";
import { adminHref, safeAdminNext } from "@/lib/admin/path";
import { groupSecret, otpauthUri, TOTP_ISSUER } from "@/lib/admin/totp";
import { Page } from "@/components/admin/ui";
import { MfaForm } from "@/components/admin/mfa-form";

/**
 * The code screen (and, on the first visit, the authenticator enrolment). Nothing from the console renders here.
 * The secret is generated and kept on the server (vault, kind admin_totp_pending, 15 minutes); the form only ever
 * sends a code.
 */
export default async function AdminUnlock({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await adminPage({ allowLocked: true });
  const next = safeAdminNext((await searchParams).next, adminHref("/"));
  if (admin.unlocked) redirect(next);

  if (await isEnrolled(admin.id))
    return (
      <Page
        title="Enter your code"
        subtitle="The admin console needs a code from your authenticator, once an hour."
      >
        <div data-testid="mfa-code-screen" className="flex flex-col gap-6">
          <MfaForm next={next} submit="Unlock" testId="mfa-verify" />
        </div>
      </Page>
    );

  const { secret, expiresAt } = await pendingEnrolment(admin.id);
  const uri = otpauthUri(secret, admin.email);
  const svg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return (
    <Page
      title="Set up your authenticator"
      subtitle="The admin console asks for a code from an authenticator app (Google Authenticator or any TOTP app) once an hour."
    >
      <div data-testid="mfa-enrol-screen" className="grid gap-12 lg:grid-cols-[280px_1fr]">
        <div
          className="size-[240px] rounded-lg bg-paper p-3 [&_svg]:size-full"
          aria-label="QR code to scan with your authenticator app"
          role="img"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div className="flex flex-col gap-6">
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-[15px] text-dim">
            <li>Scan the QR code with your authenticator app.</li>
            <li>
              Or add it by hand: issuer <span className="text-paper">{TOTP_ISSUER}</span>, account{" "}
              <span className="text-paper">{admin.email}</span>, time-based, this key:
            </li>
          </ol>
          <p
            className="font-mono text-[17px] tracking-[0.08em] break-all text-paper"
            data-testid="mfa-secret"
          >
            {groupSecret(secret)}
          </p>
          <p className="text-[15px] text-dim">
            Then enter the current code to confirm. This setup expires at{" "}
            <span className="font-mono text-[13px]">{expiresAt.toISOString().slice(11, 16)} UTC</span>.
          </p>
          <MfaForm next={next} submit="Confirm and unlock" testId="mfa-enrol" />
        </div>
      </div>
    </Page>
  );
}
