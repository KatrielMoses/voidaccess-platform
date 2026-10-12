import { FOUNDING, PLANS } from "@voidaccess/config";
import { resolve } from "./facts";
import { abs, GITHUB_URL, SITE_NAME } from "./site";
import { faq as homeFaq } from "@content/home";
import { faq as pricingFaq } from "@content/pricing";
import { meta as homeMeta } from "@content/home";
import type { Faq } from "@content/types";

const USD = "USD";

/** One Offer per plan and billing period, plus the founding offer; every number comes from @voidaccess/config. */
export function offers() {
  const out: Record<string, unknown>[] = [];
  for (const p of Object.values(PLANS)) {
    out.push({
      "@type": "Offer",
      name: `${p.name} (monthly)`,
      price: p.monthlyUsd,
      priceCurrency: USD,
      url: abs("/pricing"),
      description: `${p.monthlyCredits} credits per month`,
      priceSpecification: { "@type": "UnitPriceSpecification", price: p.monthlyUsd, priceCurrency: USD, billingDuration: "P1M" },
      availability: "https://schema.org/PreOrder",
    });
    if (p.annualUsd !== null) {
      out.push({
        "@type": "Offer",
        name: `${p.name} (annual)`,
        price: p.annualUsd,
        priceCurrency: USD,
        url: abs("/pricing"),
        description: `${p.monthlyCredits} credits per month, billed annually`,
        priceSpecification: { "@type": "UnitPriceSpecification", price: p.annualUsd, priceCurrency: USD, billingDuration: "P1Y" },
        availability: "https://schema.org/PreOrder",
      });
    }
  }
  out.push({
    "@type": "Offer",
    name: "Founding member (Pro)",
    price: FOUNDING.monthlyUsd,
    priceCurrency: USD,
    url: abs("/pricing"),
    description: `${FOUNDING.copy} First ${FOUNDING.seats} paid Pro subscribers; ${FOUNDING.monthlyCredits} credits per month.`,
    priceSpecification: { "@type": "UnitPriceSpecification", price: FOUNDING.monthlyUsd, priceCurrency: USD, billingDuration: "P1M" },
    availability: "https://schema.org/PreOrder",
  });
  return out;
}

export function softwareApplicationLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "SecurityApplication",
    operatingSystem: "Web",
    description: resolve(homeMeta.description),
    url: abs("/"),
    license: "https://opensource.org/license/mit",
    offers: offers(),
  };
}

export function organizationLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: abs("/"),
    logo: abs("/logo_circle.png"),
    founder: { "@type": "Person", name: "Katriel Moses" },
    sameAs: [GITHUB_URL],
  };
}

export function faqLd(items: Faq[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({ "@type": "Question", name: resolve(f.q), acceptedAnswer: { "@type": "Answer", text: resolve(f.a) } })),
  };
}

export const homeFaqLd = () => faqLd(homeFaq);
export const pricingFaqLd = () => faqLd(pricingFaq);
