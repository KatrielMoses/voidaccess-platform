import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const SCAN = [
  "lib/billing",
  "components/billing",
  "app/(app)/billing",
  "app/(app)/usage",
  "app/api/billing",
  "app/api/webhooks",
  "app/api/founding",
  "app/api/usage",
  "app/api/cron/grants",
  "app/api/cron/founding",
  "app/api/cron/credit-alerts",
  "content/billing.ts",
  "scripts",
  "../../packages/emails/src/content.ts",
];
const EXT = new Set([".ts", ".tsx"]);

function walk(p: string): string[] {
  const s = statSync(p);
  if (s.isFile()) return EXT.has(extname(p)) ? [p] : [];
  return readdirSync(p).flatMap((n) => walk(join(p, n)));
}

// a dollar amount, a thousands-separated number, or a number next to the word "credit(s)"
const RULES: [string, RegExp][] = [
  ["dollar amount", /\$\s?\d/],
  ["thousands-separated number", /\b\d{1,3}(,\d{3})+\b/],
  ["credit amount", /\b\d+\s*credits?\b|\bcredits?\s*[:=]?\s*\d/i],
];

describe("prices and credit amounts come only from @voidaccess/config", () => {
  const files = SCAN.flatMap((d) => walk(join(root, d)));
  it("scans the billing code", () => expect(files.length).toBeGreaterThan(25));
  for (const [name, re] of RULES) {
    it(`no hard-coded ${name} in billing code, copy or emails`, () => {
      const hits: string[] = [];
      for (const f of files)
        readFileSync(f, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (re.test(line))
              hits.push(`${f.replace(root + "/", "")}:${i + 1}: ${line.trim().slice(0, 90)}`);
          });
      expect(hits).toEqual([]);
    });
  }
});
