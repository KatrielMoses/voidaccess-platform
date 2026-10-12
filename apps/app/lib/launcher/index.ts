import { getEnv } from "../../env";
import { CloudRunLauncher } from "./cloudrun";
import { MockLauncher } from "./mock";
import type { RunLauncher } from "./types";

export * from "./types";
export { MockLauncher } from "./mock";
export { CloudRunLauncher } from "./cloudrun";

let override: RunLauncher | null = null;
let cached: RunLauncher | undefined;

/** ENGINE_LAUNCHER=mock|cloudrun; unset means mock outside production and cloudrun in production. */
export function launcherKind(): "mock" | "cloudrun" {
  const env = getEnv();
  return env.ENGINE_LAUNCHER ?? (env.NODE_ENV === "production" ? "cloudrun" : "mock");
}

export function getLauncher(): RunLauncher {
  if (override) return override;
  return (cached ??= launcherKind() === "mock" ? new MockLauncher() : new CloudRunLauncher());
}

/** Tests: force a launcher (or pass null to go back to the env-selected one). */
export function setLauncher(l: RunLauncher | null): void {
  override = l;
}
