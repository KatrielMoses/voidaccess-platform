import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-10 sm:py-16">
      <Link
        href="/"
        className="mb-8 font-display text-2xl font-semibold tracking-tight text-fg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
      >
        Void<span className="text-accent">Access</span>
      </Link>
      <main className="w-full max-w-md">{children}</main>
    </div>
  );
}
