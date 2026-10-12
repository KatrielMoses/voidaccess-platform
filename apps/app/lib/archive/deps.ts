/**
 * Where the archive worker reads a finished run's artifacts and keeps page snapshots.
 *  - mock launcher (dev, tests): the mock artifact store (MOCK_ARTIFACT_DIR) and a local filesystem object store.
 *  - cloud run: the run's bundle and pages.jsonl.gz from the runs bucket (R0's reader), page snapshots in the
 *    permanent, versioned archive bucket (ARCHIVE_BUCKET) through P4's GcsObjectStore, all as the app's identity.
 */
import { gunzipSync } from "node:zlib";
import { GcsObjectStore, mockArchiveDeps, type ArchiveDeps, type PageRecord } from "@voidaccess/archive";
import { getEnv } from "../../env";
import { launcherKind } from "../launcher";
import { PAGES_NAME } from "../launcher/artifact-paths";
import { gcsArtifactDeps, gcsRunObjectReader } from "../launcher/artifacts-gcs";
import { defaultTokenProvider } from "../launcher/gcp-auth";

export function archiveDepsFor(): ArchiveDeps {
  if (launcherKind() === "mock") return mockArchiveDeps();
  const runs = gcsArtifactDeps();
  const readRunObject = gcsRunObjectReader();
  return {
    readBundle: (runId) => runs.readBundle(runId),
    readPages(runId) {
      // An async generator: a missing pages file (404) simply yields nothing, so the archive works from the bundle.
      return (async function* (): AsyncGenerator<PageRecord> {
        const gz = await readRunObject(runId, PAGES_NAME);
        if (!gz) return;
        for (const line of new TextDecoder().decode(gunzipSync(gz)).split("\n")) {
          if (line.trim()) yield JSON.parse(line) as PageRecord;
        }
      })();
    },
    objectStore: new GcsObjectStore(getEnv().ARCHIVE_BUCKET, defaultTokenProvider),
  };
}
