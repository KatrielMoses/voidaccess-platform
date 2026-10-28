/**
 * Content-safety removal: every item goes through removeFromArchive (tombstone, delete every object version,
 * remember removed page hashes, audit_log). Run by runner/cloud/scripts/safety_purge.py --apply, or by an operator.
 *   pnpm --filter @voidaccess/archive exec tsx scripts/remove-pages.ts --input <file.json> [--reason "<why>"] [--actor ops:<name>]
 * <file.json>: {"pages": ["<sha256>", ...], "sources": ["<uuid>", ...], "entities": ["<uuid>", ...]} (any key optional)
 * Env as scripts/remove.ts: DATABASE_URL (va_app) and DATABASE_URL_SYSTEM (va_worker), plus ARCHIVE_STORE_DIR, or
 * ARCHIVE_BUCKET with GCS_ACCESS_TOKEN. Prints counts only.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { GcsObjectStore, LocalFsObjectStore, removeFromArchive, type RemovalKind } from "../src/index";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    reason: { type: "string", default: "content-safety H211" },
    actor: { type: "string", default: "ops:h211" },
  },
});

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

const HASH = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!values.input) fail("--input is required");
const input = JSON.parse(readFileSync(values.input, "utf8")) as Record<string, unknown>;
const list = (key: string, re: RegExp): string[] => {
  const v = input[key] ?? [];
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && re.test(x)))
    fail(`"${key}" must be a list of ${re === HASH ? "sha256 hashes" : "uuids"}`);
  return [...new Set(v as string[])];
};
const items: Array<{ kind: RemovalKind; key: string }> = [
  ...list("pages", HASH).map((key) => ({ kind: "page" as const, key })),
  ...list("sources", UUID).map((key) => ({ kind: "source" as const, key })),
  ...list("entities", UUID).map((key) => ({ kind: "entity" as const, key })),
];

const dir = process.env.ARCHIVE_STORE_DIR;
const bucket = process.env.ARCHIVE_BUCKET;
const token = process.env.GCS_ACCESS_TOKEN;
const objectStore = dir
  ? new LocalFsObjectStore(dir)
  : bucket && token
    ? new GcsObjectStore(bucket, async () => token)
    : fail("set ARCHIVE_STORE_DIR, or ARCHIVE_BUCKET and GCS_ACCESS_TOKEN");

const totals = { page: 0, source: 0, entity: 0, tombstoned: 0, objectsDeleted: 0 };
for (const item of items) {
  const res = await removeFromArchive(
    { kind: item.kind, key: item.key, reason: values.reason!, actor: values.actor! },
    { objectStore },
  );
  totals[item.kind]++;
  totals.tombstoned += res.tombstoned;
  totals.objectsDeleted += res.objectsDeleted;
}
console.log(JSON.stringify(totals));
process.exit(0);
