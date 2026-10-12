import kev from "../data/feeds/cisa-kev.json" with { type: "json" };

const KEV = new Set((kev.cves as string[]).map((c) => c.toUpperCase()));

/** The licensed public feed (if any) that validates this canonical value. Today: CISA KEV for CVEs. */
export function feedMatchFor(type: string, canonical: string | null): string | null {
  if (canonical && (type === "CVE_NUMBER" || type === "CVE") && KEV.has(canonical.toUpperCase()))
    return "cisa_kev";
  return null;
}
