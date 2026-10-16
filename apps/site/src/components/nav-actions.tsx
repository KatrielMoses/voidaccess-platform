"use client";

import { usePathname } from "next/navigation";
import { chrome as c } from "@content/chrome";

/** The home page's nav actions: Sign in and Start free. Hidden on the sign-in page itself. */
export function NavActions() {
  if (usePathname() === "/sign-in") return null;
  return (
    <>
      <a className="va-ul" href={c.signIn.href}>
        {c.signIn.label}
      </a>
      <a className="va-btn va-btn-light" href={c.start.href}>
        <span>{c.start.label}</span>
      </a>
    </>
  );
}
