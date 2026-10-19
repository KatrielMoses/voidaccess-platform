import Link from "next/link";
import { adminPage } from "@/lib/admin/guard";
import { adminHref } from "@/lib/admin/path";
import { Logo } from "@/components/logo";
import { LockButton } from "@/components/admin/mfa-form";
import { AdminNav } from "./nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin | VoidAccess", robots: { index: false, follow: false } };

// Defence in depth: every page below also calls adminPage() itself, because a layout does not guard a page's own
// data fetching. Locked (no step-up yet), the header shows only the logo: the code screen is the only page that renders.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await adminPage({ allowLocked: true });
  const base = adminHref("/");
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-bg/[.78] backdrop-blur-[18px] backdrop-saturate-[1.4]">
        <div className="va-wrap flex min-h-[68px] flex-wrap items-center gap-x-10 gap-y-0 max-[960px]:min-h-[60px]">
          <Logo href={base} suffix="admin" className="h-[68px] max-[960px]:h-[60px]" />
          {admin.unlocked ? <AdminNav base={base} /> : null}
          <span className="ml-auto flex items-center gap-6 py-3 text-[15px] whitespace-nowrap max-[960px]:order-2">
            {admin.unlocked ? (
              <>
                <span
                  className="max-w-[200px] truncate font-mono text-[12px] text-mute max-[1360px]:hidden"
                  title={admin.email}
                >
                  {admin.email}
                </span>
                <LockButton />
              </>
            ) : null}
            <Link href="/investigations" className="ul-link">
              Back to app
            </Link>
          </span>
        </div>
      </header>
      <main className="va-wrap pt-14 pb-28 max-[960px]:pt-10 max-[960px]:pb-20">{children}</main>
    </>
  );
}
