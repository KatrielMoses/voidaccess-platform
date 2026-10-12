/**
 * Test vectors for the production runner (runner/cloud, Python): callback signing and masking, produced by this
 * package so the Python port is cross-checked against the TypeScript implementation that the app verifies with.
 * Output: runner/cloud/tests/vectors/engine-client.json (committed; `vectors.test.ts` fails if it drifts).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildVectors } from "../src/runner-vectors";

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "runner",
  "cloud",
  "tests",
  "vectors",
);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "engine-client.json"), JSON.stringify(buildVectors(), null, 2) + "\n");
console.log("wrote runner/cloud/tests/vectors/engine-client.json");
