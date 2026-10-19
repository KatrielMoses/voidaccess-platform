"use client";

import { usePathname } from "next/navigation";
import { chrome as c } from "@content/chrome";
import { APP_URL } from "@/lib/auth/config";
import { useSignedIn } from "@/lib/auth/signed-in";

/** Nav actions: Pricing, then Sign in and Start free, or Open console when already signed in. Hidden on /sign-in. */
export function NavActions() {
  const path = usePathname();
  const signedIn = useSignedIn();
  if (path === "/sign-in") return null;
  if (signedIn)
    return (
      <>
        <a className="va-ul" href={c.pricing.href}>
          {c.pricing.label}
        </a>
        <a className="va-btn va-btn-light" href={`${APP_URL}${c.console.path}`} data-va-mag data-testid="open-console">
          <span>{c.console.label}</span>
        </a>
      </>
    );
  return (
    <>
      <a className="va-ul" href={c.pricing.href}>
        {c.pricing.label}
      </a>
      <a className="va-ul" href={c.signIn.href}>
        {c.signIn.label}
      </a>
      <a className="va-btn va-btn-light" href={c.start.href} data-va-mag>
        <span>{c.start.label}</span>
      </a>
    </>
  );
}
