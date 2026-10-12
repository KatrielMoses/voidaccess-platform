import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildVectors } from "./runner-vectors";

describe("runner test vectors", () => {
  it("committed runner/cloud/tests/vectors/engine-client.json is up to date (run `pnpm gen:runner-vectors`)", () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "runner", "cloud", "tests", "vectors", "engine-client.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(JSON.parse(JSON.stringify(buildVectors())));
  });
});
