import { describe, expect, it, vi } from "vitest";
import { RunSpec } from "@voidaccess/engine-client";
import { investigations } from "@voidaccess/db";
import { eq } from "drizzle-orm";

const kind = vi.hoisted(() => ({ value: "cloudrun" as "mock" | "cloudrun" }));
vi.mock("@/lib/launcher", async (orig) => ({
  ...(await orig<typeof import("@/lib/launcher")>()),
  launcherKind: () => kind.value,
}));

import { StubLauncher, db, makeUser } from "./helpers";
import { setLauncher } from "@/lib/launcher";
import { startInvestigation } from "@/lib/runs/service";
import { consumeSpecToken } from "@/lib/runs/spec";

const stub = new StubLauncher();
setLauncher(stub);

async function specFor(depth: "quick" | "standard") {
  const u = await makeUser();
  const r = await startInvestigation(u, { query: "spec url switch query", depth });
  const token = new URL(stub.launches.find((l) => l.runId === r.id)!.specUrl).searchParams.get("t")!;
  const spec = await consumeSpecToken(r.id, token);
  return { id: r.id, spec: spec! };
}

describe("RunSpec artifact URLs by launcher", () => {
  it("cloudrun: gs:// paths in the runs bucket for the bundle, every export format and the page archive", async () => {
    kind.value = "cloudrun";
    const { id, spec } = await specFor("quick");
    const base = `gs://voidaccess-cloud-runs/runs/${id}`;
    expect(spec.artifact_put_urls).toEqual({
      bundle: `${base}/bundle.json`,
      exports: {
        stix: `${base}/stix.json`,
        misp: `${base}/misp.json`,
        sigma: `${base}/sigma.yml`,
        yara: `${base}/yara.yar`,
        snort: `${base}/snort.rules`,
        suricata: `${base}/suricata.rules`,
      },
      pages: `${base}/pages.jsonl.gz`,
    });
    expect(RunSpec.safeParse(JSON.parse(JSON.stringify(spec))).success).toBe(true);
    expect(JSON.stringify(spec.artifact_put_urls)).not.toContain("?t=");
  });

  it("mock: unchanged (the app's own artifact route, no exports)", async () => {
    kind.value = "mock";
    const { id, spec } = await specFor("standard");
    expect(spec.artifact_put_urls.exports).toEqual({});
    expect(spec.artifact_put_urls.bundle).toMatch(
      new RegExp(`^http://localhost:3000/api/engine/runs/${id}/artifacts/bundle\\?t=[0-9a-f]{64}$`),
    );
    expect("pages" in spec.artifact_put_urls).toBe(false);
    void db;
    void investigations;
    void eq;
  });
});
