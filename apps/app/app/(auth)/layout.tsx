import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line">
        <div className="va-wrap flex h-[68px] items-center max-[960px]:h-[60px]">
          <Logo />
        </div>
      </header>
      <main className="va-wrap flex flex-1 flex-col pt-[clamp(56px,12vh,128px)] pb-24">
        <div className="va-rise w-full max-w-[520px]">{children}</div>
      </main>
    </div>
  );
}
