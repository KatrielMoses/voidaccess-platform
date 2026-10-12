/**
 * Where the archive worker reads a finished run's artifacts and keeps page snapshots.
 *  - mock launcher (dev, tests): the mock artifact store (MOCK_ARTIFACT_DIR) and a local filesystem object store.
 *  - cloud run: NOT WIRED YET. The architect wires R0's GCS readers (bundle and pages.jsonl.gz) and a GcsObjectStore
 *    for gs://voidaccess-cloud-archive here, at merge. Until then the job fails visibly and retries; users are unaffected.
 */
import { mockArchiveDeps, type ArchiveDeps } from "@voidaccess/archive";
import { launcherKind } from "../launcher";

export function archiveDepsFor(): ArchiveDeps {
  if (launcherKind() === "mock") return mockArchiveDeps();
  throw new Error(
    "archive readers for Cloud Run runs (GCS bundle, pages.jsonl.gz, archive bucket) are not wired yet",
  );
}
