import { afterEach, describe, expect, it, vi } from "vitest";
import DevUiPage from "@/app/dev/ui/page";

describe("development surfaces (guarantee 4)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("/dev/ui is a 404 in production, for everyone", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => DevUiPage()).toThrowError(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });

  it("renders in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(() => DevUiPage()).not.toThrow();
  });
});
