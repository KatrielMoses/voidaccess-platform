/**
 * Removal CLI. Run by an operator, never by the app.
 *   pnpm --filter @voidaccess/archive remove -- --kind entity|source|page --key <key> --reason "<why>" --actor ops:<name>
 * Needs DATABASE_URL (the app role; removal goes through withSystem) and either ARCHIVE_STORE_DIR (local objects)
 * or ARCHIVE_BUCKET with GCS_ACCESS_TOKEN (for example `gcloud auth print-access-token`).
 */
import { parseArgs } from "node:util";
import { GcsObjectStore, LocalFsObjectStore, removeFromArchive, type RemovalKind } from "../src/index";

const { values } = parseArgs({
  options: {
    kind: { type: "string" },
    key: { type: "string" },
    reason: { type: "string" },
    actor: { type: "string" },
  },
});

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

const kind = values.kind as RemovalKind | undefined;
if (!kind || !["entity", "source", "page"].includes(kind)) fail("--kind must be entity, source or page");
if (!values.key || !values.reason || !values.actor) fail("--key, --reason and --actor are required");

const dir = process.env.ARCHIVE_STORE_DIR;
const bucket = process.env.ARCHIVE_BUCKET;
const token = process.env.GCS_ACCESS_TOKEN;
const objectStore = dir
  ? new LocalFsObjectStore(dir)
  : bucket && token
    ? new GcsObjectStore(bucket, async () => token)
    : fail("set ARCHIVE_STORE_DIR, or ARCHIVE_BUCKET and GCS_ACCESS_TOKEN");

const res = await removeFromArchive(
  { kind: kind!, key: values.key, reason: values.reason, actor: values.actor },
  { objectStore },
);
console.log(JSON.stringify(res));
process.exit(0);
