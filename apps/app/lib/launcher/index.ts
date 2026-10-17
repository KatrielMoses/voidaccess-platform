import { getEnv } from "../../env";
import { CloudRunLauncher } from "./cloudrun";
import { MockLauncher } from "./mock";
import { ProcessLauncher } from "./process";
import type { RunLauncher } from "./types";

export * from "./types";
export { MockLauncher } from "./mock";
export { CloudRunLauncher } from "./cloudrun";

let override: RunLauncher | null = null;
let cached: RunLauncher | undefined;

/**
 * ENGINE_LAUNCHER=mock|cloudrun|process; unset means mock outside production and cloudrun in production.
 * `process` (development only) runs the real runner locally, see ProcessLauncher.
 */
export function launcherKind(): "mock" | "cloudrun" | "process" {
  const env = getEnv();
  return env.ENGINE_LAUNCHER ?? (env.NODE_ENV === "production" ? "cloudrun" : "mock");
}

/** Artifacts go to the dev mock store (mock engine or a local runner), not the runs bucket. */
export const usesLocalArtifacts = (): boolean => launcherKind() !== "cloudrun";

export function getLauncher(): RunLauncher {
  if (override) return override;
  const kind = launcherKind();
  return (cached ??=
    kind === "mock"
      ? new MockLauncher()
      : kind === "process"
        ? new ProcessLauncher()
        : new CloudRunLauncher());
}

/** Tests: force a launcher (or pass null to go back to the env-selected one). */
export function setLauncher(l: RunLauncher | null): void {
  override = l;
}
