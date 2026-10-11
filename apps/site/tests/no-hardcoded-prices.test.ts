import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const SCAN = ["src", "content"];
const EXT = new Set([".ts", ".tsx", ".md", ".mdx", ".json", ".css"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : EXT.has(extname(p)) ? [p] : [];
  });
}

// A dollar amount, a thousands-separated number, or a number next to the word "credit(s)".
const RULES: [string, RegExp][] = [
  ["dollar amount", /\$\s?\d/],
  ["thousands-separated number", /\b\d{1,3}(,\d{3})+\b/],
  ["credit amount", /\b\d+\s*credits?\b|\bcredits?\s*[:=]?\s*\d/i],
];

describe("prices come only from @voidaccess/config", () => {
  const files = SCAN.flatMap((d) => walk(join(root, d)));
  it("scans a meaningful number of files", () => expect(files.length).toBeGreaterThan(30));
  for (const [name, re] of RULES) {
    it(`no hard-coded ${name} in apps/site`, () => {
      const hits: string[] = [];
      for (const f of files) {
        readFileSync(f, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (re.test(line)) hits.push(`${f.replace(root + "/", "")}:${i + 1}: ${line.trim().slice(0, 100)}`);
          });
      }
      expect(hits).toEqual([]);
    });
  }
});
