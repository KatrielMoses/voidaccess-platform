import { Suspense } from "react";
import { Container } from "@/components/ui";

// Auth pages are never indexed. Cookies are set by the app domain; this site never reads the session.
export const metadata = { robots: { index: false, follow: false } };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <Container className="py-14 sm:py-20">
      <Suspense>{children}</Suspense>
    </Container>
  );
}
