import { describe, expect, it, vi } from "vitest";
import { MAX_ARTIFACT_BYTES, gcsArtifactDeps } from "@/lib/launcher/artifacts-gcs";

const RUN = "0b7a6e5c-1f2d-4a3b-8c9d-0e1f2a3b4c5d";
const base = (name: string) =>
  `https://storage.googleapis.com/storage/v1/b/voidaccess-cloud-runs/o/${encodeURIComponent(`runs/${RUN}/${name}`)}?alt=media`;

function deps(responder: (url: string) => Response) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
    return responder(String(input));
  };
  return { calls, deps: gcsArtifactDeps({ fetchImpl, tokenProvider: async () => "tok-gcs" }) };
}

describe("GCS artifact readers (IngestDeps shape)", () => {
  it("readBundle reads runs/<id>/bundle.json as the app and parses it", async () => {
    const t = deps(() => new Response(JSON.stringify({ schema_version: 1, run_id: RUN })));
    await expect(t.deps.readBundle(RUN)).resolves.toEqual({ schema_version: 1, run_id: RUN });
    expect(t.calls).toEqual([{ url: base("bundle.json"), auth: "Bearer tok-gcs" }]);
  });

  it("readBundle throws when the bundle is missing, unreadable or not JSON", async () => {
    await expect(deps(() => new Response("", { status: 404 })).deps.readBundle(RUN)).rejects.toThrow(
      /not found/,
    );
    await expect(deps(() => new Response("", { status: 500 })).deps.readBundle(RUN)).rejects.toThrow(
      /HTTP 500/,
    );
    await expect(deps(() => new Response("not json")).deps.readBundle(RUN)).rejects.toThrow();
  });

  it("readExport returns bytes per format, null when absent, and null for unknown formats without a request", async () => {
    const files: Record<string, string> = {
      "stix.json": "{}",
      "sigma.yml": "title: x",
      "snort.rules": "alert",
    };
    const t = deps((url) => {
      const name = decodeURIComponent(url.split("/o/")[1]!.split("?")[0]!).split("/").pop()!;
      return name in files ? new Response(files[name]) : new Response("", { status: 404 });
    });
    expect(new TextDecoder().decode((await t.deps.readExport(RUN, "stix"))!)).toBe("{}");
    expect(new TextDecoder().decode((await t.deps.readExport(RUN, "sigma"))!)).toBe("title: x");
    expect(await t.deps.readExport(RUN, "yara")).toBeNull();
    const before = t.calls.length;
    expect(await t.deps.readExport(RUN, "../../etc/passwd")).toBeNull();
    expect(await t.deps.readExport(RUN, "csv")).toBeNull();
    expect(t.calls.length).toBe(before);
    expect(t.calls.map((c) => decodeURIComponent(c.url.split("/o/")[1]!.split("?")[0]!))).toEqual([
      `runs/${RUN}/stix.json`,
      `runs/${RUN}/sigma.yml`,
      `runs/${RUN}/yara.yar`,
    ]);
  });

  it("readExport surfaces a server error (ingest logs it and goes on) and refuses oversized objects", async () => {
    await expect(deps(() => new Response("", { status: 503 })).deps.readExport(RUN, "misp")).rejects.toThrow(
      /503/,
    );
    const big = new Response("x", { headers: { "content-length": String(MAX_ARTIFACT_BYTES + 1) } });
    await expect(deps(() => big).deps.readExport(RUN, "misp")).rejects.toThrow(/too large/);
  });

  it("a run id with path characters cannot escape its prefix (the object name is one encoded path segment)", async () => {
    const t = deps(() => new Response("{}"));
    await t.deps.readBundle("../other/run");
    expect(t.calls[0]!.url).toContain(encodeURIComponent("runs/../other/run/bundle.json"));
    expect(t.calls[0]!.url).not.toContain("/o/runs/");
    void vi;
  });
});
