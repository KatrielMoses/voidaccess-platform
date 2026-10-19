"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Paths relative to the console's public base (the secret slug, passed in by the layout; never hardcoded).
const NAV = [
  { path: "", label: "Overview" },
  { path: "/users", label: "Users" },
  { path: "/abuse", label: "Abuse" },
  { path: "/costs", label: "Costs" },
  { path: "/archive", label: "Archive" },
  { path: "/founding", label: "Founding" },
  { path: "/blocked-domains", label: "Blocked domains" },
];

/** The current path relative to the console: the browser shows the public base, the server may see the internal one. */
function relative(pathname: string, base: string): string {
  for (const prefix of [base, "/" + "admin"])
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  return pathname;
}

export function AdminNav({ base }: { base: string }) {
  const rel = relative(usePathname(), base);
  return (
    <nav
      aria-label="Admin"
      className="flex flex-wrap items-center gap-x-[26px] gap-y-3 max-[960px]:order-last max-[960px]:w-full max-[960px]:border-t max-[960px]:border-line max-[960px]:py-3.5"
    >
      {NAV.map((n) => {
        const active =
          n.path === "" ? rel === "" || rel === "/" : rel === n.path || rel.startsWith(`${n.path}/`);
        return (
          <Link
            key={n.path}
            href={`${base}${n.path}`}
            aria-current={active ? "page" : undefined}
            className="ul-link text-[15px] leading-none"
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
