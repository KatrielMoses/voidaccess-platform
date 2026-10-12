/**
 * Mock artifact store: where the mock engine PUTs its result bundle
 * (`PUT /api/engine/runs/{id}/artifacts/bundle?t=<hmac>`). One JSON file per run in
 * MOCK_ARTIFACT_DIR (default: <os tmp>/voidaccess-mock-artifacts). Development and tests only: the route
 * returns 404 unless the mock launcher is selected. The P3 ingest registered via registerIngest() can read
 * the bundle with readMockBundle(runId); in production the bundle lives in GCS and R0 replaces this.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getEnv } from "../../env";

const dir = () => getEnv().MOCK_ARTIFACT_DIR ?? join(tmpdir(), "voidaccess-mock-artifacts");
const fileFor = (runId: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new Error("bad run id");
  return join(dir(), `${runId}.bundle.json`);
};

export async function putMockBundle(runId: string, body: string): Promise<void> {
  await mkdir(dir(), { recursive: true });
  await writeFile(fileFor(runId), body, "utf8");
}

/** Returns the raw bundle JSON text, or null when none was uploaded. */
export async function readMockBundle(runId: string): Promise<string | null> {
  try {
    return await readFile(fileFor(runId), "utf8");
  } catch {
    return null;
  }
}
