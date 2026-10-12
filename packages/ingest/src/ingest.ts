import { eq, or, sql } from "drizzle-orm";
import {
  getDatabase,
  invActors,
  invEntities,
  invExports,
  invRelationships,
  invSources,
  invSummary,
  investigations,
  storeCredential,
  type Database,
  type VaultOptions,
} from "@voidaccess/db";
import { ResultBundle, checkBundleIntegrity } from "@voidaccess/engine-client";
import { IngestError } from "./errors";
import { transformBundle } from "./transform";

export interface IngestDeps {
  /** Returns the parsed bundle JSON for a run, or throws if it's missing. */
  readBundle(runId: string): Promise<unknown>;
  /** Returns an export artifact's bytes (stix, misp, sigma, yara, snort, suricata), or null. */
  readExport(runId: string, format: string): Promise<Uint8Array | null>;
}

export const ARTIFACT_FORMATS = ["stix", "misp", "sigma", "yara", "snort", "suricata"] as const;
export const MAX_ENTITIES = 50_000;
const CHUNK = 1000;

export interface IngestOptions {
  /** Tests inject a Database; defaults to the DATABASE_URL singleton (must be the va_app role). */
  database?: Database;
  vault?: VaultOptions;
  /** HMAC key for fingerprints; defaults to VA_FINGERPRINT_KEY. */
  fingerprintKey?: string;
}

function chunks<T>(xs: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

const lookup = (runId: string) =>
  or(sql`${investigations.id}::text = ${runId}`, eq(investigations.engineRunId, runId));

/**
 * Turn a finished run's bundle into the user's immutable snapshot rows.
 * - user_id comes from the investigation row, never from input
 * - validates, masks (raw sensitive values go to the vault, only masked forms are stored), then
 *   writes everything in ONE transaction; a failure leaves nothing behind
 * - idempotent: a second call for an ingested investigation changes nothing
 * - never touches investigation status (the caller marks completed/failed)
 */
export async function ingestBundle(runId: string, deps: IngestDeps, opts: IngestOptions = {}): Promise<void> {
  const database = opts.database ?? getDatabase();
  const fingerprintKey = opts.fingerprintKey ?? process.env.VA_FINGERPRINT_KEY;
  if (!fingerprintKey) throw new Error("VA_FINGERPRINT_KEY is not set");

  // Cheap pre-check (read-only) so an idempotent repeat never reads the bundle.
  const already = await database.withSystem(
    "ingest.bundle.lookup",
    async (tx) => {
      const [inv] = await tx
        .select({ id: investigations.id })
        .from(investigations)
        .where(lookup(runId))
        .limit(1);
      if (!inv) throw new IngestError("not_found", `no investigation for run ${runId}`);
      const [s] = await tx
        .select({ id: invSummary.id })
        .from(invSummary)
        .where(eq(invSummary.investigationId, inv.id))
        .limit(1);
      return Boolean(s);
    },
    { audit: false },
  );
  if (already) return;

  let raw: unknown;
  try {
    raw = await deps.readBundle(runId);
  } catch (e) {
    throw new IngestError("bundle_unreadable", `could not read bundle for ${runId}`, { cause: e });
  }
  const parsed = ResultBundle.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new IngestError(
      "invalid_bundle",
      `bundle failed validation: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`.trim(),
    );
  }
  const bundle = parsed.data;
  if (bundle.entities.length > MAX_ENTITIES)
    throw new IngestError("too_large", `bundle has ${bundle.entities.length} entities (max ${MAX_ENTITIES})`);
  const problems = checkBundleIntegrity(bundle);
  if (problems.length > 0)
    throw new IngestError("integrity", `bundle integrity: ${problems.slice(0, 3).join("; ")}`);

  const t = transformBundle(bundle, { fingerprintKey });

  // Export artifacts are copied now (the runner's object store expires); raw values are scrubbed from them too.
  const artifacts: { format: string; bytes: Buffer }[] = [];
  for (const format of ARTIFACT_FORMATS) {
    let data: Uint8Array | null = null;
    try {
      data = await deps.readExport(runId, format);
    } catch (e) {
      console.warn(
        `ingest: artifact ${format} unreadable for ${runId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (data && data.length > 0)
      artifacts.push({ format, bytes: Buffer.from(t.scrub(Buffer.from(data).toString("utf8")), "utf8") });
  }

  try {
    await database.withSystem("ingest.bundle", async (tx) => {
      const rows = await tx
        .select({ id: investigations.id, userId: investigations.userId })
        .from(investigations)
        .where(lookup(runId))
        .for("update")
        .limit(1);
      const inv = rows[0];
      if (!inv) throw new IngestError("not_found", `no investigation for run ${runId}`);
      const base = { userId: inv.userId, investigationId: inv.id };

      // The summary row is the idempotency marker; its unique index makes a concurrent double ingest a no-op.
      const inserted = await tx
        .insert(invSummary)
        .values({
          ...base,
          markdown: t.summary.markdown,
          keyFindings: t.summary.keyFindings,
          riskNotes: t.summary.riskNotes,
          confidence: t.summary.confidence,
          sourceCount: t.summary.sourceCount,
          communities: t.summary.communities,
          entityCounts: t.summary.entityCounts,
          stats: t.summary.stats,
        })
        .onConflictDoNothing()
        .returning({ id: invSummary.id });
      if (inserted.length === 0) return;

      // Raw sensitive values: encrypted into the vault inside this same transaction.
      for (const v of t.vault) {
        await storeCredential(
          { userId: inv.userId, investigationId: inv.id, type: v.type, value: v.value },
          { tx },
          opts.vault,
        );
      }
      for (const c of chunks(t.entities))
        await tx.insert(invEntities).values(c.map((e) => ({ ...base, ...e })));
      for (const c of chunks(t.relationships))
        await tx.insert(invRelationships).values(c.map((r) => ({ ...base, ...r })));
      if (t.actors.length) await tx.insert(invActors).values(t.actors.map((a) => ({ ...base, ...a })));
      for (const c of chunks(t.sources))
        await tx.insert(invSources).values(c.map((s) => ({ ...base, ...s })));
      for (const a of artifacts) {
        await tx.insert(invExports).values({
          ...base,
          format: a.format,
          objectPath: `db://inv_exports/${inv.id}/${a.format}`,
          bytes: a.bytes.length,
          content: a.bytes,
        });
      }
    });
  } catch (e) {
    if (e instanceof IngestError) throw e;
    throw new IngestError(
      "write_failed",
      `ingest transaction failed: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }
}
