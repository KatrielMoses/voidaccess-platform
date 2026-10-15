import Link from "next/link";
import { buttonVariants } from "@voidaccess/ui";

export const metadata = { title: "Not found | VoidAccess" };

export default function NotFound() {
  return (
    // Rendered inside whichever layout owns the segment (the app shell for a missing investigation), so no header here.
    <div className="va-wrap flex min-h-[70vh] flex-col pt-[clamp(56px,14vh,160px)] pb-24">
      <div>
        <div className="va-rise flex max-w-[640px] flex-col gap-6">
          <p className="flex items-center gap-3 font-mono text-[13px] text-dim">
            <i aria-hidden className="inline-block h-px w-7 bg-line-3" />
            404
          </p>
          <h1 className="text-[clamp(40px,4.8vw,70px)] leading-none font-medium tracking-[-0.04em]">
            Nothing at <span className="text-v-200">this address.</span>
          </h1>
          <p className="text-[17px] leading-[1.55] text-dim">
            The page may have moved, or it belongs to someone else.
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <Link href="/investigations" className={buttonVariants({ variant: "secondary", size: "lg" })}>
              Go to your investigations
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
