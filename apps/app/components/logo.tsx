import Link from "next/link";
import { cn } from "@voidaccess/ui";

/** The lockup (design.md §2): the 28px logo PNG, a 10px gap, "voidaccess" in Sora 500 16px, −0.03em. */
export function Logo({
  href = "/",
  className,
  suffix,
}: {
  href?: string;
  className?: string;
  suffix?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex shrink-0 items-center gap-2.5 font-brand text-[16px] leading-none font-medium tracking-[-0.03em] text-paper",
        className,
      )}
    >
      <img src="/logo.png" alt="" width={28} height={28} className="block size-7 rounded-full" />
      <span>voidaccess</span>
      {suffix ? (
        <span className="font-mono text-[12px] font-normal tracking-normal text-mute">{suffix}</span>
      ) : null}
    </Link>
  );
}
