/**
 * Production artifact readers (Cloud Run launcher): the runs bucket, read as the app's service account through the
 * Cloud Storage JSON API with plain `fetch`. Same shape as P3's `IngestDeps`, so `lib/runs/ingest.ts` hands them
 * straight to `ingestBundle`.
 */
import type { IngestDeps } from "@voidaccess/ingest";
import { defaultTokenProvider, type TokenProvider } from "./gcp-auth";
import { BUNDLE_NAME, EXPORT_FILE, objectName, runsBucket } from "./artifact-paths";
import type { ExportKind } from "@voidaccess/engine-client";

const GCS_API = "https://storage.googleapis.com/storage/v1";
const READ_TIMEOUT_MS = 60_000;
/** A bundle is a few MB; a runaway object is refused rather than buffered. */
export const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;

export interface GcsReaderOptions {
  fetchImpl?: typeof fetch;
  tokenProvider?: TokenProvider;
  bucket?: string;
}

export function gcsArtifactDeps(opts: GcsReaderOptions = {}): IngestDeps {
  const doFetch = opts.fetchImpl ?? fetch;
  const token = opts.tokenProvider ?? defaultTokenProvider;

  /** The object's bytes, or null when it does not exist. Any other failure throws. */
  async function read(runId: string, name: string): Promise<Uint8Array | null> {
    const bucket = opts.bucket ?? runsBucket();
    const url = `${GCS_API}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName(runId, name))}?alt=media`;
    const res = await doFetch(url, {
      headers: { Authorization: `Bearer ${await token()}` },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GCS read of ${name} failed: HTTP ${res.status}`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_ARTIFACT_BYTES) throw new Error(`GCS object ${name} is too large (${declared} bytes)`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_ARTIFACT_BYTES) throw new Error(`GCS object ${name} is too large`);
    return bytes;
  }

  return {
    async readBundle(runId: string): Promise<unknown> {
      const bytes = await read(runId, BUNDLE_NAME);
      if (!bytes) throw new Error("bundle not found in the runs bucket");
      return JSON.parse(new TextDecoder().decode(bytes));
    },
    async readExport(runId: string, format: string): Promise<Uint8Array | null> {
      const file = EXPORT_FILE[format as ExportKind];
      if (!file) return null;
      return read(runId, file);
    },
  };
}
