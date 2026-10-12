import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

const objects = new Map<string, Uint8Array>();
vi.mock("@/lib/launcher", () => ({ launcherKind: () => "cloudrun" }));
vi.mock("@/lib/launcher/artifacts-gcs", () => ({
  gcsArtifactDeps: () => ({
    readBundle: async (runId: string) => ({ run: runId }),
    readExport: async () => null,
  }),
  gcsRunObjectReader: () => async (runId: string, name: string) => objects.get(`${runId}/${name}`) ?? null,
}));

import { archiveDepsFor } from "@/lib/archive/deps";

async function collect<T>(it: AsyncIterable<T> | null): Promise<T[]> {
  const out: T[] = [];
  if (it) for await (const x of it) out.push(x);
  return out;
}

afterEach(() => objects.clear());

describe("archive deps on Cloud Run", () => {
  it("reads page snapshots from the run's gzipped pages.jsonl.gz", async () => {
    const lines = [
      { url: "http://a.onion/1", fetched_at: "2026-10-01T00:00:00Z", content_hash: "h1", text: "one" },
      { url: "http://b.onion/2", fetched_at: "2026-10-02T00:00:00Z", content_hash: "h2", text: "two" },
    ];
    objects.set("run-1/pages.jsonl.gz", gzipSync(lines.map((l) => JSON.stringify(l)).join("\n") + "\n"));
    const deps = archiveDepsFor();
    expect(await deps.readBundle("run-1")).toEqual({ run: "run-1" });
    expect(await collect(deps.readPages("run-1"))).toEqual(lines);
  });

  it("yields no pages when the runner wrote no pages file", async () => {
    expect(await collect(archiveDepsFor().readPages("run-2"))).toEqual([]);
  });
});
