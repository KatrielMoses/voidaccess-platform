/**
 * Ingest hook (lane P3 plugs in here).
 *
 * CONTRACT
 *  - `registerIngest(fn)`: P3 registers its implementation with one line. Last registration wins.
 *  - The lifecycle calls `ingestBundle(runId)` AFTER the engine's `completed` callback has been accepted and
 *    the run is in status `ingesting`, and outside any DB transaction. `runId` is the investigation id.
 *  - `fn` reads the bundle (GCS in production; `readMockBundle(runId)` from lib/launcher/artifacts with the mock
 *    launcher), validates it, masks sensitive entities and writes the inv_* snapshot rows (withSystem).
 *    It must be idempotent: the same run can be re-ingested if a previous attempt crashed.
 *  - If `fn` resolves, the run becomes `completed` (no ledger change). If it THROWS, the run becomes `failed`
 *    with failure_reason `ingest_failure` and the user is refunded in full: P3 owns bundle content, and a run
 *    the user cannot read must not be charged. A run stuck in `ingesting` for WATCHDOG_SILENCE_MINUTES is failed
 *    and refunded by the watchdog.
 *  - The default is P3's real ingest (wired at the P2+P3 merge). Tests that only exercise the lifecycle can
 *    call useNoopIngest().
 */
import { ingestBundle as runIngest, type IngestDeps } from "@voidaccess/ingest";
import { launcherKind } from "../launcher";
import { readMockBundle } from "../launcher/artifacts";

export type IngestFn = (runId: string) => Promise<void>;

/** Where ingest reads artifacts from. Mock launcher: the local artifact store. Cloud Run: R0's GCS readers. */
function artifactDeps(): IngestDeps {
  if (launcherKind() === "mock") {
    return {
      async readBundle(runId) {
        const raw = await readMockBundle(runId);
        if (raw === null) throw new Error("bundle not found in the mock artifact store");
        return JSON.parse(raw);
      },
      async readExport() {
        return null; // the mock launcher stores no export artifacts
      },
    };
  }
  throw new Error("GCS artifact readers are not wired yet (R0)");
}

/** P3's ingest (validate, mask, write the inv_* snapshot) is the default since the P2+P3 merge. */
const defaultIngest: IngestFn = (runId) => runIngest(runId, artifactDeps());
const noop: IngestFn = async () => {};
let impl: IngestFn = defaultIngest;

export function registerIngest(fn: IngestFn): void {
  impl = fn;
}

/** Test helper: back to the default (P3's real ingest). */
export function resetIngest(): void {
  impl = defaultIngest;
}

/** Test helper: skip ingest entirely (lifecycle-only tests). */
export function useNoopIngest(): void {
  impl = noop;
}

export function ingestBundle(runId: string): Promise<void> {
  return impl(runId);
}
