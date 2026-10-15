import Link from "next/link";
import { IS_MINIMAL } from "@/lib/site-mode";
import { siteContent } from "@content/site";

export const metadata = { title: "Page not found: VoidAccess", robots: { index: false } };

export default function NotFound() {
  return (
    <div className="va-wrap">
      <section className="grid grid-cols-1 pt-14 pb-28 min-[961px]:grid-cols-12 min-[961px]:pt-[132px] min-[961px]:pb-[168px]">
        <div className="min-[961px]:col-span-8">
          <p className="va-idx">404</p>
          <h1 className="va-title mt-8">{siteContent.notFound.title}</h1>
          <p className="va-lede mt-6 max-w-[46ch]">{siteContent.notFound.body}</p>
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
          <div className="mt-10 flex flex-wrap gap-3">
            {/* a plain link: the home page is a static document (app/route.ts), not a React page */}
            <a href="/" className="va-btn va-btn-primary">
              <span>Back to the home page</span>
              <span className="va-arr" aria-hidden="true" />
            </a>
            <Link href="/sign-in" className="va-btn va-btn-line">
              <span>Sign in</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
