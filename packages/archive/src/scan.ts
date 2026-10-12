/**
 * Defence-in-depth content scan. The runner already sanitises pages (credentials and personal data redacted);
 * the archive does not trust that. Anything that still matches a credential or personal-data pattern is not
 * archived. Returns only the NAMES of the patterns that matched, never the matching text.
 */
const PATTERNS: [string, RegExp][] = [
  ["aws_access_key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["github_token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["slack_token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ["stripe_key", /\b[rs]k_live_[0-9a-zA-Z]{16,}\b/],
  ["google_api_key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/],
  ["private_key_block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["bearer_token", /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/],
  [
    "secret_assignment",
    /\b(?:api[_-]?key|secret|passwd|password|pwd|token)\s*[:=]\s*["']?[A-Za-z0-9/+_.!@#$%^&*-]{8,}/i,
  ],
  ["email_address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
  ["phone_number", /(?<![\w.])\+\d[\d\s().-]{8,16}\d(?![\w])/],
];

export function scanForSecrets(text: string): string[] {
  const hits: string[] = [];
  for (const [name, re] of PATTERNS) if (re.test(text)) hits.push(name);
  return hits;
}

export const isClean = (text: string) => scanForSecrets(text).length === 0;
