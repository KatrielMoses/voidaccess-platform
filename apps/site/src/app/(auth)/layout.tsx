import { Suspense } from "react";
import { CalmField } from "@/components/calm-field";

// Auth pages are never indexed. Cookies are set by the app domain; this site never reads the session.
export const metadata = { robots: { index: false, follow: false } };

/**
 * The form sits at the top of one viewport; the home page's calm field (design.md §7) fills the bottom of it, behind
 * nothing: it starts below the form, so it never sits under text.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="va-auth">
      <div className="va-wrap">
        <Suspense>{children}</Suspense>
      </div>
      <CalmField />
    </div>
  );
}
