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
 *  - The default is a no-op, so the platform works end to end without P3 (the run is marked completed).
 */
export type IngestFn = (runId: string) => Promise<void>;

const noop: IngestFn = async () => {};
let impl: IngestFn = noop;

export function registerIngest(fn: IngestFn): void {
  impl = fn;
}

/** Test helper: back to the default no-op. */
export function resetIngest(): void {
  impl = noop;
}

export function ingestBundle(runId: string): Promise<void> {
  return impl(runId);
}
