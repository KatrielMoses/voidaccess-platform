import { describe, expect, it, vi } from "vitest";
import type { IngestDeps } from "@voidaccess/ingest";

const state = vi.hoisted(() => ({
  kind: "cloudrun" as "mock" | "cloudrun",
  deps: undefined as IngestDeps | undefined,
}));
vi.mock("@/lib/launcher", async (orig) => ({
  ...(await orig<typeof import("@/lib/launcher")>()),
  launcherKind: () => state.kind,
}));
vi.mock("@voidaccess/ingest", async (orig) => ({
  ...(await orig<typeof import("@voidaccess/ingest")>()),
  ingestBundle: vi.fn(async (_runId: string, deps: IngestDeps) => {
    state.deps = deps;
  }),
}));

import { ingestBundle, resetIngest } from "@/lib/runs/ingest";

describe("ingest hook artifact readers", () => {
  it("cloudrun: hands P3's ingest the GCS readers (no more 'not wired yet' error)", async () => {
    resetIngest();
    state.kind = "cloudrun";
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ ok: true }));
    });
    process.env.GCP_ACCESS_TOKEN = "tok";
    try {
      await ingestBundle("0b7a6e5c-1f2d-4a3b-8c9d-0e1f2a3b4c5d");
      expect(await state.deps!.readBundle("0b7a6e5c-1f2d-4a3b-8c9d-0e1f2a3b4c5d")).toEqual({ ok: true });
      expect(urls[0]).toContain("storage.googleapis.com/storage/v1/b/voidaccess-cloud-runs/o/");
    } finally {
      delete process.env.GCP_ACCESS_TOKEN;
      vi.unstubAllGlobals();
    }
  });

  it("mock: still reads the local mock artifact store", async () => {
    resetIngest();
    state.kind = "mock";
    await ingestBundle("0b7a6e5c-1f2d-4a3b-8c9d-0e1f2a3b4c5e");
    await expect(state.deps!.readBundle("0b7a6e5c-1f2d-4a3b-8c9d-0e1f2a3b4c5e")).rejects.toThrow(
      /mock artifact store/,
    );
    expect(await state.deps!.readExport("x", "stix")).toBeNull();
  });
});
