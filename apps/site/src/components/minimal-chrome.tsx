import { chrome as c } from "@content/chrome";
import { NavActions } from "./nav-actions";
import { NavScroll } from "./nav-scroll";

/**
 * The home page's logo lockup (design.md §2): 28px PNG, then "VoidAccess" in General Sans 500 16px. A plain link: the
 * home page is a static document (app/route.ts), not a React page, so there is nothing for next/link to prefetch.
 */
function Logo({ pre = false }: { pre?: boolean }) {
  return (
    <a className="va-logo" href="/" aria-label={c.homeLabel} data-va-pre={pre || undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the logo PNG at its fixed 28px size, as on the home page */}
      <img src="/assets/logo.png" alt="" width={28} height={28} />
      VoidAccess
    </a>
  );
}

/** Header for the sign-in, legal and 404 pages: the home page's nav, minus the home-only section links. */
export function MinimalHeader() {
  return (
    <nav id="nav" className="va-nav" aria-label="Main">
      <div className="va-wrap">
        <Logo pre />
        <div className="va-navr" data-va-pre>
          <NavActions />
        </div>
      </div>
      <NavScroll />
    </nav>
  );
}

/** The home page's footer. */
export function MinimalFooter() {
  return (
    <footer className="va-footer">
      <div className="va-wrap">
        <Logo />
        <span className="va-fm">
          {c.footerLine} Support:{" "}
          <a className="va-ul" href={c.support.href}>
            {c.support.label}
          </a>
        </span>
        <div className="va-fl">
          {c.footerLinks.map((l) => (
            <a key={l.label} className="va-ul" href={l.href} {...(l.external ? { target: "_blank", rel: "noopener" } : {})}>
              {l.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
