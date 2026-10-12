import { getEnv } from "../../env";
import { defaultTokenProvider, type TokenProvider } from "./gcp-auth";
import type { LaunchRequest, RunLauncher } from "./types";

const RUN_API = "https://run.googleapis.com/v2";
const CALL_TIMEOUT_MS = 30_000;

/** A launch or cancel call failed. The message never contains the request body (it holds the single-use spec URL). */
export class LaunchError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "LaunchError";
  }
}

export interface CloudRunLauncherOptions {
  fetchImpl?: typeof fetch;
  tokenProvider?: TokenProvider;
  project?: string;
  region?: string;
  job?: string;
  baseUrl?: string;
}

/**
 * Starts one execution of the `va-runner` Cloud Run Job per investigation through the Cloud Run Admin API v2
 * (`jobs.run` / `executions.cancel`), authenticated as the app's own service account (metadata server).
 *
 * SECURITY (ENGINE-CONTRACT section 1): the execution overrides carry exactly SPEC_URL, RUN_ID and DEADLINE_AT, so the
 * query never reaches Cloud Run execution metadata. SPEC_URL is a single-use token URL that is dead after one fetch
 * or ten minutes.
 */
export class CloudRunLauncher implements RunLauncher {
  private readonly doFetch: typeof fetch;
  private readonly token: TokenProvider;
  private readonly project: string;
  private readonly region: string;
  private readonly job: string;
  private readonly base: string;

  constructor(opts: CloudRunLauncherOptions = {}) {
    const env = getEnv();
    this.doFetch = opts.fetchImpl ?? fetch;
    this.token = opts.tokenProvider ?? defaultTokenProvider;
    this.project = opts.project ?? env.GCP_PROJECT;
    this.region = opts.region ?? env.GCP_REGION;
    this.job = opts.job ?? env.RUNNER_JOB_NAME;
    this.base = opts.baseUrl ?? RUN_API;
  }

  async launch(req: LaunchRequest): Promise<{ executionId: string }> {
    const url = `${this.base}/projects/${this.project}/locations/${this.region}/jobs/${this.job}:run`;
    const body = {
      overrides: {
        taskCount: 1,
        containerOverrides: [
          {
            env: [
              { name: "SPEC_URL", value: req.specUrl },
              { name: "RUN_ID", value: req.runId },
              { name: "DEADLINE_AT", value: req.deadlineAt },
            ],
          },
        ],
      },
    };
    const op = await this.call(url, body, [req.specUrl]);
    if (op.error)
      throw new LaunchError(`jobs.run failed: ${op.error.status ?? "error"}`, undefined, op.error.status);
    const name = op.metadata?.name;
    if (typeof name !== "string" || !/\/executions\/[^/]+$/.test(name))
      throw new LaunchError("jobs.run returned no execution name");
    return { executionId: name };
  }

  async cancel(executionId: string): Promise<void> {
    if (!/^projects\/[^/]+\/locations\/[^/]+\/jobs\/[^/]+\/executions\/[^/]+$/.test(executionId))
      throw new LaunchError("not a Cloud Run execution name");
    try {
      await this.call(`${this.base}/${executionId}:cancel`, {}, []);
    } catch (e) {
      // Already finished, or already gone: the goal (nothing running) is met.
      if (e instanceof LaunchError && (e.httpStatus === 404 || e.code === "FAILED_PRECONDITION")) return;
      throw e;
    }
  }

  private async call(url: string, body: unknown, redact: string[]): Promise<GoogleOperation> {
    const token = await this.token();
    let res: Response;
    try {
      res = await this.doFetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (e) {
      throw new LaunchError(`Cloud Run API unreachable (${e instanceof Error ? e.name : "error"})`);
    }
    if (!res.ok) {
      let status: string | undefined;
      let message = "";
      try {
        const j = (await res.json()) as { error?: { status?: string; message?: string } };
        status = j.error?.status;
        message = j.error?.message ?? "";
      } catch {
        /* not JSON */
      }
      for (const secret of redact) message = message.split(secret).join("[redacted]");
      throw new LaunchError(
        `Cloud Run API ${res.status}${status ? ` ${status}` : ""}${message ? `: ${message.slice(0, 200)}` : ""}`,
        res.status,
        status,
      );
    }
    return (await res.json()) as GoogleOperation;
  }
}

interface GoogleOperation {
  name?: string;
  done?: boolean;
  metadata?: { name?: string };
  error?: { status?: string; message?: string };
}
