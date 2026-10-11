import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ProgressEvent, ResultBundle, RunMetrics, RunSpec } from "../src/index";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
mkdirSync(out, { recursive: true });

const schemas = { RunSpec, ProgressEvent, ResultBundle, RunMetrics } as const;
for (const [name, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", io: "output" });
  const doc = { ...json, $id: `https://voidaccess.dev/schemas/${name}.json`, title: name };
  writeFileSync(join(out, `${name}.json`), JSON.stringify(doc, null, 2) + "\n");
  console.log(`wrote schemas/${name}.json`);
}
