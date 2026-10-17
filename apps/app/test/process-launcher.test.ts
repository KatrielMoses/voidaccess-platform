import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ NODE_ENV: "production", LOCAL_RUNNER_CMD: "true" as string | undefined }));
vi.mock("@/env", () => ({ getEnv: () => env }));

const { ProcessLauncher } = await import("@/lib/launcher/process");
const req = { runId: "r1", specUrl: "http://localhost:3000/spec", deadlineAt: new Date().toISOString() };

describe("ProcessLauncher (development only)", () => {
  it("refuses to start a run in production", async () => {
    env.NODE_ENV = "production";
    await expect(new ProcessLauncher().launch(req)).rejects.toThrow(/cannot run in production/);
  });

  it("needs LOCAL_RUNNER_CMD", async () => {
    env.NODE_ENV = "development";
    env.LOCAL_RUNNER_CMD = undefined;
    await expect(new ProcessLauncher().launch(req)).rejects.toThrow(/LOCAL_RUNNER_CMD/);
  });
});
