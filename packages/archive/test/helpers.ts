import pg from "pg";
import type { Database } from "@voidaccess/db";
import { createLocalDatabase } from "@voidaccess/db/local";
import { appUrl, ownerUrl } from "./urls";

let app: Database | undefined;
let owner: pg.Pool | undefined;
export const appDb = () => (app ??= createLocalDatabase(appUrl, { max: 10 }));
export const ownerPool = () => (owner ??= new pg.Pool({ connectionString: ownerUrl, max: 3 }));

/** Wipes the archive between tests (owner connection; the archive is shared state). */
export async function resetArchive() {
  await ownerPool().query(
    "truncate archive_observations, archive_relationship_sources, archive_relationships, archive_aliases, archive_entities, archive_sources, archive_removed_pages, archive_jobs cascade",
  );
}

/** Every archive row and every stored object as one searchable string (for the anonymity scans). */
export async function dumpArchive(objects: Map<string, Uint8Array> | null = null): Promise<string> {
  const parts: string[] = [];
  for (const t of [
    "archive_entities",
    "archive_sources",
    "archive_observations",
    "archive_relationships",
    "archive_relationship_sources",
    "archive_aliases",
    "archive_removed_pages",
  ]) {
    const { rows } = await ownerPool().query(`select row_to_json(x)::text as j from ${t} x`);
    parts.push(...rows.map((r) => r.j as string));
  }
  if (objects) for (const [k, v] of objects) parts.push(k, Buffer.from(v).toString("latin1"));
  return parts.join("\n");
}
