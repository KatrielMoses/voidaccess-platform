import type { LaunchRequest, RunLauncher } from "./types";

/** Stub until phase R0 (the Cloud Run job + production runner). */
export class CloudRunLauncher implements RunLauncher {
  async launch(_req: LaunchRequest): Promise<{ executionId: string }> {
    throw new Error("CloudRunLauncher.launch: not implemented (R0)");
  }
  async cancel(_executionId: string): Promise<void> {
    throw new Error("CloudRunLauncher.cancel: not implemented (R0)");
  }
}
