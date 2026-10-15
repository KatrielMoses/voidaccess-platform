import { Suspense } from "react";

// Auth pages are never indexed. Cookies are set by the app domain; this site never reads the session.
export const metadata = { robots: { index: false, follow: false } };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="va-wrap">
      <Suspense>{children}</Suspense>
    </div>
  );
}
