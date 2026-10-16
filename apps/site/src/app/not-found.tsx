import Link from "next/link";
import { IS_MINIMAL } from "@/lib/site-mode";
import { siteContent } from "@content/site";
import { Index, Reveal } from "@/components/motion";

export const metadata = { title: "Page not found: VoidAccess", robots: { index: false } };

export default function NotFound() {
  return (
    <div className="va-wrap">
      <Reveal />
      <section className="grid grid-cols-1 pt-14 pb-28 min-[961px]:grid-cols-12 min-[961px]:pt-[132px] min-[961px]:pb-[168px]">
        <div className="min-[961px]:col-span-8">
          <Index label="404" />
          <h1 className="va-title mt-8" data-va-split="title">
            {siteContent.notFound.title}
          </h1>
          <p className="va-lede mt-6 max-w-[46ch]" data-va-split="lede">
            {siteContent.notFound.body}
          </p>
          {!IS_MINIMAL && (
            <ul className="mt-8 flex flex-wrap gap-x-7 gap-y-3">
              {siteContent.nav.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} className="va-ul">
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-10 flex flex-wrap gap-3" data-va-up>
            {/* a plain link: the home page is a static document (app/route.ts), not a React page */}
            <a href="/" className="va-btn va-btn-primary" data-va-mag>
              <span>Back to the home page</span>
              <span className="va-arr" aria-hidden="true" />
            </a>
            <Link href="/sign-in" className="va-btn va-btn-line" data-va-mag>
              <span>Sign in</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
