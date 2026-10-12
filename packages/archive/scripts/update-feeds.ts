/** Refreshes data/feeds/cisa-kev.json from CISA's public Known Exploited Vulnerabilities JSON feed. */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const URL_ = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
const res = await fetch(URL_);
if (!res.ok) {
  console.error(`feed download failed: ${res.status}`);
  process.exit(1);
}
const body = (await res.json()) as { vulnerabilities?: { cveID?: string }[] };
const cves = [
  ...new Set((body.vulnerabilities ?? []).map((v) => v.cveID?.toUpperCase()).filter((c): c is string => !!c)),
].sort();
if (cves.length < 100) {
  console.error(`refusing to write: only ${cves.length} entries`);
  process.exit(1);
}
const out = {
  feed: "cisa_kev",
  source: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
  note: "Full list from CISA's public JSON feed. Refresh with `pnpm --filter @voidaccess/archive update-feeds`. A CVE missing here is simply not feed-validated yet.",
  updated: new Date().toISOString().slice(0, 10),
  cves,
};
writeFileSync(
  fileURLToPath(new URL("../data/feeds/cisa-kev.json", import.meta.url)),
  JSON.stringify(out, null, 2) + "\n",
);
console.log(`wrote ${cves.length} CVEs`);
