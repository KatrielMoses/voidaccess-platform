// Example queries for the first-run screen (a ransomware group, a malware family, a CVE). Copy lives here so it can
// be rewritten without touching code.
export const EXAMPLE_QUERIES = [
  { label: "A ransomware group", query: "LockBit ransomware group" },
  { label: "A malware family", query: "Lumma Stealer malware" },
  { label: "A CVE", query: "CVE-2024-3400" },
] as const;

export const PROFILE_ROLES = [
  { value: "analyst", label: "Security analyst" },
  { value: "researcher", label: "Researcher or journalist" },
  { value: "student", label: "Student or hobbyist" },
  { value: "other", label: "Something else" },
] as const;

export const PROFILE_USE_CASES = [
  { value: "threat_intel", label: "Threat intelligence" },
  { value: "incident_response", label: "Incident response" },
  { value: "brand_protection", label: "Brand or leak monitoring" },
  { value: "research", label: "Research" },
] as const;

/** Plain-words depth descriptions. Prices are NOT here: they come from DEPTHS in @voidaccess/config. */
export const DEPTH_COPY = {
  quick: { label: "Quick", blurb: "A fast first look.", time: "About 3–5 min." },
  standard: { label: "Standard", blurb: "More sources and pages. The default.", time: "About 5–8 min." },
} as const;
