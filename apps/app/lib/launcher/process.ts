import { spawn, type ChildProcess } from "node:child_process";
import { getEnv } from "../../env";
import type { LaunchRequest, RunLauncher } from "./types";

/**
 * Development only: starts the real runner (`runner/cloud`) as a local process, so a run goes through the real
 * engine, Tor and the real callback path without Cloud Run. LOCAL_RUNNER_CMD is the command (run through a shell);
 * it gets SPEC_URL, RUN_ID and DEADLINE_AT like the Cloud Run job, plus VA_NO_AUTH=1 (no identity token locally).
 * cancel() sends SIGTERM, which the runner traps exactly as in Cloud Run. Refuses to run in production.
 */
export class ProcessLauncher implements RunLauncher {
  private readonly running = new Map<string, ChildProcess>();

  async launch(req: LaunchRequest): Promise<{ executionId: string }> {
    const env = getEnv();
    if (env.NODE_ENV === "production") throw new Error("The process launcher cannot run in production");
    if (!env.LOCAL_RUNNER_CMD) throw new Error("LOCAL_RUNNER_CMD is not set");
    const executionId = `local-${req.runId}`;
    const child = spawn(env.LOCAL_RUNNER_CMD, {
      shell: true,
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        SPEC_URL: req.specUrl,
        RUN_ID: req.runId,
        DEADLINE_AT: req.deadlineAt,
        VA_NO_AUTH: "1",
      },
    });
    child.on("exit", (code) => {
      console.log(`local runner ${req.runId}: exited ${code}`);
      this.running.delete(executionId);
    });
    this.running.set(executionId, child);
    return { executionId };
  }

  async cancel(executionId: string): Promise<void> {
    this.running.get(executionId)?.kill("SIGTERM");
  }
}
