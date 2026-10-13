import Link from "next/link";
import { adminPage } from "@/lib/admin/guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin | VoidAccess", robots: { index: false, follow: false } };

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/abuse", label: "Abuse" },
  { href: "/admin/costs", label: "Costs" },
  { href: "/admin/archive", label: "Archive" },
  { href: "/admin/founding", label: "Founding" },
  { href: "/admin/blocked-domains", label: "Blocked domains" },
];

// Defence in depth: every page below also calls adminPage() itself, because a layout does not guard a page's own data fetching.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await adminPage();
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border-subtle bg-void/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 sm:px-6">
          <Link href="/admin" className="font-display text-lg font-semibold tracking-tight">
            Void<span className="text-accent">Access</span>{" "}
            <span className="text-sm font-normal text-fg-secondary">admin</span>
          </Link>
          <nav aria-label="Admin" className="flex flex-wrap items-center gap-1">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="rounded-md px-2.5 py-1.5 text-sm text-fg-secondary hover:bg-raised hover:text-fg"
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <span className="ml-auto flex items-center gap-3 text-xs text-fg-secondary">
            {admin.email}
            <Link href="/investigations" className="hover:text-fg">
              Back to app
            </Link>
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </>
  );
}
