import { describe, expect, it } from "vitest";
import { GcpAuthError, createTokenProvider } from "@/lib/launcher/gcp-auth";

const METADATA = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

describe("Google access tokens (plain fetch)", () => {
  it("on Cloud Run: reads the metadata server with the Metadata-Flavor header and caches until near expiry", async () => {
    const calls: { url: string; flavor: string | null }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), flavor: new Headers(init?.headers).get("metadata-flavor") });
      return new Response(JSON.stringify({ access_token: "ya29.meta", expires_in: 3600 }));
    };
    const token = createTokenProvider({ fetchImpl, env: { K_SERVICE: "va-app" } });
    expect(await token()).toBe("ya29.meta");
    expect(await token()).toBe("ya29.meta");
    expect(calls).toEqual([{ url: METADATA, flavor: "Google" }]);
  });

  it("GCP_ACCESS_TOKEN wins (development), and nothing is fetched", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("must not be called");
    };
    expect(await createTokenProvider({ fetchImpl, env: { GCP_ACCESS_TOKEN: "dev-token" } })()).toBe(
      "dev-token",
    );
  });

  it("on Cloud Run a metadata failure is an error, not a fallback to other credentials", async () => {
    const fetchImpl: typeof fetch = async () => new Response("no", { status: 500 });
    await expect(createTokenProvider({ fetchImpl, env: { K_SERVICE: "va-app" } })()).rejects.toBeInstanceOf(
      GcpAuthError,
    );
  });

  it("under test it refuses to use any real credentials (no accidental calls to Google)", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("must not be called");
    };
    await expect(createTokenProvider({ fetchImpl, env: { NODE_ENV: "test" } })()).rejects.toThrow(
      /disabled under test/,
    );
  });
});
