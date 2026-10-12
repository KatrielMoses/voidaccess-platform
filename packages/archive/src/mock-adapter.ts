/**
 * Development and test deps: the bundle comes from the mock artifact store (MOCK_ARTIFACT_DIR, the same
 * `<run id>.bundle.json` files lib/launcher/artifacts.ts writes) and pages from an optional
 * `<run id>.pages.jsonl.gz` beside it. The mock engine writes no pages file, so pages are null there.
 * Production readers (GCS: bundle and pages.jsonl.gz) are wired by the architect from R0.
 */
import { existsSync, createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { LocalFsObjectStore } from "./store";
import type { ArchiveDeps, PageRecord } from "./types";

const RUN_ID = /^[0-9a-f-]{36}$/i;

export function mockArtifactDir(): string {
  return process.env.MOCK_ARTIFACT_DIR ?? join(tmpdir(), "voidaccess-mock-artifacts");
}
export function localArchiveStoreDir(): string {
  return process.env.ARCHIVE_STORE_DIR ?? join(tmpdir(), "voidaccess-archive-objects");
}

export function mockArchiveDeps(opts: { artifactDir?: string; storeDir?: string } = {}): ArchiveDeps {
  const dir = opts.artifactDir ?? mockArtifactDir();
  return {
    async readBundle(runId) {
      if (!RUN_ID.test(runId)) throw new Error("bad run id");
      return JSON.parse(await readFile(join(dir, `${runId}.bundle.json`), "utf8"));
    },
    readPages(runId) {
      if (!RUN_ID.test(runId)) return null;
      const file = join(dir, `${runId}.pages.jsonl.gz`);
      if (!existsSync(file)) return null;
      return (async function* (): AsyncGenerator<PageRecord> {
        const rl = createInterface({
          input: createReadStream(file).pipe(createGunzip()),
          crlfDelay: Infinity,
        });
        for await (const line of rl) if (line.trim()) yield JSON.parse(line) as PageRecord;
      })();
    },
    objectStore: new LocalFsObjectStore(opts.storeDir ?? localArchiveStoreDir()),
  };
}
