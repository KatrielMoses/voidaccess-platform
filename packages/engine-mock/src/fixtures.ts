import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ResultBundle, type ProgressCounts } from "@voidaccess/engine-client";

export const FIXTURE_NAMES = ["lockbit-deep", "dprk-deep-typed", "blackcat-standard-onion"] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

export function loadFixture(name: string): { bundle: ResultBundle; counts: ProgressCounts } {
  if (!(FIXTURE_NAMES as readonly string[]).includes(name)) throw new Error(`unknown fixture ${name}`);
  const bundle = ResultBundle.parse(JSON.parse(readFileSync(join(dir, `${name}.bundle.json`), "utf8")));
  const counts = JSON.parse(readFileSync(join(dir, `${name}.progress.json`), "utf8")) as ProgressCounts;
  return { bundle, counts };
}

/** Fixture picked by depth when none is given. */
export function defaultFixtureFor(depth: "quick" | "standard" | "deep"): FixtureName {
  return depth === "deep"
    ? "dprk-deep-typed"
    : depth === "standard"
      ? "blackcat-standard-onion"
      : "lockbit-deep";
}
